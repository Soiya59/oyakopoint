-- ============================================================
-- 木を飾るステッカー購入とバッジ（新設、2026-09-07）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-19章（決定11〜28）
--   設計部/成果物/スキーマ設計.sql 47章（47.1〜47.10、決定47-1〜47-13、
--     本部長採点100点）— 本ファイルのDDLはこの章を実行可能な形にそのまま
--     書き写したもの。設計判断・却下案の詳細な理由は同章コメントを正とし、
--     ここでは開発部として実装時に気づいた点のみコメントを補う。
--   設計部/成果物/API仕様.md 14章
--   開発部/成果物/実装メモ.md 138章
--
-- 破壊性: 新規オブジェクトの追加が中心。唯一の既存オブジェクトへの変更は
--   以下の2点で、いずれも非破壊であることを確認済み（実装メモ138章）。
--   (1) family_tree_decorations への ALTER TABLE（列追加2本・NOT NULL解除1本・
--       CHECK制約の貼り替え1本・部分UNIQUEインデックス新設1本）。既存行は
--       DEFAULT句により自動的にdecoration_source='gacha'に分類され、既存の
--       draw_id・completion_idの値は一切書き換わらない。
--   (2) member_points（View）のCREATE OR REPLACE。列名・型は変更せず、
--       算出式にornament_sticker_purchasesの減算経路を1つ追加するのみ。
--       既存の参照元（reward_redemptions_before_insert・cancel_chore_
--       completion・purchase_sticker自身）はcurrent_pointsを1行lookupする
--       だけであり、内訳の追加による影響は無い（47.4章）。
--   新規テーブル3件（sticker_catalog・ornament_sticker_purchases・
--   member_badges）、新規RPC3件（purchase_sticker・decorate_tree_with_sticker・
--   member_badges_sync）、新規トリガー4件、新規View1件（member_badge_progress）、
--   新規純関数1件（badge_tier_thresholds）を追加する。
-- ============================================================


-- ------------------------------------------------------------
-- 1. sticker_catalog（新設：全家族共通グローバルカタログ）
-- ------------------------------------------------------------
-- gacha_preset_ornaments（33c章）と同型のグローバルカタログ。family_idを
-- 持たない。形3種（beetle/butterfly/flower）×レアリティ4段
-- （bronze/silver/gold/rainbow）＝12種。SVGの実体はDBに置かず、sticker_key
-- のみをクライアント側アセット参照キーとして持つ（47.1章）。
CREATE TABLE IF NOT EXISTS sticker_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shape TEXT NOT NULL CHECK (shape IN ('beetle', 'butterfly', 'flower')),
  rarity TEXT NOT NULL CHECK (rarity IN ('bronze', 'silver', 'gold', 'rainbow')),
  sticker_key TEXT NOT NULL UNIQUE CHECK (char_length(trim(sticker_key)) BETWEEN 1 AND 50),
  display_name TEXT NOT NULL CHECK (char_length(trim(display_name)) BETWEEN 1 AND 50),
  points_cost INT NOT NULL CHECK (points_cost > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (shape, rarity)
);

ALTER TABLE sticker_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sticker_catalog_select_authenticated" ON sticker_catalog;
CREATE POLICY "sticker_catalog_select_authenticated" ON sticker_catalog
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT/UPDATE/DELETEはクライアントに一切開放しない（33c章と同じ設計）。
-- gacha_preset_ornamentsと異なり「is_active=trueの行を0件にできない」トリガーは
-- 設けない（本カタログは抽選プールではなく単純な購入可能一覧のため、47.1章）。

