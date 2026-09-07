-- ============================================================
-- 画面に出る呼び名を「メダル」に統一 — DB側エラーメッセージの訂正（2026-09-10）
-- ============================================================
-- 参照:
--   本部長からの業務指示（統括判断・実装メモ152章）。画面に出る呼び名が
--   子ども画面「シール」・大人画面「ステッカー」で混在し、同じ画面に両方
--   出ている箇所もあった。「メダル」に統一する。
--   開発部/成果物/実装メモ.md 152章
--
-- 破壊性: 既存オブジェクトの変更のみ。新規オブジェクトは追加しない。
--   `purchase_sticker(UUID)`・`decorate_tree_with_sticker(UUID, INT, INT)`を
--   CREATE OR REPLACEする。いずれも引数・戻り値の型は一切変更していない
--   （シグネチャ無変更）ため、83.2章の「旧シグネチャの明示DROPが必要」という
--   教訓は本変更には当てはまらない。CREATE OR REPLACEは同一シグネチャなら
--   既存のGRANT/REVOKE設定をそのまま保持するため、権限の再設定も不要
--   （20260909010000の申し送りと同じ）。
--
--   関数の中身（RAISE EXCEPTIONのメッセージ文字列のみ）を差し替える。
--   判定ロジック・SQL・戻り値はすべて無変更（20260909010000・20260908010000の
--   時点の内容をそのままコピーし、メッセージ文言だけを書き換えた）。
--
--   move_tree_sticker(UUID, INT, INT)は対象外（メッセージに「ステッカー」
--   「シール」の語を含まないため、変更不要と判断した）。
--
-- [RLS照査への影響] 関数の中身（メッセージ文字列）のみの変更であり、
--   GRANT/REVOKE・RLSポリシー・トリガーは一切変更しない。RLS照査スイート
--   （supabase/tests/rls_checks.sql）のS1/S3/S4の該当件数は不変の見込み
--   （本部長の業務指示どおり、適用後に実測して確認する。実測値が想定と
--   異なった場合は期待値を書き換えず報告する＝96.5章の教訓）。
--
-- [変えていないもの] テーブル名・列名・関数名・sticker_key列の値
--   （sticker_catalog／ornament_sticker_purchases／purchase_sticker／
--   beetle_bronze等）は一切変更しない。本ファイル中のコメント・過去の
--   マイグレーションファイル（20260907020000・20260908010000・20260909010000）
--   もそのまま残す（経緯が読めなくなるため書き換えない）。
-- ============================================================


-- ------------------------------------------------------------
-- 1. purchase_sticker(UUID) — 20260909010000時点の内容を踏襲し、
--    利用者に見えるメッセージ2箇所のみ「ステッカー」→「メダル」に書き換える。
-- ------------------------------------------------------------
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
    -- [2026-09-10改訂・152章] 画面表示は「メダル」に統一（統括判断）。
    RAISE EXCEPTION '指定されたメダルが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
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
    -- [2026-09-10改訂・152章] 画面表示は「メダル」に統一（統括判断）。
    -- 本部長の業務指示で明示された文言の差し替え本体。
    RAISE EXCEPTION 'このメダルは今月すでに購入しています（同じ種類は1人あたり月1枚まで）' USING ERRCODE = 'check_violation';
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
  '要件定義書07-19-9a章「決定31」（2026-09-09改訂、決定15の読み取り誤りの訂正）。同じ種類（sticker_catalog_id）につき1人あたり月1枚までの購入上限（JST暦月・購入単位でカウント）・残高チェック（member_points）を満たした場合のみornament_sticker_purchasesへ記録する。月あたりの合計購入数には上限を設けない。取消経路は無い（決定24）。[2026-09-10改訂・152章] 画面に出るメッセージの呼び名を「メダル」に統一した（判定ロジック・シグネチャは無変更）。';

-- [権限について] REVOKE/GRANTの再実行は不要。CREATE OR REPLACE FUNCTIONは
-- 引数リスト（シグネチャ）が同一である限り同一のオブジェクト（同一OID）を
-- 更新するだけであり、20260907020000で設定済みのGRANT EXECUTE TO
-- authenticated・REVOKE ALL FROM PUBLIC, anon はそのまま維持される
-- （PostgreSQLの仕様。RLS照査スイートS4の実測でも変化が無いことを確認する）。


