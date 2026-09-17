-- ============================================================
-- 習慣カード（台紙）とフィギュア（07-28章、2026-09-17新設）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-28章（決定1〜24）
--   設計部/成果物/スキーマ設計.sql 55章（本マイグレーションはこの章の草案を
--     ほぼそのまま実装したもの。差分は本ファイル内コメントに明記する）
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 49章
--   開発部/成果物/実装メモ.md 237章
--
-- [全体方針] 「お手伝い＝ポイント」「習慣＝台紙」の二本立て（決定1）を、
-- 新しい完了報告経路・新しい取消経路を一切作らずに既存のchores・
-- chore_completionsの骨格に乗せる（決定5・6）。ポイント経済（member_points）へは
-- 一切触れない（決定9・17）。
--
-- [55.14章の申し送りへの対応・重要な実装判断]
--   (1) chores.points/chore_completions.pointsのCHECK制約は、設計書は
--       `chores_points_check`/`chore_completions_points_check`という推定名を
--       DROPする案だったが、本マイグレーションでは推定に頼らず、pg_constraint/
--       pg_attributeを都度検索して実際の制約名を動的に特定してDROPする
--       （下記DOブロック）。名前がずれていても確実に対象を落とせる。
-- ============================================================

-- ------------------------------------------------------------
-- 55.1 chores拡張（reward_mode・habit_kind_key、pointsのNULL許容化）
-- ------------------------------------------------------------
ALTER TABLE chores
  ADD COLUMN IF NOT EXISTS reward_mode TEXT NOT NULL DEFAULT 'points',
  ADD COLUMN IF NOT EXISTS habit_kind_key TEXT NULL;

ALTER TABLE chores ALTER COLUMN points DROP NOT NULL;

-- [動的な制約名解決] chores.points に付いている無名CHECK制約（`points > 0`）を、
-- 実際の名前を検索したうえでDROPする（開発部/成果物/実装メモ.md 237章参照。
-- 55.14章の申し送りに対する実装上の改善）。
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'chores' AND con.contype = 'c' AND att.attname = 'points'
    AND array_length(con.conkey, 1) = 1
  LIMIT 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE chores DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_reward_mode_values;
ALTER TABLE chores ADD CONSTRAINT chk_chores_reward_mode_values
  CHECK (reward_mode IN ('points', 'habit_card'));

-- [決定55-3] reward_mode='habit_card'の行は
-- (a) points IS NULL, (b) habit_kind_key IS NOT NULL,
-- (c) is_repeatable=true AND daily_limit=1, (d) assigned_to IS NOT NULL
-- をまとめて1つのCHECK制約で強制する。reward_mode='points'の行は逆に
-- (a)points NOT NULL・(b)habit_kind_key IS NULL を要求し、既存の挙動を保つ。
ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_reward_mode_payload;
ALTER TABLE chores ADD CONSTRAINT chk_chores_reward_mode_payload CHECK (
  (reward_mode = 'points'
    AND points IS NOT NULL AND points > 0
    AND habit_kind_key IS NULL)
  OR
  (reward_mode = 'habit_card'
    AND points IS NULL
    AND habit_kind_key IS NOT NULL
    AND is_repeatable = true
    AND daily_limit = 1
    AND assigned_to IS NOT NULL)
);

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT con.conname INTO v_conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'chore_completions' AND con.contype = 'c' AND att.attname = 'points'
    AND array_length(con.conkey, 1) = 1
  LIMIT 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE chore_completions DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE chore_completions ALTER COLUMN points DROP NOT NULL;
ALTER TABLE chore_completions DROP CONSTRAINT IF EXISTS chk_chore_completions_points;
ALTER TABLE chore_completions ADD CONSTRAINT chk_chore_completions_points
  CHECK (points IS NULL OR points > 0);

