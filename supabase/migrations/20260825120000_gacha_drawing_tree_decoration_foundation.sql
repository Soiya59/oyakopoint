-- ============================================================
-- 07-13章「ガチャ・お絵かき・コレクター棚・木への飾り付け」— 第1段階：DB基盤
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-13章（2026-08-25追加）
--   設計部/成果物/スキーマ設計.sql 32b章（既存バッチ関数REVOKEの明記）・
--     33章（33a. gacha_member_progress／33b. family_drawings／
--     33c. gacha_preset_ornaments／33d. gacha_draws・draw_gacha()／
--     33e. family_tree_decorations・decorate_tree_with_gacha_prize()／
--     33f. 過去の木の確認メモ（新規テーブル・View不要）／33g. EXECUTE権限）
--   設計部/成果物/API仕様.md 12章
--   設計部/成果物/認証・データ管理設計書.md 9章
--   開発部/成果物/実装メモ.md 第76章相当（本マイグレーション対応章）参照
--
-- 本ファイルは今回の依頼範囲（第1段階：DB基盤のみ）に対応する。UI・
-- コンポーネント・フック・src/data/api.tsへの追加は今回のスコープ外であり
-- 本マイグレーションには含まれない。
--
-- 破壊性: 新規オブジェクトの追加のみで非破壊（実装メモ.md事前記録済み）。
--   - 新規テーブル4件（gacha_member_progress, family_drawings,
--     gacha_preset_ornaments, gacha_draws, family_tree_decorations）
--     ※5件。既存テーブルへの列追加・変更は無い
--     （family_drawingsへのrevealed_by_draw_id列追加は、本ファイル内で
--     新規作成したfamily_drawings自身に対する追加であり、既存テーブルの
--     変更ではない）。
--   - 新規View1件（gacha_member_progress_summary）の追加。
--   - 新規トリガー3件
--     （chore_completions への2本目のAFTER INSERTトリガー
--       trg_gacha_member_progress_bump ※既存トリガー
--       trg_family_tree_seasons_bumpは一切変更しない、
--      gacha_preset_ornaments の trg_gacha_preset_ornaments_before_update、
--      family_drawings の trg_family_drawings_before_insert）の追加。
--   - 新規関数6件（gacha_member_progress_bump, is_valid_drawing_line_data,
--     max_unpublished_drawings_per_member, gacha_preset_ornaments_before_update,
--     family_drawings_before_insert, gacha_drawing_weight, draw_gacha,
--     decorate_tree_with_gacha_prize）※8件。既存関数の置き換え
--     （CREATE OR REPLACE）は一切無い。
--   - 【既存オブジェクトへの変更】32b章のREVOKE 4件
--     （generate_weekly_family_digest / generate_weekly_family_digests_for_all_families /
--     rollover_family_tree_seasons / next_member_avatar_color）を本ファイルにも
--     含める。ただし本部長が本番のpg_proc.proaclを事前確認済みであり、
--     これらは20260823100000_family_tree_and_weekly_digest.sqlおよび
--     20260824221436_assign_avatar_color_to_all_members.sqlで**既に本番適用済み**
--     （ACLはpostgres/service_roleのみ、authenticated/anonは含まれないことを
--     適用前に本マイグレーションでも再確認済み）。REVOKEは冪等な操作のため
--     再実行しても安全であり、設計書（スキーマ設計.sql）とマイグレーション
--     資産の記述を一致させる目的でのみ再掲する。実行後の影響は無い
--     （既に無い権限をさらに剥奪するだけ）。
--   - GRANT/REVOKE EXECUTE（33g章）: draw_gacha() / decorate_tree_with_gacha_prize()
--     をauthenticatedにのみ許可し、anon/PUBLICからは明示的に剥奪する新規GRANT/REVOKE。
--     is_valid_drawing_line_data等の内部検証関数はPUBLICのEXECUTEを維持する
--     （CHECK制約からの呼び出しがロールを問わず動作する必要があるため。
--     33g章参照）。
--
-- 動作確認（秘匿性検証）は実装メモ.mdに手順・結果を記載する
-- （BEGIN; SET ROLE authenticated; ...; ROLLBACK; の非破壊的な検証）。
-- ============================================================


