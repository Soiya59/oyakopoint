-- ============================================================
-- 保護者がソーシャル機能を管理するトグル1つ — 新設・2026-09-20
-- 参照: 設計部/成果物/スキーマ設計.sql 67章
-- 要件定義書 07-32章（決定20・21・22・22b・23・24・33）
-- ============================================================
-- [何を作るか] 保護者が家族全体に効かせるトグルを1つ
-- （social_interactions_enabled）。お絵かきは対象にしない。
--   止まるもの: 掲示板への投稿・コメント（実装後）・スタンプ／完了報告への
--     コメント（chore_reactions.comment_body）／感謝メッセージのひとこと
--     （gratitude_points.note）
--   止まらないもの: 過去の投稿・コメント／スタンプ4種（完了報告への
--     リアクション、定型でありUGCではない）／感謝ポイントを贈ること自体
--     （このマイグレーションのgratitude_points.noteのNULL許容化が前提）
--
-- [本マイグレーションを1本にまとめた理由] 67.3章のALTER（noteのNULL許容化）
-- だけを先に出すと、noteがNULLを許すだけでトグルが無い状態が本番へ出る
-- （設計部の申し送りどおり）。67.1・67.3・67.4・67.5章を1本にまとめる。
--
-- 【破壊的操作の記録・実行前】
--   - ALTER TABLE gratitude_points ALTER COLUMN note DROP NOT NULL;
--     既存の行は1件も変わらない（NOT NULLを外すだけ）。CHECK制約は
--     いったんDROPし、NULLを許す形で作り直す（既存の1〜200字の範囲検査は
--     NULLでない値に対して維持される）。
--   - families に3列追加（ADD COLUMN IF NOT EXISTS、破壊的ではないが
--     DEFAULT trueで全既存行を埋める）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. families への列追加（スキーマ設計.sql 67.1章）
-- ------------------------------------------------------------
-- [既定値の注意・67.6章] 既定は必ず DEFAULT true のまま入れる。
-- 既存の全家族の画面から、アップデートの日に機能が消えることを避けるため
-- （決定22の理由1）。既定オン/オフの最終判断が統括から下りたら、
-- 「ALTER TABLE families ALTER COLUMN social_interactions_enabled SET
-- DEFAULT false;」を別マイグレーションで足すだけでよい（既存家族の値は
-- 変わらない）。
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS social_interactions_enabled BOOLEAN NOT NULL DEFAULT true,
  -- 最後にこの設定を確認（または変更）した保護者のメンバーidと日時。
  -- 変更履歴は持たない（決定24）。NULL = まだ一度も保護者が確認していない。
  -- [循環参照の回避・67.2章] REFERENCES family_members(id) は意図的に
  -- 付けない。families ⇄ family_members の循環参照を避けるため
  -- （delete_familyのCASCADE順序が壊れうる）。
  ADD COLUMN IF NOT EXISTS social_settings_updated_by UUID NULL,
  ADD COLUMN IF NOT EXISTS social_settings_updated_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN families.social_interactions_enabled IS
  '要件定義書07-32章 決定33「家族のやりとりを使う」（仮称）。家族全体に
   効く（決定21。子どもごとの個別設定は作らない）。falseのとき、掲示板への
   投稿・コメント（実装後）・スタンプ、chore_reactionsのkind=''comment''、
   gratitude_points.noteの3種の自由記述を止める。kind=''stamp''
   （完了報告へのスタンプ4種）と、感謝ポイントを贈ること自体は止めない。
   過去の投稿・コメントは残る。';
COMMENT ON COLUMN families.social_settings_updated_by IS
  '最後にソーシャル設定を確認・変更した保護者のfamily_members.id。
   意図的に外部キーを張っていない（families ⇄ family_membersの循環参照を
   避けるため）。NULLは「まだ一度も保護者が確認していない」
   （決定22bの1回だけの案内の判定に使う）。';