-- [chores_before_write()の改訂]
-- 45.4章の最新版（scope分岐によるcreated_by/assigned_to補正・37章updated_byの
-- 記録・scope不変チェックを含む）を土台にし、55章の変更（下記4点）を重ねる。
--   (1) reward_mode・habit_kind_keyは作成時にのみ確定でき、以後のUPDATEでの
--       変更は拒否する。
--   (2) reward_mode='habit_card'の行は、is_repeatable/daily_limit/pointsを
--       クライアント入力に関わらずDB側で強制的に補正する。
--   (3) habit_card型は担当者（assigned_to）が必須。「誰でも実行可」
--       （assigned_to IS NULL）を許さない（決定55-21）。
--   (4) habit_kind_key が habit_figure_catalog に実在し有効
--       （is_active=true）であることを検証する。
--   (5) habit_card型クエストの担当者（assigned_to）は作成時にのみ確定でき、
--       以後のUPDATEでの変更を拒否する（決定55-22）。
CREATE OR REPLACE FUNCTION public.chores_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.scope IS DISTINCT FROM OLD.scope THEN
    RAISE EXCEPTION '公開範囲（scope）は作成後に変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [55章・決定55-9] reward_mode・habit_kind_keyは作成時にのみ確定できる。
  IF TG_OP = 'UPDATE' THEN
    IF NEW.reward_mode IS DISTINCT FROM OLD.reward_mode
       OR NEW.habit_kind_key IS DISTINCT FROM OLD.habit_kind_key THEN
      RAISE EXCEPTION 'たまり方（ポイント／台紙）と台紙の種類は、あとから変更できません' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- [55章・決定55-22] habit_card型の担当者は作成時にのみ確定でき、
  -- 以後のUPDATEでの変更を拒否する。
  IF TG_OP = 'UPDATE' AND OLD.reward_mode = 'habit_card'
     AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    RAISE EXCEPTION '台紙型のクエストの担当者は、あとから変更できません' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.assigned_to IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = NEW.assigned_to AND fm.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'assigned_toは同じ家族のメンバーである必要があります' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF NEW.category_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM categories c WHERE c.id = NEW.category_id AND c.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'category_idは同じ家族のカテゴリーである必要があります' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- [45.4章・無変更] scopeごとのcreated_by/assigned_to補正。
  IF NEW.scope = 'personal' THEN
    NEW.created_by := current_family_member_id();
    NEW.assigned_to := NEW.created_by;
  ELSIF NEW.scope = 'supporter_shared' THEN
    NEW.assigned_to := NULL;
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := current_family_member_id();
    ELSE
      NEW.created_by := OLD.created_by;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.created_by := current_family_member_id();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
  END IF;

  -- [55章・決定55-4] habit_card型はDB側でis_repeatable/daily_limit/pointsを
  -- 強制的に補正する（クライアント入力を信用しない）。ここでのNEW.assigned_toは
  -- 直前のscope補正がすべて終わった後の最終値である。
  IF NEW.reward_mode = 'habit_card' THEN
    NEW.is_repeatable := true;
    NEW.daily_limit := 1;
    NEW.points := NULL;

    -- [決定55-21] 担当者必須（「誰でも実行可」不可）。scope='supporter_shared'は
    -- 上記補正で必ずassigned_to=NULLになるため、この分岐により構造的に
    -- habit_card型にできない。
    IF NEW.assigned_to IS NULL THEN
      RAISE EXCEPTION '台紙型のクエストは担当者を指定する必要があります（誰でも実行可にはできません）' USING ERRCODE = 'check_violation';
    END IF;

    -- [55章・決定55-5] habit_kind_keyの実在確認。
    IF NEW.habit_kind_key IS NULL OR NOT EXISTS (
      SELECT 1 FROM habit_figure_catalog hfc
      WHERE hfc.kind_key = NEW.habit_kind_key AND hfc.is_active
    ) THEN
      RAISE EXCEPTION '指定された台紙の種類が存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- [37章・無変更] updated_byの記録（許可リスト方式）。
  IF TG_OP = 'UPDATE' AND (
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.emoji IS DISTINCT FROM OLD.emoji OR
    NEW.points IS DISTINCT FROM OLD.points OR
    NEW.category_id IS DISTINCT FROM OLD.category_id OR
    NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR
    NEW.is_repeatable IS DISTINCT FROM OLD.is_repeatable OR
    NEW.daily_limit IS DISTINCT FROM OLD.daily_limit OR
    NEW.nfc_tag_id IS DISTINCT FROM OLD.nfc_tag_id
  ) THEN
    NEW.updated_by := current_family_member_id();
  END IF;

  -- is_repeatable=true かつ daily_limit未指定のchore新規作成時はデフォルト1を補完。
  IF TG_OP = 'INSERT' AND NEW.is_repeatable AND NEW.daily_limit IS NULL THEN
    NEW.daily_limit := 1;
  END IF;
  RETURN NEW;
