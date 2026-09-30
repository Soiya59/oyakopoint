/**
 * [2026-09-29新設・やること.md 4-40の残り、開発部/成果物/実装メモ.md 331章]
 * API呼び出し（PostgREST・RPC・Edge Function）の失敗を、画面で出す文言の種類に
 * 分ける「純粋関数」。ごほうび交換・ガチャ・クエスト/ごほうびの登録編集・お絵かき・
 * 掲示板など、これまで`res.error.message`（PostgRESTの生の文言）や固定の一文を
 * そのまま出していた画面が、原因の見当をつけられるよう共通で使う。
 *
 * 文言は`describeChoreReportFailure()`（src/data/api.ts、実装メモ230.3章）・
 * ログインの画面（317章）と同じ言い回しに揃える。分け方:
 * - offline: fetch自体が失敗した（postgrest-jsは`status: 0`・`code: ""`を返す。
 *   Edge Functionは`invokeEdgeFunction`が`code: "network_error"`を付ける）。
 * - login  : HTTP 401、またはPostgRESTのJWT関連コード（PGRST30x）。
 * - busy   : HTTP 500番台（ゲートウェイ・サーバー側の異常）。
 * - detail : DB側が利用者向けに書いた日本語のRAISE EXCEPTION（例: 上限超過）。
 *            これまでも`res.error.message`をそのまま出していたため、意味を変えず
 *            そのまま出す。Edge Function経路（source==="edge"）では使わない
 *            （Edge Functionの日本語の既定文言は利用者向けの説明ではないため）。
 * - denied : 42501（RLS拒否）またはHTTP 403。
 * - other  : 上のどれでもない。呼び出し側が渡す`fallback`（既存の一文）を出す。
 *
 * [制約] `*.verify.ts`からNode単体で読み込めるよう、値のimportを一切持たない
 * （src/lib/pgFailureRef.tsと同じ理由）。総称の文言（GENERIC_ERROR_MESSAGE等）は
 * 呼び出し側（src/lib/apiFailureDisplay.ts）が`fallback`として渡す。
 */
import type { ApiError } from "@/data/api";

export type FailureTone = "parent" | "child" | "supporter";
export type FailureSource = "pg" | "edge";
export type ApiFailureKind = "offline" | "login" | "busy" | "detail" | "denied" | "other";

// ログインの画面（src/components/EmailCodeVerifyForm.tsx）・感謝ポイント・取消と同じ言い回し（実装メモ317章）。
export const MSG_OFFLINE = "電波の状態が悪いようです。電波の良い場所で、もう一度お試しください。";
export const MSG_SERVER_BUSY = "ただいま混み合っているようです。少し時間をおいてから、もう一度お試しください。";
// 完了報告の失敗（describeChoreReportFailure、実装メモ230.3章）と同じ言い回し。
export const MSG_LOGIN_LOST =
  "ログインの状態を確認できませんでした。お手数ですが、アプリを一度終了して開き直してから、もう一度お試しください。";
export const MSG_DENIED =
  "この操作を行う権限を確認できませんでした。お手数ですが、アプリを一度終了して開き直し、もう一度お試しください。";

/** ひらがな・カタカナ・漢字を1文字でも含むか（DB側が日本語で書いたメッセージの判定）。 */
const JAPANESE = /[぀-ヿ㐀-鿿]/;

export function classifyApiFailure(error: ApiError, source: FailureSource = "pg"): ApiFailureKind {
  const status = error.status;
  const code = error.code;
  if (status === 0 || code === "network_error" || (status === undefined && code === "")) return "offline";
  if (status === 401 || (typeof code === "string" && code.startsWith("PGRST30"))) return "login";
  const isDbJapaneseMessage =
    source === "pg" &&
    code !== "" &&
    code !== "unknown_error" &&
    typeof error.message === "string" &&
    JAPANESE.test(error.message);
  // [2026-09-29・本部長レビュー、実装メモ331章] PostgRESTはSQLSTATEのP0系（P0001を除く。
  // 例: RAISE ... USING ERRCODE='no_data_found'＝P0002「対象の完了報告が見つかりません」）を
  // HTTP 500で返す。busyより先に見ないと「混み合っている」と出てしまい、何度やり直しても
  // 成功しない操作を再試行させることになる。P0系でDBが日本語で書いたものはdetailにする。
  if (isDbJapaneseMessage && typeof code === "string" && code.startsWith("P0")) return "detail";
  if (typeof status === "number" && status >= 500) return "busy";
  if (isDbJapaneseMessage) return "detail";
  if (code === "42501" || status === 403) return "denied";
  return "other";
}

