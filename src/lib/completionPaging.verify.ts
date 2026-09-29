/**
 * completionPaging.ts の検証スクリプト（実装メモ.md 330章、やること.md 4-58）。
 *
 *   node src/lib/completionPaging.verify.ts
 *
 * Node.js 22（`--experimental-strip-types`が既定で有効）ならビルド不要で実行できる。
 * 1件でも失敗すれば非ゼロの終了コードで終わる。
 */
import {
  COMPLETIONS_MAX_PAGES,
  COMPLETIONS_PAGE_SIZE,
  mergeCompletionPages,
  planRemainingPages,
  resolvePageSize,
} from "./completionPaging.ts";

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

const P = COMPLETIONS_PAGE_SIZE;
const M = COMPLETIONS_MAX_PAGES;

// 定数（設計部58.6章・決定58-6）
assertEqual("1ページ=1,000件", P, 1000);
assertEqual("上限=20ページ", M, 20);

// --- planRemainingPages: 何ページに分けるか ---
assertEqual("0件: 追加ページなし・全体0ページ", planRemainingPages(0, P, M), { ranges: [], totalPages: 0, truncated: false });
assertEqual("1件: 追加ページなし", planRemainingPages(1, P, M), { ranges: [], totalPages: 1, truncated: false });
assertEqual("999件: 追加ページなし", planRemainingPages(999, P, M), { ranges: [], totalPages: 1, truncated: false });
assertEqual("ちょうど1,000件: 追加ページなし", planRemainingPages(1000, P, M), { ranges: [], totalPages: 1, truncated: false });
assertEqual("1,001件: 2ページ目(1000-1999)を追加", planRemainingPages(1001, P, M), {
  ranges: [{ from: 1000, to: 1999 }],
  totalPages: 2,
  truncated: false,
});
assertEqual("2,000件: 2ページ", planRemainingPages(2000, P, M).totalPages, 2);
assertEqual("2,001件: 3ページ", planRemainingPages(2001, P, M).totalPages, 3);
assertEqual("2,500件: 追加は2ページ目・3ページ目", planRemainingPages(2500, P, M).ranges, [
  { from: 1000, to: 1999 },
  { from: 2000, to: 2999 },
]);
{
  const plan = planRemainingPages(20000, P, M);
  assertEqual("ちょうど2万件: 20ページ・打ち切りなし", [plan.totalPages, plan.ranges.length, plan.truncated], [20, 19, false]);
  assertEqual("ちょうど2万件: 最後の範囲は19000-19999", plan.ranges[plan.ranges.length - 1], { from: 19000, to: 19999 });
}
{
  const plan = planRemainingPages(20001, P, M);
  assertEqual("2万1件: 20ページで打ち切り・truncated", [plan.totalPages, plan.ranges.length, plan.truncated], [20, 19, true]);
  assertEqual("2万1件: 最後の範囲は19000-19999（新しい側の2万件だけ）", plan.ranges[plan.ranges.length - 1], {
    from: 19000,
    to: 19999,
  });
}
assertEqual("100万件でも20ページで頭打ち", planRemainingPages(1_000_000, P, M).totalPages, 20);
assertEqual(
  "範囲に穴・重なりが無い（3,500件）",
  (() => {
    const { ranges } = planRemainingPages(3500, P, M);
    const all = [{ from: 0, to: P - 1 }, ...ranges];
    return all.every((r, i) => (i === 0 ? r.from === 0 : r.from === all[i - 1].to + 1));
  })(),
  true
);
assertEqual("不正な値（総件数NaN）は追加ページなし", planRemainingPages(Number.NaN, P, M).ranges, []);

// --- resolvePageSize: サーバー側max_rowsが小さい場合の保険 ---
assertEqual("通常: 1,000件返ればそのまま1,000", resolvePageSize(1000, 1000, 3000), 1000);
assertEqual("全件が1ページに収まる: 要求のまま", resolvePageSize(1000, 300, 300), 1000);
assertEqual("サーバーが500件で切った: 500をページ幅にする", resolvePageSize(1000, 500, 3000), 500);
assertEqual("0件: 要求のまま", resolvePageSize(1000, 0, 0), 1000);
{
  // max_rowsが500のサーバーで3,000件: 500ページ幅で6ページ（20ページ上限内）に分ければ全件が取れる
  const size = resolvePageSize(1000, 500, 3000);
  const plan = planRemainingPages(3000, size, M);
  assertEqual("max_rows=500・3,000件: 6ページ", plan.totalPages, 6);
  assertEqual("max_rows=500・3,000件: 最後の範囲は2500-2999", plan.ranges[plan.ranges.length - 1], { from: 2500, to: 2999 });
}