END;
$$;
-- トリガー本体（trg_chores_before_write・trg_chores_updated_at）は既存のものを
-- そのまま再利用する（再作成不要。シグネチャ不変）。

-- ------------------------------------------------------------
-- 55.2 habit_figure_catalog（静的カタログ・種類×段階）
-- ------------------------------------------------------------
-- [決定55-7・最重要] `kind_key`にはCHECK IN(...)のようなハードコードされた
-- 値リストを設けない（NOT NULL・長さチェックのみ）。これにより、新しい種類の
-- 追加は文字どおり4行のINSERTのみで完結し、CHECK制約のALTERは不要になる。
CREATE TABLE IF NOT EXISTS habit_figure_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind_key TEXT NOT NULL CHECK (char_length(trim(kind_key)) BETWEEN 1 AND 50),
  kind_display_name TEXT NOT NULL CHECK (char_length(trim(kind_display_name)) BETWEEN 1 AND 50),
  kind_emoji TEXT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('bronze', 'silver', 'gold', 'crystal')),
  figure_key TEXT NOT NULL UNIQUE CHECK (char_length(trim(figure_key)) BETWEEN 1 AND 50),
  display_name TEXT NOT NULL CHECK (char_length(trim(display_name)) BETWEEN 1 AND 50),
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (kind_key, tier)
);

ALTER TABLE habit_figure_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "habit_figure_catalog_select_authenticated" ON habit_figure_catalog;
CREATE POLICY "habit_figure_catalog_select_authenticated" ON habit_figure_catalog
  FOR SELECT
  TO authenticated
  USING (true);

-- [初期データ・統括確定] MVPは2種類（ドラゴン・うさぎ）×4段階＝8行。
-- figure_keyは「figure_＋kind_key＋tier」の形にし、画像アセットのファイル名
-- （figure_dragon_bronze.png等）と対応させる。画像アセット自体は統括が制作中で
-- 未着のため、開発部はプレースホルダで進める（実装メモ237章参照）。
INSERT INTO habit_figure_catalog (kind_key, kind_display_name, kind_emoji, tier, figure_key, display_name, sort_order) VALUES
  ('dragon', 'ドラゴン台紙', '🐉', 'bronze',  'figure_dragon_bronze',  'どうのドラゴン',       1),
  ('dragon', 'ドラゴン台紙', '🐉', 'silver',  'figure_dragon_silver',  'ぎんのドラゴン',       1),
  ('dragon', 'ドラゴン台紙', '🐉', 'gold',    'figure_dragon_gold',    'きんのドラゴン',       1),
  ('dragon', 'ドラゴン台紙', '🐉', 'crystal', 'figure_dragon_crystal', 'クリスタルのドラゴン', 1),
  ('rabbit', 'うさぎ台紙',   '🐰', 'bronze',  'figure_rabbit_bronze',  'どうのうさぎ',         2),
  ('rabbit', 'うさぎ台紙',   '🐰', 'silver',  'figure_rabbit_silver',  'ぎんのうさぎ',         2),
  ('rabbit', 'うさぎ台紙',   '🐰', 'gold',    'figure_rabbit_gold',    'きんのうさぎ',         2),
  ('rabbit', 'うさぎ台紙',   '🐰', 'crystal', 'figure_rabbit_crystal', 'クリスタルのうさぎ',   2)
