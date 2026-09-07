-- ============================================================
-- 木を飾るステッカー：木の上の自由な位置に貼れるようにする（2026-09-08）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-19章「決定29（その月かぎり・翌月への
--     置き直しは不可）」「決定30（配置数に追加上限を設けない）」、決定17（撤回）
--   設計部/成果物/スキーマ設計.sql 49章（49.1〜49.17、決定49-1〜49-14。
--     49.12章は本部長判断）
--   設計部/成果物/API仕様.md 14.4節・14.5節・14.8節・11章
--   開発部/成果物/実装メモ.md 142章
--
-- 破壊性: 既存オブジェクトへの変更を含む。適用前に必ず本コメントと実装メモ
--   142章を読むこと。
--   (1) family_tree_decorations への ALTER TABLE
--       - pos_x/pos_y列（INT、0〜1000）を追加
--       - completion_id列のNOT NULL制約を解除（ガチャ景品側はCHECK制約で
--         引き続き必須のまま。UNIQUE(completion_id)自体は無変更で残す）
--       - CHECK制約 chk_family_tree_decorations_source_payload を貼り替え
--   (2) 既存データの書き換え（本番で1件該当することを本部長が確認済み。
--       設計部49.3章のとおり件数に依存しない安全なUPDATE。0件でも無害）:
--       decoration_source='sticker' AND completion_id IS NOT NULL の行を
--       completion_id=NULL・pos_x=500・pos_y=500（キャンバス中央）に更新する。
--       このWHERE句は本マイグレーション適用より前に作られた旧方式（色丸交換）の
--       行だけを対象にする（新RPC適用後に生まれた行はcompletion_idが既にNULLの
--       ためこの条件に一致せず、誤って座標を巻き戻すことはない）。
--   (3) decorate_tree_with_sticker(UUID, UUID)（旧シグネチャ、
--       20260907020000で本番適用済み）を明示的にDROP FUNCTIONし、
--       decorate_tree_with_sticker(UUID, INT, INT)（自由配置・生涯一度版、
--       49.2章＋49.14章の最終形）に置き換える（83.2章の教訓：オーバーロード
--       放置により旧シグネチャが残存動作し続けることを防ぐ）。
--   (4) 部分UNIQUEインデックスを uq_family_tree_decorations_sticker_per_season
--       （sticker_purchase_id, season_id）から
--       uq_family_tree_decorations_sticker_once（sticker_purchase_idのみ）に
--       置き換える（決定29「同じ購入品は生涯に一度しか飾れない」のDB強制）。
--   新規: RPC1件（move_tree_sticker、その月のうちの座標変更のみ。取り外しは
--   実装しない）。
--   ガチャ景品（decoration_source='gacha'）側は本マイグレーションで一切変更
--   しない（completion_id必須・領域自動配置・40スロット優先確保のまま）。
-- ============================================================


-- ------------------------------------------------------------
-- 1. family_tree_decorations の再拡張（設計部49.1章）
-- ------------------------------------------------------------
ALTER TABLE family_tree_decorations
  ADD COLUMN IF NOT EXISTS pos_x INT NULL,
  ADD COLUMN IF NOT EXISTS pos_y INT NULL;

ALTER TABLE family_tree_decorations
  ALTER COLUMN completion_id DROP NOT NULL;

-- [重要・冪等性の罠に注意、設計部49.1章] 本UPDATEは「旧decorate_tree_with_
-- sticker(UUID,UUID)によって作られた、completion_idを持つステッカー由来の行」
-- だけを対象にする。新RPC（本ファイル下部）適用後に自由配置済みの行は
-- completion_id IS NOT NULLに一致しないため、この巻き戻しの対象にならない。
UPDATE family_tree_decorations
SET completion_id = NULL, pos_x = 500, pos_y = 500
WHERE decoration_source = 'sticker' AND completion_id IS NOT NULL;

ALTER TABLE family_tree_decorations DROP CONSTRAINT IF EXISTS chk_family_tree_decorations_source_payload;
ALTER TABLE family_tree_decorations
  ADD CONSTRAINT chk_family_tree_decorations_source_payload CHECK (
    decoration_source IN ('gacha', 'sticker')
    AND (
      (decoration_source = 'gacha'
        AND draw_id IS NOT NULL AND sticker_purchase_id IS NULL
        AND completion_id IS NOT NULL
        AND pos_x IS NULL AND pos_y IS NULL)
      OR (decoration_source = 'sticker'
        AND sticker_purchase_id IS NOT NULL AND draw_id IS NULL
        AND completion_id IS NULL
        AND pos_x IS NOT NULL AND pos_y IS NOT NULL
        AND pos_x BETWEEN 0 AND 1000
        AND pos_y BETWEEN 0 AND 1000)
    )
  );

-- [RLS] family_tree_decorations_select_same_family（33e章、family_id =
-- current_family_id()のみ）は本マイグレーションでも一切変更しない。
-- INSERT/UPDATE/DELETEポリシーも従来どおり一切定義しない（下記のRPCのみが
-- 書き込む）。


-- ------------------------------------------------------------
-- 2. 部分UNIQUEインデックスの置き換え（決定29のDB強制、設計部49.14章）
-- ------------------------------------------------------------
DROP INDEX IF EXISTS uq_family_tree_decorations_sticker_per_season;

CREATE UNIQUE INDEX IF NOT EXISTS uq_family_tree_decorations_sticker_once
  ON family_tree_decorations (sticker_purchase_id)
  WHERE decoration_source = 'sticker';