// --- mergeCompletionPages: 結合と重複除去 ---
const row = (id: string) => ({ id });
assertEqual(
  "順序を保って結合する",
  mergeCompletionPages([[row("a"), row("b")], [row("c")], [row("d")]]).map((r) => r.id),
  ["a", "b", "c", "d"]
);
assertEqual(
  "ページ境目の重複（新しい報告が入ってずれた）は1件にする",
  mergeCompletionPages([[row("a"), row("b")], [row("b"), row("c")]]).map((r) => r.id),
  ["a", "b", "c"]
);
assertEqual(
  "空のページが混ざっても壊れない",
  mergeCompletionPages([[row("a")], [], [row("b")]]).map((r) => r.id),
  ["a", "b"]
);
assertEqual("入力が空", mergeCompletionPages([]), []);
// 日別集計（activity_date と member_id の組が行の識別子）
const drow = (d: string, m: string) => ({ activity_date: d, member_id: m });
assertEqual(
  "キー指定（日別集計）: 境目の重複を除く",
  mergeCompletionPages(
    [[drow("2026-09-29", "a"), drow("2026-09-29", "b")], [drow("2026-09-29", "b"), drow("2026-09-28", "a")]],
    (r) => `${r.activity_date}:${r.member_id}`
  ).length,
  3
);
assertEqual(
  "キー指定（日別集計）: 同じ日でもメンバーが違えば別の行",
  mergeCompletionPages([[drow("2026-09-29", "a")], [drow("2026-09-29", "b")]], (r) => `${r.activity_date}:${r.member_id}`).length,
  2
);
// 日別集計の想定規模: 7人×400日=2,800行 → 3ページ、1,000行以内なら1リクエスト
assertEqual("日別集計 2,800行: 3ページ", planRemainingPages(2800, P, M).totalPages, 3);
assertEqual("日別集計 1,602行(実測): 2ページ・追加1リクエスト", planRemainingPages(1602, P, M).ranges.length, 1);
assertEqual("日別集計 300行(短い窓・小さい家族): 追加リクエスト無し", planRemainingPages(300, P, M).ranges.length, 0);

// --- 1,000件超の家族を模した、擬似サーバーによる通し確認 ---
// 「max_rowsで先頭N件に切るサーバーが、総件数Nの家族に対して範囲指定つきで返す」動きを
// 純粋関数で再現し、計画どおりに取れば全件が新しい順に欠け・重複なくそろうことを確かめる。
function fakeServer(total: number, maxRows: number) {
  const all = Array.from({ length: total }, (_, i) => ({ id: `c${total - i}` })); // 新しい順（c{total}が最新）
  return (from: number, to: number) => all.slice(from, Math.min(to, from + maxRows - 1) + 1);
}
function fetchAll(total: number, maxRows: number) {
  const server = fakeServer(total, maxRows);
  const first = server(0, P - 1);
  const size = resolvePageSize(P, first.length, total);
  const plan = planRemainingPages(total, size, M);
  const rest = plan.ranges.map((r) => server(r.from, r.to));
  return mergeCompletionPages([first, ...rest]);
}
for (const n of [0, 268, 1000, 1001, 2999, 3000, 12345, 20000]) {
  const got = fetchAll(n, 1000);
  assertEqual(`擬似サーバー(max_rows=1000) ${n}件: 全件を新しい順に取得`, [got.length, got[0]?.id, got[got.length - 1]?.id], [
    n,
    n ? `c${n}` : undefined,
    n ? "c1" : undefined,
  ]);
}
{
  const got = fetchAll(25000, 1000);
  assertEqual("擬似サーバー 25,000件: 新しい側の2万件だけ（最新c25000〜c5001）", [got.length, got[0].id, got[got.length - 1].id], [
    20000,
    "c25000",
    "c5001",
  ]);
}
{
  const got = fetchAll(3000, 500);
  assertEqual("擬似サーバー(max_rows=500) 3,000件: 全件そろう", [got.length, new Set(got.map((r) => r.id)).size], [3000, 3000]);
}

if (failed > 0) {
  console.log(`\n${failed}件失敗`);
  process.exitCode = 1;
} else {
  console.log("\n全件OK");
}
