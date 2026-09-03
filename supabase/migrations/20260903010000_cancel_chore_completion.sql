-- ============================================================
-- 07-17章「完了報告の直後の取消（誤操作リカバリ、1分以内）」
-- （2026-09-03・統括が実装まで承認）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-17章・05章「設計部への申し送り事項」
--   設計部/成果物/スキーマ設計.sql 43章（43.1〜43.10。cancel_chore_completion()の
--     DDL本体〔43.6章〕・EXECUTE権限〔43.7章〕は、下記へそのまま写している。
--     設計判断の経緯〔ガチャCHECK制約との整合・シーズン境界・木への飾り付けとの
--     整合〕は43.3・43.4・43.5章参照。43.3章は本部長の訂正注記（43.4章直後）が
--     正であり、43.6章のDDLは訂正後の結論（更新直前の防御的再検証は残す）を
--     そのまま実装している）
--   設計部/成果物/API仕様.md 4d節（呼び出し方法）・11章（エラー表に5行追記）
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 28章（C7・C5・P8・S2への
--     画面設計。28.5節は撤回済み・28.5aが現行仕様のためC18には実装しない）
--   開発部/成果物/実装メモ.md 120章（本マイグレーション対応章）
--
-- [背景] 統括の発言「誤ってクエストをしてしまった時に削除することを入れたほうが
-- よいかな？」を受け、報告から1分以内に限り報告者本人（家族共有choreは保護者も）が
-- 完了報告を物理削除できるRPCを新設する。新規テーブル・新規カラムの追加は無い。
--
-- 破壊性: 非破壊的。新規関数1件（cancel_chore_completion）の追加のみで、
-- 既存テーブル・既存関数・既存ポリシーの定義・既存データには一切触れない。
-- `chore_completions`への新しいDELETEポリシーは追加しない（43.1章。削除経路は
-- 本RPC1本に集約する）。
--
-- 権限影響: RLS照査スイート（oyakopoint-app/supabase/tests/rls_checks.sql）の
-- S4（authenticatedが実行できる関数の件数照合）の期待値が48件→49件になる
-- （新規関数1件をauthenticatedへGRANTするため）。S1（RLS有効テーブル数）・
-- S3（ポリシー本数の定義照合）はいずれも±0（43.8章のとおり新規テーブル・新規
-- ポリシーを追加していない）。適用後、開発部/成果物/実装メモ.md 120章の手順に
-- 従いS1/S3/S4を実測し、FAILが本ファイルの意図した変更によるものであることを
-- 確認したうえでスナップショットを更新すること（96章の運用手順）。
--
-- [重要] 本マイグレーションはまだ本番に適用していない（作成のみ）。
-- 適用は本部長の操作を待つ（開発部/成果物/実装メモ.md 120章参照）。
-- ============================================================