-- ------------------------------------------------------------
-- 2. gratitude_points.note を NULL許容にする（スキーマ設計.sql 67.3章。
--    ★これが無いとトグルが成立しない）
-- ------------------------------------------------------------
-- [制約名の確認・実行前] 67.3章の注記どおり、制約名は環境によって異なり
-- うるため、適用前に実DBで以下を確認すること。
--   SELECT conname FROM pg_constraint WHERE conrelid = 'gratitude_points'::regclass;
-- 本番適用前に確認した制約名・確認結果は実装メモに記録する
-- （このマイグレーション自体はDROP CONSTRAINT IF EXISTSのため、名前が
-- 想定と違っていても失敗はしない。何も落とせなかった場合は次の
-- ADD CONSTRAINTが重複エラーになるので、その場合は本番適用前に
-- 実際の制約名で書き換えること）。
ALTER TABLE gratitude_points ALTER COLUMN note DROP NOT NULL;
ALTER TABLE gratitude_points DROP CONSTRAINT IF EXISTS gratitude_points_note_check;
ALTER TABLE gratitude_points
  ADD CONSTRAINT gratitude_points_note_check
  CHECK (note IS NULL OR char_length(trim(note)) BETWEEN 1 AND 200);

-- [chore_reactions.comment_body は直さなくてよい] こちらは既にNULL許容で、
-- chk_reaction_kind_payloadが「kind='stamp'ならcomment_body IS NULL」を
-- 定めている。トグルをオフにするときはkind='comment'の行を作らせない
-- だけでよく、列の変更は不要。