ON CONFLICT (figure_key) DO NOTHING;

-- ------------------------------------------------------------
-- 55.3 habit_cards（台紙インスタンス）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS habit_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  chore_id UUID NOT NULL REFERENCES chores(id) ON DELETE RESTRICT,
  member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  chore_title TEXT NOT NULL,
  chore_emoji TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ NULL,
  archive_reason TEXT NULL CHECK (archive_reason IN ('manual', 'crystal_completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (
    (status = 'active' AND archived_at IS NULL AND archive_reason IS NULL)
    OR
    (status = 'archived' AND archived_at IS NOT NULL AND archive_reason IS NOT NULL)
  )
);

-- [決定18] 「習慣ごとに1枚」（進行中は高々1枚）をDBで保証する部分UNIQUEインデックス。
CREATE UNIQUE INDEX IF NOT EXISTS uq_habit_cards_active_per_chore_member
  ON habit_cards (chore_id, member_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_habit_cards_family_id ON habit_cards(family_id);
CREATE INDEX IF NOT EXISTS idx_habit_cards_member_id ON habit_cards(member_id);
CREATE INDEX IF NOT EXISTS idx_habit_cards_chore_id ON habit_cards(chore_id);

DROP TRIGGER IF EXISTS trg_habit_cards_updated_at ON habit_cards;
CREATE TRIGGER trg_habit_cards_updated_at
  BEFORE UPDATE ON habit_cards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE habit_cards ENABLE ROW LEVEL SECURITY;

-- 家族の誰でも他メンバーの台紙を閲覧できる（決定12）。書き込みは下記トリガー・
-- end_habit_card()のみに限定するため、INSERT/UPDATE/DELETEポリシーは
-- 一切定義しない。
DROP POLICY IF EXISTS "habit_cards_select_same_family" ON habit_cards;
CREATE POLICY "habit_cards_select_same_family" ON habit_cards
  FOR SELECT
  USING (family_id = current_family_id());

-- ------------------------------------------------------------
-- 55.3a habit_cards_before_write()（家族整合性の検証・上限3枚の強制）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.habit_cards_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_active_count INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM chores c WHERE c.id = NEW.chore_id AND c.family_id = NEW.family_id
  ) THEN
    RAISE EXCEPTION 'chore_idは同じ家族のクエストである必要があります' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM family_members fm WHERE fm.id = NEW.member_id AND fm.family_id = NEW.family_id
  ) THEN
    RAISE EXCEPTION 'member_idは同じ家族のメンバーである必要があります' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.status = 'active' THEN
    SELECT count(*) INTO v_active_count
    FROM habit_cards
    WHERE member_id = NEW.member_id AND status = 'active';

    IF v_active_count >= 3 THEN
      RAISE EXCEPTION '台紙は同時に3まいまでです。今の台紙をどれか「おわりにする」と、新しい台紙を始められます' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_habit_cards_before_write ON habit_cards;
CREATE TRIGGER trg_habit_cards_before_write
  BEFORE INSERT ON habit_cards
  FOR EACH ROW EXECUTE FUNCTION public.habit_cards_before_write();

-- ------------------------------------------------------------
-- 55.4 habit_figure_grants（自動付与の記録）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS habit_figure_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  habit_card_id UUID NOT NULL REFERENCES habit_cards(id) ON DELETE RESTRICT,
  member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  tier TEXT NOT NULL CHECK (tier IN ('bronze', 'silver', 'gold', 'crystal')),
  figure_catalog_id UUID NOT NULL REFERENCES habit_figure_catalog(id) ON DELETE RESTRICT,
  -- [決定55-14・重要] 取消はブロックしない。付与は取り消さない（55.7章参照）。
  triggering_completion_id UUID NULL REFERENCES chore_completions(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (habit_card_id, tier)
);

