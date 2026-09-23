-- 掲示板のコメント・完了報告へのコメント削除・お絵かきの公開通知／
-- リアクション／コメント（新設・2026-09-23）
-- やること.md 2-69・2-70・5-13。要件定義書07章「コメントの削除ルール」・
-- 07-30章「掲示板へのコメント機能の追加」・07-38章「お絵かきの公開通知・
-- リアクション・コメント」に対応する。設計部/成果物/スキーマ設計.sql 76章・
-- API仕様.md 33章が正本（本マイグレーションはその実装）。
-- 開発部/成果物/実装メモ.md 293章に、削除の判定順の実測結果・既存の
-- chore_reactionsコメント行が壊れないことの確認・公開通知トリガーが1回だけ
-- 発火することの実測を記録している。
--
-- [76.13章の申し送りどおり、1本のマイグレーションにまとめる]
-- 新設テーブル3本（family_board_comments・family_drawing_comments・
-- family_drawing_reactions）・列追加1本（chore_reactions）・関数8本・
-- トリガー9本が相互に依存するため。
--
-- [依頼された3つの失敗の反映（本プロジェクトの新設マイグレーション共通ルール）]
--   (1) 新設する関数はすべて SET search_path = public を付ける。
--   (2) 拡張機能への新規依存は発生しない（pg_net・supabase_vaultは74章・
--       75章で既に有効化済みのものに相乗りするだけ）。
--   (3) 家族の削除を壊さない。新設外部キーはすべて families(id) ON DELETE
--       CASCADE（新設3テーブルのfamily_id）または family_members 参照への
--       ON DELETE RESTRICT/SET NULL（既存パターンの踏襲）。
--   (4) RETURNS TABLE の出力列名衝突を作らない。本文中の列参照にはすべて
--       テーブル別名を付けている。

