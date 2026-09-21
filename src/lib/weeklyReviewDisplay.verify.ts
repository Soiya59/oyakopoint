/**
 * weeklyReviewDisplay.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md（「振り返る機会」章）。
 *
 * src/lib/groupDuplicateRows.verify.ts と同じく、Node で直接実行する
 * 検証スクリプトとして書いた:
 *
 *   node src/lib/weeklyReviewDisplay.verify.ts
 *
 * 実行するとテストケースごとにOK/NGを表示し、1件でも失敗すれば非ゼロの終了
 * コードで終わる（`process.exitCode`）。対象本体（weeklyReviewDisplay.ts）は
 * 相対importのみ・パスエイリアス非依存にしてある。
 */
import {
  findSeasonForWeek,
  hasAtLeastOneConfirmedPastWeek,
  stageIndexForCount,
  sumCompletionCountsThroughWeek,
  summarizeWeeklyChoreCounts,
} from "./weeklyReviewDisplay.ts";

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

// ---- summarizeWeeklyChoreCounts ----
{
  const rows = [
    { chore_id: "hamigaki", completion_count: 12 },
    { chore_id: "okataduke", completion_count: 9 },
    { chore_id: "yomikikase", completion_count: 8 },
    { chore_id: "asagohan", completion_count: 5 },
    { chore_id: "sanpo", completion_count: 3 },
    { chore_id: "sentaku", completion_count: 2 },
    { chore_id: "osoji", completion_count: 1 },
  ];
  const { top, otherCount, otherTotal } = summarizeWeeklyChoreCounts(rows);
  assertEqual("上位5件が多い順に並ぶ", top.map((e) => e.choreId), ["hamigaki", "okataduke", "yomikikase", "asagohan", "sanpo"]);
  assertEqual("6件目以降はほか2件", otherCount, 2);
  assertEqual("ほかの合計は2+1=3", otherTotal, 3);
}
{
  const { top, otherCount, otherTotal } = summarizeWeeklyChoreCounts([]);
  assertEqual("0件のときtopは空配列", top, []);
  assertEqual("0件のときotherCountは0", otherCount, 0);
  assertEqual("0件のときotherTotalは0", otherTotal, 0);
}

// ---- stageIndexForCount（DB family_tree_stage_for_count()・theme.tsの複製が一致すること） ----
{
  assertEqual("0件→種(0)", stageIndexForCount(0), 0);
  assertEqual("9件→種(0、10未満)", stageIndexForCount(9), 0);
  assertEqual("10件→芽(1)", stageIndexForCount(10), 1);
  assertEqual("29件→芽(1)", stageIndexForCount(29), 1);
  assertEqual("30件→若木(2)", stageIndexForCount(30), 2);
  assertEqual("59件→若木(2)", stageIndexForCount(59), 2);
  assertEqual("60件→花(3)", stageIndexForCount(60), 3);
  assertEqual("99件→花(3)", stageIndexForCount(99), 3);
  assertEqual("100件→実(4)", stageIndexForCount(100), 4);
  assertEqual("999件→実(4、上限で頭打ち)", stageIndexForCount(999), 4);
}

// ---- sumCompletionCountsThroughWeek ----
{
  const rows = [
    { week_start: "2026-09-07", completion_count: 5 },
    { week_start: "2026-09-14", completion_count: 20 },
    { week_start: "2026-09-21", completion_count: 100 }, // 先週より後の週（まだ進行中）は含めない
  ];
  assertEqual(
    "先週(2026-09-14)までの累積は5+20=25（進行中の週2026-09-21は含めない）",
    sumCompletionCountsThroughWeek(rows, "2026-09-14"),
    25
  );
  assertEqual("先週より前の1週目だけなら5", sumCompletionCountsThroughWeek(rows, "2026-09-07"), 5);
  assertEqual("対象週の行が無ければ0", sumCompletionCountsThroughWeek(rows, "2026-08-01"), 0);
}

// ---- findSeasonForWeek ----
{
  const seasons = [
    { id: "sep", season_start: "2026-09-01", season_end: null },
    { id: "aug", season_start: "2026-08-01", season_end: "2026-09-01" },
    { id: "jul", season_start: "2026-07-01", season_end: "2026-08-01" },
  ];
  assertEqual("進行中シーズン内の週はそのシーズンが見つかる", findSeasonForWeek(seasons, "2026-09-14")?.id, "sep");
  assertEqual("season_endちょうどの週は次のシーズン扱い（排他的上限）", findSeasonForWeek(seasons, "2026-09-01")?.id, "sep");
  assertEqual("閉じたシーズン内の週はそのシーズンが見つかる", findSeasonForWeek(seasons, "2026-08-15")?.id, "aug");
  assertEqual("どのシーズンにも属さない週はnull", findSeasonForWeek(seasons, "2026-01-01"), null);
}

// ---- hasAtLeastOneConfirmedPastWeek ----
{
  assertEqual("作成週=先週の開始週 → 確定した先週がある(true)", hasAtLeastOneConfirmedPastWeek("2026-09-07", "2026-09-07"), true);
  assertEqual("作成週が先週より後 → まだ確定した先週が無い(false)", hasAtLeastOneConfirmedPastWeek("2026-09-14", "2026-09-07"), false);
  assertEqual("作成週が先週より前 → 確定した先週がある(true)", hasAtLeastOneConfirmedPastWeek("2026-08-01", "2026-09-07"), true);
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