-- 初期データ（決定13の形3種×決定25〈統括決定〉の価格 銅10／銀30／金50／虹100）。
INSERT INTO sticker_catalog (shape, rarity, sticker_key, display_name, points_cost) VALUES
  ('beetle',    'bronze',  'beetle_bronze',     'どうのカブトムシ',       10),
  ('beetle',    'silver',  'beetle_silver',     'ぎんのカブトムシ',       30),
  ('beetle',    'gold',    'beetle_gold',       'きんのカブトムシ',       50),
  ('beetle',    'rainbow', 'beetle_rainbow',    'にじいろのカブトムシ',   100),
  ('butterfly', 'bronze',  'butterfly_bronze',  'どうのちょうちょ',       10),
  ('butterfly', 'silver',  'butterfly_silver',  'ぎんのちょうちょ',       30),
  ('butterfly', 'gold',    'butterfly_gold',    'きんのちょうちょ',       50),
  ('butterfly', 'rainbow', 'butterfly_rainbow', 'にじいろのちょうちょ',   100),
  ('flower',    'bronze',  'flower_bronze',     'どうのちいさなはな',     10),
  ('flower',    'silver',  'flower_silver',     'ぎんのちいさなはな',     30),
  ('flower',    'gold',    'flower_gold',       'きんのちいさなはな',     50),
  ('flower',    'rainbow', 'flower_rainbow',    'にじいろのちいさなはな', 100)
ON CONFLICT (sticker_key) DO NOTHING;


-- ------------------------------------------------------------
-- 2. ornament_sticker_purchases（新設：購入記録）・purchase_sticker()
-- ------------------------------------------------------------
-- 月1個の上限は既存のdaily_limit系（5a章）・感謝ポイント日次原資（13b章）・
-- 書き込みボード日次上限（35a章）と同じ「RPC内でのCOUNTチェック」方式に統一
-- する（生成列+UNIQUE制約は`AT TIME ZONE 'Asia/Tokyo'`がSTABLEでIMMUTABLE
-- 要件を満たさないため却下。47.2章・決定47-3）。
CREATE TABLE IF NOT EXISTS ornament_sticker_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  sticker_catalog_id UUID NOT NULL REFERENCES sticker_catalog(id) ON DELETE RESTRICT,
  -- 購入時点のカタログ価格のスナップショット（5a章chore_completions.pointsと同じ考え方）。
  points_spent INT NOT NULL CHECK (points_spent > 0),
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ornament_sticker_purchases_family_id ON ornament_sticker_purchases(family_id);
CREATE INDEX IF NOT EXISTS idx_ornament_sticker_purchases_member_id ON ornament_sticker_purchases(member_id);

ALTER TABLE ornament_sticker_purchases ENABLE ROW LEVEL SECURITY;

-- 家族の誰でも他メンバーの購入記録を閲覧できる（決定7・決定23、比較は許容する）。
-- ソート・件数の多い順の集計Viewは意図的に作らない（07-10章必須3条件）。
DROP POLICY IF EXISTS "ornament_sticker_purchases_select_same_family" ON ornament_sticker_purchases;
CREATE POLICY "ornament_sticker_purchases_select_same_family" ON ornament_sticker_purchases
  FOR SELECT
  USING (family_id = current_family_id());

-- INSERT/UPDATE/DELETEポリシーは一切定義しない。書き込みは下記
-- purchase_sticker()（SECURITY DEFINER）のみが行う（決定24「購入の取消不可」
-- により取消・訂正の書き込み経路自体を用意する必要が無い）。

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

  -- [重要・43.6章／120.4章と同型の罠への対処] 本関数のRETURNS TABLEは
  -- sticker_catalog_id・points_spent・purchased_atという列名を持ち、いずれも
  -- ornament_sticker_purchasesの実列名と一致する。plpgsqlの既定
  -- （variable_conflict=error）により裸の列参照はOUT列と衝突しambiguousで
  -- 実行時エラーになるため、テーブル別名（osp）を必ず付けて列を修飾する。

  -- 月1個チェック（決定15。JST暦月。カウント単位は「購入」）。
  v_month_start := date_trunc('month', (now() AT TIME ZONE 'Asia/Tokyo'))::date;
  IF EXISTS (
    SELECT 1 FROM ornament_sticker_purchases osp
    WHERE osp.member_id = v_member_id
      AND date_trunc('month', (osp.purchased_at AT TIME ZONE 'Asia/Tokyo'))::date = v_month_start
  ) THEN
    RAISE EXCEPTION '今月はすでにステッカーを購入しています（1人あたり月1個まで）' USING ERRCODE = 'check_violation';
  END IF;

  -- 残高チェック（決定22: ポイントは現金で発行・販売しない。既存の残高の
  -- 範囲内でのみ購入可。感謝ポイント受領分も残高に含まれる、7a章参照）。
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
  '要件定義書07-19-9a章。1人あたり月1個までの購入上限（JST暦月・購入単位でカウント）・残高チェック（member_points）を満たした場合のみornament_sticker_purchasesへ記録する。取消経路は無い（決定24）。';