-- ------------------------------------------------------------
-- 2. decorate_tree_with_sticker(UUID, INT, INT) — 20260908010000時点の
--    内容を踏襲し、利用者に見えるメッセージ2箇所のみ「ステッカー」→「メダル」に
--    書き換える。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decorate_tree_with_sticker(
  p_purchase_id UUID,
  p_pos_x INT,
  p_pos_y INT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_purchase RECORD;
  v_season_id UUID;
  v_decoration_id UUID;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 木の外（キャンバス外）に貼れないようにする。RPC内の事前チェックと
  -- テーブルのCHECK制約（20260908010000の1.）の二重防御とする
  -- （101.4章「DB制約が最終防衛線」）。
  IF p_pos_x IS NULL OR p_pos_y IS NULL
     OR p_pos_x < 0 OR p_pos_x > 1000
     OR p_pos_y < 0 OR p_pos_y > 1000 THEN
    RAISE EXCEPTION '木の外側には貼れません' USING ERRCODE = 'check_violation';
  END IF;

  -- 対象の購入が自分自身の所有物であることを確認する（決定16「区画3は個人所有」）。
  SELECT * INTO v_purchase FROM ornament_sticker_purchases
  WHERE id = p_purchase_id AND family_id = v_family_id AND member_id = v_member_id
  FOR UPDATE;
  IF NOT FOUND THEN
    -- [2026-09-10改訂・152章] 画面表示は「メダル」に統一（統括判断）。
    RAISE EXCEPTION '対象のメダルが見つかりません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 今シーズン（進行中）の木にのみ飾れる（過去シーズンの木は飾られた状態のまま
  -- 凍結保存する。33e章・旧decorate_tree_with_stickerと同じ方針）。
  SELECT id INTO v_season_id
  FROM family_tree_seasons
  WHERE family_id = v_family_id AND season_end IS NULL;

  IF v_season_id IS NULL THEN
    RAISE EXCEPTION '今シーズンの木にのみ飾れます' USING ERRCODE = 'check_violation';
  END IF;

  -- [決定29のDB強制] シーズンを問わず、この購入ステッカーが一度でも
  -- family_tree_decorationsに存在すれば拒否する（「同じ購入品は生涯に一度しか
  -- 飾れない」。旧版の「同一シーズン内のみ複数不可」から拡張。設計部49.14章）。
  -- 実際の排他制御はuq_family_tree_decorations_sticker_once（20260908010000の2.）
  -- が担うが、0件成功のわなを踏まないための明示チェックを先に行う。
  IF EXISTS (
    SELECT 1 FROM family_tree_decorations
    WHERE decoration_source = 'sticker' AND sticker_purchase_id = p_purchase_id
  ) THEN
    -- [2026-09-10改訂・152章] 画面表示は「メダル」に統一（統括判断）。
    RAISE EXCEPTION 'このメダルはすでに木に飾られています（1個のメダルは一度しか飾れません）' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO family_tree_decorations
    (family_id, season_id, completion_id, decoration_source, sticker_purchase_id, pos_x, pos_y)
  VALUES
    (v_family_id, v_season_id, NULL, 'sticker', p_purchase_id, p_pos_x, p_pos_y)
  RETURNING id INTO v_decoration_id;

  RETURN v_decoration_id;
END;
$$;

COMMENT ON FUNCTION public.decorate_tree_with_sticker(UUID, INT, INT) IS
  '要件定義書07-19章・スキーマ設計.sql 49章（決定29）。自分が購入したステッカーを、今シーズンの木の上の任意の座標（pos_x/pos_y、0〜1000のキャンバス相対整数）に自由配置する。完了報告（色丸）は一切消費しない。他人の購入品・過去シーズンへの配置・キャンバス外の座標は一切指定できない。同じ購入ステッカーは生涯に一度しか配置できない（決定29）。配置後に座標を変更したい場合はmove_tree_sticker()を使う。[2026-09-10改訂・152章] 画面に出るメッセージの呼び名を「メダル」に統一した（判定ロジック・シグネチャは無変更）。';

-- [権限について] REVOKE/GRANTの再実行は不要（20260908010000で設定済みの
-- GRANT EXECUTE TO authenticated・REVOKE ALL FROM PUBLIC, anon がそのまま
-- 維持される。1.と同じ理由）。


-- ------------------------------------------------------------
-- 3. move_tree_sticker(UUID, INT, INT) — 対象外（変更なし）
-- ------------------------------------------------------------
-- メッセージ（'木の外側には貼れません'／'対象の配置が見つかりません'／
-- '過去の木の配置は動かせません'）はいずれも「ステッカー」「シール」の語を
-- 含まないため、本マイグレーションでは変更しない。
