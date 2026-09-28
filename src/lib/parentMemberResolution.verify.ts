/**
 * parentMemberResolution.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md 322章。
 *
 * src/lib/pgFailureRef.verify.ts の前例に倣い「Node で直接実行する検証
 * スクリプト」として書いた。Node.js 22（`--experimental-strip-types`が
 * 既定で有効）であればビルド不要でそのまま実行できる:
 *
 *   node src/lib/parentMemberResolution.verify.ts
 *
 * 対象本体（parentMemberResolution.ts）は値のimportを一切持たない
 * （`@/...`パスエイリアスも使っていない）ため、Node単体でそのまま読み込める。
 * tsconfig.jsonのexclude（`.verify.ts`）によりtscの型チェック対象からも外れる。
 */
import { resolveParentMemberFetch } from "./parentMemberResolution.ts";

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

// ---- 1. 問い合わせ成功・1件ヒット（hasHeldStateの値に関わらず"found"） ----
{
  assertEqual('found × hasHeldState=false → "found"', resolveParentMemberFetch("found", false), "found");
  assertEqual('found × hasHeldState=true → "found"', resolveParentMemberFetch("found", true), "found");
}

// ---- 2. 問い合わせ成功・0件（本当に家族なし。hasHeldStateの値に関わらず"notFound"） ----
{
  assertEqual('notFound × hasHeldState=false → "notFound"', resolveParentMemberFetch("notFound", false), "notFound");
  assertEqual('notFound × hasHeldState=true → "notFound"', resolveParentMemberFetch("notFound", true), "notFound");
}

// ---- 3. エラー × 手元に同じ利用者の家族情報が既にある → 現状維持（"keep"） ----
// [本題] トークン自動更新直後の一過性エラーでも、既にparent/supporterとして
// 確定していた利用者を「家族なし」に落としてはいけない。
{
  assertEqual('error × hasHeldState=true → "keep"（家族なしに落とさない）', resolveParentMemberFetch("error", true), "keep");
}

// ---- 4. エラー × 手元に何もない（起動直後等） → 再試行画面（"unreachable"） ----
{
  assertEqual(
    'error × hasHeldState=false → "unreachable"（再試行画面。家族作成/削除の導線は出さない）',
    resolveParentMemberFetch("error", false),
    "unreachable"
  );
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