-- ============================================================
-- 1. family_board_comments（掲示板のコメント、新設）
-- ============================================================
CREATE TABLE IF NOT EXISTS family_board_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES family_board_posts(id) ON DELETE CASCADE,
  commenter_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  deleted_at TIMESTAMPTZ NULL,
  deleted_by_member_id UUID NULL REFERENCES family_members(id) ON DELETE SET NULL,

  CONSTRAINT chk_family_board_comments_deleted_by_requires_deleted_at
    CHECK (deleted_by_member_id IS NULL OR deleted_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_family_board_comments_post_id ON family_board_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_family_board_comments_family_id ON family_board_comments(family_id);
CREATE INDEX IF NOT EXISTS idx_family_board_comments_post_created_active
  ON family_board_comments(post_id, created_at)
  WHERE deleted_at IS NULL;

ALTER TABLE family_board_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_board_comments_select_same_family" ON family_board_comments;
CREATE POLICY "family_board_comments_select_same_family" ON family_board_comments
  FOR SELECT
  USING (family_id = current_family_id() AND deleted_at IS NULL);

DROP POLICY IF EXISTS "family_board_comments_insert_self" ON family_board_comments;
CREATE POLICY "family_board_comments_insert_self" ON family_board_comments
  FOR INSERT
  WITH CHECK (family_id = current_family_id() AND commenter_member_id = current_family_member_id());

-- UPDATE/DELETEポリシーは作らない（削除済みを隠すSELECTポリシーと、その行を
-- 隠す方向へのUPDATEは共存できないため。削除は5章のSECURITY DEFINER RPC経由）。

CREATE OR REPLACE FUNCTION public.family_board_comments_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  SELECT p.family_id INTO v_family_id
  FROM family_board_posts p
  WHERE p.id = NEW.post_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の投稿が見つからないか、すでに削除されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.family_id := v_family_id;
  NEW.created_at := now();
  NEW.deleted_at := NULL;
  NEW.deleted_by_member_id := NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_board_comments_before_insert ON family_board_comments;
CREATE TRIGGER trg_family_board_comments_before_insert
  BEFORE INSERT ON family_board_comments
  FOR EACH ROW EXECUTE FUNCTION public.family_board_comments_before_insert();

COMMENT ON TABLE family_board_comments IS
  '要件定義書07-30章「掲示板へのコメント機能の追加」。保護者・子ども・
   みまもりメンバー全員が、自分自身の投稿を含む家族の誰の投稿にも
   コメントできる（決定1）。1投稿・1人あたりの上限なし、返信のネスト
   構造は対象外（決定3、フラットな1階層のみ）。論理削除（deleted_at/
   deleted_by_member_id）。削除は5章delete_family_comment()経由のみ
   （直接UPDATE/DELETEのポリシーは無い）。';

-- ============================================================
-- 2. family_drawing_comments（お絵かきのコメント、新設）
-- ============================================================
CREATE TABLE IF NOT EXISTS family_drawing_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  drawing_id UUID NOT NULL REFERENCES family_drawings(id) ON DELETE CASCADE,
  commenter_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  deleted_at TIMESTAMPTZ NULL,
  deleted_by_member_id UUID NULL REFERENCES family_members(id) ON DELETE SET NULL,

  CONSTRAINT chk_family_drawing_comments_deleted_by_requires_deleted_at
    CHECK (deleted_by_member_id IS NULL OR deleted_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_family_drawing_comments_drawing_id ON family_drawing_comments(drawing_id);
CREATE INDEX IF NOT EXISTS idx_family_drawing_comments_family_id ON family_drawing_comments(family_id);
CREATE INDEX IF NOT EXISTS idx_family_drawing_comments_drawing_created_active
  ON family_drawing_comments(drawing_id, created_at)
  WHERE deleted_at IS NULL;

ALTER TABLE family_drawing_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_drawing_comments_select_same_family" ON family_drawing_comments;
CREATE POLICY "family_drawing_comments_select_same_family" ON family_drawing_comments
  FOR SELECT
  USING (family_id = current_family_id() AND deleted_at IS NULL);

DROP POLICY IF EXISTS "family_drawing_comments_insert_self" ON family_drawing_comments;
CREATE POLICY "family_drawing_comments_insert_self" ON family_drawing_comments
  FOR INSERT
  WITH CHECK (family_id = current_family_id() AND commenter_member_id = current_family_member_id());

CREATE OR REPLACE FUNCTION public.family_drawing_comments_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_is_published BOOLEAN;
BEGIN
  SELECT d.family_id, d.is_published INTO v_family_id, v_is_published
  FROM family_drawings d
  WHERE d.id = NEW.drawing_id;

  IF NOT FOUND OR NOT v_is_published THEN
    RAISE EXCEPTION '対象の絵が見つからないか、まだ公開されていません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.family_id := v_family_id;
  NEW.created_at := now();
  NEW.deleted_at := NULL;
  NEW.deleted_by_member_id := NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_drawing_comments_before_insert ON family_drawing_comments;
CREATE TRIGGER trg_family_drawing_comments_before_insert
  BEFORE INSERT ON family_drawing_comments
  FOR EACH ROW EXECUTE FUNCTION public.family_drawing_comments_before_insert();

COMMENT ON TABLE family_drawing_comments IS
  '要件定義書07-38章6章「お絵かきへのコメント」。対象は公開済み
   (is_published=true)の絵のみ。保護者・子ども・みまもりメンバー全員が、
   自分自身の絵を含む家族の誰の絵にもコメントできる（6-1節）。1枚・1人
   あたりの上限なし、返信のネスト構造は対象外（6-3節）。論理削除
   （deleted_at/deleted_by_member_id）。削除は5章delete_family_comment()
   経由のみ。やりとりトグルの対象に含める（6章、決定20の対象外だった
   お絵かき本体・題名とは異なる扱い）。';

-- ============================================================
-- 3. family_drawing_reactions（お絵かきのリアクション、新設）
-- ============================================================
CREATE TABLE IF NOT EXISTS family_drawing_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  drawing_id UUID NOT NULL REFERENCES family_drawings(id) ON DELETE CASCADE,
  reactor_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  stamp_key TEXT NOT NULL CHECK (char_length(trim(stamp_key)) BETWEEN 1 AND 50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_family_drawing_reactions_drawing_reactor_stamp
    UNIQUE (drawing_id, reactor_member_id, stamp_key)
);

CREATE INDEX IF NOT EXISTS idx_family_drawing_reactions_drawing_id ON family_drawing_reactions(drawing_id);
CREATE INDEX IF NOT EXISTS idx_family_drawing_reactions_family_id ON family_drawing_reactions(family_id);

ALTER TABLE family_drawing_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_drawing_reactions_select_same_family" ON family_drawing_reactions;
CREATE POLICY "family_drawing_reactions_select_same_family" ON family_drawing_reactions
  FOR SELECT
  USING (family_id = current_family_id());

-- INSERT/UPDATE/DELETEポリシーは一切作らない。書き込みは下記トグルRPC経由に一本化する。

CREATE OR REPLACE FUNCTION public.family_drawing_reactions_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_artist_member_id UUID;
  v_is_published BOOLEAN;
BEGIN
  SELECT d.family_id, d.artist_member_id, d.is_published
    INTO v_family_id, v_artist_member_id, v_is_published
  FROM family_drawings d
  WHERE d.id = NEW.drawing_id;

  IF NOT FOUND OR NOT v_is_published THEN
    RAISE EXCEPTION '対象の絵が見つからないか、まだ公開されていません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.family_id := v_family_id;
  NEW.created_at := now();

  IF v_artist_member_id = NEW.reactor_member_id THEN
    RAISE EXCEPTION '自分の絵にはリアクションできません' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_drawing_reactions_before_insert ON family_drawing_reactions;
CREATE TRIGGER trg_family_drawing_reactions_before_insert
  BEFORE INSERT ON family_drawing_reactions
  FOR EACH ROW EXECUTE FUNCTION public.family_drawing_reactions_before_insert();

-- [61.4章toggle_family_board_reaction_stamp()と完全に同型]
-- 列名衝突の確認: RETURNS TABLE (removed BOOLEAN, reaction_id UUID)。
-- family_drawing_reactionsの主キーはidでありreaction_idではないため
-- 無修飾参照によるambiguousは起こらない。
CREATE OR REPLACE FUNCTION public.toggle_family_drawing_reaction_stamp(
  p_drawing_id UUID,
  p_stamp_key TEXT
)
RETURNS TABLE (
  removed BOOLEAN,
  reaction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_family_id UUID := current_family_id();
  v_caller_member_id UUID := current_family_member_id();
  v_drawing RECORD;
  v_existing_id UUID;
  v_new_id UUID;
BEGIN
  IF v_caller_family_id IS NULL OR v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT fd.family_id, fd.artist_member_id INTO v_drawing
  FROM family_drawings fd
  WHERE fd.id = p_drawing_id
    AND fd.family_id = v_caller_family_id
    AND fd.is_published;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の絵が見つからないか、まだ公開されていません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_drawing.artist_member_id = v_caller_member_id THEN
    RAISE EXCEPTION '自分の絵にはリアクションできません' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_existing_id
  FROM family_drawing_reactions
  WHERE drawing_id = p_drawing_id
    AND reactor_member_id = v_caller_member_id
    AND stamp_key = p_stamp_key;

  IF v_existing_id IS NOT NULL THEN
    DELETE FROM family_drawing_reactions WHERE id = v_existing_id;
    RETURN QUERY SELECT true, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO family_drawing_reactions (drawing_id, reactor_member_id, stamp_key)
  VALUES (p_drawing_id, v_caller_member_id, p_stamp_key)
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT false, v_new_id;
END;
$$;

COMMENT ON FUNCTION public.toggle_family_drawing_reaction_stamp(UUID, TEXT) IS
  '要件定義書07-38章5章。toggle_family_board_reaction_stamp()と完全に同型
   （同じスタンプの再送信で取消、違う種類は追加、既存の他の種類は残す）。
   対象は公開済みの絵のみ・自己リアクション禁止（5-1節）。自分の行のみ
   操作可、他家族・未公開の絵は同一エラーに収束させ存在を漏らさない。';

REVOKE ALL ON FUNCTION public.toggle_family_drawing_reaction_stamp(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_family_drawing_reaction_stamp(UUID, TEXT) TO authenticated;

COMMENT ON TABLE family_drawing_reactions IS
  '要件定義書07-38章5章「リアクション（スタンプ）」。既存4種のスタンプを
   そのまま流用（専用の種類は作らない）。対象は公開済みの絵のみ。全ロール
   対称・自己リアクション禁止。書き込みはtoggle_family_drawing_reaction_
   stamp()経由のみに一本化（family_board_reactionsと同型）。やりとり
   トグルの対象にしない（常時ON、6章。定型リアクションは自由記述では
   ないため）。';

-- ============================================================
-- 4. chore_reactionsの改訂（完了報告のコメントを消せるようにする）
-- ============================================================
-- やること.md 5-13・要件定義書07章「コメントの削除ルール」への対応。
-- kind='stamp'の行・toggle_chore_reaction_stamp()は一切変更しない
-- （スタンプは引き続き物理DELETEによるトグル方式のまま）。
ALTER TABLE chore_reactions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by_member_id UUID NULL REFERENCES family_members(id) ON DELETE SET NULL;

ALTER TABLE chore_reactions
  DROP CONSTRAINT IF EXISTS chk_chore_reactions_deleted_by_requires_deleted_at;
ALTER TABLE chore_reactions
  ADD CONSTRAINT chk_chore_reactions_deleted_by_requires_deleted_at
  CHECK (deleted_by_member_id IS NULL OR deleted_at IS NOT NULL);

-- [多層防御] kind='stamp'の行にdeleted_atを立てさせないよう、CHECK制約でも
-- 構造的に禁止する。
ALTER TABLE chore_reactions
  DROP CONSTRAINT IF EXISTS chk_chore_reactions_only_comment_soft_deletable;
ALTER TABLE chore_reactions
  ADD CONSTRAINT chk_chore_reactions_only_comment_soft_deletable
  CHECK (deleted_at IS NULL OR kind = 'comment');

-- [SELECT: 削除済みのコメントを除外する] kind='stamp'の行はdeleted_atが常に
-- NULLのため、この条件を追加してもスタンプの可視性は一切変わらない。
DROP POLICY IF EXISTS "chore_reactions_select_same_family" ON chore_reactions;
CREATE POLICY "chore_reactions_select_same_family" ON chore_reactions
  FOR SELECT
  USING (family_id = current_family_id() AND deleted_at IS NULL);

COMMENT ON COLUMN chore_reactions.deleted_at IS
  '要件定義書07章「コメントの削除ルール」（2026-09-23新設）。kind=''comment''
   の行にのみ設定されうる（chk_chore_reactions_only_comment_soft_
   deletable）。削除は5章delete_family_comment()経由のみ。kind=''stamp''は
   引き続き物理DELETE（toggle_chore_reaction_stamp()、変更なし）。';
COMMENT ON COLUMN chore_reactions.deleted_by_member_id IS
  '削除を実行したメンバー。自己取消なら本人（reacted_byと一致）、保護者の
   是正削除ならその保護者のid。deleted_atがNULLの間は常にNULL
   （chk_chore_reactions_deleted_by_requires_deleted_atが強制）。';

-- ============================================================
-- 5. delete_family_comment()（3つの削除を1本の関数・同じ判定順に統一）
-- ============================================================
-- 判定順は要件定義書07章「コメントの削除ルール」・07-30章決定2・07-38章
-- 6-2節がいずれも明記した順序と同一——
--   1. 書いた本人なら（保護者であっても）5分以内だけ消せる。
--   2. 本人でなく保護者なら他の人のコメントを5分以降もいつでも消せる。
--   3. それ以外は消せない。
-- 種別の値はhidden_contents.content_kindと同じ命名を流用する。
CREATE OR REPLACE FUNCTION public.delete_family_comment(
  p_kind TEXT,
  p_comment_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_family_id UUID := current_family_id();
  v_caller_member_id UUID := current_family_member_id();
  v_row_family_id UUID;
  v_author_member_id UUID;
  v_created_at TIMESTAMPTZ;
  v_already_deleted BOOLEAN;
BEGIN
  IF v_caller_family_id IS NULL OR v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 1. 種別ごとに対象行を取得する（ここだけが種別で分岐する。以降の
  --    判定ロジックは3種とも完全に共通）。
  CASE p_kind
    WHEN 'family_board_comment' THEN
      SELECT c.family_id, c.commenter_member_id, c.created_at, (c.deleted_at IS NOT NULL)
        INTO v_row_family_id, v_author_member_id, v_created_at, v_already_deleted
      FROM family_board_comments c
      WHERE c.id = p_comment_id;
    WHEN 'chore_reaction_comment' THEN
      SELECT r.family_id, r.reacted_by, r.created_at, (r.deleted_at IS NOT NULL)
        INTO v_row_family_id, v_author_member_id, v_created_at, v_already_deleted
      FROM chore_reactions r
      WHERE r.id = p_comment_id AND r.kind = 'comment';
    WHEN 'family_drawing_comment' THEN
      SELECT d.family_id, d.commenter_member_id, d.created_at, (d.deleted_at IS NOT NULL)
        INTO v_row_family_id, v_author_member_id, v_created_at, v_already_deleted
      FROM family_drawing_comments d
      WHERE d.id = p_comment_id;
    ELSE
      RAISE EXCEPTION '対象の種別が正しくありません: %', p_kind USING ERRCODE = 'check_violation';
  END CASE;

  -- 2. 存在確認・自家族限定（他家族の行と存在しないIDを区別しない）。
  IF v_row_family_id IS NULL OR v_row_family_id <> v_caller_family_id THEN
    RAISE EXCEPTION '対象のコメントが見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  -- 3. 二重削除の防止。
  IF v_already_deleted THEN
    RAISE EXCEPTION 'このコメントはすでに削除されています' USING ERRCODE = 'check_violation';
  END IF;

  -- 4. 権限判定（★3種とも完全に同じ順序。判定順を変えないこと）。
  --    まず「本人かどうか」を判定し、本人でなかった場合にのみ保護者の
  --    是正権限へ進む——「保護者は自分のコメントもいつでも消せる」という
  --    誤読を避けるため、同じ順序をそのままコードにする。
  IF v_author_member_id = v_caller_member_id THEN
    IF now() > v_created_at + INTERVAL '5 minutes' THEN
      RAISE EXCEPTION 'コメントから5分を過ぎているため削除できません' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF public.is_current_user_parent() THEN
    -- 保護者による是正削除: 時間制限なし・本人以外の誰のコメントでも可。
    NULL;
  ELSE
    RAISE EXCEPTION '他のメンバーのコメントを削除する権限がありません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 5. 実際の論理削除（判定はここより上ですべて完了済み。種別ごとの
  --    UPDATE文だけが異なる）。
  CASE p_kind
    WHEN 'family_board_comment' THEN
      UPDATE family_board_comments
         SET deleted_at = now(), deleted_by_member_id = v_caller_member_id
       WHERE id = p_comment_id;
    WHEN 'chore_reaction_comment' THEN
      UPDATE chore_reactions
         SET deleted_at = now(), deleted_by_member_id = v_caller_member_id
       WHERE id = p_comment_id;
    WHEN 'family_drawing_comment' THEN
      UPDATE family_drawing_comments
         SET deleted_at = now(), deleted_by_member_id = v_caller_member_id
       WHERE id = p_comment_id;
  END CASE;
END;
$$;

COMMENT ON FUNCTION public.delete_family_comment(TEXT, UUID) IS
  '要件定義書07章「コメントの削除ルール」（2026-09-23新設）。掲示板の
   コメント（family_board_comment）・完了報告へのコメント
   （chore_reaction_comment）・お絵かきのコメント（family_drawing_
   comment）の3種を、同一の判定順（1.本人なら5分以内のみ／2.本人でなく
   保護者なら本人以外のものを時間制限なく／3.それ以外は不可）で削除する
   単一のRPC。みまもりメンバーは1（本人・5分以内）にのみ該当しうる
   （is_current_user_parent()が常にfalseのため、自動的に是正権限を
   持たない）。';

REVOKE ALL ON FUNCTION public.delete_family_comment(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_family_comment(TEXT, UUID) TO authenticated;

-- ============================================================
-- 6. やりとりトグルとの関係
-- ============================================================
-- [含める（トグルOFFで止まる）] 掲示板のコメント（★新規追加）・お絵かき
-- のコメント（★新規追加）。既存の対象（掲示板の投稿・スタンプ、完了報告
-- へのコメント、感謝のひとこと）は変更なし。
-- [含めない（常時ON）] 完了報告のスタンプ（変更なし）・お絵かきの
-- リアクション（対象外）・お絵かき本体と題名（変更なし）・お絵かきの
-- 公開通知（常時ON）・感謝ポイントを贈ること自体（変更なし）。
CREATE OR REPLACE FUNCTION public.family_board_comments_social_toggle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  v_family_id := NEW.family_id;
  IF v_family_id IS NULL THEN
    SELECT p.family_id INTO v_family_id
    FROM family_board_posts p WHERE p.id = NEW.post_id;
  END IF;

  IF v_family_id IS NOT NULL
     AND NOT public.is_family_social_interactions_enabled(v_family_id) THEN
    RAISE EXCEPTION 'この家族では、いま家族のやりとりを使わない設定になっています'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_board_comments_social_toggle_guard ON family_board_comments;
CREATE TRIGGER trg_family_board_comments_social_toggle_guard
  BEFORE INSERT ON family_board_comments
  FOR EACH ROW EXECUTE FUNCTION public.family_board_comments_social_toggle_guard();

CREATE OR REPLACE FUNCTION public.family_drawing_comments_social_toggle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  v_family_id := NEW.family_id;
  IF v_family_id IS NULL THEN
    SELECT d.family_id INTO v_family_id
    FROM family_drawings d WHERE d.id = NEW.drawing_id;
  END IF;

  IF v_family_id IS NOT NULL
     AND NOT public.is_family_social_interactions_enabled(v_family_id) THEN
    RAISE EXCEPTION 'この家族では、いま家族のやりとりを使わない設定になっています'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_drawing_comments_social_toggle_guard ON family_drawing_comments;
CREATE TRIGGER trg_family_drawing_comments_social_toggle_guard
  BEFORE INSERT ON family_drawing_comments
  FOR EACH ROW EXECUTE FUNCTION public.family_drawing_comments_social_toggle_guard();

COMMENT ON COLUMN families.social_interactions_enabled IS
  '要件定義書07-32章 決定33「家族のやりとりを使う」（旧稿の3トグルを
   1つに統合したもの）。2026-09-23・本マイグレーションで対象にお絵かきの
   コメントを追加した。falseのとき、掲示板への投稿・コメント・スタンプ
   （family_board_posts・family_board_comments・family_board_reactions）、
   chore_reactionsのkind=''comment''、gratitude_points.noteの自由記述、
   および family_drawing_comments（お絵かきのコメント）を止める。
   kind=''stamp''（完了報告のスタンプ）・family_drawing_reactions
   （お絵かきのリアクション、対象外のまま）・お絵かき本体と題名・感謝
   ポイントを贈ること自体は止めない（NULL許容化が前提）。過去の投稿・
   コメントは残る。';

-- ============================================================
-- 7. hidden_contents（66章）の拡張
-- ============================================================
-- [★制約名を実測して確認済み（開発部/成果物/実装メモ.md 293章参照）]
-- ローカルDockerで `SELECT conname FROM pg_constraint WHERE conrelid =
-- 'hidden_contents'::regclass;` を実行し、`hidden_contents_content_kind_
-- check` という名前であることを確認した（設計部の推定どおりだった）。
ALTER TABLE hidden_contents
  DROP CONSTRAINT IF EXISTS hidden_contents_content_kind_check;
ALTER TABLE hidden_contents
  ADD CONSTRAINT hidden_contents_content_kind_check CHECK (
    content_kind IN (
      'family_board_post',
      'family_board_comment',
      'chore_completion_note',
      'chore_reaction_comment',
      'gratitude_note',
      'family_drawing',
      'family_drawing_comment'
    )
  );

CREATE OR REPLACE FUNCTION public.hide_content(
  p_content_kind TEXT,
  p_content_id UUID
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_id UUID;
BEGIN
  IF p_content_id IS NULL THEN
    RAISE EXCEPTION '対象のIDを指定してください' USING ERRCODE = 'check_violation';
  END IF;

  CASE p_content_kind
    WHEN 'family_board_post' THEN
      SELECT t.family_id INTO v_family_id FROM family_board_posts t WHERE t.id = p_content_id;
    WHEN 'family_board_comment' THEN
      SELECT t.family_id INTO v_family_id FROM family_board_comments t WHERE t.id = p_content_id;
    WHEN 'chore_completion_note' THEN
      SELECT t.family_id INTO v_family_id FROM chore_completions t WHERE t.id = p_content_id;
    WHEN 'chore_reaction_comment' THEN
      SELECT t.family_id INTO v_family_id FROM chore_reactions t WHERE t.id = p_content_id;
    WHEN 'gratitude_note' THEN
      SELECT t.family_id INTO v_family_id FROM gratitude_points t WHERE t.id = p_content_id;
    WHEN 'family_drawing' THEN
      SELECT t.family_id INTO v_family_id FROM family_drawings t WHERE t.id = p_content_id;
    WHEN 'family_drawing_comment' THEN
      SELECT t.family_id INTO v_family_id FROM family_drawing_comments t WHERE t.id = p_content_id;
    ELSE
      RAISE EXCEPTION '対象の種別が正しくありません（7値のいずれか）: %', p_content_kind
        USING ERRCODE = 'check_violation';
  END CASE;

  IF v_family_id IS NULL THEN
    RAISE EXCEPTION '対象が見つかりません（種別 % / ID %）', p_content_kind, p_content_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO hidden_contents (family_id, content_kind, content_id)
  VALUES (v_family_id, p_content_kind, p_content_id)
  ON CONFLICT (content_kind, content_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT h.id INTO v_id FROM hidden_contents h
    WHERE h.content_kind = p_content_kind AND h.content_id = p_content_id;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.hide_content(TEXT, UUID) IS
  '運営が、対象のコンテンツを家族全員から見えなくする（要件定義書07-32章
   決定7の段階3）。service_roleからのみ実行できる。べき等（既に隠して
   あれば同じidを返す）。データは消さない（論理的な非表示のみ）。
   2026-09-23、対象を7値に拡張（family_board_comment・family_drawing_
   commentを実装）。';

-- ============================================================
-- 8. 通知：コメントが付いたら書いた人にだけ通知
-- ============================================================
-- families.push_notifications_enabled（74.3章、掲示板の投稿通知と同じ
-- 家族単位トグル）を共有ゲートとして使う（理由は293章参照）。
-- お絵かきの公開通知（9章）はこのゲートの対象外（常時ON）——コメント
-- 通知と公開通知でゲートの扱いが異なる点に注意。
COMMENT ON COLUMN families.push_notifications_enabled IS
  '要件定義書07-37章3章・07章「コメントの削除ルール」隣接の2026-09-23
   決定。家族のプッシュ通知を送るかどうかの家族単位のトグル（保護者・
   副管理者のみ変更可）。対象は(1)掲示板の投稿通知、(2)コメント通知3種
   ——掲示板・完了報告・お絵かきのコメントが付いたら書いた人にのみ送る
   通知（2026-09-23対象追加）。お絵かきの公開通知は対象外（常時ON）。
   定時アナウンスの送信可否にも関与しない。既定値はfalse——OSの許可
   ダイアログという「利用者への要求」を発生させる設定であり、既定でオフに
   するのが筋。この列がtrueでも、実際に配信されるかは受け手ごとのOSの
   通知許可に依存する。';

-- [なぜRETURNS jsonbか] CLAUDE.mdのルール。RETURNS TABLEにすると出力列名と
-- 実在列名が衝突しうるため。
CREATE OR REPLACE FUNCTION public.comment_notification_payload(
  p_kind TEXT,
  p_comment_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_target_member_id UUID;
  v_commenter_member_id UUID;
  v_commenter_name TEXT;
  v_tokens jsonb;
BEGIN
  -- 対象（通知の宛先=投稿・完了報告・絵の持ち主）と、コメントした人を
  -- 種別ごとに取得する（5章delete_family_comment()と同じCASE分岐の考え方）。
  CASE p_kind
    WHEN 'family_board_comment' THEN
      SELECT c.family_id, p.author_member_id, c.commenter_member_id
        INTO v_family_id, v_target_member_id, v_commenter_member_id
      FROM family_board_comments c
      JOIN family_board_posts p ON p.id = c.post_id
      WHERE c.id = p_comment_id;
    WHEN 'chore_reaction_comment' THEN
      SELECT r.family_id, cc.reported_by, r.reacted_by
        INTO v_family_id, v_target_member_id, v_commenter_member_id
      FROM chore_reactions r
      JOIN chore_completions cc ON cc.id = r.completion_id
      WHERE r.id = p_comment_id;
    WHEN 'family_drawing_comment' THEN
      SELECT dc.family_id, d.artist_member_id, dc.commenter_member_id
        INTO v_family_id, v_target_member_id, v_commenter_member_id
      FROM family_drawing_comments dc
      JOIN family_drawings d ON d.id = dc.drawing_id
      WHERE dc.id = p_comment_id;
    ELSE
      RETURN NULL;
  END CASE;

  IF v_family_id IS NULL THEN
    RETURN NULL; -- 対象が見つからない（呼び出し側の取り違え等）。
  END IF;

  -- 自己コメントには通知しない。
  IF v_target_member_id = v_commenter_member_id THEN
    RETURN NULL;
  END IF;

  SELECT fm.display_name INTO v_commenter_name
  FROM family_members fm WHERE fm.id = v_commenter_member_id;

  -- 端末単位の除外（コメントした人の端末では鳴らさない。コメント者と
  -- 宛先が同じ共有端末を使っている場合の対策）。
  SELECT COALESCE(jsonb_agg(DISTINCT pt.expo_push_token), '[]'::jsonb)
    INTO v_tokens
  FROM push_tokens pt
  JOIN family_members fm ON fm.id = pt.member_id
  WHERE fm.family_id = v_family_id
    AND fm.is_active
    AND pt.member_id = v_target_member_id
    AND pt.expo_push_token NOT IN (
      SELECT pt2.expo_push_token FROM push_tokens pt2 WHERE pt2.member_id = v_commenter_member_id
    );

  RETURN jsonb_build_object(
    'kind', p_kind,
    'comment_id', p_comment_id,
    -- 「コメントの中身は出さない」。本文（body/comment_body）は一切含めない。
    'commenter_display_name', v_commenter_name,
    'recipient_tokens', v_tokens
  );
END;
$$;

COMMENT ON FUNCTION public.comment_notification_payload(TEXT, UUID) IS
  '要件定義書07章隣接の2026-09-23決定「コメントが付いたら書いた人にだけ
   通知する」。掲示板・完了報告・お絵かきの3種のコメントについて、通知に
   必要な最小限の情報（種別・コメントした人の表示名・送信先Expoトークンの
   配列）だけをjsonbで組み立てる。コメント本文は含めない。自己コメント
   （対象=コメントした本人）はNULLを返し送信しない。';

REVOKE ALL ON FUNCTION public.comment_notification_payload(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- [骨格は74.9章と同一] (1) families.push_notifications_enabledを判定→
-- (2) comment_notification_payload()で組み立て→(3) 送り先0件なら何もしない
-- →(4) Vaultから読みnet.http_postで非同期に呼ぶ→(5) 失敗はRAISE WARNINGに
-- 留め、コメントの記録（INSERT）を巻き戻さない。3本ともこの骨格を共有する。
CREATE OR REPLACE FUNCTION public.family_board_comments_after_insert_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_notify_enabled BOOLEAN;
  v_payload jsonb;
  v_url TEXT;
  v_bearer TEXT;
BEGIN
  SELECT f.push_notifications_enabled INTO v_family_notify_enabled
  FROM families f WHERE f.id = NEW.family_id;

  IF NOT COALESCE(v_family_notify_enabled, false) THEN
    RETURN NEW;
  END IF;

  v_payload := public.comment_notification_payload('family_board_comment', NEW.id);

  IF v_payload IS NULL
     OR jsonb_array_length(COALESCE(v_payload->'recipient_tokens', '[]'::jsonb)) = 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'comment_notify_url';
    SELECT decrypted_secret INTO v_bearer FROM vault.decrypted_secrets WHERE name = 'comment_notify_bearer';

    IF v_url IS NULL OR v_bearer IS NULL THEN
      RAISE WARNING 'family_board_comments notify skipped for % (vault secrets not configured)', NEW.id;
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_bearer),
      body    := v_payload
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'family_board_comments notify failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_board_comments_after_insert_notify ON family_board_comments;
CREATE TRIGGER trg_family_board_comments_after_insert_notify
  AFTER INSERT ON family_board_comments
  FOR EACH ROW EXECUTE FUNCTION public.family_board_comments_after_insert_notify();

-- [chore_reactions: kind='stamp'のINSERTでも本トリガーは発火するため、
-- 先頭でkindを判定して即return する（スタンプには一切通知しない）。]
CREATE OR REPLACE FUNCTION public.chore_reactions_after_insert_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_notify_enabled BOOLEAN;
  v_payload jsonb;
  v_url TEXT;
  v_bearer TEXT;
BEGIN
  IF NEW.kind <> 'comment' THEN
    RETURN NEW;
  END IF;

  SELECT f.push_notifications_enabled INTO v_family_notify_enabled
  FROM families f WHERE f.id = NEW.family_id;

  IF NOT COALESCE(v_family_notify_enabled, false) THEN
    RETURN NEW;
  END IF;

  v_payload := public.comment_notification_payload('chore_reaction_comment', NEW.id);

  IF v_payload IS NULL
     OR jsonb_array_length(COALESCE(v_payload->'recipient_tokens', '[]'::jsonb)) = 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'comment_notify_url';
    SELECT decrypted_secret INTO v_bearer FROM vault.decrypted_secrets WHERE name = 'comment_notify_bearer';

    IF v_url IS NULL OR v_bearer IS NULL THEN
      RAISE WARNING 'chore_reactions notify skipped for % (vault secrets not configured)', NEW.id;
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_bearer),
      body    := v_payload
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chore_reactions notify failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chore_reactions_after_insert_notify ON chore_reactions;
CREATE TRIGGER trg_chore_reactions_after_insert_notify
  AFTER INSERT ON chore_reactions
  FOR EACH ROW EXECUTE FUNCTION public.chore_reactions_after_insert_notify();

CREATE OR REPLACE FUNCTION public.family_drawing_comments_after_insert_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_notify_enabled BOOLEAN;
  v_payload jsonb;
  v_url TEXT;
  v_bearer TEXT;
BEGIN
  SELECT f.push_notifications_enabled INTO v_family_notify_enabled
  FROM families f WHERE f.id = NEW.family_id;

  IF NOT COALESCE(v_family_notify_enabled, false) THEN
    RETURN NEW;
  END IF;

  v_payload := public.comment_notification_payload('family_drawing_comment', NEW.id);

  IF v_payload IS NULL
     OR jsonb_array_length(COALESCE(v_payload->'recipient_tokens', '[]'::jsonb)) = 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'comment_notify_url';
    SELECT decrypted_secret INTO v_bearer FROM vault.decrypted_secrets WHERE name = 'comment_notify_bearer';

    IF v_url IS NULL OR v_bearer IS NULL THEN
      RAISE WARNING 'family_drawing_comments notify skipped for % (vault secrets not configured)', NEW.id;
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_bearer),
      body    := v_payload
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'family_drawing_comments notify failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_drawing_comments_after_insert_notify ON family_drawing_comments;
CREATE TRIGGER trg_family_drawing_comments_after_insert_notify
  AFTER INSERT ON family_drawing_comments
  FOR EACH ROW EXECUTE FUNCTION public.family_drawing_comments_after_insert_notify();

-- ============================================================
-- 9. 通知：お絵かきの公開通知
-- ============================================================
-- [起点はdraw_gacha()の1行のUPDATE] family_drawingsへのUPDATEはこの1箇所
-- にしか存在しない（33b章「UPDATEポリシーは一切定義しない」）。
-- draw_gacha()自体は改訂しない——AFTER UPDATEトリガーを新設し、
-- is_publishedがfalse→trueへ変わった行だけを対象にする。
--
-- [families.push_notifications_enabled・やりとりトグルのいずれの対象にも
-- しない（★常時ON、要件定義書07-38章4-6節）] 社会的なやりとりの通知では
-- なく、ガチャという核となるゲームループの成果を本人に返す通知だから。
CREATE OR REPLACE FUNCTION public.drawing_published_notification_payload(
  p_drawing_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_artist_member_id UUID;
  v_discoverer_member_id UUID;
  v_tokens jsonb;
BEGIN
  SELECT d.family_id, d.artist_member_id, gd.member_id
    INTO v_family_id, v_artist_member_id, v_discoverer_member_id
  FROM family_drawings d
  LEFT JOIN gacha_draws gd ON gd.id = d.revealed_by_draw_id
  WHERE d.id = p_drawing_id;

  IF v_family_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 07-13-2章「自分が描いた絵は、自分では引けない」によりv_artist_member_id
  -- = v_discoverer_member_id にはならない。端末単位の除外だけ行う。
  SELECT COALESCE(jsonb_agg(DISTINCT pt.expo_push_token), '[]'::jsonb)
    INTO v_tokens
  FROM push_tokens pt
  JOIN family_members fm ON fm.id = pt.member_id
  WHERE fm.family_id = v_family_id
    AND fm.is_active
    AND pt.member_id = v_artist_member_id
    AND (
      v_discoverer_member_id IS NULL
      OR pt.expo_push_token NOT IN (
        SELECT pt2.expo_push_token FROM push_tokens pt2 WHERE pt2.member_id = v_discoverer_member_id
      )
    );

  RETURN jsonb_build_object(
    'drawing_id', p_drawing_id,
    'recipient_tokens', v_tokens
  );
END;
$$;

COMMENT ON FUNCTION public.drawing_published_notification_payload(UUID) IS
  '要件定義書07-38章4章。絵が公開された1件について、送信先Expoトークンの
   配列だけをjsonbで組み立てる。題名・発見者名は一切含めない（4-4節。
   通知文言はEdge Function側の固定文言）。families.push_notifications_
   enabledの判定は行わない（常時ON、4-6節）。';

REVOKE ALL ON FUNCTION public.drawing_published_notification_payload(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.family_drawings_after_publish_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_url TEXT;
  v_bearer TEXT;
BEGIN
  -- draw_gacha()のUPDATEでis_publishedがfalse→trueへ変わった行だけが
  -- ここに到達する（下記トリガー定義のWHEN句）。
  v_payload := public.drawing_published_notification_payload(NEW.id);

  IF v_payload IS NULL
     OR jsonb_array_length(COALESCE(v_payload->'recipient_tokens', '[]'::jsonb)) = 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'drawing_published_notify_url';
    SELECT decrypted_secret INTO v_bearer FROM vault.decrypted_secrets WHERE name = 'drawing_published_notify_bearer';

    IF v_url IS NULL OR v_bearer IS NULL THEN
      RAISE WARNING 'family_drawings publish notify skipped for % (vault secrets not configured)', NEW.id;
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_bearer),
      body    := v_payload
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'family_drawings publish notify failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_drawings_after_publish_notify ON family_drawings;
CREATE TRIGGER trg_family_drawings_after_publish_notify
  AFTER UPDATE ON family_drawings
  FOR EACH ROW
  WHEN (NOT OLD.is_published AND NEW.is_published)
  EXECUTE FUNCTION public.family_drawings_after_publish_notify();

COMMENT ON FUNCTION public.family_drawings_after_publish_notify() IS
  '要件定義書07-38章4章。draw_gacha()がis_publishedをfalseからtrueへ
   更新した瞬間に、描いた本人へ「絵が公開された」ことをプッシュ通知する。
   families.push_notifications_enabledの判定は行わない（常時ON）。失敗は
   RAISE WARNINGに留め、抽選の記録（draw_gacha()のトランザクション）を
   巻き戻さない。';

-- ============================================================
-- 10. EXECUTE権限の明示（本プロジェクトの既知挙動＝新規関数作成時に
--     anon/authenticatedへEXECUTE権限が自動付与されることがあるため、
--     明示REVOKEしていない関数についても再確認しておく）
-- ============================================================
-- delete_family_comment / toggle_family_drawing_reaction_stamp は上記で
-- 個別にGRANTしたとおり。comment_notification_payload /
-- drawing_published_notification_payload は上記で個別にREVOKEしたとおり。
-- 3本の通知トリガー関数・family_drawings_after_publish_notifyはトリガー
-- 関数のため既定のままとする（271.2.1節・74.9章と同じ扱い）。