CREATE INDEX IF NOT EXISTS idx_habit_figure_grants_family_id ON habit_figure_grants(family_id);
CREATE INDEX IF NOT EXISTS idx_habit_figure_grants_member_id ON habit_figure_grants(member_id);
CREATE INDEX IF NOT EXISTS idx_habit_figure_grants_habit_card_id ON habit_figure_grants(habit_card_id);

ALTER TABLE habit_figure_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "habit_figure_grants_select_same_family" ON habit_figure_grants;
CREATE POLICY "habit_figure_grants_select_same_family" ON habit_figure_grants
  FOR SELECT
  USING (family_id = current_family_id());

-- ------------------------------------------------------------
-- 55.5 habit_card_progress_bump()（累計の数え方・自動付与）
-- ------------------------------------------------------------
-- [決定55-15・最重要] 累計は`habit_cards`にカウンタ列を持たせず、都度
-- `chore_completions`をCOUNTする。取消（cancel_chore_completion）が
-- `chore_completions`の行を物理削除するだけで、カウントが自動的に正しくなる。
CREATE OR REPLACE FUNCTION public.habit_card_progress_bump()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chore RECORD;
  v_card RECORD;
  v_count INT;
  v_tier TEXT;
  v_catalog_id UUID;
BEGIN
  SELECT c.reward_mode, c.habit_kind_key INTO v_chore
  FROM chores c WHERE c.id = NEW.chore_id;

  IF NOT FOUND OR v_chore.reward_mode <> 'habit_card' THEN
    RETURN NULL; -- 既定・大多数を占めるポイント型の完了報告は何もしない
  END IF;

  -- habit_card型は担当者が必須のため、台紙は常に「クエスト作成と同じ
  -- トランザクション」で事前に作成済みである。
  SELECT hc.* INTO v_card FROM habit_cards hc
  WHERE hc.chore_id = NEW.chore_id AND hc.member_id = NEW.reported_by AND hc.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    -- [理論上到達しない防御的フォールバック] 到達した場合（データ不整合等）でも
    -- 完了報告そのものは失敗させない（後退しない原則）。
    RETURN NULL;
  END IF;

  -- [決定55-15] 累計はCOUNTで都度算出する。台紙作成後（started_at以降）の
  -- 完了報告のみを対象にする（決定19「再開時は0から」）。
  SELECT count(*) INTO v_count
  FROM chore_completions cc
  WHERE cc.chore_id = NEW.chore_id
    AND cc.reported_by = NEW.reported_by
    AND cc.reported_at >= v_card.started_at;

  v_tier := CASE
    WHEN v_count >= 100 THEN 'crystal'
    WHEN v_count >= 50  THEN 'gold'
    WHEN v_count >= 30  THEN 'silver'
    WHEN v_count >= 10  THEN 'bronze'
    ELSE NULL
  END;

  IF v_tier IS NOT NULL THEN
    SELECT hfc.id INTO v_catalog_id
    FROM habit_figure_catalog hfc
    JOIN chores c ON c.id = v_card.chore_id
    WHERE hfc.kind_key = c.habit_kind_key AND hfc.tier = v_tier AND hfc.is_active;

    IF FOUND THEN
      -- [二重付与防止・決定9] ON CONFLICT DO NOTHINGが最終防衛線。
      INSERT INTO habit_figure_grants
        (family_id, habit_card_id, member_id, tier, figure_catalog_id, triggering_completion_id)
      VALUES
        (NEW.family_id, v_card.id, v_card.member_id, v_tier, v_catalog_id, NEW.id)
      ON CONFLICT (habit_card_id, tier) DO NOTHING;
    END IF;
    -- カタログにhabit_kind_key×tierの行が無い場合（データ不整合）は、
    -- 完了報告そのものを失敗させない（後退しない原則）。

    -- [決定20] クリスタル到達で台紙を自動的にアーカイブする。
    IF v_tier = 'crystal' THEN
      UPDATE habit_cards
      SET status = 'archived', archived_at = now(), archive_reason = 'crystal_completed', updated_at = now()
      WHERE id = v_card.id AND status = 'active';
    END IF;
  END IF;

  RETURN NULL; -- AFTER ROWトリガーのため戻り値は無視される
