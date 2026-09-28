/**
 * [2026-09-27新設・ワイヤーフレーム67章決定7順位3、開発部/成果物/実装メモ.md
 * 317章] supabase.functions.invoke()（src/data/api.tsのinvokeEdgeFunction）
 * 経由の失敗から、src/lib/authFailureRef.ts と同じ考え方（"{status}-{短い記号}"）
 * の識別子を作る。codeの体系がAUTH_ERRCODE・PG_ERRCODEのどちらとも異なる
 * （各Edge Functionが自分のjsonResponseで返す`error`文字列、または
 * invokeEdgeFunctionが通信断のときに付ける"network_error"）ため、専用の
 * 対応表をここに置く（ワイヤーフレーム67.4節申し送り5への対応）。
 *
 * 対象: src/data/api.tsのinviteLookup()（Edge Function `invite-lookup`）を
 * 呼ぶ画面のうち、大人向け（app/onboarding/join-family.tsx＝P5）のみ。
 * 子ども向け画面（C1 app/child-auth/invite-code.tsx、C2 profile-select.tsx、
 * C12 app/child/profile-switch.tsx）は同じinviteLookup()を呼ぶが、決定5・6
 * により識別子を出さない。familyInviteLookup・acceptFamilyInviteは
 * supabase.rpc()（PostgREST）のためsrc/lib/pgFailureRef.tsを使う（同ファイルの
 * 注記参照）。
 *
 * 判定根拠（src/data/api.tsのinvokeEdgeFunction実装を確認）:
 * - fetch自体が失敗し、レスポンスを受け取れなかった場合（FunctionsHttpError
 *   以外）: `code: "network_error"`、`status`は付かない（真の通信断の疑い、
 *   AuthRetryableFetchErrorのstatus===0と同じ意味）。
 * - HTTPレスポンスは返ったが非2xxの場合（FunctionsHttpError）: `status`に
 *   実際のHTTPステータス、`code`はレスポンス本文のJSONの`error`文字列
 *   （例: invite-lookupの"invite_code_not_found"・"invalid_json"・
 *   "internal_error"）。本文がJSONとして読めなかった場合は
 *   `code: "edge_function_error"`。
 *
 * 読み方（本部長がスクリーンショットから引く用）:
 *   "{status}-{記号}" の形。例:
 *   - "--net": statusが無い＝fetch自体が失敗＝真の通信断の疑い
 *   - "500-srv" / "502-srv": Edge Function側のサーバーエラー
 *     （internal_error・パース不能でedge_function_errorに落ちた場合）
 *   - "404-nf": 招待コードが見つからない（invite_code_not_found）
 *   - "400-req": リクエストの形が不正（invalid_json・invite_code_required等、
 *     通常は到達しない想定の防御的分類）
 *   表に無いcodeが出た場合は、先頭8文字がそのままcodeとして出ているので、
 *   その文字列でsupabase/functions配下の該当関数（jsonResponse呼び出し箇所）
 *   を検索すれば特定できる。
 */
import type { ApiError } from "@/data/api";

const CODE_ALIASES: Record<string, string> = {
  network_error: "net",
  edge_function_error: "srv",
  internal_error: "srv",
  invalid_json: "req",
  invite_code_required: "req",
  method_not_allowed: "req",
  invite_code_not_found: "nf",
};

export function formatEdgeFailureRef(error: ApiError): string {
  const status = error.status ?? "-";
  const code = error.code ? CODE_ALIASES[error.code] ?? error.code.slice(0, 8) : "-";
  return `${status}-${code}`;
}
