-- ============================================================
-- メダルの段階購入制（銅→銀→金→虹、家族単位で解放）・月次購入上限の撤廃（2026-09-11）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-19-14章「メダルのレアリティ段階購入制」
--     （決定32〜38、統括発案）。および同章直前の「決定39（統括判断・
--     2026-09-08）: 月ごとの購入上限を撤廃する。同じ種類を何枚でも買える」
--     （07-19章、決定31の撤回注記）。
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 32.0b節（決定26〜32、
--     決定39反映の改訂版）・32.1節。
--   本部長からの業務指示（2026-09-08、開発部/成果物/実装メモ.md 161章）。
--
-- 本部長が確認した事実: 本番の購入はカブトムシの銅1枚のみ（せいや）。段階を
--   飛ばして持っている人はいないため、遡って問題になるものは無い（決定35が
--   前提とする「既存データには遡って適用しない」を満たす状態で導入する）。
--
-- 差分は2つ（数としては差し引き±0）:
--   (1) 外す: 月次購入上限のチェック（同じ種類は1人あたり月1枚。決定31）。
--       決定39により撤廃。
--   (2) 足す: 段階購入制のチェック（決定32〜34）。銅以外のレアリティは、
--       同じ形（shape）の「ひとつ下のレアリティ」を家族の誰かが過去に
--       購入したことがある場合のみ購入できる。「持っている」の判定基準は
--       現在の保有数ではなく購入履歴（`ornament_sticker_purchases`への
--       EXISTS、決定33）。判定範囲はfamily_id単位で、購入者本人は問わない
--       （決定33「発言4：大人が下の段を買って子どもの道を開ける」を成立
--       させるための必須条件）。形ごとに完全に独立（決定34）。
--
--   チェックの順序は、UIUXデザイン部32.0b節「決定29」の表示優先順位
--   （①家族解放待ち＞②残高不足）に合わせ、段階購入制のチェックを残高
--   チェックより先に行う（両方の理由が同時に成立する場合、貯めても解決
--   しない条件〈家族解放待ち〉を優先して伝えるため）。
--
-- 破壊性: 既存オブジェクトの変更のみ。新規オブジェクトは追加しない。
--   `purchase_sticker(UUID)`をCREATE OR REPLACEする。引数・戻り値の列名は
--   一切変更していない（シグネチャ無変更）ため、83.2章の「旧シグネチャの
--   明示DROPが必要」という教訓は本変更には当てはまらない。CREATE OR REPLACEは
--   同一シグネチャなら既存のGRANT/REVOKE設定をそのまま保持するため、権限の
--   再設定も不要（20260909010000・20260910010000の申し送りと同じ）。
--   既存データへの書き換えは無い（DDLのみ、`ornament_sticker_purchases`・
--   `sticker_catalog`の既存行は一切変更しない）。決定35のとおり、本ルール
--   導入前に行われた購入は一切見直さない（新規INSERTにのみ判定を適用）。
--
-- [ファイル名日付について] 実際の作業日（システム時刻で確認、2026-09-08）
--   より後の日付にしているが、既存マイグレーションの最新が20260910030000で
--   あり、本ファイルはその内容を踏まえた差分（20260910010000版の
--   purchase_sticker(UUID)をベースにしている）であるため、152章・実装メモ
--   152.4章と同じ理由でマイグレーションの適用順序を保つことを優先した。
-- ============================================================