END;
$$;

DROP TRIGGER IF EXISTS trg_habit_card_progress_bump ON chore_completions;
CREATE TRIGGER trg_habit_card_progress_bump
  AFTER INSERT ON chore_completions
  FOR EACH ROW EXECUTE FUNCTION public.habit_card_progress_bump();

COMMENT ON TRIGGER trg_habit_card_progress_bump ON chore_completions IS
  '要件定義書07-28章決定9・23。reward_mode=habit_cardの完了報告のたびに、既に存在する進行中の台紙（chores_after_insert_create_habit_card()が作成済み）を取得し、started_at以降のchore_completionsをCOUNTして累計を求め、10/30/50/100到達時にhabit_figure_grantsへ自動付与する。member_pointsには一切触れない。';

-- ------------------------------------------------------------
-- 55.6 台紙の作成経路（即時作成のみ、決定18・決定24）
-- ------------------------------------------------------------
-- habit_card型クエストは常にassigned_toが確定している（決定55-21）ため、
-- chore作成と同じトランザクション内でその人の台紙を1枚自動作成する。
-- 3枚上限を超えていればhabit_cards_before_write()が例外を投げ、chore自体の
-- INSERTごとロールバックする。
CREATE OR REPLACE FUNCTION public.chores_after_insert_create_habit_card()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reward_mode = 'habit_card' AND NEW.assigned_to IS NOT NULL THEN
    INSERT INTO habit_cards (family_id, chore_id, member_id, chore_title, chore_emoji)
    VALUES (NEW.family_id, NEW.id, NEW.assigned_to, NEW.title, NEW.emoji);
  END IF;
  RETURN NULL; -- AFTER ROWトリガーのため戻り値は無視される
END;
$$;

DROP TRIGGER IF EXISTS trg_chores_after_insert_create_habit_card ON chores;
CREATE TRIGGER trg_chores_after_insert_create_habit_card
  AFTER INSERT ON chores
  FOR EACH ROW EXECUTE FUNCTION public.chores_after_insert_create_habit_card();

COMMENT ON TRIGGER trg_chores_after_insert_create_habit_card ON chores IS
  '要件定義書07-28章決定18・24。habit_card型クエストは作成と同じトランザクションで台紙を1枚自動作成する。上限3枚を超えていればhabit_cards_before_write()が例外を投げ、クエストの作成自体が失敗する。台紙の作成経路はこれのみ（遅延作成は存在しない）。';

-- [55.7章・chore_completions_before_insert()・cancel_chore_completion()への影響]
-- いずれも変更不要（設計部の確認どおり）。chores.pointsがhabit_card型でNULLに
-- なるため、既存のNEW.points := v_pointsコピーが自動的にNULLを渡し、決定9を
-- 満たす。段階到達直後の1分取消でも、triggering_completion_idがON DELETE
-- SET NULLのため取消は失敗せず、既に付与されたhabit_figure_grantsも取り消さない
-- （決定55-17）。

