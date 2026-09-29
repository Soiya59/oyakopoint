/**
 * oneOffFinished.ts の検証スクリプト（実装メモ.md 330章、やること.md 4-58）。
 *
 *   node src/lib/oneOffFinished.verify.ts
 */
import { buildCompletedChoreIdSet, isOneOffFinishedFor } from "./oneOffFinished.ts";

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

const oneOff = { id: "chore-once", is_repeatable: false };
const other = { id: "chore-other", is_repeatable: false };
const repeatable = { id: "chore-daily", is_repeatable: true };

const totals = buildCompletedChoreIdSet([
  { chore_id: "chore-once", total_count: 1 },
  { chore_id: "chore-once", total_count: 2 }, // 同じクエストを複数人が実施した行
  { chore_id: "chore-daily", total_count: 30 },
  { chore_id: null, total_count: 5 }, // choreが物理削除された行は無視
  { chore_id: "chore-zero", total_count: 0 }, // 0件は完了扱いにしない
]);

assertEqual("集計から作った集合: 実施済みのchore_idを含む", totals.has("chore-once"), true);
assertEqual("集計から作った集合: nullのchore_idは入らない・重複は1つ（once, daily）", totals.size, 2);
assertEqual("集計から作った集合: total_count=0は入らない", totals.has("chore-zero"), false);

assertEqual("単発・集計に有り: 完了済み", isOneOffFinishedFor(oneOff, totals), true);
assertEqual("単発・集計に無し: 未完了", isOneOffFinishedFor(other, totals), false);
assertEqual("くり返すクエストは、実施済みでも完了扱いにしない", isOneOffFinishedFor(repeatable, totals), false);

// 1,000件超で端末側が古い記録を持てない状況（端末側の集合は空）でも、DB側の集計で判定できる
assertEqual("端末側が空でも、集計に有れば完了済み（1,000件超の再現）", isOneOffFinishedFor(oneOff, totals, new Set()), true);

// 端末側は「完了済みと見なす側」にだけ足す補助
const local = new Set(["chore-other"]);
assertEqual("完了報告の直後（集計は未更新・端末側に有り）: 完了済み", isOneOffFinishedFor(other, totals, local), true);
assertEqual(
  "集計の取得前・失敗時（集計が空）でも端末側に有れば完了済み",
  isOneOffFinishedFor(oneOff, new Set(), new Set(["chore-once"])),
  true
);
assertEqual("集計が空・端末側も無し: 未完了", isOneOffFinishedFor(oneOff, new Set(), new Set()), false);
assertEqual(
  "端末側に有ってもくり返すクエストは完了扱いにしない",
  isOneOffFinishedFor(repeatable, new Set(), new Set(["chore-daily"])),
  false
);

if (failed > 0) {
  console.log(`\n${failed}件失敗`);
  process.exitCode = 1;
} else {
  console.log("\n全件OK");
}
