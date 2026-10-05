-- ============================================================
-- みまもり招待のコード（token）を、DB側で作る（やること4-96・2026-10-05）
-- ============================================================
-- 不具合: ネイティブアプリ（Hermes）には crypto.randomUUID が無く、
--   createFamilyInvite()（src/data/api.ts）が「この端末では安全な招待コードを
--   作れませんでした」で止まっていた。9/1に Math.random() のフォールバックを
--   廃止していたため（実装メモ106章）、ネイティブでは招待が一度も作れなかった。
--
-- 直し方: tokenを端末ではなくDBが作る。gen_random_uuid() は暗号論的に安全な乱数
--   （122ビット）で、これまでのUUID形式と同じ。クライアントが送った値は、
--   あってもなくても使わず、必ずここで作り直す（クライアントが推測しやすい値を
--   入れる経路も塞ぐ）。INSERTの戻り値（.select("*")）にはトリガー適用後の行が
--   入るので、古いクライアントも、返ってきたtokenをそのまま使える。
--
-- 他の自動補完（family_id・created_by・role・status等）は、20260822153000_supporter_role.sql
-- 25a章と同じ。

CREATE OR REPLACE FUNCTION public.family_invites_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.family_id := current_family_id();
  NEW.created_by := current_family_member_id();
  NEW.role := 'supporter';
  NEW.status := 'pending';
  NEW.accepted_by := NULL;
  NEW.accepted_at := NULL;
  NEW.invited_email := lower(trim(NEW.invited_email));
  NEW.token := gen_random_uuid()::text;
  RETURN NEW;
END;
$$;
