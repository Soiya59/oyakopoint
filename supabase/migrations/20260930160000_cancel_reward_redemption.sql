-- ============================================================
-- 07-39章「ごほうびの交換の直後の取消（誤操作リカバリ、1分以内）」
-- （統括決定・2026-09-25、やること.md 2-71）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-39章
--   設計部/成果物/スキーマ設計.sql 77章（77.1〜77.9。cancel_reward_redemption()の
--     DDL本体〔77.4章〕・EXECUTE権限〔77.5章〕は、下記へそのまま写している。
--     権限・時間窓の判定方式〔77.3章〕、「もう使われている」状態が無いことの
--     確認〔77.2章〕、物理削除にそろえる判断〔77.1章〕は同ファイル参照）
--   設計部/成果物/API仕様.md 34章（呼び出し方法）・11章（エラー表に3行追記）
--   開発部/成果物/実装メモ.md 298章（本マイグレーション対応章）
--
-- [背景] 完了報告の取消（07-17章・43章、cancel_chore_completion）と同じ考え方に
-- そろえ、ごほうびの交換から1分以内に限り、交換した本人（家族共有rewardは
-- 保護者も。自分専用・みまもり共通rewardは本人のみ）が交換記録を物理削除し、
-- 使ったポイントを自動的に戻せるようにする。新規テーブル・新規カラムの追加は無い。
--
-- 破壊性: 非破壊的。新規関数1件（cancel_reward_redemption）の追加のみで、
-- 既存テーブル・既存関数・既存ポリシーの定義・既存データには一切触れない。
-- `reward_redemptions`への新しいDELETEポリシーは追加しない（77.1章。削除経路は
-- 本RPC1本に集約する）。
--
-- 権限影響: RLS照査スイート（oyakopoint-app/supabase/tests/rls_checks.sql）の
-- S4（authenticatedが実行できる関数の件数照合）の期待値が98件→99件になる
-- （新規関数1件をauthenticatedへGRANTするため）。S1（RLS有効テーブル数）・
-- S3（ポリシー本数の定義照合）はいずれも±0（77.6章のとおり新規テーブル・新規
-- ポリシーを追加していない）。適用後、開発部/成果物/実装メモ.md 298章の手順に
-- 従いS1/S3/S4を実測し、FAILが本ファイルの意図した変更によるものであることを
-- 確認したうえでスナップショットを更新すること（96章の運用手順）。
--
-- [重要] 本マイグレーションはまだ本番に適用していない（作成のみ）。
-- 適用は本部長の操作を待つ（開発部/成果物/実装メモ.md 298章参照）。
-- ============================================================

-- ------------------------------------------------------------
-- cancel_reward_redemption() DDL本体（スキーマ設計.sql 77.4章）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_reward_redemption(p_redemption_id UUID)
RETURNS TABLE (
  redemption_id UUID,
  reward_id UUID,
  reward_name TEXT,
  member_id UUID,
  cost INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_family_id UUID := current_family_id();
  v_caller_member_id UUID := current_family_member_id();
  v_redemption RECORD;
  v_scope TEXT;
BEGIN
  IF v_caller_family_id IS NULL OR v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [77.3章] 1. 対象行の取得・存在確認（自家族限定・行ロック）。他家族の
  -- 行と存在しないIDは区別せず同一のno_data_foundに収束させる（43.2章と
  -- 同じ設計）。rewardsはLEFT JOINする（対象rewardが既に削除されていても
  -- 〈reward_idはON DELETE SET NULL〉取消自体は継続できるようにするため）。
  SELECT rr.*, r.scope AS reward_scope
    INTO v_redemption
  FROM reward_redemptions rr
  LEFT JOIN rewards r ON r.id = rr.reward_id
  WHERE rr.id = p_redemption_id
    AND rr.family_id = v_caller_family_id
  FOR UPDATE OF rr;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の交換記録が見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  -- [77.3章・43.2章とは逆方向] rewardが既に削除されscopeが不明(NULL)な
  -- 場合、43.2章（chore側）は広いほう（'family'）へ倒したが、本関数は
  -- 狭いほう（'personal'扱い＝本人のみ）へ倒す。理由は77.3章参照。
  v_scope := COALESCE(v_redemption.reward_scope, 'personal');

  -- [77.3章] 2. 権限判定。personal/supporter_sharedはまとめて本人のみ、
  -- familyのみ本人または保護者（43.2章・45.12章と同型）。
  IF v_scope IN ('personal', 'supporter_shared') THEN
    IF v_redemption.member_id <> v_caller_member_id THEN
      RAISE EXCEPTION 'この交換は本人のみ取り消せます' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF v_redemption.member_id <> v_caller_member_id AND NOT public.is_current_user_parent() THEN
      RAISE EXCEPTION 'この交換を取り消す権限がありません' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- [77.3章] 3. 時間窓（ちょうど60秒は取消可能側に含める）。
  IF now() - v_redemption.created_at > INTERVAL '1 minute' THEN
    RAISE EXCEPTION '交換から1分を過ぎているため取消できません' USING ERRCODE = 'check_violation';
  END IF;

  -- [77.2章] 「もう使われている」状態は存在しないため、43.2章のガチャ判定・
  -- 43.5章の木の飾り付け判定・43.2章5.の残高判定に相当するチェックは
  -- いずれも無い（取消はポイントを戻す＝加算方向のみであり、member_points
  -- が負になる余地が無い）。

  -- 4. 削除。member_pointsはView集計のため、これだけで残高へ即座に反映
  -- される（二重に戻す・戻し忘れが構造的に起きない。77.1章参照）。
  DELETE FROM reward_redemptions WHERE id = p_redemption_id;

  RETURN QUERY SELECT
    v_redemption.id, v_redemption.reward_id, v_redemption.reward_name,
    v_redemption.member_id, v_redemption.cost;
END;
$$;

COMMENT ON FUNCTION public.cancel_reward_redemption(UUID) IS
  '要件定義書07-39章「ごほうびの交換の直後の取消」。交換から1分以内に限り、交換した本人（家族共有rewardは保護者も。自分専用・みまもり共通rewardは本人のみ）が交換記録を物理削除し、使ったポイントをmember_points（View集計）経由で自動的に戻す。「もう使われている」状態は存在しない（77.2章）ため、ガチャ判定・残高判定に相当するチェックは無い。reward_redemptionsへの新しいDELETEポリシーは追加せず、削除経路を本RPCに集約する（07-17章・43.1章と同じ設計方針）。EXECUTE権限は77.5章参照。';

-- ------------------------------------------------------------
-- EXECUTE権限（GRANT/REVOKE）— スキーマ設計.sql 77.5章
-- ------------------------------------------------------------
-- cancel_chore_completion()等と同じ扱いとする。33g章の教訓（PUBLICからの
-- REVOKEだけではSupabaseが直接付与するanonのEXECUTEは消えない）を踏まえ、
-- anonを明示的にREVOKEの対象に含める。
REVOKE ALL ON FUNCTION public.cancel_reward_redemption(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_reward_redemption(UUID) TO authenticated;