-- ------------------------------------------------------------
-- 3. decorate_tree_with_sticker() の全面改訂（自由配置・生涯一度版、最終形）
-- ------------------------------------------------------------
-- [重要・本番適用済み関数の旧シグネチャを明示DROP] decorate_tree_with_sticker
-- (UUID, UUID)は20260907020000_sticker_purchases_and_badges.sqlで本番適用済み。
-- 引数リストを変えるとPostgreSQLは別オーバーロードとして扱い、何もしなければ
-- 旧シグネチャが残存動作し続ける（83.2章の教訓）。
DROP FUNCTION IF EXISTS public.decorate_tree_with_sticker(UUID, UUID);

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
  -- テーブルのCHECK制約（上記1.）の二重防御とする（101.4章「DB制約が最終防衛線」）。
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
    RAISE EXCEPTION '対象のステッカーが見つかりません' USING ERRCODE = 'foreign_key_violation';
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
  -- 実際の排他制御はuq_family_tree_decorations_sticker_once（上記2.）が担うが、
  -- 0件成功のわなを踏まないための明示チェックを先に行う。
  IF EXISTS (
    SELECT 1 FROM family_tree_decorations
    WHERE decoration_source = 'sticker' AND sticker_purchase_id = p_purchase_id
  ) THEN
    RAISE EXCEPTION 'このステッカーはすでに木に飾られています（1個のステッカーは一度しか飾れません）' USING ERRCODE = 'check_violation';
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
  '要件定義書07-19章・スキーマ設計.sql 49章（決定29）。自分が購入したステッカーを、今シーズンの木の上の任意の座標（pos_x/pos_y、0〜1000のキャンバス相対整数）に自由配置する。完了報告（色丸）は一切消費しない。他人の購入品・過去シーズンへの配置・キャンバス外の座標は一切指定できない。同じ購入ステッカーは生涯に一度しか配置できない（決定29）。配置後に座標を変更したい場合はmove_tree_sticker()を使う。';

-- 33g章・43.7章・47.2章と同じ扱い（PUBLICからのREVOKEだけではSupabaseが
-- 直接付与するanonのEXECUTEは消えないため、anonを明示的に含める）。
REVOKE ALL ON FUNCTION public.decorate_tree_with_sticker(UUID, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decorate_tree_with_sticker(UUID, INT, INT) TO authenticated;


-- ------------------------------------------------------------
-- 4. move_tree_sticker() の新設（設計部49.13章、統括判断49.12章(1)）
-- ------------------------------------------------------------
-- 「その月のうちは、貼ったステッカーの座標を変更できる」。取り外し（配置の
-- 取消）は実装しない。座標（pos_x・pos_y）のみを対象にしたUPDATE用の
-- SECURITY DEFINER関数。テーブル構造の変更は不要（座標を持つ列は上記1.で
-- 用意済み）。
CREATE OR REPLACE FUNCTION public.move_tree_sticker(
  p_decoration_id UUID,
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
  v_decoration RECORD;
  v_current_season_id UUID;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- キャンバス外への移動禁止（decorate_tree_with_sticker()と同じ事前チェック）。
  IF p_pos_x IS NULL OR p_pos_y IS NULL
     OR p_pos_x < 0 OR p_pos_x > 1000
     OR p_pos_y < 0 OR p_pos_y > 1000 THEN
    RAISE EXCEPTION '木の外側には貼れません' USING ERRCODE = 'check_violation';
  END IF;

  -- 対象の配置が (a)自分の家族の (b)自由配置ステッカーであり (c)自分自身が
  -- 購入したものであることを一括で確認する。他人の配置・ガチャの景品は
  -- 構造的にヒットしない（decoration_source='sticker'を明示条件にしているため）。
  SELECT ftd.id, ftd.season_id INTO v_decoration
  FROM family_tree_decorations ftd
  JOIN ornament_sticker_purchases osp ON osp.id = ftd.sticker_purchase_id
  WHERE ftd.id = p_decoration_id
    AND ftd.family_id = v_family_id
    AND ftd.decoration_source = 'sticker'
    AND osp.member_id = v_member_id
  FOR UPDATE OF ftd;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の配置が見つかりません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 過去シーズンの配置は凍結され、移動できない（コレクションに保存された
  -- 過去の木を書き換えないため）。進行中シーズンでなければ拒否する。
  SELECT id INTO v_current_season_id
  FROM family_tree_seasons
  WHERE family_id = v_family_id AND season_end IS NULL;

  IF v_current_season_id IS NULL OR v_decoration.season_id <> v_current_season_id THEN
    RAISE EXCEPTION '過去の木の配置は動かせません' USING ERRCODE = 'check_violation';
  END IF;

  -- 座標のみを更新する。購入・シーズン・所有者はSET句に含めない。
  UPDATE family_tree_decorations
  SET pos_x = p_pos_x, pos_y = p_pos_y
  WHERE id = v_decoration.id;

  RETURN v_decoration.id;
END;
$$;

COMMENT ON FUNCTION public.move_tree_sticker(UUID, INT, INT) IS
  '要件定義書07-19章・スキーマ設計.sql 49.12章〜49.13章（統括判断）。自由配置ステッカー（family_tree_decorations、decoration_source=sticker）の座標のみを更新する。購入・シーズン・所有者は変更しない。同一シーズン内の自分の配置のみ移動でき、過去シーズンの配置（凍結済み）は移動できない。キャンバス外には移動できない。取り外し（配置の取消）はこのRPCの対象外（実装しない）。';

REVOKE ALL ON FUNCTION public.move_tree_sticker(UUID, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_tree_sticker(UUID, INT, INT) TO authenticated;

-- [RLS] 新規のRLSポリシーは追加しない。family_tree_decorations_select_same_
-- familyは本マイグレーションでも一切変更しない。INSERT/UPDATE/DELETEポリシーも
-- 従来どおり一切定義しない（decorate_tree_with_sticker()・move_tree_sticker()の
-- 2本のRPCのみが書き込む）。
