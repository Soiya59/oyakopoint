-- ============================================================
-- hidden_contents（運営による非表示＝決定7の段階3）— 新設・2026-09-20
-- 参照: 設計部/成果物/スキーマ設計.sql 66章
-- 要件定義書 07-32章（決定7の改訂注記・決定9／サマリー表#6）
-- ============================================================
-- [この章の範囲] MVPは「段階3」だけ（運営が家族全員から見えなくする）。
-- アプリに操作UIを持たない。保護者にも子どもにも、非表示にするボタンは
-- 無い。運営がDBで hide_content() / unhide_content() を実行する。
-- ============================================================

-- ------------------------------------------------------------
-- 1. hidden_contents テーブル（スキーマ設計.sql 66.1章）
-- ------------------------------------------------------------
-- content_id に外部キーを張らない（対象が複数テーブルにまたがる
-- ポリモーフィック参照のため）。行を入れる経路を hide_content() に一本化し、
-- その中で対象の実在と family_id の一致を確認する。
CREATE TABLE IF NOT EXISTS hidden_contents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,

  -- 何の種類のコンテンツか。
  content_kind TEXT NOT NULL CHECK (
    content_kind IN (
      'family_board_post',
      'family_board_comment',   -- 07-30章。未実装（値だけ先に用意）
      'chore_completion_note',
      'chore_reaction_comment',
      'gratitude_note',
      'family_drawing'
    )
  ),

  -- 対象の行のid。外部キーは張らない。
  content_id UUID NOT NULL,

  hidden_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 同じものを二重に隠さない。hide_content() の ON CONFLICT の受け先。
  CONSTRAINT uq_hidden_contents_target UNIQUE (content_kind, content_id)
);

CREATE INDEX IF NOT EXISTS idx_hidden_contents_family_id ON hidden_contents(family_id);

ALTER TABLE hidden_contents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE hidden_contents IS
  '要件定義書07-32章 決定7の「段階3」（運営が家族全員から見えなくする）を
   支える表。アプリに操作UIは無く、運営がhide_content()で行を入れる
   （決定9・管理画面を作らない）。保護者は戻せない（DELETE/UPDATEポリシーを
   1本も置いていない）。データそのものは消さない（論理的な非表示）。';

-- ------------------------------------------------------------
-- 2. hide_content() / unhide_content()（スキーマ設計.sql 66.3章。
--    運営の操作はこの2本だけ）
-- ------------------------------------------------------------
-- family_board_comment（07-30章の掲示板コメント）は未実装のため、はっきり
-- したメッセージで止める。実装するときにこのCASEの1行を書き換えること。
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
    WHEN 'chore_completion_note' THEN
      SELECT t.family_id INTO v_family_id FROM chore_completions t WHERE t.id = p_content_id;
    WHEN 'chore_reaction_comment' THEN
      SELECT t.family_id INTO v_family_id FROM chore_reactions t WHERE t.id = p_content_id;
    WHEN 'gratitude_note' THEN
      SELECT t.family_id INTO v_family_id FROM gratitude_points t WHERE t.id = p_content_id;
    WHEN 'family_drawing' THEN
      SELECT t.family_id INTO v_family_id FROM family_drawings t WHERE t.id = p_content_id;
    WHEN 'family_board_comment' THEN
      RAISE EXCEPTION '掲示板のコメント（07-30章）はまだ実装されていません。実装時にhide_content()のCASEを1行書き換えること'
        USING ERRCODE = 'feature_not_supported';
    ELSE
      RAISE EXCEPTION '対象の種別が正しくありません（content_kindの6値のいずれか）: %', p_content_kind
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

  -- 既に隠されていた場合（ON CONFLICT DO NOTHING）は RETURNING が
  -- 1行も返さないため v_id が NULL になる。そのときは既存の行のidを返す。
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
   あれば同じidを返す）。データは消さない（論理的な非表示のみ）。';

-- 戻すのは運営だけ（決定7「段階3で非表示にしたものを保護者は戻せない」）。
CREATE OR REPLACE FUNCTION public.unhide_content(
  p_content_kind TEXT,
  p_content_id UUID
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM hidden_contents h
  WHERE h.content_kind = p_content_kind AND h.content_id = p_content_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

COMMENT ON FUNCTION public.unhide_content(TEXT, UUID) IS
  '運営が非表示を取り消す。service_roleからのみ実行できる（保護者は戻せない。
   要件定義書07-32章 決定7）。';

-- [EXECUTE権限] アプリに操作UIを持たないので、authenticated も含めて落とす。
-- 運営はSupabaseのSQL Editor（service_role相当）で実行する。
REVOKE ALL ON FUNCTION public.hide_content(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unhide_content(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. RLS（スキーマ設計.sql 66.5章）
-- ------------------------------------------------------------
-- SELECTは同じ家族なら誰でも可。クライアントが「隠すべき対象」を知るため
-- だけに読む。この表が持つのは「種別＋対象のid＋日時」だけで、誰が報告
-- したかも、何が書いてあったかも入っていない。
DROP POLICY IF EXISTS "hidden_contents_select_same_family" ON hidden_contents;
CREATE POLICY "hidden_contents_select_same_family" ON hidden_contents
  FOR SELECT
  USING (family_id = current_family_id());

-- [重要] INSERT / UPDATE / DELETE のポリシーは意図的に1本も定義しない。
-- アプリからは誰も行を入れられず、消せない。運営は service_role で
-- 上の2関数を使う。保護者が戻せないことは「戻すポリシーを書かない」
-- ことで担保している。

-- ------------------------------------------------------------
-- 4. クライアントの実装（スキーマ設計.sql 66.4章。★クライアント必須要件・
--    次回の画面対応で使うための申し送り。本マイグレーションはDB側のみ）
-- ------------------------------------------------------------
-- | content_kind             | 何を隠すか |
-- |---------------------------|------------|
-- | family_board_post         | カードごと（一覧・ホームカード・履歴のどれにも出さない） |
-- | family_board_comment      | コメントごと（親の投稿は出す） |
-- | chore_completion_note     | noteだけ。行は出す。ポイント・木・通帳・カレンダーの数字は変えない |
-- | chore_reaction_comment    | その1行（kind='comment'）ごと。スタンプは残す |
-- | gratitude_note            | noteだけ。行は出す。ポイントは動かさない |
-- | family_drawing            | 絵と題名ごと。木に飾られていればその飾りも描かない |
