-- ============================================================
-- 退会済み(is_active=false)アカウントが「すでに家族に参加しています」と
-- 誤って拒否され、家族の新規作成・招待コード参加・みまもりメンバー招待の
-- いずれからも再参加できなくなる既存バグを修正する。
--
-- [発見の経緯]
-- 60章（src/lib/session.tsx の fetchParentMember 修正）と同根の見落とし。
-- create_family_with_owner / join_family_with_invite_code /
-- accept_family_invite の3関数はいずれも
--   IF EXISTS (SELECT 1 FROM family_members WHERE auth_user_id = auth.uid())
-- という「同じauth_user_idの行が1件でもあれば拒否」というガードを持っており、
-- is_active を見ていなかった。そのため、確認用に作成し後で退会させた
-- （is_active=false にした）アカウントで再度ログインし、家族を新規作成する・
-- 招待コードで参加する・みまもりメンバー招待を承認する、のいずれを試みても
-- 「このアカウントはすでにいずれかの家族に所属しています」
-- （画面表示は「すでに家族に参加しています」）という誤ったエラーで
-- 弾かれてしまっていた。
--
-- [対応]
-- 3関数すべてのガード条件に `AND is_active` を追加する。退会済み
-- （is_active=false）の行は「現在所属していない」とみなし、再度の家族作成・
-- 参加を許可する。ロジック自体は既存のとおり新規INSERTのため、退会済みの
-- 古い行はそのまま残り、新しい行が別途作成される（退会履歴を消さない）。
-- ============================================================

-- [追加発見] このマイグレーション適用後、上記3関数のガードを直しただけでは
-- 不十分であることが判明した（uq_family_members_auth_user_idのユニーク制約が
-- is_activeを見ていないため、INSERT自体が失敗する）。対応は後続の
-- 20260823023435_fix_inactive_member_unique_index.sql を参照。

CREATE OR REPLACE FUNCTION public.create_family_with_owner(p_family_name TEXT, p_display_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM family_members WHERE auth_user_id = auth.uid() AND is_active) THEN
    RAISE EXCEPTION 'このアカウントはすでにいずれかの家族に所属しています' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO families (name) VALUES (p_family_name) RETURNING id INTO v_family_id;

  INSERT INTO family_members (family_id, display_name, role, auth_user_id, is_owner)
  VALUES (v_family_id, p_display_name, 'parent', auth.uid(), true);

  RETURN v_family_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_family_with_invite_code(p_invite_code TEXT, p_display_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM family_members WHERE auth_user_id = auth.uid() AND is_active) THEN
    RAISE EXCEPTION 'このアカウントはすでにいずれかの家族に所属しています' USING ERRCODE = 'unique_violation';
  END IF;

  SELECT id INTO v_family_id FROM families WHERE invite_code = upper(p_invite_code);
  IF NOT FOUND THEN
    RAISE EXCEPTION '招待コードが無効です' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO family_members (family_id, display_name, role, auth_user_id, is_owner)
  VALUES (v_family_id, p_display_name, 'parent', auth.uid(), false);

  RETURN v_family_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_family_invite(p_token TEXT, p_display_name TEXT)
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

  v_caller_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
  IF v_caller_email = '' OR v_caller_email <> v_invite.invited_email THEN
    RAISE EXCEPTION 'この招待は別のメールアドレス宛てです' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO family_members (family_id, display_name, role, auth_user_id, is_owner)
  VALUES (v_invite.family_id, p_display_name, v_invite.role, auth.uid(), false)
  RETURNING id INTO v_member_id;

  UPDATE family_invites
  SET status = 'accepted', accepted_by = v_member_id, accepted_at = now()
  WHERE id = v_invite.id;

  RETURN v_invite.family_id;
END;
$$;
