/**
 * [2026-09-27新設・ワイヤーフレーム67章、実装メモ317章] ログイン用の6けたの数字を
 * メールで送る処理（signInWithEmail）が失敗したときの、利用者向けの文言。
 *
 * 以前は、呼び出し側（app/onboarding/email.tsx・app/onboarding/join-supporter.tsx）が
 * res.error.message（GoTrueの英語の生の文言）をそのまま出していた。ログインの数字を
 * 入れる画面（EmailCodeVerifyForm.tsx、実装メモ262章）と同じ考え方で、利用者の
 * 行動が変わるものだけ文言を分け、ほかはやさしい1文にまとめる。
 * 原因を追うための目印は、呼び出し側で formatAuthFailureRef（src/lib/authFailureRef.ts）を
 * 使って小さく添える。
 */
import { AUTH_ERRCODE, type ApiError } from "@/data/api";
import { GENERIC_ERROR_MESSAGE } from "@/lib/errorMessages";

export const SEND_MSG_RATE_LIMIT = "メールの送信回数が上限に達しました。しばらく時間をおいてからもう一度お試しください。";
export const SEND_MSG_INVALID_EMAIL = "メールアドレスの形を確かめてください。";
export const SEND_MSG_OFFLINE = "電波の状態が悪いようです。電波の良い場所で、もう一度お試しください。";
export const SEND_MSG_SERVER_BUSY = "ただいま混み合っているようです。少し時間をおいてから、もう一度お試しください。";

export function authSendErrorText(e: ApiError): string {
  if (e.status === 429 || e.code === AUTH_ERRCODE.overEmailSendRateLimit || e.code === AUTH_ERRCODE.overRequestRateLimit) {
    return SEND_MSG_RATE_LIMIT;
  }
  if (e.code === "email_address_invalid" || e.code === "validation_failed") return SEND_MSG_INVALID_EMAIL;
  if (e.code === AUTH_ERRCODE.retryableFetch && e.status === 0) return SEND_MSG_OFFLINE;
  if (e.code === AUTH_ERRCODE.retryableFetch) return SEND_MSG_SERVER_BUSY;
  return GENERIC_ERROR_MESSAGE;
}
