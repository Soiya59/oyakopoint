-- ============================================================
-- 利用規約への同意取得＋Play Families 安全リマインダー（初回1回のモーダル）
-- やること.md 2-22（市場調査部レポート サマリー表#1・#7）
-- 開発部/成果物/実装メモ.md 181章
--
-- [設計方針] join_consents（20260902010000_join_visibility_consent.sql、
-- スキーマ設計.sql 40章）と同じ流儀に揃える。
-- - 追記専用（append-only）。書き込みはSECURITY DEFINER関数のみに閉じ、
--   RLSにINSERT/UPDATE/DELETEポリシーは定義しない。
-- - current_terms_consent_version() を文言バージョンの単一の定義箇所とし、
--   クライアント側の対応する定数（src/components/TermsConsentGate.tsx の
--   TERMS_CONSENT_VERSION）と一致させる。文言（禁止事項・安全リマインダーの
--   文章）を変更するときは、この関数の返り値とクライアント側定数の両方を
--   同じデプロイでCREATE OR REPLACEすること。
--
-- [join_consentsとの違い] join_consentsは「保護者・みまもりが招待を受諾する
-- 瞬間」にしか書き込まれず、子ども（role='child'）は書き込み経路（
-- join_family_with_invite_code/accept_family_invite）を一切呼べない設計
-- だった（40.10章）。本テーブルは逆に、子どもも含む3ロール全員が対象
-- （実装メモ.md 181章「開発部の判断」参照。市場調査部レポート1-5節の
-- Play Families安全リマインダーが「子どもユーザーが自由形式のやりとりを
-- 始める前」を要求しているため）。current_family_member_id()は子どもの
-- カスタムJWT（family_member_idクレーム）でも解決できる設計
-- （20260815093520_initial_schema.sql）なので、書き込み関数
-- record_terms_consent()は3ロール共通のまま実装できる。
-- ============================================================

-- ------------------------------------------------------------
-- 1. terms_consents テーブル
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS terms_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  family_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  consent_version INTEGER NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_terms_consents_member_version UNIQUE (family_member_id, consent_version)
);

CREATE INDEX IF NOT EXISTS idx_terms_consents_family_id ON terms_consents(family_id);
CREATE INDEX IF NOT EXISTS idx_terms_consents_family_member_id ON terms_consents(family_member_id);

ALTER TABLE terms_consents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE terms_consents IS
  '利用規約への同意＋Play Families安全リマインダー（初回1回のモーダル）の
   同意記録。市場調査部レポート サマリー表#1・#7、やること.md 2-22。
   join_consentsと同じく、書き込み後は一切変更・削除できない追記専用の記録
   とする。書き込みはrecord_terms_consent()の内部からのみ行われる。
   保護者・みまもりメンバーだけでなく子ども（role=''child''）も対象。';

-- ------------------------------------------------------------
-- 2. RLS（閲覧のみ。書込みはRLS経由を一切許可しない。join_consentsと同じ設計）
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "terms_consents_select_by_parent" ON terms_consents;
CREATE POLICY "terms_consents_select_by_parent" ON terms_consents
  FOR SELECT
  USING (family_id = current_family_id() AND is_current_user_parent());

DROP POLICY IF EXISTS "terms_consents_select_own" ON terms_consents;
CREATE POLICY "terms_consents_select_own" ON terms_consents
  FOR SELECT
  USING (family_member_id = current_family_member_id());

-- INSERT/UPDATE/DELETEポリシーは定義しない。書き込み経路は下記4.の
-- SECURITY DEFINER関数のみに閉じる（join_consentsと同じ設計判断）。

-- ------------------------------------------------------------
-- 3. consent_version の管理
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_terms_consent_version()
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 1; $$;

COMMENT ON FUNCTION public.current_terms_consent_version() IS
  '利用規約への同意＋Play Families安全リマインダーモーダルの文言の現行バージョン
   の単一の定義箇所。文言（禁止事項・安全リマインダー文）を追加・変更する
   改訂を行うたびにこの関数の返り値をCREATE OR REPLACEで1つ進める。
   record_terms_consent()は、呼び出し時点のこの値と一致するp_consent_version
   のみを受け付ける。クライアント側の対応する定数は
   src/components/TermsConsentGate.tsx の TERMS_CONSENT_VERSION。';

-- 本関数はauthenticated/anonへの明示的なGRANTを行わない
-- （current_join_consent_version()等の既存の「定数取得用ヘルパー関数」と
-- 同じ扱い。34.5章の既知の挙動により新規関数作成時にauthenticatedへの
-- EXECUTE権限が自動付与されるが、公開APIとしては位置付けない）。

-- ------------------------------------------------------------
-- 4. 同意状況の確認・記録（3ロール共通。SECURITY DEFINER）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_agreed_to_current_terms()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM terms_consents
    WHERE family_member_id = public.current_family_member_id()
      AND consent_version = public.current_terms_consent_version()
  );
$$;

COMMENT ON FUNCTION public.has_agreed_to_current_terms() IS
  '現在ログイン中のメンバー（保護者・みまもり・子どものいずれも可）が、
   現行バージョンの利用規約＋安全リマインダーに同意済みかどうか。
   未ログイン（current_family_member_id()がNULL）の場合はfalseを返す
   （同意モーダルを表示する側で安全に倒れる。実運用ではログイン確定後にしか
   呼ばれない）。';

REVOKE ALL ON FUNCTION public.has_agreed_to_current_terms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_agreed_to_current_terms() TO authenticated;

CREATE OR REPLACE FUNCTION public.record_terms_consent(p_consent_version INT)
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

  -- クライアントが表示した文言のバージョンと、DB側の現行バージョンが一致しない
  -- 場合は記録させない（join_consentsのp_consent_version検証と同じ設計）。
  IF p_consent_version IS NULL OR p_consent_version <> public.current_terms_consent_version() THEN
    RAISE EXCEPTION 'アプリが古い可能性があります。最新の状態に更新してからもう一度お試しください' USING ERRCODE = 'check_violation';
  END IF;

  -- 2回目以降の呼び出し（連打・再表示など）はON CONFLICT DO NOTHINGで
  -- 静かに成功扱いにする（join_consentsは参加処理と一体のため一度しか
  -- 呼ばれない設計だったが、本関数は独立した「あとから何度でも呼べる」
  -- 導線のため、べき等にしておく）。
  INSERT INTO terms_consents (family_id, family_member_id, consent_version)
  VALUES (v_family_id, v_member_id, p_consent_version)
  ON CONFLICT (family_member_id, consent_version) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.record_terms_consent(INT) IS
  '利用規約＋安全リマインダーへの同意を記録する。保護者・みまもり・子どもの
   いずれのセッション（session.clientの実体はsupabase本体クライアント/
   子ども専用クライアントのいずれか）からも呼び出せる。';

REVOKE ALL ON FUNCTION public.record_terms_consent(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_terms_consent(INT) TO authenticated;