-- ------------------------------------------------------------
-- 55.8 end_habit_card()（「おわりにする」、決定18・19）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.end_habit_card(p_habit_card_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_card RECORD;
  v_scope TEXT;
  v_archived_at TIMESTAMPTZ;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT hc.* INTO v_card FROM habit_cards hc
  WHERE hc.id = p_habit_card_id AND hc.family_id = v_family_id AND hc.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の台紙が見つかりません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT c.scope INTO v_scope FROM chores c WHERE c.id = v_card.chore_id;

  IF v_scope = 'personal' THEN
    IF v_card.member_id <> v_member_id THEN
      RAISE EXCEPTION '自分専用の台紙は本人のみ「おわりにする」ことができます' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF v_card.member_id <> v_member_id AND NOT is_current_user_parent() THEN
      RAISE EXCEPTION 'この台紙は本人または保護者のみ「おわりにする」ことができます' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  UPDATE habit_cards
  SET status = 'archived', archived_at = now(), archive_reason = 'manual', updated_at = now()
  WHERE id = v_card.id
  RETURNING habit_cards.archived_at INTO v_archived_at;

  RETURN v_archived_at;
END;
$$;

COMMENT ON FUNCTION public.end_habit_card(UUID) IS
  '要件定義書07-28章決定18・19。進行中の台紙を、獲得済みの累計・フィギュアを保持したまま「おわりにする」（アーカイブする）。本人、または家族共有chore・みまもり共通choreの場合は保護者も操作できる。自分専用choreの台紙は本人のみ。持っているフィギュアは取り上げない。';

REVOKE ALL ON FUNCTION public.end_habit_card(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_habit_card(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 55.9 木への配置（family_tree_decorations拡張、決定21・決定55-18）
-- ------------------------------------------------------------
-- [重要・実装が正のルールの適用] 07-28章決定21・22、ワイヤーフレーム49章決定26は
-- いずれも「メダルの40スロット優先確保ロジックを流用する」ことを前提にしているが、
-- メダル（ステッカー）は2026-09-08付で自由配置方式へ全面移行済みである
-- （20260908010000_sticker_free_placement.sql）。プロジェクト全体のルール
-- （CLAUDE.md「実装済みの仕様について文書と実装が食い違ったら、実装を正とする」）
-- に従い、フィギュアも自由配置方式で実装する。40スロットの優先確保・間引き
-- ロジックには合流させない（設計部/成果物/スキーマ設計.sql 55.9章・55.14章で
-- 既に確定済みの判断をそのまま実装する）。
ALTER TABLE family_tree_decorations
  ADD COLUMN IF NOT EXISTS habit_figure_grant_id UUID NULL REFERENCES habit_figure_grants(id) ON DELETE RESTRICT;

ALTER TABLE family_tree_decorations DROP CONSTRAINT IF EXISTS chk_family_tree_decorations_source_payload;
ALTER TABLE family_tree_decorations
  ADD CONSTRAINT chk_family_tree_decorations_source_payload CHECK (
    decoration_source IN ('gacha', 'sticker', 'habit_figure')
    AND (
      (decoration_source = 'gacha'
        AND draw_id IS NOT NULL AND sticker_purchase_id IS NULL AND habit_figure_grant_id IS NULL
        AND completion_id IS NOT NULL
        AND pos_x IS NULL AND pos_y IS NULL)
      OR (decoration_source = 'sticker'
        AND sticker_purchase_id IS NOT NULL AND draw_id IS NULL AND habit_figure_grant_id IS NULL
        AND completion_id IS NULL
        AND pos_x IS NOT NULL AND pos_y IS NOT NULL
        AND pos_x BETWEEN 0 AND 1000 AND pos_y BETWEEN 0 AND 1000)
      OR (decoration_source = 'habit_figure'
        AND habit_figure_grant_id IS NOT NULL AND draw_id IS NULL AND sticker_purchase_id IS NULL
        AND completion_id IS NULL
        AND pos_x IS NOT NULL AND pos_y IS NOT NULL
        AND pos_x BETWEEN 0 AND 1000 AND pos_y BETWEEN 0 AND 1000)
    )
  );

-- [決定55-20] 1体のフィギュア（1つのhabit_figure_grants行）は生涯に一度しか
-- 木に飾れない（ステッカー側の決定29「同じ購入品は生涯に一度しか飾れない」と
-- 同じ考え方）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_family_tree_decorations_habit_figure_once
  ON family_tree_decorations (habit_figure_grant_id)
  WHERE decoration_source = 'habit_figure';

-- [RLS] family_tree_decorations_select_same_family（既存）は交換元を問わず
-- 全ての行を対象にしているため無変更。INSERT/UPDATE/DELETEポリシーも一切
-- 定義しない（下記2つのRPCのみが書き込む）。

CREATE OR REPLACE FUNCTION public.decorate_tree_with_habit_figure(
  p_grant_id UUID,
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
  v_grant RECORD;
  v_season_id UUID;
  v_decoration_id UUID;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_pos_x IS NULL OR p_pos_y IS NULL
     OR p_pos_x < 0 OR p_pos_x > 1000
     OR p_pos_y < 0 OR p_pos_y > 1000 THEN
    RAISE EXCEPTION '木の外側には貼れません' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_grant FROM habit_figure_grants
  WHERE id = p_grant_id AND family_id = v_family_id AND member_id = v_member_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象のフィギュアが見つかりません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT id INTO v_season_id FROM family_tree_seasons
  WHERE family_id = v_family_id AND season_end IS NULL;
  IF v_season_id IS NULL THEN
    RAISE EXCEPTION '今シーズンの木にのみ飾れます' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM family_tree_decorations
    WHERE decoration_source = 'habit_figure' AND habit_figure_grant_id = p_grant_id
  ) THEN
    RAISE EXCEPTION 'このフィギュアはすでに木に飾られています（1体のフィギュアは一度しか飾れません）' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO family_tree_decorations
    (family_id, season_id, decoration_source, habit_figure_grant_id, pos_x, pos_y)
  VALUES
    (v_family_id, v_season_id, 'habit_figure', p_grant_id, p_pos_x, p_pos_y)
  RETURNING id INTO v_decoration_id;

  RETURN v_decoration_id;
END;
$$;

COMMENT ON FUNCTION public.decorate_tree_with_habit_figure(UUID, INT, INT) IS
  '要件定義書07-28章決定21。自分が獲得したフィギュア（habit_figure_grants）を、今シーズンの木の上の任意の座標（0〜1000のキャンバス相対整数）に自由配置する（decorate_tree_with_stickerと同型）。他人の獲得物・過去シーズンへの配置・キャンバス外の座標は指定できない。同じフィギュアは生涯に一度しか配置できない。';

REVOKE ALL ON FUNCTION public.decorate_tree_with_habit_figure(UUID, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decorate_tree_with_habit_figure(UUID, INT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.move_tree_habit_figure(
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

  IF p_pos_x IS NULL OR p_pos_y IS NULL
     OR p_pos_x < 0 OR p_pos_x > 1000
     OR p_pos_y < 0 OR p_pos_y > 1000 THEN
    RAISE EXCEPTION '木の外側には貼れません' USING ERRCODE = 'check_violation';
  END IF;

  SELECT ftd.id, ftd.season_id INTO v_decoration
  FROM family_tree_decorations ftd
  JOIN habit_figure_grants hfg ON hfg.id = ftd.habit_figure_grant_id
  WHERE ftd.id = p_decoration_id
    AND ftd.family_id = v_family_id
    AND ftd.decoration_source = 'habit_figure'
    AND hfg.member_id = v_member_id
  FOR UPDATE OF ftd;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の配置が見つかりません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT id INTO v_current_season_id
  FROM family_tree_seasons
  WHERE family_id = v_family_id AND season_end IS NULL;

  IF v_current_season_id IS NULL OR v_decoration.season_id <> v_current_season_id THEN
    RAISE EXCEPTION '過去の木の配置は動かせません' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE family_tree_decorations
  SET pos_x = p_pos_x, pos_y = p_pos_y
  WHERE id = v_decoration.id;

  RETURN v_decoration.id;
END;
$$;

COMMENT ON FUNCTION public.move_tree_habit_figure(UUID, INT, INT) IS
  '要件定義書07-28章決定21。自由配置フィギュア（decoration_source=habit_figure）の座標のみを更新する（move_tree_stickerと同型）。同一シーズン内の自分の配置のみ移動でき、過去シーズンの配置は動かせない。取り外しは実装しない。';

REVOKE ALL ON FUNCTION public.move_tree_habit_figure(UUID, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_tree_habit_figure(UUID, INT, INT) TO authenticated;
