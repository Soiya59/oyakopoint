/**
 * drawingLineDataBytes.ts の検証スクリプト（塗った形の"f"キー分、実装メモ.md 313章）。
 * drawingShapes.verify.ts（309章）と同じ方針・同じ書き方（テストランナー未導入のため、
 * Node単体実行の検証スクリプト）。
 *
 *   node src/lib/drawingLineDataBytes.verify.ts
 *
 * このファイルは`.verify.ts`で終わるため`tsconfig.json`のexcludeでtsc型チェック対象外。
 * 型の妥当性は
 *   npx tsc --noEmit --allowImportingTsExtensions src/lib/drawingLineDataBytes.verify.ts
 * で個別に確認できる。
 */
import { estimateLineDataBytes, pgJsonbLineDataText } from "./drawingLineDataBytes.ts";
import type { FamilyDrawingLine } from "../types/domain.ts";

let failed = 0;

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`OK   ${label}`);
  } else {
    failed += 1;
    console.log(`NG   ${label}`);
    console.log(`     期待値: ${e}`);
    console.log(`     実際値: ${a}`);
  }
}

// ---- 1. fが無い線（従来どおり）は今までどおりの直列化のまま ----
{
  const line: FamilyDrawingLine = { c: "#FFFFFF", p: [0, 0, 1, 1], w: 2 };
  assertEqual(
    "fが無い線: 今までどおり{c, p, w}のみ",
    pgJsonbLineDataText([line]),
    '{"v": 1, "lines": [{"c": "#FFFFFF", "p": [0, 0, 1, 1], "w": 2}]}'
  );
}

// ---- 2. f: trueの線は末尾に"f": trueが足される ----
{
  const line: FamilyDrawingLine = { c: "#FFFFFF", p: [0, 0, 1, 1], w: 2, f: true };
  assertEqual(
    "f: trueの線: 末尾に\"f\": trueが足される",
    pgJsonbLineDataText([line]),
    '{"v": 1, "lines": [{"c": "#FFFFFF", "p": [0, 0, 1, 1], "w": 2, "f": true}]}'
  );
}

// ---- 3. f: false（保存時には作られない想定だが、防御的に）は無視される ----
{
  const line: FamilyDrawingLine = { c: "#FFFFFF", p: [0, 0, 1, 1], w: 2, f: false };
  assertEqual(
    "f: falseの線: fが無い場合と同じ直列化になる（書き込まない）",
    pgJsonbLineDataText([line]),
    '{"v": 1, "lines": [{"c": "#FFFFFF", "p": [0, 0, 1, 1], "w": 2}]}'
  );
}

// ---- 4. wが無くfだけある線（旧太さ未設定＋新しい塗りは想定しないが、キーの独立性を確認） ----
{
  const line: FamilyDrawingLine = { c: "#2E2E2E", p: [10, 10, 20, 20], f: true };
  assertEqual(
    "wが無くfだけある線: wを飛ばしてfだけ足される",
    pgJsonbLineDataText([line]),
    '{"v": 1, "lines": [{"c": "#2E2E2E", "p": [10, 10, 20, 20], "f": true}]}'
  );
}

// ---- 5. estimateLineDataBytesの増分は、", \"f\": true"のバイト数ぶんちょうど ----
{
  const withoutF: FamilyDrawingLine = { c: "#8B4513", p: [0, 0, 1000, 1000], w: 4 };
  const withF: FamilyDrawingLine = { ...withoutF, f: true };
  const diff = estimateLineDataBytes([withF]) - estimateLineDataBytes([withoutF]);
  const expectedDiff = new TextEncoder().encode(', "f": true').length;
  assertEqual("f付与によるバイト数の増分は', \"f\": true'のバイト数と一致する", diff, expectedDiff);
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
