/**
 * edgeFailureRef.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md 317章、UIUXデザイン部/成果物/
 * 主要画面ワイヤーフレーム.md 67章。
 *
 * src/lib/appVersionInfo.verify.ts の前例に倣い「Node で直接実行する検証
 * スクリプト」として書いた。Node.js 22（`--experimental-strip-types`が
 * 既定で有効）であればビルド不要でそのまま実行できる:
 *
 *   node src/lib/edgeFailureRef.verify.ts
 *
 * 対象本体（edgeFailureRef.ts）は`import type`のみ（実行時に消える）を使い、
 * 値のimportを持たないため、パスエイリアス（"@/..."）の解決なしにNode単体
 * で読み込める。tsconfig.jsonのexclude（`.verify.ts`）によりtscの型チェック
 * 対象からも外れる。
 */
import { formatEdgeFailureRef } from "./edgeFailureRef.ts";

/** src/data/api.ts の ApiError と同じ形（このファイルだけで完結させるため複製）。 */
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

// ---- 1. 真の通信断（invokeEdgeFunctionのcatch末尾、statusなし） ----
{
  const error: ApiError = { code: "network_error", message: "通信できませんでした" };
  assertEqual("network_error（statusなし）→ '--net'", formatEdgeFailureRef(error), "--net");
}

// ---- 2. 招待コードが見つからない（invite-lookup、404） ----
{
  const error: ApiError = { code: "invite_code_not_found", message: "invite_code_not_found", status: 404 };
  assertEqual("invite_code_not_found → '404-nf'", formatEdgeFailureRef(error), "404-nf");
}

// ---- 3. サーバー側の異常（本文がJSONとして読めなかった場合、edge_function_error） ----
{
  const error: ApiError = { code: "edge_function_error", message: "サーバーでエラーが発生しました", status: 500 };
  assertEqual("edge_function_error＋500 → '500-srv'", formatEdgeFailureRef(error), "500-srv");
}

// ---- 4. Edge Function自身が返すinternal_error ----
{
  const error: ApiError = { code: "internal_error", message: "internal_error", status: 500 };
  assertEqual("internal_error＋500 → '500-srv'", formatEdgeFailureRef(error), "500-srv");
}

// ---- 5. 未知のcode（表に無い） ----
{
  const error: ApiError = { code: "some_unknown_reason_code", message: "…", status: 400 };
  assertEqual("未知のcode → 先頭8文字をそのまま使う", formatEdgeFailureRef(error), "400-some_unk");
}

// ---- 6. codeが空文字（statusのみ） ----
{
  const error: ApiError = { code: "", message: "", status: 429 };
  assertEqual("codeが空文字 → '{status}--'（記号なし）", formatEdgeFailureRef(error), "429--");
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