CREATE OR REPLACE FUNCTION public.purchase_sticker(p_catalog_id UUID)
RETURNS TABLE (
  purchase_id UUID,
  sticker_catalog_id UUID,
  points_spent INT,
  purchased_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_catalog RECORD;
  v_required_rarity TEXT;
  v_balance INT;
  v_new_id UUID;
  v_purchased_at TIMESTAMPTZ;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_catalog FROM sticker_catalog WHERE id = p_catalog_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '指定されたメダルが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- [重要・変更なし] 本関数のRETURNS TABLEはsticker_catalog_id・points_spent・
  -- purchased_atという列名を持ち、いずれもornament_sticker_purchasesの実列名と
  -- 一致する。plpgsqlの既定（variable_conflict=error）により、テーブル別名
  -- （osp）を必ず付けて列を修飾すること（20260907020000の既存コメントを踏襲）。

  -- [2026-09-11改訂・決定39] 月次購入上限のチェック（決定31「同じ種類につき
  -- 1人あたり月1枚」、20260909010000で導入）は撤廃した。同じ種類を同じ月に
  -- 何枚でも購入できる。

  -- [2026-09-11新設・要件定義書07-19-14章 決定32〜34] 段階購入制。
  -- 銅（下の段が無い）は無条件で買える。銀・金・虹は、同じ形（shape）の
  -- 「ひとつ下のレアリティ」を家族の誰か（family_id単位、購入者本人は問わない）
  -- が過去に購入したことがある場合のみ買える。「持っている」の判定基準は
  -- 現在の保有数・木への配置状況ではなく、購入履歴の有無
  -- （ornament_sticker_purchasesへのEXISTS、決定33）。形ごとに完全に独立
  -- しており、共通のフラグ・テーブルは持たない（決定34）。
  IF v_catalog.rarity <> 'bronze' THEN
    v_required_rarity := CASE v_catalog.rarity
      WHEN 'silver' THEN 'bronze'
      WHEN 'gold' THEN 'silver'
      WHEN 'rainbow' THEN 'gold'
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM ornament_sticker_purchases osp
      JOIN sticker_catalog sc ON sc.id = osp.sticker_catalog_id
      WHERE osp.family_id = v_family_id
        AND sc.shape = v_catalog.shape
        AND sc.rarity = v_required_rarity
    ) THEN
      RAISE EXCEPTION 'このメダルはまだ買えません。家族の誰かがひとつ下のレアリティを買うと購入できるようになります'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- 残高チェック（無変更。決定22: ポイントは現金で発行・販売しない）。
  -- [順序について] 段階購入制のチェックをこの残高チェックより先に行っている。
  -- UIUXデザイン部32.0b節「決定29」の表示優先順位（①家族解放待ち＞②残高
  -- 不足）にDB側の判定順序も合わせ、両方の理由が同時に成立する場合は
  -- 「家族解放待ち」のエラーを返す（貯めても解決しない条件を先に伝えるため）。
  SELECT current_points INTO v_balance FROM member_points WHERE member_id = v_member_id;
  v_balance := COALESCE(v_balance, 0);

  IF v_balance < v_catalog.points_cost THEN
    RAISE EXCEPTION 'ポイントが不足しています。必要: %pt、保有: %pt', v_catalog.points_cost, v_balance
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO ornament_sticker_purchases AS osp (family_id, member_id, sticker_catalog_id, points_spent)
  VALUES (v_family_id, v_member_id, p_catalog_id, v_catalog.points_cost)
  RETURNING osp.id, osp.purchased_at INTO v_new_id, v_purchased_at;

  RETURN QUERY SELECT v_new_id, p_catalog_id, v_catalog.points_cost, v_purchased_at;
END;
$$;

COMMENT ON FUNCTION public.purchase_sticker(UUID) IS
  '要件定義書07-19-14章（決定32〜38、2026-09-11改訂）。段階購入制（銅は無条件、銀・金・虹は同じ形のひとつ下のレアリティを家族の誰かが過去に購入したことがある場合のみ購入可。判定はornament_sticker_purchasesへのEXISTS、家族単位・購入者本人は問わない）・残高チェック（member_points）を満たした場合のみornament_sticker_purchasesへ記録する。月次購入上限は決定39により撤廃した（同じ種類を何枚でも購入できる）。取消経路は無い（決定24）。画面に出るメッセージの呼び名は「メダル」（152章）。';

-- [権限について] REVOKE/GRANTの再実行は不要。CREATE OR REPLACE FUNCTIONは
-- 引数リスト（シグネチャ）が同一である限り同一のオブジェクト（同一OID）を
-- 更新するだけであり、20260907020000で設定済みのGRANT EXECUTE TO
-- authenticated・REVOKE ALL FROM PUBLIC, anon はそのまま維持される
-- （PostgreSQLの仕様。RLS照査スイートS4の実測でも変化が無いことを確認する。
-- 実装メモ143章・161章参照）。
