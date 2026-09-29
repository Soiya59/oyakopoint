/**
 * [2026-09-27新設・ワイヤーフレーム67章決定7順位2/3、開発部/成果物/実装メモ.md
 * 317章] PostgREST・RPC呼び出しの失敗から、src/lib/authFailureRef.ts と同じ
 * 考え方（"{status}-{短い記号}"）の識別子を作る。AUTH_ERRCODE（GoTrueの
 * error_code）とPG_ERRCODE（PostgresのSQLSTATE）は別の体系のため、
 * authFailureRef.tsのformatAuthFailureRefをそのまま使い回さず、ここに新設
 * した（ワイヤーフレーム67.4節申し送り4への対応）。
 *
 * 対象: src/lib/gratitudeSendError.ts（感謝ポイント送信、tone!=="child"の
 * 分岐のみ）、app/onboarding/join-supporter.tsx（familyInviteLookup・
 * acceptFamilyInvite。いずれもsupabase.rpc()経由でsrc/data/api.tsの
 * fromPostgrestErrorを通るため、codeの形はPG_ERRCODEと同じSQLSTATE）。
 *
 * [注記] やること.md・実装メモ262.11節・ワイヤーフレーム67.3節はfamilyInviteLookup・
 * acceptFamilyInviteを「招待関連のEdge Function呼び出し」と一括りに書いているが、
 * 実装（src/data/api.ts）を確認すると、この2つはsupabase.rpc()（PostgREST）を
 * 直接呼んでおり、supabase.functions.invoke()を経由する真のEdge Functionは
 * inviteLookupのみ（そちらはsrc/lib/edgeFailureRef.tsを使う）。識別子は実際の
 * 失敗の形（PostgrestError vs invoke()のFunctionsHttpError）に合わせて
 * ファイルを分けた。
 *
 * 読み方（本部長がスクリーンショットから引く用）:
 *   "{status}-{記号}" の形。例:
 *   - "--net" / "0-net": statusが無い、またはfetch自体が失敗＝真の通信断の疑い
 *     （AuthRetryableFetchErrorのstatus===0と同じ意味）
 *   - "42501-rls": RLSポリシーによる拒否
 *   - "23514-limit": check_violation（1日の上限超過等）
 *   - "23503-fk": foreign_key_violation（送信者・受取人・招待の不整合）
 *   - "23505-dup": unique_violation（重複）
 *   - "P0002-notfound" / "--notfound": 招待コード等が見つからない
 *     （RPCがP0002を返す場合と、呼び出し元が0件を自前でcode: "no_data_found"に
 *     している場合の両方をこの記号にまとめる）
 *   表に無いcodeが出た場合は、先頭8文字がそのままcodeとして出ているので、
 *   その文字列でsrc/data/api.tsのPG_ERRCODE・該当マイグレーションのRAISE
 *   EXCEPTIONを検索すれば特定できる。
 *
 * [実装メモ] `PG_ERRCODE`（src/data/api.ts）の値を直接importせず、下表に
 * リテラルのSQLSTATEを書き写している。src/lib/authFailureRef.tsが
 * `AUTH_ERRCODE`をimportせず文字列を直書きしているのと同じ理由（api.tsは
 * `@/lib/supabase`のクライアント初期化を連鎖的にimportするため、Node単体で
 * 動かす`*.verify.ts`から素直に読み込めない）。`type ApiError`のみ
 * `import type`で取り込む（型のみのimportは実行時に消えるため、Nodeの
 * 型ストリップでも問題にならない）。値がずれた場合はsrc/data/api.tsの
 * PG_ERRCODEと本ファイルを両方直すこと。
 */
import type { ApiError } from "@/data/api";

const CODE_ALIASES: Record<string, string> = {
  "23514": "limit", // PG_ERRCODE.checkViolation
  "23503": "fk", // PG_ERRCODE.foreignKeyViolation
  "23505": "dup", // PG_ERRCODE.uniqueViolation
  "42501": "rls", // PG_ERRCODE.insufficientPrivilege
  P0002: "notfound", // PG_ERRCODE.noDataFound
  // familyInviteLookup()が0件時に自前で付ける独自code（P0002とは別表記だが同じ意味）
  no_data_found: "notfound",
  // fromPostgrestErrorがcodeの無いエラー（HTML等のJSONでない本文を返したゲートウェイ異常）に付ける既定値
  unknown_error: "unk",
};

export function formatPgFailureRef(error: ApiError): string {
  const status = error.status ?? "-";
  const code = !error.code ? "net" : CODE_ALIASES[error.code] ?? error.code.slice(0, 8);
  return `${status}-${code}`;
}
