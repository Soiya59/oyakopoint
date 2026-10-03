/**
 * questCount.ts の検証スクリプト（実装メモ353章）。
 *
 *   node src/lib/questCount.verify.ts
 */
import * as Q from "./questCount.ts";

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

// ---- 絵文字の代替（72.0節。ベルと同じ「📝」） ----
assertEqual("絵文字あり: そのまま", Q.questCountEmoji("🪥"), "🪥");
assertEqual("絵文字NULL: 📝", Q.questCountEmoji(null), "📝");
assertEqual("絵文字undefined: 📝", Q.questCountEmoji(undefined), "📝");
assertEqual("絵文字が空文字列: 📝", Q.questCountEmoji(""), "📝");
assertEqual("絵文字が空白だけ: 📝", Q.questCountEmoji("  "), "📝");

// ---- 行の組み立て: 取得した順のまま・時刻を渡さない・並べ替えない・落とさない ----
const fetched = [
  { chore_name: "はみがき", chore_emoji: "🪥", completion_count: 4, last_completed_at: "2026-10-03T01:38:00Z" },
  { chore_name: "おしっこ1人でできた", chore_emoji: null, completion_count: 40, last_completed_at: "2026-10-03T01:30:00Z" },
  { chore_name: "", chore_emoji: "🧺", completion_count: 1, last_completed_at: "2026-10-03T01:20:00Z" },
  { chore_name: "ごはん", chore_emoji: "🍚", completion_count: 7, last_completed_at: "2026-10-02T01:20:00Z" },
];
const rows = Q.toQuestCountRows(fetched);
assertEqual(
  "取得した順のまま（回数の多い順に並べ替えない）・絵文字は補う",
  rows.map((r) => [r.name, r.emoji, r.count]),
  [
    ["はみがき", "🪥", 4],
    ["おしっこ1人でできた", "📝", 40],
    ["", "🧺", 1],
    ["ごはん", "🍚", 7],
  ]
);
assertEqual("名前が空文字列の行も落とさない（行数が同じ）", rows.length, fetched.length);
assertEqual("最後にやった時刻は部品に渡さない（列は3つだけ）", Object.keys(rows[0]).sort(), ["count", "emoji", "name"]);
assertEqual("0行は0行（文を作らない）", Q.toQuestCountRows([]), []);

// ---- 文言（72.5節） ----
assertEqual("見出し（保護者）", Q.questCountHeading("parent"), "クエストごとの回数");
assertEqual("見出し（みまもり）", Q.questCountHeading("supporter"), "クエストごとの回数");
assertEqual("見出し（子ども）", Q.questCountHeading("child"), "クエストごとの かず");
assertEqual("単位（保護者）", Q.questCountUnit("parent"), "回");
assertEqual("単位（みまもり）", Q.questCountUnit("supporter"), "回");
assertEqual("単位（子ども）", Q.questCountUnit("child"), "かい");
assertEqual("読み上げ（保護者）: 絵文字を含まない", Q.questCountRowLabel("parent", "はみがき", 40), "はみがき、40回");
assertEqual("読み上げ（子ども）", Q.questCountRowLabel("child", "はみがき", 40), "はみがき、40かい");
assertEqual("ヒント（保護者・閉）", Q.questCountToggleHint("parent", false), "押すと、開きます");
assertEqual("ヒント（保護者・開）", Q.questCountToggleHint("parent", true), "押すと、閉じます");
assertEqual("ヒント（子ども・閉）", Q.questCountToggleHint("child", false), "おすと ひらくよ");
assertEqual("ヒント（子ども・開）", Q.questCountToggleHint("child", true), "おすと とじるよ");
assertEqual("失敗の文（保護者）", Q.questCountErrorTitle("parent"), "クエストごとの回数を読み込めませんでした");
assertEqual("失敗の文（みまもり）", Q.questCountErrorTitle("supporter"), "クエストごとの回数を読み込めませんでした");
assertEqual("失敗の文（子ども）", Q.questCountErrorTitle("child"), "つうしんがおやすみ中みたい");

// 使わない言葉（企画部6節5）が、どの文言にも入っていない
const banned = ["卒業", "できるようになった", "削除済み", "やっていない", "まだ", "あと", "いちばん", "たくさん", "少ない", "目標"];
const allTexts = (["parent", "child", "supporter"] as const).flatMap((t) => [
  Q.questCountHeading(t),
  Q.questCountUnit(t),
  Q.questCountToggleHint(t, true),
  Q.questCountToggleHint(t, false),
  Q.questCountRowLabel(t, "はみがき", 3),
  Q.questCountErrorTitle(t),
]);
assertEqual("使わない言葉が文言に入っていない", allTexts.filter((s) => banned.some((b) => s.includes(b))), []);

// ---- 枠を出すか（72.4節） ----
assertEqual("lifetime_completionsの現在値を取り出す", Q.lifetimeCompletionsOf([
  { key: "lifetime_drawings", currentValue: 9 },
  { key: "lifetime_completions", currentValue: 128 },
]), 128);
assertEqual("行が無ければnull", Q.lifetimeCompletionsOf([{ key: "lifetime_drawings", currentValue: 9 }]), null);
assertEqual("ready・1回以上: 出す", Q.shouldShowQuestCountSection("ready", 1), true);
assertEqual("ready・128回: 出す", Q.shouldShowQuestCountSection("ready", 128), true);
assertEqual("ready・0回: 枠ごと出さない", Q.shouldShowQuestCountSection("ready", 0), false);
assertEqual("ready・行なし(null): 出さない", Q.shouldShowQuestCountSection("ready", null), false);
assertEqual("読み込み中: 出さない", Q.shouldShowQuestCountSection("loading", 128), false);
assertEqual("失敗: 出さない", Q.shouldShowQuestCountSection("error", 128), false);

// ---- みまもりの自分のタブ（07-46章 決定8） ----
assertEqual("自分のタブ: 出す", Q.isOwnTab("m1", "m1"), true);
assertEqual("他の人のタブ: 出さない", Q.isOwnTab("m2", "m1"), false);
assertEqual("＋家族全体(null): 出さない", Q.isOwnTab(null, "m1"), false);
assertEqual("自分のIDが未確定: 出さない", Q.isOwnTab("m1", null), false);
assertEqual("自分のIDが空文字列: 出さない", Q.isOwnTab("", ""), false);

if (failed > 0) {
  console.log(`\n${failed} 件NG`);
  process.exit(1);
}
console.log("\n全部OK");
