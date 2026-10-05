/**
 * みまもりの招待コード（token）を、貼り付けられた文字列から取り出す。
 * [2026-10-05新設・やること4-96] 招待リンク（oyakopoint://onboarding/join-supporter?token=…、
 * またはWeb版の https://…?token=…）を丸ごと貼っても、コード（UUID）だけを貼っても受け付ける。
 * tokenはDBが gen_random_uuid() で作るUUID（マイグレーション 20261005010000）。
 * 見つからなければ null。
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function extractSupporterInviteToken(input: string): string | null {
  const m = input.trim().match(UUID_RE);
  return m ? m[0].toLowerCase() : null;
}