-- ------------------------------------------------------------
-- 32b. 既存バッチ関数のEXECUTE権限REVOKE（設計書との乖離解消・再掲）
-- ------------------------------------------------------------
-- [注記] 本番では既に適用済み（本マイグレーション適用前に
-- pg_proc.proaclで確認済み。上記ヘッダー参照）。冪等な操作のため再実行する。
REVOKE EXECUTE ON FUNCTION public.generate_weekly_family_digest(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_weekly_family_digests_for_all_families(DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rollover_family_tree_seasons() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_member_avatar_color(UUID) FROM PUBLIC, anon, authenticated;


-- ------------------------------------------------------------
-- 33a. gacha_member_progress（「あと◯回でガチャ」の維持カウンタ）
-- ------------------------------------------------------------
-- 個人単位・全期間累計の加算専用カウンタ。29a章family_tree_seasons_bumpと
-- 同型のトリガーパターン。詳細な設計判断はスキーマ設計.sql 33a章参照。
CREATE TABLE IF NOT EXISTS gacha_member_progress (
  member_id UUID PRIMARY KEY REFERENCES family_members(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  lifetime_completion_count INT NOT NULL DEFAULT 0 CHECK (lifetime_completion_count >= 0),
  draw_count INT NOT NULL DEFAULT 0 CHECK (draw_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 「引いた回数だけの完了報告が無いのに引けている」状態を構造的に禁止する最終防衛線。
  CONSTRAINT chk_gacha_progress_draw_le_lifetime CHECK (draw_count * 5 <= lifetime_completion_count)
);

CREATE INDEX IF NOT EXISTS idx_gacha_member_progress_family_id ON gacha_member_progress(family_id);

DROP TRIGGER IF EXISTS trg_gacha_member_progress_updated_at ON gacha_member_progress;
CREATE TRIGGER trg_gacha_member_progress_updated_at
  BEFORE UPDATE ON gacha_member_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE gacha_member_progress ENABLE ROW LEVEL SECURITY;

-- 完了報告件数そのものは家族全体に公開済みの非機微情報（29b章と同種）。
DROP POLICY IF EXISTS "gacha_member_progress_select_same_family" ON gacha_member_progress;
CREATE POLICY "gacha_member_progress_select_same_family" ON gacha_member_progress
  FOR SELECT
  USING (family_id = current_family_id());

-- [重要] INSERT/UPDATE/DELETEポリシーは一切定義しない。書き込みは下記トリガーと
-- draw_gacha()（SECURITY DEFINER）のみが行う（29章family_tree_seasonsと同じ方針）。

CREATE OR REPLACE FUNCTION public.gacha_member_progress_bump()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO gacha_member_progress (member_id, family_id, lifetime_completion_count, draw_count)
  VALUES (NEW.reported_by, NEW.family_id, 1, 0)
  ON CONFLICT (member_id) DO UPDATE
    SET lifetime_completion_count = gacha_member_progress.lifetime_completion_count + 1,
        updated_at = now();
  RETURN NULL; -- AFTER ROWトリガーのため戻り値は無視される
END;
$$;

-- 29a章trg_family_tree_seasons_bumpとは独立した、chore_completionsに対する
-- 2本目のAFTER INSERTトリガー。既存トリガー・トリガー関数は一切変更しない。
DROP TRIGGER IF EXISTS trg_gacha_member_progress_bump ON chore_completions;
CREATE TRIGGER trg_gacha_member_progress_bump
  AFTER INSERT ON chore_completions
  FOR EACH ROW EXECUTE FUNCTION public.gacha_member_progress_bump();

COMMENT ON TRIGGER trg_gacha_member_progress_bump ON chore_completions IS
  '07-13章「あと◯回でガチャ」。chore_completionsへのINSERTのたびに、報告者本人のgacha_member_progress.lifetime_completion_countを+1する。29a章trg_family_tree_seasons_bumpとは独立（別トリガー・別テーブル）。';

-- 参照用View: 単一行の主キー読み取り＋四則演算のみ（集計クエリを含まない）。
CREATE OR REPLACE VIEW public.gacha_member_progress_summary
WITH (security_invoker = true) AS
SELECT
  member_id,
  family_id,
  lifetime_completion_count,
  draw_count,
  ((draw_count + 1) * 5) AS next_draw_threshold,
  GREATEST(((draw_count + 1) * 5) - lifetime_completion_count, 0)::int AS remaining_until_next_draw,
  (lifetime_completion_count >= ((draw_count + 1) * 5)) AS can_draw_now
FROM gacha_member_progress;

COMMENT ON VIEW public.gacha_member_progress_summary IS
  '07-13章「あと◯回でガチャ」の表示用View。対象メンバーがまだ1件も完了報告していない場合は行自体が存在しない（クライアント側はremaining_until_next_draw=5・can_draw_now=falseとして扱うこと）。security_invoker=trueのためgacha_member_progress_select_same_familyがそのまま適用される。';


-- ------------------------------------------------------------
-- 33b. family_drawings（お絵かき本体。秘匿性RLSの核心）
-- ------------------------------------------------------------
-- 線データJSONBスキーマ: {"v":1,"lines":[{"c":"#RRGGBB","p":[x1,y1,x2,y2,...]}, ...]}
-- 座標はキャンバス相対0〜1000の整数、色は8色固定パレット。
-- 上限値の根拠（悪意ある巨大データ対策）はスキーマ設計.sql 33b章コメント参照。
CREATE OR REPLACE FUNCTION public.is_valid_drawing_line_data(p_line_data JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_lines JSONB;
  v_line JSONB;
  v_points JSONB;
  v_point_count INT;
  v_total_points INT := 0;
  v_line_count INT;
  v_allowed_colors TEXT[] := ARRAY[
    '#2E2E2E', '#E4572E', '#F2913D', '#F5C518',
    '#3FA34D', '#2F80ED', '#E5449B', '#8B5CD6'
  ]; -- 07-13-2章決定済みの8色パレット
  v_val JSONB;
  v_num NUMERIC;
BEGIN
  IF p_line_data IS NULL OR jsonb_typeof(p_line_data) <> 'object' THEN RETURN false; END IF;
  IF p_line_data ->> 'v' IS DISTINCT FROM '1' THEN RETURN false; END IF;

  v_lines := p_line_data -> 'lines';
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' THEN RETURN false; END IF;

  v_line_count := jsonb_array_length(v_lines);
  IF v_line_count < 1 OR v_line_count > 150 THEN RETURN false; END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    IF jsonb_typeof(v_line) <> 'object' THEN RETURN false; END IF;
    IF NOT ((v_line ->> 'c') = ANY (v_allowed_colors)) THEN RETURN false; END IF;

    v_points := v_line -> 'p';
    IF v_points IS NULL OR jsonb_typeof(v_points) <> 'array' THEN RETURN false; END IF;

    v_point_count := jsonb_array_length(v_points);
    IF v_point_count < 2 OR v_point_count > 600 OR v_point_count % 2 <> 0 THEN RETURN false; END IF;

    FOR v_val IN SELECT * FROM jsonb_array_elements(v_points) LOOP
      IF jsonb_typeof(v_val) <> 'number' THEN RETURN false; END IF;
      v_num := v_val::text::numeric;
      IF v_num < 0 OR v_num > 1000 OR v_num <> trunc(v_num) THEN RETURN false; END IF;
    END LOOP;

    v_total_points := v_total_points + (v_point_count / 2);
  END LOOP;

  IF v_total_points > 3000 THEN RETURN false; END IF;
  IF octet_length(p_line_data::text) > 20480 THEN RETURN false; END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.is_valid_drawing_line_data(JSONB) IS
  '07-13-2章「線データ」のスキーマ検証・悪意ある巨大データ対策。線数(1-150)・1本あたり座標点数(1-300)・合計座標点数(3000以下)・座標値(0-1000の整数)・色(8色固定パレット)・シリアライズ後バイト数(20KB以下)を検証する。';

-- 未公開の絵の保有上限（企画部案：同時3枚まで。単一のSQL関数にハードコード）。
CREATE OR REPLACE FUNCTION public.max_unpublished_drawings_per_member()
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 3; $$;

COMMENT ON FUNCTION public.max_unpublished_drawings_per_member() IS
  '07-13-2章「未公開の絵の保有上限」の単一の定義箇所（企画部初期案：3枚。運用データを見て調整する前提）。';

-- [列設計] revealed_by_draw_idはgacha_draws(id)への循環参照のため、
-- ここでは列を持たせずCREATE TABLEし、33d章相当（本ファイル下部）で
-- gacha_draws作成後にALTER TABLEで追加する。
CREATE TABLE IF NOT EXISTS family_drawings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  artist_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  line_data JSONB NOT NULL,
  is_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_family_drawings_line_data CHECK (public.is_valid_drawing_line_data(line_data))
);

CREATE INDEX IF NOT EXISTS idx_family_drawings_family_id ON family_drawings(family_id);
CREATE INDEX IF NOT EXISTS idx_family_drawings_artist_unpublished
  ON family_drawings(artist_member_id) WHERE NOT is_published;
CREATE INDEX IF NOT EXISTS idx_family_drawings_family_unpublished
  ON family_drawings(family_id) WHERE NOT is_published;

ALTER TABLE family_drawings ENABLE ROW LEVEL SECURITY;

-- [方針1・最重要] 未公開の絵は作成者本人以外SELECT不可。UIではなくここで担保する。
DROP POLICY IF EXISTS "family_drawings_select_scoped" ON family_drawings;
CREATE POLICY "family_drawings_select_scoped" ON family_drawings
  FOR SELECT
  USING (
    family_id = current_family_id()
    AND (is_published OR artist_member_id = current_family_member_id())
  );

DROP POLICY IF EXISTS "family_drawings_insert_self" ON family_drawings;
CREATE POLICY "family_drawings_insert_self" ON family_drawings
  FOR INSERT
  WITH CHECK (family_id = current_family_id() AND artist_member_id = current_family_member_id());

-- [2026-08-25 本部長決定B] 未公開の絵は作成者本人がDELETE可能（描き直しの詰み防止）。
-- 公開済みの絵は引き続き削除不可（コレクター棚「永久保管」の要件）。
-- 未公開＝本人の所有物／公開済み＝家族の共有財産、という非対称性が設計原則。
DROP POLICY IF EXISTS "family_drawings_delete_own_unpublished" ON family_drawings;
CREATE POLICY "family_drawings_delete_own_unpublished" ON family_drawings
  FOR DELETE
  USING (
    family_id = current_family_id()
    AND artist_member_id = current_family_member_id()
    AND NOT is_published
  );

-- [重要] UPDATEポリシーは一切定義しない。公開状態の変更はdraw_gacha()
-- （SECURITY DEFINER）のみが行う。「DELETEしてINSERTし直す」以外に既存行の
-- 内容を書き換える手段が無いことを構造的に保証する（詳細はスキーマ設計.sql
-- 33b章コメント参照）。

COMMENT ON TABLE family_drawings IS
  '要件定義書07-13-2章「お絵かき」。未公開の間はartist_member_id本人にしかSELECTできない（family_drawings_select_scoped）。公開状態の変更経路はdraw_gacha()のみ。未公開の行は作成者本人がDELETE可（family_drawings_delete_own_unpublished、2026-08-25本部長決定B）。公開済みの行は誰も削除できない（コレクター棚の永久保管）。INSERT時トリガーの定義は本ファイル下部（gacha_draws作成後）参照。';


-- ------------------------------------------------------------
-- 33c. gacha_preset_ornaments（既製の飾りカタログ。全家族共通のグローバルカタログ）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gacha_preset_ornaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ornament_key TEXT NOT NULL UNIQUE CHECK (char_length(trim(ornament_key)) BETWEEN 1 AND 50),
  display_name TEXT NOT NULL CHECK (char_length(trim(display_name)) BETWEEN 1 AND 50),
  emoji TEXT NULL, -- UIUXデザイン部の最終アセット確定までのプレースホルダ表示用
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gacha_preset_ornaments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gacha_preset_ornaments_select_authenticated" ON gacha_preset_ornaments;
CREATE POLICY "gacha_preset_ornaments_select_authenticated" ON gacha_preset_ornaments
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT/UPDATE/DELETEはクライアントに一切開放しない。カタログの改廃は
-- マイグレーションまたは将来の運用管理画面（本設計のスコープ外）で行う。

CREATE OR REPLACE FUNCTION public.gacha_preset_ornaments_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining_active INT;
BEGIN
  IF OLD.is_active AND NOT NEW.is_active THEN
    SELECT count(*) INTO v_remaining_active
    FROM gacha_preset_ornaments
    WHERE is_active AND id <> OLD.id;

    IF v_remaining_active = 0 THEN
      RAISE EXCEPTION '既製の飾りを1件も無効化できません（07-13-2章「既製品が構造上必要な理由」。抽選プールが空になることを防ぐ最終防衛線）'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gacha_preset_ornaments_before_update ON gacha_preset_ornaments;
CREATE TRIGGER trg_gacha_preset_ornaments_before_update
  BEFORE UPDATE ON gacha_preset_ornaments
  FOR EACH ROW EXECUTE FUNCTION public.gacha_preset_ornaments_before_update();

-- [プレースホルダ初期データ] 最終カタログはUIUXデザイン部確定後に別途マイグレーションで追加・置換する。
INSERT INTO gacha_preset_ornaments (ornament_key, display_name, emoji) VALUES
  ('star_gold',   'きんいろの星', '⭐'),
  ('heart_red',   'あかいハート', '❤️'),
  ('ribbon_pink', 'ピンクのリボン', '🎀'),
  ('crown_gold',  'きんのかんむり', '👑'),
  ('balloon_blue','あおいふうせん', '🎈'),
  ('rainbow',     'にじ', '🌈'),
  ('medal_gold',  'きんメダル', '🏅'),
  ('flower_sun',  'ひまわり', '🌻')
ON CONFLICT (ornament_key) DO NOTHING;


-- ------------------------------------------------------------
-- 33d. gacha_draws（抽選ログ）・draw_gacha()（抽選RPC本体）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gacha_draws (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  prize_kind TEXT NOT NULL CHECK (prize_kind IN ('preset_ornament', 'family_drawing')),
  preset_ornament_id UUID NULL REFERENCES gacha_preset_ornaments(id) ON DELETE RESTRICT,
  prize_drawing_id UUID NULL REFERENCES family_drawings(id) ON DELETE RESTRICT,
  consumed_completion_from INT NOT NULL,
  consumed_completion_to INT NOT NULL,
  drawn_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_gacha_draws_prize_payload CHECK (
    (prize_kind = 'preset_ornament' AND preset_ornament_id IS NOT NULL AND prize_drawing_id IS NULL)
    OR (prize_kind = 'family_drawing' AND prize_drawing_id IS NOT NULL AND preset_ornament_id IS NULL)
  ),
  CONSTRAINT chk_gacha_draws_consumed_range CHECK (
    consumed_completion_from > 0 AND consumed_completion_to = consumed_completion_from + 4
  )
);

CREATE INDEX IF NOT EXISTS idx_gacha_draws_family_id ON gacha_draws(family_id);
CREATE INDEX IF NOT EXISTS idx_gacha_draws_member_id ON gacha_draws(member_id);

ALTER TABLE gacha_draws ENABLE ROW LEVEL SECURITY;

-- 誰が何を引いたかは家族の出来事として家族全員に公開する
-- （秘匿すべきなのは「未公開の絵」の中身であって「誰が何を引いたか」ではない）。
DROP POLICY IF EXISTS "gacha_draws_select_same_family" ON gacha_draws;
CREATE POLICY "gacha_draws_select_same_family" ON gacha_draws
  FOR SELECT
  USING (family_id = current_family_id());

-- [方針2・最重要] INSERT/UPDATE/DELETEポリシーは一切定義しない。書き込みは
-- 下記draw_gacha()（SECURITY DEFINER）のみが行う。クライアントが景品を
-- 指定してINSERTできる余地を構造的に無くすための設計。

-- family_drawingsの循環FK backfill。
ALTER TABLE family_drawings
  ADD COLUMN IF NOT EXISTS revealed_by_draw_id UUID NULL REFERENCES gacha_draws(id) ON DELETE RESTRICT;

ALTER TABLE family_drawings DROP CONSTRAINT IF EXISTS chk_family_drawings_publish_state;
ALTER TABLE family_drawings
  ADD CONSTRAINT chk_family_drawings_publish_state CHECK (
    (NOT is_published AND published_at IS NULL AND revealed_by_draw_id IS NULL)
    OR (is_published AND published_at IS NOT NULL AND revealed_by_draw_id IS NOT NULL)
  );

-- [33b章から移設] INSERT時トリガー本体。revealed_by_draw_id列が上記で追加済み
-- のため、ここで3列（is_published/published_at/revealed_by_draw_id）を
-- まとめて強制上書きできる。
CREATE OR REPLACE FUNCTION public.family_drawings_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_unpublished_count INT;
BEGIN
  -- クライアントを信用せず、常に呼び出し本人のfamily_id/artist_member_idで上書きする。
  NEW.family_id := current_family_id();
  NEW.artist_member_id := current_family_member_id();

  IF NEW.family_id IS NULL OR NEW.artist_member_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [最重要] 公開状態はガチャ（draw_gacha関数）経由でのみ変更できる。
  -- クライアントが最初からis_published=true等を送っても常に無視して未公開で作成する。
  NEW.is_published := false;
  NEW.published_at := NULL;
  NEW.revealed_by_draw_id := NULL;

  -- 未公開の絵の保有上限（企画部案：同時3枚まで）。上限到達時は新規INSERT
  -- 自体を拒否するのみで、既存の未公開の絵を自動削除する等の操作は一切行わない。
  SELECT count(*) INTO v_unpublished_count
  FROM family_drawings
  WHERE artist_member_id = NEW.artist_member_id AND NOT is_published;

  IF v_unpublished_count >= public.max_unpublished_drawings_per_member() THEN
    RAISE EXCEPTION 'まだ誰にも見つかっていない絵が%枚あります。ガチャで見つかるまで新しい絵は描けません', v_unpublished_count
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_drawings_before_insert ON family_drawings;
CREATE TRIGGER trg_family_drawings_before_insert
  BEFORE INSERT ON family_drawings
  FOR EACH ROW EXECUTE FUNCTION public.family_drawings_before_insert();

-- ガチャの重み付け（企画部初期案：家族の絵1枚＝既製の飾り3個分の重み）。
CREATE OR REPLACE FUNCTION public.gacha_drawing_weight()
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 3::numeric; $$;

COMMENT ON FUNCTION public.gacha_drawing_weight() IS
  '07-13-1章「家族の絵1枚あたりの当選確率を、既製の飾り3個分程度の重みとする」の単一の定義箇所（企画部初期案。運用データを見て調整する前提）。既製の飾りの重みは1固定（draw_gacha()内）。';

-- [抽選ロジック本体] 権利検証・プール構成（自分の絵を除外）・抽選・公開状態への
-- 更新・gacha_drawsへの記録を1トランザクションで完結させる。クライアントから
-- 景品を指定する引数は一切受け取らない。
-- [同時実行対策] 家族の絵の候補はFOR UPDATE SKIP LOCKEDで行ロックを取得した
-- ものだけをプールに含める（「同じ絵が2人に同時に当たる」事故を構造的に防ぐ）。
CREATE OR REPLACE FUNCTION public.draw_gacha()
RETURNS TABLE (
  draw_id UUID,
  prize_kind TEXT,
  preset_ornament_id UUID,
  prize_drawing_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_lifetime_count INT;
  v_draw_count INT;
  v_next_threshold INT;
  v_kind TEXT;
  v_ref_id UUID;
  v_new_draw_id UUID;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 行ロックしてから判定する（同一メンバーからの同時多重呼び出しでの二重
  -- 抽選・カウンタ不整合を防ぐ）。行が無ければ「0回」として扱う。
  SELECT lifetime_completion_count, draw_count
    INTO v_lifetime_count, v_draw_count
  FROM gacha_member_progress
  WHERE member_id = v_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_lifetime_count := 0;
    v_draw_count := 0;
  END IF;

  -- [権利の検証] 完了報告数と消費実績（draw_count*5）の差が5以上か。
  v_next_threshold := (v_draw_count + 1) * 5;
  IF v_lifetime_count < v_next_threshold THEN
    RAISE EXCEPTION 'まだガチャを引けません（あと%回の完了報告が必要です）',
      (v_next_threshold - v_lifetime_count)
      USING ERRCODE = 'check_violation';
  END IF;

  -- [抽選プールの構成・実行]
  WITH locked_drawings AS (
    SELECT id, public.gacha_drawing_weight() AS weight
    FROM family_drawings
    WHERE family_id = v_family_id
      AND NOT is_published
      AND artist_member_id <> v_member_id -- 自分の絵は自分では引けない
    FOR UPDATE SKIP LOCKED
  ),
  pool AS (
    SELECT 'preset_ornament'::text AS kind, id AS ref_id, 1::numeric AS weight
    FROM gacha_preset_ornaments WHERE is_active
    UNION ALL
    SELECT 'family_drawing'::text, id, weight FROM locked_drawings
  ),
  weighted AS (
    SELECT kind, ref_id, weight,
      sum(weight) OVER (ORDER BY kind, ref_id) AS cum_weight,
      sum(weight) OVER () AS total_weight
    FROM pool
  )
  SELECT kind, ref_id INTO v_kind, v_ref_id
  FROM weighted
  WHERE cum_weight >= (random() * (SELECT max(total_weight) FROM weighted))
  ORDER BY cum_weight
  LIMIT 1;

  IF v_kind IS NULL THEN
    -- 通常運用では到達しない（gacha_preset_ornaments_before_updateがis_active=true
    -- の行を0件にすることを防止しているため、既製の飾りのプールは常に非空）。
    RAISE EXCEPTION '抽選できる景品がありません（運用側の設定を確認してください）' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO gacha_draws (
    family_id, member_id, prize_kind, preset_ornament_id, prize_drawing_id,
    consumed_completion_from, consumed_completion_to
  ) VALUES (
    v_family_id, v_member_id, v_kind,
    CASE WHEN v_kind = 'preset_ornament' THEN v_ref_id END,
    CASE WHEN v_kind = 'family_drawing' THEN v_ref_id END,
    v_draw_count * 5 + 1,
    v_next_threshold
  )
  RETURNING id INTO v_new_draw_id;

  -- 抽選回数を確定させる（上記FOR UPDATEで行ロック済みのため安全に+1できる）。
  UPDATE gacha_member_progress
  SET draw_count = draw_count + 1, updated_at = now()
  WHERE member_id = v_member_id;

  IF v_kind = 'family_drawing' THEN
    -- [方針1と方針2の接続点] ここで初めてis_published=trueになる。
    -- 「引かれた瞬間に家族へ初公開される」をサーバー側の1トランザクションとして実装している。
    UPDATE family_drawings
    SET is_published = true, published_at = now(), revealed_by_draw_id = v_new_draw_id
    WHERE id = v_ref_id;
  END IF;

  RETURN QUERY SELECT
    v_new_draw_id,
    v_kind,
    CASE WHEN v_kind = 'preset_ornament' THEN v_ref_id END,
    CASE WHEN v_kind = 'family_drawing' THEN v_ref_id END;
END;
$$;

COMMENT ON FUNCTION public.draw_gacha() IS
  '要件定義書07-13-1章「ガチャ」。引数を一切取らない（景品をクライアントが指定できないようにするための構造的な設計）。権利検証・プール構成（自分の絵を除外）・抽選・公開状態への更新・gacha_drawsへの記録を1トランザクションで行う。EXECUTE権限は本ファイル末尾参照。';


-- ------------------------------------------------------------
-- 33e. family_tree_decorations（木への飾り付け）・
--      decorate_tree_with_gacha_prize()（交換RPC本体）
-- ------------------------------------------------------------
-- 抽選(draw_gacha)と木への反映(decorate_tree_with_gacha_prize)は別の
-- ユーザー操作として分離する（1回の抽選結果はまだどの丸にするか選んでいない
-- 「未反映」の状態が存在しうる。詳細はスキーマ設計.sql 33e章参照）。
CREATE TABLE IF NOT EXISTS family_tree_decorations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES family_tree_seasons(id) ON DELETE RESTRICT,
  completion_id UUID NOT NULL REFERENCES chore_completions(id) ON DELETE RESTRICT,
  draw_id UUID NOT NULL REFERENCES gacha_draws(id) ON DELETE RESTRICT,
  decorated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (completion_id), -- 同じ色丸を二重に交換できない
  UNIQUE (draw_id)        -- 同じガチャ結果を二重に木へ乗せられない
);

CREATE INDEX IF NOT EXISTS idx_family_tree_decorations_family_id ON family_tree_decorations(family_id);
CREATE INDEX IF NOT EXISTS idx_family_tree_decorations_season_id ON family_tree_decorations(season_id);

ALTER TABLE family_tree_decorations ENABLE ROW LEVEL SECURITY;

-- 木は家族全員が見るものであり、飾り付けの結果も家族全員に公開する。
DROP POLICY IF EXISTS "family_tree_decorations_select_same_family" ON family_tree_decorations;
CREATE POLICY "family_tree_decorations_select_same_family" ON family_tree_decorations
  FOR SELECT
  USING (family_id = current_family_id());

-- [方針3] INSERT/UPDATE/DELETEポリシーは一切定義しない。書き込みは下記
-- decorate_tree_with_gacha_prize()（SECURITY DEFINER）のみが行う。
-- chore_completions自体を書き換えずに色丸と景品の交換を表現する
-- （chore_completionsにはUPDATE/DELETEポリシーを一切追加していない）。

CREATE OR REPLACE FUNCTION public.decorate_tree_with_gacha_prize(p_draw_id UUID, p_completion_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_draw RECORD;
  v_completion RECORD;
  v_season_id UUID;
  v_season_start DATE;
  v_decoration_id UUID;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 対象のガチャ結果が自分自身のものであることを確認する。
  SELECT * INTO v_draw FROM gacha_draws
  WHERE id = p_draw_id AND family_id = v_family_id AND member_id = v_member_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象のガチャ結果が見つかりません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM family_tree_decorations WHERE draw_id = p_draw_id) THEN
    RAISE EXCEPTION 'この景品はすでに木に飾られています' USING ERRCODE = 'check_violation';
  END IF;

  -- [方針3] 交換対象はガチャを引いた本人自身の色丸に限る。
  SELECT * INTO v_completion FROM chore_completions
  WHERE id = p_completion_id AND family_id = v_family_id AND reported_by = v_member_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の色丸が見つからないか、自分の完了報告ではありません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM family_tree_decorations WHERE completion_id = p_completion_id) THEN
    RAISE EXCEPTION 'この色丸はすでに景品と交換済みです' USING ERRCODE = 'check_violation';
  END IF;

  -- [重要] 対象の色丸が「今まさに進行中のシーズン」に属することを確認する。
  -- 過去シーズンの木は飾られた状態のまま凍結保存する。
  SELECT id, season_start INTO v_season_id, v_season_start
  FROM family_tree_seasons
  WHERE family_id = v_family_id AND season_end IS NULL;

  IF v_season_id IS NULL
     OR date_trunc('month', (v_completion.reported_at AT TIME ZONE 'Asia/Tokyo'))::date <> v_season_start THEN
    RAISE EXCEPTION '今シーズンの色丸のみ交換できます（過去シーズンの木は保存された状態のまま変更できません）'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO family_tree_decorations (family_id, season_id, completion_id, draw_id)
  VALUES (v_family_id, v_season_id, p_completion_id, p_draw_id)
  RETURNING id INTO v_decoration_id;

  RETURN v_decoration_id;
END;
$$;

COMMENT ON FUNCTION public.decorate_tree_with_gacha_prize(UUID, UUID) IS
  '要件定義書07-13-4章「木への飾り付け」。draw_gacha()で確定した自分のガチャ結果を、自分の今シーズンの色丸1つと交換する。他人の色丸・過去シーズンの色丸・他人のガチャ結果は一切指定できない（各種検証はfunction内で完結）。EXECUTE権限は本ファイル末尾参照。';


-- ------------------------------------------------------------
-- 33f. コレクター棚「過去の木」区画 — 新規テーブル・View不要（スキーマ設計.sql 33f章の確認どおり）
-- ------------------------------------------------------------
-- PostgRESTの外部キー埋め込み（embedding）機能により既存の
-- chore_completions ?select=...&family_tree_decorations(...) というクエリの
-- 自然な拡張で実現できるため、本ファイルでの新規オブジェクト追加は無い
-- （具体的なクエリ形状はAPI仕様.md 12.5節参照）。


-- ------------------------------------------------------------
-- 33g. EXECUTE権限（GRANT/REVOKE）のまとめ
-- ------------------------------------------------------------
-- draw_gacha()・decorate_tree_with_gacha_prize()はいずれも「本人が自分の意思で
-- 呼ぶ」操作であり、authenticatedロールにのみEXECUTEを許可する。PostgreSQLは
-- CREATE FUNCTION時にEXECUTEをPUBLICへ自動付与するため、未ログイン（anon）
-- からの呼び出しを確実に防ぐには明示的なREVOKEが必要。
REVOKE ALL ON FUNCTION public.draw_gacha() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.draw_gacha() TO authenticated;

REVOKE ALL ON FUNCTION public.decorate_tree_with_gacha_prize(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decorate_tree_with_gacha_prize(UUID, UUID) TO authenticated;

-- is_valid_drawing_line_data / max_unpublished_drawings_per_member /
-- gacha_drawing_weight はCHECK制約・関数内部から呼ばれるだけの純粋関数であり
-- クライアントから直接RPCとして呼ぶ必要が無い。ただしCHECK制約からの呼び出し
-- はロールに関わらず動作する必要があるため、これらはPUBLICへのEXECUTEを
-- 維持する（REVOKEしない。REVOKEするとauthenticatedによるfamily_drawingsへの
-- 通常のINSERT時にCHECK制約の評価自体が権限エラーになり、正規のお絵かき
-- 投稿ができなくなってしまうため）。
-- ============================================================
