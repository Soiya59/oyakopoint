/**
 * [2026-09-20新設・実装メモ.md 262章] 失敗の原因を追うための短い識別子を作る。
 *
 * 背景: みまもりメンバーのログイン失敗（本番・TestFlight）が「通信エラーが
 * 発生しました」の1文にしか出ず、本部長が本番の`auth.users`・
 * `auth.audit_log_entries`を見ても原因を特定できなかった事案への対応。
 * `auth.audit_log_entries`はサーバー側の記録が残らない設定のため、
 * 手がかりは利用者の画面（＝統括からのスクリーンショット）だけになる。
 *
 * 方針:
 * - 利用者向けの文言は変えず、その下に小さく・控えめに識別子だけを添える
 *   （呼び出し元 src/components/EmailCodeVerifyForm.tsx 参照）。
 * - メールアドレス・6桁コードなど個人が分かる値は一切含めない
 *   （ApiError.message にはGoTrueの生の文言が入りうるため、messageは使わず
 *   code・statusだけを使う）。
 * - 「エラー」「Error」のような強い言葉が利用者の目に触れないよう、
 *   知っているcodeは下表の短い記号に置き換える。「エラーコード」を思わせる
 *   見た目にしないため、ラベルも付けない（識別子の文字列だけを表示する）。
 * - 未知のcodeは先頭8文字までをそのまま出す（個人情報が乗る想定の値ではない。
 *   AUTH_ERRCODE・PG_ERRCODE — いずれもsrc/data/api.ts — に列挙されている
 *   値と、GoTrueのerror-codes.d.tsに載っている定義済みcodeのみが実際には入る）。
 *
 * 読み方（本部長がスクリーンショットから引く用）:
 *   "{status}-{記号}" の形。例: "0-net" なら「fetch自体が失敗した＝端末側の
 *   通信断・DNS失敗・TLS拒否等の疑い」、"503-net" なら「サーバー側のゲートウェイ
 *   異常」、"400-cred" なら「メール+パスワードの組み合わせ誤り」、
 *   "403-code" なら「6桁コードが違う・期限切れ（区別不可、実装メモ128章）」。
 *   表にない記号が出た場合は、この対応表（CODE_ALIASES）にまだ載っていない
 *   codeがそのまま出ている（先頭8文字）ので、その文字列でGoTrue/PostgRESTの
 *   ドキュメントを検索すること。
 */
import type { ApiError } from "@/data/api";

const CODE_ALIASES: Record<string, string> = {
  otp_expired: "code",
  over_email_send_rate_limit: "mail",
  over_request_rate_limit: "rate",
  invalid_credentials: "cred",
  user_banned: "acct",
  otp_disabled: "off",
  AuthRetryableFetchError: "net",
  AuthUnknownError: "parse",
};

export function formatAuthFailureRef(error: ApiError): string {
  const status = error.status ?? "-";
  const code = error.code ? CODE_ALIASES[error.code] ?? error.code.slice(0, 8) : "-";
  return `${status}-${code}`;
}