-- ------------------------------------------------------------
-- cancel_chore_completion() DDL本体（スキーマ設計.sql 43.6章）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_chore_completion(p_completion_id UUID)
RETURNS TABLE (
  completion_id UUID,
  chore_id UUID,
  chore_title TEXT,
  reported_by UUID,
  points INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_family_id UUID := current_family_id();
  v_caller_member_id UUID := current_family_member_id();
  v_completion RECORD;
  v_scope TEXT;
  v_month_start DATE;
  v_season_id UUID;
  v_progress RECORD;
  v_new_lifetime INT;
  v_balance INT;
BEGIN
  IF v_caller_family_id IS NULL OR v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [43.2章] 1. 対象行の取得・存在確認（自家族限定・行ロック）。他家族の
  -- 行と存在しないIDは区別せず同一のno_data_foundに収束させる。
  SELECT cc.*, COALESCE(c.scope, 'family') AS chore_scope
    INTO v_completion
  FROM chore_completions cc
  LEFT JOIN chores c ON c.id = cc.chore_id
  WHERE cc.id = p_completion_id
    AND cc.family_id = v_caller_family_id
  FOR UPDATE OF cc;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の完了報告が見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  v_scope := v_completion.chore_scope;

  -- [43.2章] 2. 権限判定。
  IF v_scope = 'personal' THEN
    IF v_completion.reported_by <> v_caller_member_id THEN
      RAISE EXCEPTION 'この完了報告は本人のみ取り消せます' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF v_completion.reported_by <> v_caller_member_id AND NOT public.is_current_user_parent() THEN
      RAISE EXCEPTION 'この完了報告を取り消す権限がありません' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- [43.2章] 3. 時間窓（ちょうど60秒は取消可能側に含める）。
  IF now() - v_completion.reported_at > INTERVAL '1 minute' THEN
    RAISE EXCEPTION '報告から1分を過ぎているため取消できません' USING ERRCODE = 'check_violation';
  END IF;

  -- [43.2章] 4. ガチャ判定: 対象の報告者について、報告のあとに引かれた
  -- 抽選が1件でもあれば不可（消費範囲までは問わない保守的な判定。
  -- 07-17章の設計判断）。
  IF EXISTS (
    SELECT 1 FROM gacha_draws
    WHERE member_id = v_completion.reported_by
      AND drawn_at > v_completion.reported_at
  ) THEN
    RAISE EXCEPTION 'この報告のあとにガチャを引いているため取消できません' USING ERRCODE = 'check_violation';
  END IF;

  -- [43.5章] 4b. 木への飾り付け済み判定: 43.2章のガチャ判定だけでは
  -- 検出できない「時系列が前後した交換」（43.5章参照）を明示的に塞ぐ。
  -- [開発部・実装時に発見したDDL上のバグ修正] 設計部43.6章のDDL原文は
  -- `WHERE completion_id = p_completion_id` と無条件のカラム名で書かれて
  -- いたが、本関数のRETURNS TABLEが`completion_id`という同名のOUT列を
  -- 持つため、plpgsqlのデフォルト設定（variable_conflict = error）により
  -- 「column reference "completion_id" is ambiguous」で必ず実行時エラーに
  -- なる（ローカル検証で発覚。設計判断の変更ではなく、テーブルエイリアスの
  -- 欠落という機械的な誤りのため、開発部の判断でエイリアス`ftd`を付けて
  -- 修正した。実装メモ.md 120章参照）。
  IF EXISTS (
    SELECT 1 FROM family_tree_decorations ftd WHERE ftd.completion_id = p_completion_id
  ) THEN
    RAISE EXCEPTION 'この完了報告はすでに木の色丸として景品と交換されているため取消できません' USING ERRCODE = 'check_violation';
  END IF;

  -- [43.2章] 5. 残高判定: 取消後の残高がマイナスにならないことを確認する
  -- （時系列ではなく残高そのもので判定。要件定義書07-17章）。
  SELECT current_points INTO v_balance
  FROM member_points
  WHERE member_id = v_completion.reported_by;

  IF COALESCE(v_balance, 0) - v_completion.points < 0 THEN
    RAISE EXCEPTION '取消するとポイント残高がマイナスになるため取消できません' USING ERRCODE = 'check_violation';
  END IF;

  -- [43.4章] 6. family_tree_seasons: 「報告時刻の属するシーズン」を対象に
  -- 1つ戻す。season_end IS NULLでは絞り込まない（シーズン境界をまたいで
  -- 既に確定済みのシーズンであっても、報告が加算された先のシーズンを
  -- 正しく特定して戻すため。43.4章参照）。current_stageは単純な-1では
  -- なく、29a章と対になる閾値関数で毎回再計算する。
  v_month_start := date_trunc('month', (v_completion.reported_at AT TIME ZONE 'Asia/Tokyo'))::date;

  UPDATE family_tree_seasons
  SET completion_count = GREATEST(completion_count - 1, 0),
      current_stage = public.family_tree_stage_for_count(GREATEST(completion_count - 1, 0)),
      updated_at = now()
  WHERE family_id = v_caller_family_id
    AND season_start = v_month_start
  RETURNING id INTO v_season_id;

  IF v_season_id IS NULL THEN
    -- [43.4章] 29a章のトリガーが必ずシーズン行を作成してから加算するため、
    -- 1分以内チェックを通過した行であれば通常到達しない内部不整合。
    RAISE EXCEPTION '内部エラー: 対象シーズンが見つかりません（family_id=%, season_start=%）', v_caller_family_id, v_month_start
      USING ERRCODE = 'internal_error';
  END IF;

  -- [43.3章] 7. gacha_member_progress: 行ロック→更新前に防御的にCHECK制約
  -- の成立を再検証してから-1する。「ガチャ未消費」だけでは境界ちょうど
  -- （lifetime_completion_count = draw_count * 5）のケースを救えないため、
  -- この事前検証は必須（43.3章の反例を参照）。
  SELECT * INTO v_progress
  FROM gacha_member_progress
  WHERE member_id = v_completion.reported_by
  FOR UPDATE;

  IF FOUND THEN
    v_new_lifetime := GREATEST(v_progress.lifetime_completion_count - 1, 0);

    IF v_progress.draw_count * 5 > v_new_lifetime THEN
      RAISE EXCEPTION 'ガチャの抽選条件を満たさなくなるため取消できません' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE gacha_member_progress
    SET lifetime_completion_count = v_new_lifetime,
        updated_at = now()
    WHERE member_id = v_completion.reported_by;
  END IF;
  -- 行が存在しない場合(NOT FOUND)は何もしない。1分以内チェックにより
  -- 対象は33a章のトリガー適用後に報告された行に限られるため、
  -- gacha_member_progress_bumpトリガーが必ず行を作成済みのはずである
  -- （33a章）。理論上到達しない防御的分岐であり、到達してもガチャに
  -- 関与しないだけで取消自体は継続してよい（安全側）。

  -- [43.1章] 8. 削除。chore_reactionsはON DELETE CASCADEで自動的に消える。
  -- 43.5章のガードにより、ここでfamily_tree_decorations由来の
  -- foreign_key_violationが発生することは想定していない。
  DELETE FROM chore_completions WHERE id = p_completion_id;

  RETURN QUERY SELECT
    v_completion.id, v_completion.chore_id, v_completion.chore_title,
    v_completion.reported_by, v_completion.points;
END;
$$;

COMMENT ON FUNCTION public.cancel_chore_completion(UUID) IS
  '要件定義書07-17章「完了報告の直後の取消」。報告から1分以内に限り、報告者本人（家族共有choreは保護者も）が完了報告を物理削除する。ガチャ未消費（43.2章）・木への飾り付け未消費（43.5章）・残高非マイナス化（43.2章）を確認したうえで、family_tree_seasons.completion_count/current_stage・gacha_member_progress.lifetime_completion_countを明示的に1つ戻す（43.3章・43.4章）。chore_completionsへの新しいDELETEポリシーは追加せず、削除経路を本RPCに集約する（43.1章）。EXECUTE権限は43.7章参照。';

-- ------------------------------------------------------------
-- EXECUTE権限（GRANT/REVOKE）— スキーマ設計.sql 43.7章
-- ------------------------------------------------------------
-- draw_gacha()・edit_unpublished_drawing()等と同じ扱いとする。33g章の教訓
-- （PUBLICからのREVOKEだけではSupabaseが直接付与するanonのEXECUTEは消えない）
-- を踏まえ、anonを明示的にREVOKEの対象に含める。
REVOKE ALL ON FUNCTION public.cancel_chore_completion(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_chore_completion(UUID) TO authenticated;
