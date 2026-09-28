/**
 * pgFailureRef.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md 317章、UIUXデザイン部/成果物/
 * 主要画面ワイヤーフレーム.md 67章。
 *
 * src/lib/appVersionInfo.verify.ts の前例に倣い「Node で直接実行する検証
 * スクリプト」として書いた。Node.js 22（`--experimental-strip-types`が
 * 既定で有効）であればビルド不要でそのまま実行できる:
 *
 *   node src/lib/pgFailureRef.verify.ts
 *
 * 対象本体（pgFailureRef.ts）は`import type`のみ（実行時に消える）を使い、
 * 値のimportを持たないため、パスエイリアス（"@/..."）の解決なしにNode単体
 * で読み込める。tsconfig.jsonのexclude（`.verify.ts`）によりtscの型チェック
 * 対象からも外れる。
 */
import { formatPgFailureRef } from "./pgFailureRef.ts";

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

// ---- 1. 真の通信断（status===0、fetch自体が失敗。codeは空文字） ----
{
  const error: ApiError = { code: "", message: "network error", status: 0 };
  assertEqual("status===0 → '0-net'", formatPgFailureRef(error), "0-net");
}

// ---- 2. RLS拒否（42501） ----
{
  const error: ApiError = { code: "42501", message: "new row violates row-level security policy", status: 403 };
  assertEqual("42501 → '403-rls'", formatPgFailureRef(error), "403-rls");
}

// ---- 3. check_violation（1日の上限等、23514） ----
{
  const error: ApiError = { code: "23514", message: "…上限を超えています", status: 400 };
  assertEqual("23514 → '400-limit'", formatPgFailureRef(error), "400-limit");
}

// ---- 4. foreign_key_violation（23503） ----
{
  const error: ApiError = { code: "23503", message: "insert or update violates foreign key", status: 409 };
  assertEqual("23503 → '409-fk'", formatPgFailureRef(error), "409-fk");
}

// ---- 5. unique_violation（23505） ----
{
  const error: ApiError = { code: "23505", message: "duplicate key value", status: 409 };
  assertEqual("23505 → '409-dup'", formatPgFailureRef(error), "409-dup");
}

// ---- 6. RPCが返すP0002（見つからない） ----
{
  const error: ApiError = { code: "P0002", message: "招待が見つかりません", status: 404 };
  assertEqual("P0002 → '404-notfound'", formatPgFailureRef(error), "404-notfound");
}

// ---- 7. familyInviteLookup()が0件時に自前で付ける独自code（no_data_found、statusなし） ----
{
  const error: ApiError = { code: "no_data_found", message: "招待が見つかりません" };
  assertEqual("no_data_found（statusなし）→ '--notfound'", formatPgFailureRef(error), "--notfound");
}

// ---- 8. サーバー側のゲートウェイ異常（未知のcode、5xx） ----
{
  const error: ApiError = { code: "XX000", message: "internal error", status: 503 };
  assertEqual("未知のcode＋503 → 先頭8文字をそのまま使う", formatPgFailureRef(error), "503-XX000");
}

// ---- 9. codeが無い（statusのみ） ----
{
  const error: ApiError = { code: "", message: "", status: 500 };
  assertEqual("codeが空文字（status===0以外）→ '{status}-net'", formatPgFailureRef(error), "500-net");
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
