-- ============================================================
-- family_invites_before_update() のservice_roleバイパス条件が誤っており、
-- accept_family_invite（招待の承認）が常に失敗していたバグを修正する。
--
-- [発見の経緯]
-- ユーザーが実際にみまもりメンバー招待（S0）の「参加を確定する」を押したところ、
-- 「この経路ではrevoked（取消）以外への変更はできません」というエラーが発生した。
--
-- family_invites_before_update() は、pending以外への遷移・statusをrevoked以外へ
-- 変更する操作を拒否する制約を持つが、`IF current_user = 'service_role' THEN
-- RETURN NEW; END IF;` という早期リターンで「信頼できる経路」をバイパスする
-- つもりだった。しかし accept_family_invite はSECURITY DEFINER関数であり、
-- 実行時のcurrent_user は関数の所有者ロール（本プロジェクトでは実際には
-- 'postgres'）になる。'service_role' という文字列と一致することは無いため、
-- このバイパスは一度も機能しておらず、accept_family_invite内部の
-- `UPDATE family_invites SET status = 'accepted', ...` が常にこのトリガーの
-- 制約（「revoked以外への変更は拒否」）に引っかかっていた。
--
-- [対応]
-- バイパス条件を「呼び出し元が`authenticated`ロールでない場合」
-- （＝一般利用者からの直接のUPDATE呼び出しではなく、SECURITY DEFINER関数を
-- 経由した信頼できる呼び出しである場合）に変更する。一般利用者が
-- PostgRESTから直接family_invitesをUPDATEする経路は常に`authenticated`
-- ロールとして実行されるため、この経路に対する「revoked以外は拒否」という
-- 制約（招待の取消以外の不正な書き換えを防ぐ、25a章の元々の意図）は
-- 従来どおり維持される。
-- ============================================================
CREATE OR REPLACE FUNCTION public.family_invites_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.invited_email IS DISTINCT FROM OLD.invited_email
     OR NEW.token IS DISTINCT FROM OLD.token
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'status以外の項目は変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'この招待はすでに確定（承認済みまたは取消済み）です' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'この経路ではrevoked（取消）以外への変更はできません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;
