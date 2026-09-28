/**
 * weeklyReviewPopupLogic.ts の検証スクリプト（`node
 * src/lib/weeklyReviewPopupLogic.verify.ts`、weeklyReviewDisplay.verify.tsと
 * 同じ流儀）。参照: 開発部/成果物/実装メモ.md 321章。
 */
import { buildWeeklyReviewPopupSeenKey, shouldAutoOpenWeeklyReviewPopup } from "./weeklyReviewPopupLogic.ts";

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

// ---- buildWeeklyReviewPopupSeenKey ----
{
  assertEqual(
    "キーはmemberIdごとに変わる",
    buildWeeklyReviewPopupSeenKey("member-1"),
    "oyakopoint.weeklyReviewPopupSeen.member-1"
  );
  assertEqual(
    "メンバーが違えばキーも異なる（きょうだいで同じ端末を使っても別々に記録される）",
    buildWeeklyReviewPopupSeenKey("member-1") !== buildWeeklyReviewPopupSeenKey("member-2"),
    true
  );
}

// ---- shouldAutoOpenWeeklyReviewPopup ----
const base = {
  cardVisible: true,
  yourWeeklyTotal: 3,
  currentWeekStart: "2026-09-28",
  lastShownWeekStart: null as string | null,
  introBubbleShowing: false,
};

{
  assertEqual("3条件がすべて揃えば出す", shouldAutoOpenWeeklyReviewPopup(base), true);
}
{
  assertEqual(
    "条件1: cardVisibleがfalse（確定した先週がまだ無い）なら出さない",
    shouldAutoOpenWeeklyReviewPopup({ ...base, cardVisible: false }),
    false
  );
}
{
  assertEqual(
    "条件2: その週にすでに出していれば出さない（lastShownWeekStart===currentWeekStart）",
    shouldAutoOpenWeeklyReviewPopup({ ...base, lastShownWeekStart: "2026-09-28" }),
    false
  );
}
{
  assertEqual(
    "先週分の記録（別の週）が残っていても、今週分はまだなら出す",
    shouldAutoOpenWeeklyReviewPopup({ ...base, lastShownWeekStart: "2026-09-21" }),
    true
  );
}
{
  assertEqual(
    "条件3: 先週の回数が0回なら出さない（ほめる材料が無いため）",
    shouldAutoOpenWeeklyReviewPopup({ ...base, yourWeeklyTotal: 0 }),
    false
  );
}
{
  assertEqual(
    "条件3: 読み込み中（yourWeeklyTotalがnull）は出さない",
    shouldAutoOpenWeeklyReviewPopup({ ...base, yourWeeklyTotal: null }),
    false
  );
}
{
  assertEqual(
    "1回だけでも出す（1回以上の下限は1）",
    shouldAutoOpenWeeklyReviewPopup({ ...base, yourWeeklyTotal: 1 }),
    true
  );
}
{
  assertEqual(
    "同じタブのはじめての案内（TabIntroBubble）が表示中なら重ねずに出さない",
    shouldAutoOpenWeeklyReviewPopup({ ...base, introBubbleShowing: true }),
    false
  );
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
