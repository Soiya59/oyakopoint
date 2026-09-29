/**
 * apiFailure.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md 331章（やること.md 4-40の残り）。
 *
 *   node src/lib/apiFailure.verify.ts
 *
 * 対象本体（apiFailure.ts）は`import type`のみで、値のimportを持たないため
 * Node単体で読み込める（src/lib/pgFailureRef.verify.tsと同じ）。
 */
import {
  actionableFailureMessage,
  MSG_DENIED,
  MSG_LOGIN_LOST,
  MSG_OFFLINE,
  MSG_SERVER_BUSY,
  apiFailureMessage,
  classifyApiFailure,
} from "./apiFailure.ts";

interface ApiError {
  code: string;
  message: string;
  status?: number;
}

let failed = 0;

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`OK   ${label}`);
  } else {
    failed += 1;
    console.log(`NG   ${label}`);
    console.log(`     期待値: ${JSON.stringify(expected)}`);
    console.log(`     実際値: ${JSON.stringify(actual)}`);
  }
}

const RAW_EN = "new row violates row-level security policy for table \"rewards\"";
const FALLBACK = "既存の一文";
const FALLBACK_CHILD = "とどきませんでした…";

// ---- 1. 種類の判定（PostgREST・RPC） ----
// postgrest-jsのfetch失敗: status 0・code ""・message "TypeError: Network request failed"
assertEqual("pg: 通信断(status 0) → offline", classifyApiFailure({ code: "", message: "TypeError: Network request failed", status: 0 }), "offline");
assertEqual("pg: statusが渡っていない通信断(code空) → offline", classifyApiFailure({ code: "", message: "TypeError: Network request failed" }), "offline");
assertEqual("pg: 401 → login", classifyApiFailure({ code: "PGRST301", message: "JWT expired", status: 401 }), "login");
assertEqual("pg: PGRST301だけ(statusなし) → login", classifyApiFailure({ code: "PGRST301", message: "JWT expired" }), "login");
assertEqual("pg: 502(HTML本文・codeなし) → busy", classifyApiFailure({ code: "unknown_error", message: "<html>Bad Gateway</html>", status: 502 }), "busy");
assertEqual("pg: P0002(no_data_found)は500でもDBの日本語なら detail", classifyApiFailure({ code: "P0002", message: "対象の完了報告が見つかりません", status: 500 }), "detail");
assertEqual("pg: P0002でも英語なら busy のまま", classifyApiFailure({ code: "P0002", message: "query returned no rows", status: 500 }), "busy");
assertEqual("pg: 500の内部エラー → busy",classifyApiFailure({ code: "XX000", message: "internal error", status: 500 }), "busy");
assertEqual("pg: RLS拒否(英語) → denied", classifyApiFailure({ code: "42501", message: RAW_EN, status: 403 }), "denied");
assertEqual("pg: 42501でstatus未指定 → denied", classifyApiFailure({ code: "42501", message: RAW_EN }), "denied");
assertEqual("pg: 42501だがDBが日本語で書いたメッセージ → detail", classifyApiFailure({ code: "42501", message: "この操作は保護者のみ行えます", status: 403 }), "detail");
assertEqual("pg: DBの日本語の上限超過(23514) → detail", classifyApiFailure({ code: "23514", message: "今日の上限（3回）に達しています", status: 400 }), "detail");
assertEqual("pg: 英語の制約違反 → other", classifyApiFailure({ code: "23505", message: "duplicate key value violates unique constraint", status: 409 }), "other");
assertEqual("pg: 日本語でもcodeが既定値unknown_errorなら detail にしない", classifyApiFailure({ code: "unknown_error", message: "通信エラーが発生しました。もう一度お試しください。", status: 400 }), "other");
assertEqual("pg: statusもcodeも無い既定エラー → other", classifyApiFailure({ code: "unknown_error", message: "x" }), "other");

// ---- 2. 種類の判定（Edge Function） ----
assertEqual("edge: network_error → offline", classifyApiFailure({ code: "network_error", message: "通信できませんでした" }, "edge"), "offline");
assertEqual("edge: 500 internal_error → busy", classifyApiFailure({ code: "internal_error", message: "internal_error", status: 500 }, "edge"), "busy");
assertEqual("edge: 日本語の既定文言でも detail にしない(403) → denied", classifyApiFailure({ code: "edge_function_error", message: "サーバーでエラーが発生しました", status: 403 }, "edge"), "denied");
assertEqual("edge: 日本語の既定文言(400) → other", classifyApiFailure({ code: "edge_function_error", message: "サーバーでエラーが発生しました", status: 400 }, "edge"), "other");
assertEqual("edge: 401 → login", classifyApiFailure({ code: "unauthorized", message: "unauthorized", status: 401 }, "edge"), "login");

