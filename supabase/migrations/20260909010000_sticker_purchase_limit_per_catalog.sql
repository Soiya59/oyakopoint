-- ============================================================
-- ステッカー購入の上限を「同じ種類につき月1枚」へ訂正（2026-09-09）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-19-9a章「決定31（統括判断・2026-09-07）」
--     統括の当初発言「月に1回だけという上限」を「1人あたり月合計1個」と
--     読んだ決定15は誤読だった。正しくは「同じ種類（sticker_catalog_id）に
--     つき1人あたり月1枚まで」。月あたりの合計購入数には上限を設けない
--     （違う種類は同じ月に何種類でも買える。翌月になれば同じ種類をもう1枚
--     買える。全12種を集めること自体は禁止しないが、揃えたことへの特別な
--     景品は一切与えない＝カード合わせ禁止、8/30法規制レポート2-4節）。
--   開発部/成果物/実装メモ.md 143章
--
-- [設計部の成果物との関係・重要な申し送り] 本部長からの業務指示により、
-- 判定方式（トリガー内COUNT/EXISTSチェック。`AT TIME ZONE 'Asia/Tokyo'`が
-- STABLEで生成列・UNIQUE制約にできないための既存方式、設計部/成果物/
-- スキーマ設計.sql 47.2章・47.9章）はそのまま維持し、判定条件に
-- `sticker_catalog_id`を1つ加えるだけの変更として実装した。**スキーマ設計.sql
-- 47.2章自体はこの決定31をまだ反映していない**（決定31は47.2章が書かれた
-- 後に生まれた統括の訂正判断のため）。本マイグレーション適用後は、開発部の
-- この実装（および実装メモ143章）が最新仕様の記録になる。設計部47.2章への
-- 反映（追記・取り消し線訂正）は別途本部長の判断で行われたい（143章「迷った点」参照）。
--
-- 破壊性: 既存オブジェクトの変更のみ。新規オブジェクトは追加しない。
--   `purchase_sticker(UUID)`をCREATE OR REPLACEする。引数・戻り値の列名は
--   一切変更していないため（シグネチャ無変更）、83.2章の「旧シグネチャの
--   明示DROPが必要」という教訓は本変更には当てはまらない（CREATE OR REPLACEは
--   同一シグネチャなら既存のGRANT/REVOKE設定をそのまま保持するため、権限の
--   再設定も不要）。判定条件を「今月ornament_sticker_purchasesに1件でも
--   購入があれば拒否」から「今月・同じsticker_catalog_idの購入が1件でも
--   あれば拒否」に変更するのみ。既存データの書き換えは無い（DDLのみで、
--   ornament_sticker_purchasesの既存行はそのまま。過去の「月1個」ルールの
--   もとで作られた行が複数月にわたっていても、新ルールでの再判定は行われず、
--   今後の購入判定にのみ新条件が適用される）。
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
  v_month_start DATE;
  v_balance INT;
  v_new_id UUID;
  v_purchased_at TIMESTAMPTZ;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_catalog FROM sticker_catalog WHERE id = p_catalog_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '指定されたステッカーが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- [重要・変更なし] 本関数のRETURNS TABLEはsticker_catalog_id・points_spent・
  -- purchased_atという列名を持ち、いずれもornament_sticker_purchasesの実列名と
  -- 一致する。plpgsqlの既定（variable_conflict=error）により、テーブル別名
  -- （osp）を必ず付けて列を修飾すること（20260907020000の既存コメントを踏襲）。

  -- [2026-09-09改訂・決定31] 「1人あたり月合計1個」から「同じ種類
  -- （sticker_catalog_id）につき1人あたり月1枚」に変更。判定方式（トリガー内
  -- EXISTSチェック・JST暦月・購入単位でカウント）はそのまま維持し、判定条件に
  -- osp.sticker_catalog_id = p_catalog_id を1行加えるだけにとどめた。
  v_month_start := date_trunc('month', (now() AT TIME ZONE 'Asia/Tokyo'))::date;
  IF EXISTS (
    SELECT 1 FROM ornament_sticker_purchases osp
    WHERE osp.member_id = v_member_id
      AND osp.sticker_catalog_id = p_catalog_id
      AND date_trunc('month', (osp.purchased_at AT TIME ZONE 'Asia/Tokyo'))::date = v_month_start
  ) THEN
    RAISE EXCEPTION 'このステッカーは今月すでに購入しています（同じ種類は1人あたり月1枚まで）' USING ERRCODE = 'check_violation';
  END IF;

  -- 残高チェック（無変更。決定22: ポイントは現金で発行・販売しない）。
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
  '要件定義書07-19-9a章「決定31」（2026-09-09改訂、決定15の読み取り誤りの訂正）。同じ種類（sticker_catalog_id）につき1人あたり月1枚までの購入上限（JST暦月・購入単位でカウント）・残高チェック（member_points）を満たした場合のみornament_sticker_purchasesへ記録する。月あたりの合計購入数には上限を設けない。取消経路は無い（決定24）。';

-- [権限について] REVOKE/GRANTの再実行は不要。CREATE OR REPLACE FUNCTIONは
-- 引数リスト（シグネチャ）が同一である限り同一のオブジェクト（同一OID）を
-- 更新するだけであり、20260907020000で設定済みのGRANT EXECUTE TO
-- authenticated・REVOKE ALL FROM PUBLIC, anon はそのまま維持される
-- （PostgreSQLの仕様。RLS照査スイートS4の実測でも変化が無いことを確認する。
-- 実装メモ143章参照）。