-- 33g章・43.7章と同じ扱い（PUBLICからのREVOKEだけではSupabaseが直接付与する
-- anonのEXECUTEは消えないため、anonを明示的に含める）。
REVOKE ALL ON FUNCTION public.purchase_sticker(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_sticker(UUID) TO authenticated;


-- ------------------------------------------------------------
-- 3. family_tree_decorations の拡張（decoration_source列の追加）・
--    decorate_tree_with_sticker()（木への配置RPC本体）
-- ------------------------------------------------------------
-- 木への配置記録は、企画部仮称tree_sticker_decorationsの新設ではなく、
-- 既存のfamily_tree_decorations（33e章）にdecoration_source・
-- sticker_purchase_id列を追加する形で統合する（決定47-5）。理由:
--   (1) 既存のUNIQUE(completion_id)制約が交換元を問わず「1つの色丸には
--       1件の景品/ステッカーしか乗らない」を無償で保証する。
--   (2) cancel_chore_completion()（43.5章）の既存ガード
--       `EXISTS (SELECT 1 FROM family_tree_decorations WHERE completion_id = ...)`
--       がdecoration_source非依存のため、43章を一切変更せずにステッカーにも
--       同じガードが及ぶ。
--   (3) 過去シーズンの木の表示クエリ（33f章）をdecoration_sourceで分岐する
--       だけで自然に拡張できる。
ALTER TABLE family_tree_decorations
  ALTER COLUMN draw_id DROP NOT NULL;

ALTER TABLE family_tree_decorations
  ADD COLUMN IF NOT EXISTS decoration_source TEXT NOT NULL DEFAULT 'gacha',
  ADD COLUMN IF NOT EXISTS sticker_purchase_id UUID NULL REFERENCES ornament_sticker_purchases(id) ON DELETE RESTRICT;

-- 既存行（本章適用前はすべてガチャ由来）はDEFAULT句により自動的に
-- decoration_source='gacha'に分類される。遡及的な書き換えは発生しない。

ALTER TABLE family_tree_decorations DROP CONSTRAINT IF EXISTS chk_family_tree_decorations_source_payload;
ALTER TABLE family_tree_decorations
  ADD CONSTRAINT chk_family_tree_decorations_source_payload CHECK (
    decoration_source IN ('gacha', 'sticker')
    AND (
      (decoration_source = 'gacha' AND draw_id IS NOT NULL AND sticker_purchase_id IS NULL)
      OR (decoration_source = 'sticker' AND sticker_purchase_id IS NOT NULL AND draw_id IS NULL)
    )
  );

-- 1シーズンにつき同じ購入ステッカーは1箇所にしか飾れない（設計部判断・
-- 47.9章(5)、本部長承認済み・47.10章「本部長判断（2026-09-07）」参照。
-- 統括への確認は不要と判断のうえ採用: 1回の購入＝1枚のステッカーであり、
-- 1枚が同時に2箇所にあるのは物として不自然。翌月への置き直し〈決定17〉は
-- 「その月の木に1箇所」の範囲で成立する）。シーズンをまたいだ置き直しは
-- 禁止しない（過去シーズンの行はそのまま残り、新しいシーズンの行を追加する
-- だけで実現できる）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_family_tree_decorations_sticker_per_season
  ON family_tree_decorations (sticker_purchase_id, season_id)
  WHERE decoration_source = 'sticker';

-- family_tree_decorations_select_same_family（33e章、family_id =
-- current_family_id()のみ）は交換元によらず全行を対象にしているため、
-- 本節による変更は不要（47.7章）。

CREATE OR REPLACE FUNCTION public.decorate_tree_with_sticker(p_purchase_id UUID, p_completion_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_purchase RECORD;
  v_completion RECORD;
  v_season_id UUID;
  v_season_start DATE;
  v_decoration_id UUID;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 対象の購入が自分自身の所有物であることを確認する（決定16「区画3は個人所有」）。
  SELECT * INTO v_purchase FROM ornament_sticker_purchases
  WHERE id = p_purchase_id AND family_id = v_family_id AND member_id = v_member_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象のステッカーが見つかりません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 交換対象は本人自身の色丸に限る（33e章decorate_tree_with_gacha_prize()と全く同じ方針）。
  SELECT * INTO v_completion FROM chore_completions
  WHERE id = p_completion_id AND family_id = v_family_id AND reported_by = v_member_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の色丸が見つからないか、自分の完了報告ではありません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM family_tree_decorations WHERE completion_id = p_completion_id) THEN
    RAISE EXCEPTION 'この色丸はすでに景品と交換済みです' USING ERRCODE = 'check_violation';
  END IF;

  -- 今シーズン（進行中）の色丸のみ対象とする（33e章と全く同じ方針）。
  SELECT id, season_start INTO v_season_id, v_season_start
  FROM family_tree_seasons
  WHERE family_id = v_family_id AND season_end IS NULL;

  IF v_season_id IS NULL
     OR date_trunc('month', (v_completion.reported_at AT TIME ZONE 'Asia/Tokyo'))::date <> v_season_start THEN
    RAISE EXCEPTION '今シーズンの色丸のみ交換できます（過去シーズンの木は保存された状態のまま変更できません）'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 「1シーズンにつき同じ購入ステッカーは1箇所」の事前検証（0件成功のわなを
  -- 踏まないための明示チェック。実際の排他制御は上記の部分UNIQUEインデックスが担う）。
  IF EXISTS (
    SELECT 1 FROM family_tree_decorations
    WHERE decoration_source = 'sticker' AND sticker_purchase_id = p_purchase_id AND season_id = v_season_id
  ) THEN
    RAISE EXCEPTION 'このステッカーは今シーズンすでに別の色丸に飾られています' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO family_tree_decorations (family_id, season_id, completion_id, decoration_source, sticker_purchase_id)
  VALUES (v_family_id, v_season_id, p_completion_id, 'sticker', p_purchase_id)
  RETURNING id INTO v_decoration_id;

  RETURN v_decoration_id;
END;
$$;

COMMENT ON FUNCTION public.decorate_tree_with_sticker(UUID, UUID) IS
  '要件定義書07-19-9a章「決定16」。自分が購入したステッカーを、自分の今シーズンの未交換の色丸1つと交換する。他人の購入品・他人の色丸・過去シーズンの色丸は一切指定できない。同一シーズン内で同じ購入品を複数の色丸に飾ることはできない。';

REVOKE ALL ON FUNCTION public.decorate_tree_with_sticker(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decorate_tree_with_sticker(UUID, UUID) TO authenticated;


-- ------------------------------------------------------------
-- 4. member_points（View）改訂 — ステッカー購入分の減算
-- ------------------------------------------------------------
-- [本節が最終定義] member_pointsの実体は1つのPostgresオブジェクトであり、
-- 本節が現時点で最後にCREATE OR REPLACEされた定義である。列名・型は
-- 一切変更していない（member_id/family_id/display_name/current_points）。
-- 感謝ポイントはバッジの対象からは除外されている（決定27）が、残高には
-- 引き続き含まれる（このView内では変更なし）。ステッカー購入の原資として
-- 感謝ポイント受領分を使うことは制限されない。
CREATE OR REPLACE VIEW member_points
WITH (security_invoker = true) AS
SELECT
  fm.id AS member_id,
  fm.family_id,
  fm.display_name,
  (
    COALESCE(earned.total, 0)
    - COALESCE(spent.total, 0)
    + COALESCE(gratitude_received.total, 0)
    - COALESCE(sticker_spent.total, 0)
  )::INT AS current_points
FROM family_members fm
LEFT JOIN (
  SELECT reported_by AS member_id, SUM(points)::INT AS total
  FROM chore_completions
  GROUP BY reported_by
) earned ON earned.member_id = fm.id
LEFT JOIN (
  SELECT member_id, SUM(cost)::INT AS total
  FROM reward_redemptions
  WHERE status = 'approved'
  GROUP BY member_id
) spent ON spent.member_id = fm.id
LEFT JOIN (
  SELECT recipient_id AS member_id, SUM(points)::INT AS total
  FROM gratitude_points
  WHERE revoked_at IS NULL
  GROUP BY recipient_id
) gratitude_received ON gratitude_received.member_id = fm.id
LEFT JOIN (
  -- [新規] ステッカー購入分。取消経路が無いため取消済み行の除外条件は不要（決定24）。
  SELECT member_id, SUM(points_spent)::INT AS total
  FROM ornament_sticker_purchases
  GROUP BY member_id
) sticker_spent ON sticker_spent.member_id = fm.id
WHERE fm.is_active;


-- ------------------------------------------------------------
-- 5. cancel_chore_completion()（43章）への影響 — 変更不要の確認
-- ------------------------------------------------------------
-- 43.5章の既存ガード
--   IF EXISTS (SELECT 1 FROM family_tree_decorations ftd WHERE
--    ftd.completion_id = p_completion_id) THEN RAISE EXCEPTION ...
-- はdecoration_source列を一切条件に含んでいないため、本章適用後も変更なく
-- そのままステッカーにも適用される。本節は関数を一切変更しない
-- （設計部/成果物/スキーマ設計.sql 47.5章、決定47-8）。


-- ------------------------------------------------------------
-- 6. バッジ（member_badges）— 累計到達の記録・階段閾値・自動判定
-- ------------------------------------------------------------
-- 「いつ到達したか」を固定記録として永続化する（企画部推奨、07-9章
-- 「後退しない」原則と同じ考え方）。判定は元イベント（完了報告・お絵かき
-- 保存・ガチャ抽選・ステッカー購入）へのAFTER INSERTトリガーが、その都度
-- その場で新たに到達した段階だけを検出してINSERTする（29a章・33a章と同じ
-- 「加算専用トリガー」の設計思想）。

-- 青天井（決定28）: 階段閾値は単一のSQL関数にハードコードする（29章
-- family_tree_stage_for_count()と同じ設計判断）。各指標の初期閾値
-- （企画部初期案の1段階目）を起点に「1・3・10」の桁を上げていくパターン
-- （100→300→1000→3000→10000→…）を一貫して適用した10段階を用意する。
CREATE OR REPLACE FUNCTION public.badge_tier_thresholds(p_badge_key TEXT)
RETURNS INT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_badge_key
    WHEN 'lifetime_points_earned'     THEN ARRAY[100, 300, 1000, 3000, 10000, 30000, 100000, 300000, 1000000, 3000000]
    WHEN 'lifetime_completions'       THEN ARRAY[50, 100, 300, 1000, 3000, 10000, 30000, 100000, 300000, 1000000]
    WHEN 'lifetime_drawings'          THEN ARRAY[10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000, 300000]
    WHEN 'lifetime_gacha_draws'       THEN ARRAY[10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000, 300000]
    WHEN 'lifetime_sticker_purchases' THEN ARRAY[5, 10, 30, 100, 300, 1000, 3000, 10000, 30000, 100000]
    ELSE ARRAY[]::INT[]
  END;
$$;

COMMENT ON FUNCTION public.badge_tier_thresholds(TEXT) IS
  '07-19-9b章「決定28」（青天井）。各バッジ指標の到達段階を昇順配列で返す純関数。将来の閾値調整はこの関数1箇所のCREATE OR REPLACEで完結する。未知のbadge_keyには空配列を返す。';

-- [初出時点でPUBLIC実行可能のまま据え置く] 33g章gacha_drawing_weight()と
-- 同じ理由。読み取り専用・副作用の無い純関数であり、REVOKEしない。

CREATE TABLE IF NOT EXISTS member_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL CHECK (badge_key IN (
    'lifetime_points_earned', 'lifetime_completions', 'lifetime_drawings',
    'lifetime_gacha_draws', 'lifetime_sticker_purchases'
  )),
  tier_value INT NOT NULL CHECK (tier_value > 0),
  achieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (member_id, badge_key, tier_value)
);

CREATE INDEX IF NOT EXISTS idx_member_badges_family_id ON member_badges(family_id);
CREATE INDEX IF NOT EXISTS idx_member_badges_member_id ON member_badges(member_id);

ALTER TABLE member_badges ENABLE ROW LEVEL SECURITY;

-- 家族の誰でも他メンバーのバッジを閲覧できる。ランキング用の集計Viewは
-- 意図的に作らない（07-10章必須3条件）。
DROP POLICY IF EXISTS "member_badges_select_same_family" ON member_badges;
CREATE POLICY "member_badges_select_same_family" ON member_badges
  FOR SELECT
  USING (family_id = current_family_id());

-- INSERT/UPDATE/DELETEポリシーは一切定義しない。書き込みは下記
-- member_badges_sync()（SECURITY DEFINER）と、それを呼ぶ4本のAFTER INSERT
-- トリガーのみが行う。

-- [重要・セキュリティ] member_badges_sync()はmember_id・family_idを引数で
-- そのまま受け取り検証なしにINSERTするため、authenticated/anonから直接RPC
-- として呼べてしまうと「バッジ偽装」の抜け穴になる。33g章の教訓
-- （PostgreSQLはCREATE FUNCTION時にEXECUTEをPUBLICへ自動付与し、Supabaseは
-- anon・authenticatedへ直接EXECUTEを付与する）を先取りして適用し、本関数は
-- 明示的にPUBLIC・anon・authenticatedすべてからREVOKEする（決定47-13）。
-- 呼び出しは下記4本のSECURITY DEFINERトリガー関数からのネスト呼び出しのみに
-- 限定する。
CREATE OR REPLACE FUNCTION public.member_badges_sync(
  p_member_id UUID,
  p_family_id UUID,
  p_badge_key TEXT,
  p_current_value BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO member_badges (family_id, member_id, badge_key, tier_value)
  SELECT p_family_id, p_member_id, p_badge_key, t
  FROM unnest(public.badge_tier_thresholds(p_badge_key)) AS t
  WHERE t <= p_current_value
  ON CONFLICT (member_id, badge_key, tier_value) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.member_badges_sync(UUID, UUID, TEXT, BIGINT) IS
  '内部ヘルパー。指定メンバー・指定指標の現在値に対し、まだ記録が無い到達済み段階のみをmember_badgesへINSERTする（ON CONFLICT DO NOTHINGで冪等）。直接のRPC呼び出しは一切許可しない（下記REVOKE参照）。呼び出しは本節の4本のAFTER INSERTトリガーからのみ行う。';

REVOKE ALL ON FUNCTION public.member_badges_sync(UUID, UUID, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;

-- [設計判断: 集計は都度のCOUNT/SUMクエリで行う] 33a章は「あと◯回でガチャ」の
-- ために専用の加算カウンタ列を新設したが、それは「ホーム画面への常時表示と
-- いう高頻度の読み取りパス」への最適化だった。本トリガーは書き込みパスで
-- 1回走る集計であり、既存の未公開の絵の保有上限チェック（33b章
-- family_drawings_before_insertのCOUNT(*)）と同じ「都度集計」で十分と判断した。

-- (1) chore_completions → lifetime_completions・lifetime_points_earned
CREATE OR REPLACE FUNCTION public.member_badges_check_chore_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completions INT;
  v_points INT;
BEGIN
  SELECT count(*), COALESCE(sum(points), 0) INTO v_completions, v_points
  FROM chore_completions
  WHERE reported_by = NEW.reported_by;

  PERFORM public.member_badges_sync(NEW.reported_by, NEW.family_id, 'lifetime_completions', v_completions);
  PERFORM public.member_badges_sync(NEW.reported_by, NEW.family_id, 'lifetime_points_earned', v_points);
  RETURN NULL; -- AFTER ROWトリガーのため戻り値は無視される
END;
$$;

-- [設計判断: gacha_member_progressを読まず、chore_completionsを都度集計する
-- 理由] gacha_member_progress.lifetime_completion_countは同じ値を保持しているが、
-- これを読む実装は「trg_gacha_member_progress_bumpが自分より先に実行され
-- 終わっていること」に暗黙に依存してしまう（33a章は両者が独立であることを
-- 前提にしている）。新しい実行順序依存を持ち込まないため、都度集計する。
DROP TRIGGER IF EXISTS trg_member_badges_check_chore_completion ON chore_completions;
CREATE TRIGGER trg_member_badges_check_chore_completion
  AFTER INSERT ON chore_completions
  FOR EACH ROW EXECUTE FUNCTION public.member_badges_check_chore_completion();

-- (2) family_drawings → lifetime_drawings（公開・未公開問わずCOUNT）。
CREATE OR REPLACE FUNCTION public.member_badges_check_family_drawing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM family_drawings WHERE artist_member_id = NEW.artist_member_id;
  PERFORM public.member_badges_sync(NEW.artist_member_id, NEW.family_id, 'lifetime_drawings', v_count);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_badges_check_family_drawing ON family_drawings;
CREATE TRIGGER trg_member_badges_check_family_drawing
  AFTER INSERT ON family_drawings
  FOR EACH ROW EXECUTE FUNCTION public.member_badges_check_family_drawing();

-- (3) gacha_draws → lifetime_gacha_draws
CREATE OR REPLACE FUNCTION public.member_badges_check_gacha_draw()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM gacha_draws WHERE member_id = NEW.member_id;
  PERFORM public.member_badges_sync(NEW.member_id, NEW.family_id, 'lifetime_gacha_draws', v_count);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_badges_check_gacha_draw ON gacha_draws;
CREATE TRIGGER trg_member_badges_check_gacha_draw
  AFTER INSERT ON gacha_draws
  FOR EACH ROW EXECUTE FUNCTION public.member_badges_check_gacha_draw();

-- (4) ornament_sticker_purchases → lifetime_sticker_purchases
CREATE OR REPLACE FUNCTION public.member_badges_check_sticker_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM ornament_sticker_purchases WHERE member_id = NEW.member_id;
  PERFORM public.member_badges_sync(NEW.member_id, NEW.family_id, 'lifetime_sticker_purchases', v_count);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_badges_check_sticker_purchase ON ornament_sticker_purchases;
CREATE TRIGGER trg_member_badges_check_sticker_purchase
  AFTER INSERT ON ornament_sticker_purchases
  FOR EACH ROW EXECUTE FUNCTION public.member_badges_check_sticker_purchase();

-- [一度きりの初期反映（バックフィル）・決定47-12] 29a章・33a章は「機能追加
-- より前の実績は遡って加算しない」と決定しているが、本章はあえて逆の判断
-- （既存メンバーの現在の累計値をもとに、遡ってバッジを一度だけ付与する）を
-- 採る。29a章・33a章が遡及を避けた理由（希少資源の後出し付与）はバッジには
-- 当てはまらない。バッジは経済的価値を一切持たない称賛の記録であり、遡って
-- 付与しない場合、機能公開時点で既に条件を満たしている実態が「未達成」という
-- 不自然な表示になってしまう（01章「ネガティブな体験を作らない」原則に反する）。
-- member_badges_sync()自体がON CONFLICT DO NOTHINGで冪等なため、本
-- マイグレーションを万一再実行しても安全である。is_activeで絞るのは
-- member_points等の既存の一貫方針と揃えるため。
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, family_id FROM family_members WHERE is_active LOOP
    PERFORM public.member_badges_sync(r.id, r.family_id, 'lifetime_completions',
      (SELECT count(*) FROM chore_completions WHERE reported_by = r.id));
    PERFORM public.member_badges_sync(r.id, r.family_id, 'lifetime_points_earned',
      (SELECT COALESCE(sum(points), 0) FROM chore_completions WHERE reported_by = r.id));
    PERFORM public.member_badges_sync(r.id, r.family_id, 'lifetime_drawings',
      (SELECT count(*) FROM family_drawings WHERE artist_member_id = r.id));
    PERFORM public.member_badges_sync(r.id, r.family_id, 'lifetime_gacha_draws',
      (SELECT count(*) FROM gacha_draws WHERE member_id = r.id));
    PERFORM public.member_badges_sync(r.id, r.family_id, 'lifetime_sticker_purchases',
      (SELECT count(*) FROM ornament_sticker_purchases WHERE member_id = r.id));
  END LOOP;
END $$;

-- [読み取り用View: 現在値（進捗表示用）] ポイント通帳画面で「次の段階まで
-- あと◯」を示すために、メンバー×指標ごとの現在の累計値を1クエリで返す。
-- member_points（8章）と同じLEFT JOIN方式（family_members起点）を踏襲する。
-- ランキング用の集計ではなく「本人の現在値」を返すだけであり、07-10章
-- 必須3条件に抵触しない（ソート・強調演出を持たない）。
CREATE OR REPLACE VIEW public.member_badge_progress
WITH (security_invoker = true) AS
SELECT fm.id AS member_id, fm.family_id, 'lifetime_points_earned'::text AS badge_key,
       COALESCE(cc_points.total, 0) AS current_value
FROM family_members fm
LEFT JOIN (
  SELECT reported_by AS member_id, SUM(points)::INT AS total FROM chore_completions GROUP BY reported_by
) cc_points ON cc_points.member_id = fm.id
WHERE fm.is_active
UNION ALL
SELECT fm.id, fm.family_id, 'lifetime_completions'::text,
       COALESCE(cc_count.total, 0)
FROM family_members fm
LEFT JOIN (
  SELECT reported_by AS member_id, count(*)::INT AS total FROM chore_completions GROUP BY reported_by
) cc_count ON cc_count.member_id = fm.id
WHERE fm.is_active
UNION ALL
SELECT fm.id, fm.family_id, 'lifetime_drawings'::text,
       COALESCE(fd_count.total, 0)
FROM family_members fm
LEFT JOIN (
  SELECT artist_member_id AS member_id, count(*)::INT AS total FROM family_drawings GROUP BY artist_member_id
) fd_count ON fd_count.member_id = fm.id
WHERE fm.is_active
UNION ALL
SELECT fm.id, fm.family_id, 'lifetime_gacha_draws'::text,
       COALESCE(gd_count.total, 0)
FROM family_members fm
LEFT JOIN (
  SELECT member_id, count(*)::INT AS total FROM gacha_draws GROUP BY member_id
) gd_count ON gd_count.member_id = fm.id
WHERE fm.is_active
UNION ALL
SELECT fm.id, fm.family_id, 'lifetime_sticker_purchases'::text,
       COALESCE(sp_count.total, 0)
FROM family_members fm
LEFT JOIN (
  SELECT member_id, count(*)::INT AS total FROM ornament_sticker_purchases GROUP BY member_id
) sp_count ON sp_count.member_id = fm.id
WHERE fm.is_active;

COMMENT ON VIEW public.member_badge_progress IS
  '07-19-9b章「どこに表示するか」。メンバー×指標ごとの現在の累計値のみを返す（達成済み段階の一覧はmember_badgesを、次の段階の閾値はbadge_tier_thresholds()を別途参照してクライアント側で組み合わせる）。ランキング表示は行わないこと（07-10章必須3条件）。';