// ---- 3. 文言（保護者・みまもり） ----
const enErr: ApiError = { code: "23505", message: "duplicate key", status: 409 };
assertEqual("adult offline", apiFailureMessage("offline", "parent", enErr, FALLBACK), MSG_OFFLINE);
assertEqual("adult busy", apiFailureMessage("busy", "supporter", enErr, FALLBACK), MSG_SERVER_BUSY);
assertEqual("adult login", apiFailureMessage("login", "parent", enErr, FALLBACK), MSG_LOGIN_LOST);
assertEqual("adult denied", apiFailureMessage("denied", "parent", enErr, FALLBACK), MSG_DENIED);
assertEqual("adult other は既存の一文", apiFailureMessage("other", "parent", enErr, FALLBACK), FALLBACK);
assertEqual("adult detail はDBの日本語をそのまま", apiFailureMessage("detail", "parent", { code: "23514", message: "上限です", status: 400 }, FALLBACK), "上限です");

// ---- 4. 文言（子ども。detail以外は言葉を変えない） ----
for (const kind of ["offline", "busy", "login", "denied", "other"] as const) {
  assertEqual(`child ${kind} は子ども向けの一文のまま`, apiFailureMessage(kind, "child", enErr, FALLBACK_CHILD), FALLBACK_CHILD);
}
assertEqual("child detail はDBの日本語をそのまま(従来どおり)", apiFailureMessage("detail", "child", { code: "23514", message: "きょうは おわり", status: 400 }, FALLBACK_CHILD), "きょうは おわり");

// ---- 4b. useDbMessage=false（従来DB側のメッセージを出さず固定の一文だけだった画面） ----
{
  const dbJa: ApiError = { code: "23514", message: "上限です", status: 400 };
  assertEqual("useDbMessage=false: detailでも固定の一文", apiFailureMessage("detail", "parent", dbJa, FALLBACK, false), FALLBACK);
  assertEqual("useDbMessage=false: offlineは電波の文言に入れ替わる", apiFailureMessage("offline", "parent", dbJa, FALLBACK, false), MSG_OFFLINE);
  assertEqual("useDbMessage=false: 子どもの他の種類は固定の一文", apiFailureMessage("busy", "child", dbJa, FALLBACK_CHILD, false), FALLBACK_CHILD);
}

// ---- 4c. actionableFailureMessage（掲示板のように画面側が文言を持つ場合の上書き判断） ----
assertEqual("actionable: 保護者 offline", actionableFailureMessage("offline", "parent"), MSG_OFFLINE);
assertEqual("actionable: みまもり busy", actionableFailureMessage("busy", "supporter"), MSG_SERVER_BUSY);
assertEqual("actionable: 保護者 login", actionableFailureMessage("login", "parent"), MSG_LOGIN_LOST);
assertEqual("actionable: 保護者 denied", actionableFailureMessage("denied", "parent"), MSG_DENIED);
assertEqual("actionable: 保護者 other は上書きしない(null)", actionableFailureMessage("other", "parent"), null);
assertEqual("actionable: 保護者 detail は上書きしない(null)", actionableFailureMessage("detail", "parent"), null);
assertEqual("actionable: 子どもは常に上書きしない(null)", actionableFailureMessage("offline", "child"), null);

// ---- 5. 生の英語・HTMLが利用者に出ない（保護者・みまもり） ----
{
  const cases: ApiError[] = [
    { code: "", message: "TypeError: Network request failed", status: 0 },
    { code: "unknown_error", message: "<html>Bad Gateway</html>", status: 502 },
    { code: "42501", message: RAW_EN, status: 403 },
    { code: "PGRST301", message: "JWT expired", status: 401 },
    { code: "23505", message: "duplicate key value", status: 409 },
  ];
  for (const e of cases) {
    const text = apiFailureMessage(classifyApiFailure(e), "parent", e, FALLBACK);
    assertEqual(`生の文言を出さない: ${e.status}-${e.code}`, text.includes(e.message), false);
  }
}

if (failed > 0) {
  console.log(`\n${failed} 件失敗`);
  process.exit(1);
}
console.log("\n全件OK");
