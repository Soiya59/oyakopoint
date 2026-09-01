-- ============================================================
-- 招待受諾フローにおける可視範囲の説明と同意取得
-- 要件定義書.md 06章「招待受諾フローにおける可視範囲の説明と同意取得」
-- 設計部/成果物/スキーマ設計.sql 40章（DDL全文）、API仕様.md 2f章
-- UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 26章
-- 開発部/成果物/実装メモ.md 111章
--
-- [背景] 95.4章の統括決定「感謝メッセージの可視範囲は現状のまま維持する」に
-- 伴う宿題（95.5章）。RLSは変更せず、招待受諾フロー（P6・S0）で可視範囲を
-- 説明しチェックボックスで明示同意を取得したうえで、同意記録をDBに残す。
--
-- [40.7章・重要な罠] 引数を追加したCREATE OR REPLACE FUNCTIONは、引数の型・
-- 個数が異なる場合「置き換え」ではなく「新しいオーバーロードの追加」になる。
-- 旧シグネチャ（2引数版）を必ずDROP FUNCTIONで明示的に削除する。
--
-- [開発部の判断・avatar_colorについて] スキーマ設計.sql 40章のDDL本文は
-- join_family_with_invite_code/accept_family_inviteの関数本体を
-- avatar_color割り当て（20260824221436_assign_avatar_color_to_all_members.sql、
-- 実装メモ.md69章）を反映しない形で記載している。本マイグレーションは、40章の
-- DDLをそのまま写すのではなく、現行の本番の関数本体（avatar_color割り当てを
-- 含む、20260823023227_fix_inactive_member_rejoin.sqlおよび
-- 20260824221436_assign_avatar_color_to_all_members.sql適用後の実物）を
-- ベースに、40章が指定する差分（p_consent_version引数の追加・バージョン検証・
-- join_consentsへのINSERT）のみを追加する。全社ルール「文書と実装が食い違った
-- ときは、実装済みの仕様は実装（コード・本番DB）を正とする」（CLAUDE.md）に
-- 基づく判断。avatar_color割り当てをうっかり消すと、07-10章「色分けによる
-- 個人の可視化」が新規参加者に対して再び機能しなくなる（69章の事故の再発）。
-- 詳細は実装メモ.md 111章「迷った点」参照。
-- ============================================================

-- ------------------------------------------------------------
-- 1. join_consents テーブル（スキーマ設計.sql 40.3章）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS join_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  family_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  consent_version INTEGER NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_join_consents_member_version UNIQUE (family_member_id, consent_version)
);

CREATE INDEX IF NOT EXISTS idx_join_consents_family_id ON join_consents(family_id);
CREATE INDEX IF NOT EXISTS idx_join_consents_family_member_id ON join_consents(family_member_id);

ALTER TABLE join_consents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE join_consents IS
  '要件定義書.md 06章「招待受諾フローにおける可視範囲の説明と同意取得」の
   同意記録。個情法の説明責任・Apple 5.1.1(i)対応・家庭間トラブル追跡の証跡
   として、書き込み後は一切変更・削除できない追記専用（append-only）の記録
   とする（スキーマ設計.sql 40.4章）。書き込みはjoin_family_with_invite_code/
   accept_family_inviteの内部からのみ行われる（同40.6章・40.7章）。';

-- ------------------------------------------------------------
-- 2. RLS（閲覧のみ。書込みはRLS経由を一切許可しない。スキーマ設計.sql 40.4章）
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "join_consents_select_by_parent" ON join_consents;
CREATE POLICY "join_consents_select_by_parent" ON join_consents
  FOR SELECT
  USING (family_id = current_family_id() AND is_current_user_parent());

DROP POLICY IF EXISTS "join_consents_select_own" ON join_consents;
CREATE POLICY "join_consents_select_own" ON join_consents
  FOR SELECT
  USING (family_member_id = current_family_member_id());

-- INSERT/UPDATE/DELETEポリシーは定義しない（40.4章の設計判断。書き込み経路は
-- 下記4.のSECURITY DEFINER関数のみに閉じる）。

-- ------------------------------------------------------------
-- 3. consent_version の管理（スキーマ設計.sql 40.5章）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_join_consent_version()
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 1; $$;

COMMENT ON FUNCTION public.current_join_consent_version() IS
  '要件定義書.md 06章「招待受諾フローにおける可視範囲の説明と同意取得」の
   説明文の現行バージョンの単一の定義箇所。説明文の項目を追加・削除する
   改訂を行うたびにこの関数の返り値をCREATE OR REPLACEで1つ進める。
   join_family_with_invite_code / accept_family_inviteは、呼び出し時点の
   この値と一致するp_consent_versionのみを受け付ける（40.7章）。クライアント
   側の対応する定数はsrc/components/InviteVisibilityConsent.tsxの
   JOIN_CONSENT_VERSION（実装メモ.md 111章）。';

-- 本関数はauthenticated/anonへの明示的なGRANTを行わない（max_unpublished_
-- drawings_per_member()等の既存の「定数取得用ヘルパー関数」と同じ扱い。
-- 34.5章の既知の挙動により新規関数作成時にauthenticatedへのEXECUTE権限が
-- 自動付与されるが、公開APIとしては位置付けない。40.10章のS4増分参照）。

