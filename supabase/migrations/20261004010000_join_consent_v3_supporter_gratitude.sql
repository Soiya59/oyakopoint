-- ============================================================
-- 招待受諾の同意の版を 2 → 3 に進める（2026-10-03・統括決定）
-- ============================================================
-- みまもりメンバーの招待受諾（S0）にも、項目aのみまもり向けの言い方を足した。
--   「感謝メッセージの本文は、保護者が家族のだれの通帳からでも読めます。
--     あなたが送った・受け取った感謝メッセージも、保護者から読めます。」
-- みまもりも感謝ポイントを送受信でき、本文は保護者全員が通帳で読める。これまでは
-- 「みまもりは感謝ポイントの送受信対象外」という古い前提のまま、説明に載せていなかった
-- （要件定義書.md 06章(1)a行・(3)、07-45章9節で企画部が発見、実装メモ346章）。
--
-- クライアント側の定数 src/components/InviteVisibilityConsent.tsx の
-- JOIN_CONSENT_VERSION も同時に3へ進める。片方だけだと参加リクエストが
-- check_violationで拒否される（スキーマ設計.sql 40.5章）。
-- 公開前のため、参加済みのメンバーに再同意は求めない（join_consentsの既存行はそのまま残す）。

CREATE OR REPLACE FUNCTION public.current_join_consent_version()
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 3; $$;

COMMENT ON FUNCTION public.current_join_consent_version() IS
  '要件定義書.md 06章「招待受諾フローにおける可視範囲の説明と同意取得」の
   説明文の現行バージョンの単一の定義箇所。説明文の項目を追加・削除する
   改訂を行うたびにこの関数の返り値をCREATE OR REPLACEで1つ進める。
   join_family_with_invite_code / accept_family_inviteは、呼び出し時点の
   この値と一致するp_consent_versionのみを受け付ける（40.7章）。クライアント
   側の対応する定数はsrc/components/InviteVisibilityConsent.tsxの
   JOIN_CONSENT_VERSION（実装メモ.md 111章）。
   版2（2026-10-01）: S0にみまもりのごほうびの項目fを追加（実装メモ342章）。
   版3（2026-10-03）: S0に感謝メッセージの項目a（みまもり向け）を追加（実装メモ346章）。';