-- ------------------------------------------------------------
-- 3. サーバ側のガード（スキーマ設計.sql 67.4章）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_family_social_interactions_enabled(
  p_family_id UUID
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  SELECT f.social_interactions_enabled
    INTO v_enabled
  FROM families f
  WHERE f.id = p_family_id;

  -- 家族が見つからないときは true（＝止めない）に倒す。false に倒すと、
  -- 家族の行が一瞬引けなかっただけで書き込みが失敗する。
  RETURN COALESCE(v_enabled, true);
END;
$$;

COMMENT ON FUNCTION public.is_family_social_interactions_enabled(UUID) IS
  '要件定義書07-32章 決定33「家族のやりとりを使う」の現在値を引く共通
   ヘルパー。判定できない場合はtrue（止めない）に倒す。';

-- [EXECUTE権限] authenticated から落とさないこと。下の4本のトリガー関数は
-- SECURITY DEFINER ではなく呼び出し元ロール（authenticated）として実行
-- されるため、その内部から呼ぶ本関数にも authenticated の EXECUTE が要る。
REVOKE ALL ON FUNCTION public.is_family_social_interactions_enabled(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_family_social_interactions_enabled(UUID) TO authenticated;

-- (1) 掲示板の投稿
CREATE OR REPLACE FUNCTION public.family_board_posts_social_toggle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.is_family_social_interactions_enabled(NEW.family_id) THEN
    RAISE EXCEPTION 'この家族では、いま家族のやりとりを使わない設定になっています'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_board_posts_social_toggle_guard ON family_board_posts;
CREATE TRIGGER trg_family_board_posts_social_toggle_guard
  BEFORE INSERT ON family_board_posts
  FOR EACH ROW EXECUTE FUNCTION public.family_board_posts_social_toggle_guard();

-- (2) 掲示板のスタンプ（決定33の統合後も「掲示板のスタンプ」は止める対象）
CREATE OR REPLACE FUNCTION public.family_board_reactions_social_toggle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  -- 61.3章のトリガーがNEW.family_idを自動補完する設計のため、こちらの
  -- トリガーが先に走った場合に備えて、NULLなら投稿から引き直す。
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

DROP TRIGGER IF EXISTS trg_family_board_reactions_social_toggle_guard ON family_board_reactions;
CREATE TRIGGER trg_family_board_reactions_social_toggle_guard
  BEFORE INSERT ON family_board_reactions
  FOR EACH ROW EXECUTE FUNCTION public.family_board_reactions_social_toggle_guard();

-- (3) 完了報告へのコメント（スタンプは止めない）
CREATE OR REPLACE FUNCTION public.chore_reactions_social_toggle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.kind = 'comment'
     AND NOT public.is_family_social_interactions_enabled(NEW.family_id) THEN
    RAISE EXCEPTION 'この家族では、いま完了報告へのコメントを使わない設定になっています'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chore_reactions_social_toggle_guard ON chore_reactions;
CREATE TRIGGER trg_chore_reactions_social_toggle_guard
  BEFORE INSERT ON chore_reactions
  FOR EACH ROW EXECUTE FUNCTION public.chore_reactions_social_toggle_guard();

-- (4) 感謝メッセージのひとこと（ポイントを贈ること自体は止めない）
--     INSERTを拒否する設計にする（黙ってnoteを落とすと、クライアント側の
--     条件分岐の書き忘れが永久に発覚しないため）。
CREATE OR REPLACE FUNCTION public.gratitude_points_social_toggle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.note IS NOT NULL
     AND NOT public.is_family_social_interactions_enabled(NEW.family_id) THEN
    RAISE EXCEPTION 'この家族では、いま感謝のひとことを使わない設定になっています'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gratitude_points_social_toggle_guard ON gratitude_points;
CREATE TRIGGER trg_gratitude_points_social_toggle_guard
  BEFORE INSERT ON gratitude_points
  FOR EACH ROW EXECUTE FUNCTION public.gratitude_points_social_toggle_guard();

-- ------------------------------------------------------------
-- 4. set_family_social_settings()（スキーマ設計.sql 67.5章）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_family_social_settings(
  p_interactions_enabled BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_member_id UUID;
BEGIN
  v_family_id := public.current_family_id();
  v_member_id := public.current_family_member_id();

  IF v_family_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 保護者のみ（みまもりメンバーは変更できない／子どもは見ることも
  -- 変更することもできない）。
  IF NOT COALESCE(public.is_current_user_parent(), false) THEN
    RAISE EXCEPTION 'この設定は保護者のみ変更できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_interactions_enabled IS NULL THEN
    RAISE EXCEPTION '設定を指定してください' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE families f
     SET social_interactions_enabled = p_interactions_enabled,
         social_settings_updated_by  = v_member_id,
         social_settings_updated_at  = now()
   WHERE f.id = v_family_id;
END;
$$;

COMMENT ON FUNCTION public.set_family_social_settings(BOOLEAN) IS
  '要件定義書07-32章 決定20〜24・決定33。保護者がソーシャル機能のトグル
   （1つに統合済み）を設定する。決定22bの「子ども登録時の確認ステップ」で
   「この内容ではじめる」を押したときも、値を変えずにこの関数を呼ぶこと
   （social_settings_updated_by / _at が埋まることが adult action の記録に
   なる）。家族全体に即時反映する（決定21）。変更履歴は持たない（決定24）。';

REVOKE ALL ON FUNCTION public.set_family_social_settings(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_family_social_settings(BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 5. 開発部への申し送り（次回の画面対応。今回はDB側のみ）
-- ------------------------------------------------------------
-- - 読み出しに新しい問い合わせは要らない。クライアントは既に読んでいる
--   familiesの行からsocial_interactions_enabledの1列を見ればよい。
-- - 書き込みは supabase.rpc('set_family_social_settings', {...}) の1本だけ。
-- - 子どもの画面には設定の存在自体を出さない（決定24）。
-- - トグルの設定画面そのものは今回作らない（次回）。
-- - 感謝を贈る画面（app/parent・child・supporter/gratitude-send.tsx）の
--   送信可否判定は、このマイグレーションと同じ回でアプリ側を修正した
--   （開発部/成果物/実装メモ.md 参照。やること.md 4-71）。