-- ------------------------------------------------------------
-- 4. join_family_with_invite_code / accept_family_invite の改訂
--    （スキーマ設計.sql 40.6章・40.7章。本体は上記「開発部の判断」のとおり
--    現行本番ロジック＝avatar_color割り当てを保持したうえで同意関連の差分を追加）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_family_with_invite_code(
  p_invite_code TEXT,
  p_display_name TEXT,
  p_consent_version INT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_member_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM family_members WHERE auth_user_id = auth.uid() AND is_active) THEN
    RAISE EXCEPTION 'このアカウントはすでにいずれかの家族に所属しています' USING ERRCODE = 'unique_violation';
  END IF;

  -- [40.5章] クライアントが表示した説明文のバージョンと、DB側の現行バージョンが
  -- 一致しない場合は参加させない（アプリが古い可能性がある）。単なる
  -- 「NULLでないか」ではなく厳密な一致を要求する。
  IF p_consent_version IS NULL OR p_consent_version <> public.current_join_consent_version() THEN
    RAISE EXCEPTION 'アプリが古い可能性があります。最新の状態に更新してからもう一度お試しください' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_family_id FROM families WHERE invite_code = upper(p_invite_code);
  IF NOT FOUND THEN
    RAISE EXCEPTION '招待コードが無効です' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO family_members (family_id, display_name, role, auth_user_id, is_owner, avatar_color)
  VALUES (v_family_id, p_display_name, 'parent', auth.uid(), false, public.next_member_avatar_color(v_family_id))
  RETURNING id INTO v_member_id;

  -- [40.6章] 参加処理と同一トランザクション内で同意記録を書く。
  INSERT INTO join_consents (family_id, family_member_id, consent_version)
  VALUES (v_family_id, v_member_id, p_consent_version);

  RETURN v_family_id;
END;
$$;

-- [40.7章・重要] 旧シグネチャ（2引数版）を明示的に削除する。
DROP FUNCTION IF EXISTS public.join_family_with_invite_code(TEXT, TEXT);

REVOKE ALL ON FUNCTION public.join_family_with_invite_code(TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_family_with_invite_code(TEXT, TEXT, INT) TO authenticated;


CREATE OR REPLACE FUNCTION public.accept_family_invite(
  p_token TEXT,
  p_display_name TEXT,
  p_consent_version INT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite family_invites%ROWTYPE;
  v_caller_email TEXT;
  v_member_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM family_members WHERE auth_user_id = auth.uid() AND is_active) THEN
    RAISE EXCEPTION 'このアカウントはすでにいずれかの家族に所属しています' USING ERRCODE = 'unique_violation';
  END IF;

  -- [40.5章] join_family_with_invite_codeと同じ検証。
  IF p_consent_version IS NULL OR p_consent_version <> public.current_join_consent_version() THEN
    RAISE EXCEPTION 'アプリが古い可能性があります。最新の状態に更新してからもう一度お試しください' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_invite FROM family_invites WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION '招待が見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_invite.status <> 'pending' THEN
    RAISE EXCEPTION 'この招待はすでに確定（承認済みまたは取消済み）です' USING ERRCODE = 'check_violation';
  END IF;

  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'この招待は有効期限が切れています' USING ERRCODE = 'check_violation';
  END IF;

  -- [必須要件] 招待に紐づくメールアドレスと、実際にログインしたSupabase Authの
  -- メールアドレスが一致することを確認する（25c章から変更なし）。
  v_caller_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
  IF v_caller_email = '' OR v_caller_email <> v_invite.invited_email THEN
    RAISE EXCEPTION 'この招待は別のメールアドレス宛てです' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO family_members (family_id, display_name, role, auth_user_id, is_owner, avatar_color)
  VALUES (v_invite.family_id, p_display_name, v_invite.role, auth.uid(), false, public.next_member_avatar_color(v_invite.family_id))
  RETURNING id INTO v_member_id;

  -- [40.6章] 参加処理と同一トランザクション内で同意記録を書く。
  INSERT INTO join_consents (family_id, family_member_id, consent_version)
  VALUES (v_invite.family_id, v_member_id, p_consent_version);

  UPDATE family_invites
  SET status = 'accepted', accepted_by = v_member_id, accepted_at = now()
  WHERE id = v_invite.id;

  RETURN v_invite.family_id;
END;
$$;

-- [40.7章・重要] 旧シグネチャ（2引数版）を明示的に削除する。
DROP FUNCTION IF EXISTS public.accept_family_invite(TEXT, TEXT);

REVOKE ALL ON FUNCTION public.accept_family_invite(TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_family_invite(TEXT, TEXT, INT) TO authenticated;

-- ------------------------------------------------------------
-- 5. create_family_with_owner は対象外（スキーマ設計.sql 40.8章）
-- ------------------------------------------------------------
-- 家族を新規作成する最初の1人（オーナー）には可視範囲の説明・同意という
-- 要件が発生しないため、引数・同意記録のいずれも変更しない。

-- ------------------------------------------------------------
-- 6. デプロイ順序についての申し送り（スキーマ設計.sql 40.7章・実装メモ.md 111章）
-- ------------------------------------------------------------
-- 本マイグレーションは旧シグネチャをDROPするため、適用した瞬間に旧クライアント
-- の参加機能（p_consent_versionを送らないjoinFamilyWithInviteCode/
-- acceptFamilyInvite呼び出し）が42883 undefined_functionで失敗するようになる
-- （意図したハードカットオーバー）。DB適用とクライアントのデプロイ（3引数対応・
-- 同意画面の実装）は同一のデプロイで続けて行うこと。本部長が実施する。
