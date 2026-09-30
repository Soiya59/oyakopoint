-- ============================================================
-- 招待受諾の同意の版を 1 → 2 に進める（2026-10-01・統括決定）
-- ============================================================
-- みまもりメンバーの招待受諾（S0）の説明に、項目fを足した。
--   「あなたが登録したごほうび（名前・ポイント）と、ごほうびを交換した記録も、
--     家族全員が見られます。」
-- みまもりのごほうびは2026-08-23から家族全員に見えている
-- （20260823083504_supporter_reward_public_visibility.sql）。これまでは説明に
-- 載せていなかった（要件定義書.md 06章(1)f行、やること4-9、実装メモ342章）。
--
-- クライアント側の定数 src/components/InviteVisibilityConsent.tsx の
-- JOIN_CONSENT_VERSION も同時に2へ進める。片方だけだと参加リクエストが
-- check_violationで拒否される（スキーマ設計.sql 40.5章）。
-- 公開前のため、参加済みのメンバーに再同意は求めない（join_consentsの既存行は版1のまま残す）。

CREATE OR REPLACE FUNCTION public.current_join_consent_version()
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 2; $$;

COMMENT ON FUNCTION public.current_join_consent_version() IS
  '要件定義書.md 06章「招待受諾フローにおける可視範囲の説明と同意取得」の
   説明文の現行バージョンの単一の定義箇所。説明文の項目を追加・削除する
   改訂を行うたびにこの関数の返り値をCREATE OR REPLACEで1つ進める。
   join_family_with_invite_code / accept_family_inviteは、呼び出し時点の
   この値と一致するp_consent_versionのみを受け付ける（40.7章）。クライアント
   側の対応する定数はsrc/components/InviteVisibilityConsent.tsxの
   JOIN_CONSENT_VERSION（実装メモ.md 111章）。
   版2（2026-10-01）: S0にみまもりのごほうびの項目fを追加（実装メモ342章）。';