/**
 * 種類と役割から画面に出す文言を決める。子ども（tone === "child"）は、DB側の日本語
 * メッセージ（detail）以外はすべて`fallback`（子ども向けの一文）にする＝言葉は変えず、
 * 原因の違いは目印（apiFailureRef）だけで見分ける（本部長依頼2026-09-29）。
 *
 * `useDbMessage`を偽にすると、detailでもDB側のメッセージを出さず`fallback`にする
 * （これまでDB側のメッセージを一切出さず固定の一文だけを出していた画面が、
 * 「意味を変えない」ために使う。電波・混み合い等の書き分けは効く）。
 */
export function apiFailureMessage(
  kind: ApiFailureKind,
  tone: FailureTone,
  error: ApiError,
  fallback: string,
  useDbMessage: boolean = true
): string {
  if (kind === "detail") return useDbMessage ? error.message : fallback;
  return actionableFailureMessage(kind, tone) ?? fallback;
}

/**
 * 「行動が変わる失敗」（電波・混み合い・ログイン切れ・権限拒否）のときだけ返す文言。
 * 保護者・みまもりのみ。それ以外（子ども・原因を特定できない失敗・DB側の日本語）は
 * nullを返し、呼び出し側が持つ既存の文言のままにする。掲示板のように画面側が
 * 既に細かい場合分けの文言を持っているところで、上書きの判断だけに使う。
 */
export function actionableFailureMessage(kind: ApiFailureKind, tone: FailureTone): string | null {
  if (tone === "child") return null;
  switch (kind) {
    case "offline":
      return MSG_OFFLINE;
    case "busy":
      return MSG_SERVER_BUSY;
    case "login":
      return MSG_LOGIN_LOST;
    case "denied":
      return MSG_DENIED;
    default:
      return null;
  }
}

/**
 * [2026-09-30追加・やること.md 4-40の残り、実装メモ337章] 複数のAPI呼び出しの結果のうち、
 * 最初に失敗したものの`ApiError`を返す（全部成功ならnull）。画面を開いたときの読み込みが
 * 複数のAPIをまとめて呼ぶ（`!a.ok || !b.ok`）hookが、失敗の中身を捨てずに`failure`として
 * 返すために使う。値のimportを持たない（このファイルの制約と同じ）。
 */
export function firstApiFailure(...results: ReadonlyArray<{ ok: boolean; error?: ApiError }>): ApiError | null {
  for (const r of results) {
    if (!r.ok && r.error) return r.error;
  }
  return null;
}

/**
 * [2026-09-30追加・実装メモ337章] 画面を開いたときの読み込み失敗（`ErrorState`）に添える
 * 「大人向けの書き分けの文」を決める。331章の書き分け（電波・混み合い・ログイン切れ・権限）
 * と同じ文言で、子ども（tone === "child"）・原因を特定できない失敗・DB側の日本語メッセージは
 * nullを返す＝画面が持つ既存のタイトルだけを出す（言葉は変えず、原因の違いは目印だけで見分ける）。
 * 読み込みの失敗ではDB側の日本語メッセージ（上限超過など）は出さない（もともと固定の一文だった）。
 * 判定は`classifyApiFailure`の今の順番のまま使う（P0系のDB日本語は「混み合い」にしない、331.10節）。
 */
export function loadFailureDetailMessage(tone: FailureTone, error: ApiError, source: FailureSource = "pg"): string | null {
  return actionableFailureMessage(classifyApiFailure(error, source), tone);
}
