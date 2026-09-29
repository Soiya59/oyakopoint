/**
 * choreRename.ts の検証スクリプト（実装メモ336章）。
 *
 *   node src/lib/choreRename.verify.ts
 */
import * as R from "./choreRename.ts";

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

// ---- 確認を出すか ----
assertEqual("名前を変えた: 出す", R.shouldConfirmChoreRename("おふろそうじ", "げんかんそうじ"), true);
assertEqual("名前を変えない: 出さない", R.shouldConfirmChoreRename("おふろそうじ", "おふろそうじ"), false);
assertEqual("新規登録（元の名前なし）: 出さない", R.shouldConfirmChoreRename(null, "おふろそうじ"), false);
assertEqual("新規登録（undefined）: 出さない", R.shouldConfirmChoreRename(undefined, "おふろそうじ"), false);
assertEqual("前後の空白だけの違い: 出さない", R.shouldConfirmChoreRename("おふろそうじ", "  おふろそうじ "), false);
assertEqual("前後の全角空白だけの違い: 出さない", R.shouldConfirmChoreRename("おふろそうじ", "　おふろそうじ　"), false);
assertEqual("元の名前の側に空白: 出さない", R.shouldConfirmChoreRename(" おふろそうじ ", "おふろそうじ"), false);
assertEqual("全角英数と半角英数だけの違い: 出さない", R.shouldConfirmChoreRename("ＡＢＣ掃除１", "ABC掃除1"), false);
assertEqual("半角カナと全角カナだけの違い: 出さない", R.shouldConfirmChoreRename("ｶﾞﾗｽそうじ", "ガラスそうじ"), false);
assertEqual("全角空白と半角空白だけの違い（途中）: 出さない", R.shouldConfirmChoreRename("お風呂　そうじ", "お風呂 そうじ"), false);
assertEqual("大文字と小文字の違い: 出す", R.shouldConfirmChoreRename("abc", "ABC"), true);
assertEqual("ひらがなとカタカナの違い: 出す", R.shouldConfirmChoreRename("そうじ", "ソウジ"), true);
assertEqual("一文字足した: 出す", R.shouldConfirmChoreRename("おふろそうじ", "おふろそうじ2"), true);
assertEqual("途中の空白の有無: 出す（別の書き方）", R.shouldConfirmChoreRename("おふろ そうじ", "おふろそうじ"), true);
assertEqual("空にした: 出す（画面では入力チェックが先）", R.shouldConfirmChoreRename("おふろそうじ", ""), true);
assertEqual("空白だけにした: 出す", R.shouldConfirmChoreRename("おふろそうじ", "   "), true);
assertEqual("絵文字を含む名前が同じ: 出さない", R.shouldConfirmChoreRename("🧹そうじ", "🧹そうじ"), false);

// ---- 比較用の値 ----
assertEqual("比較用: 空白と全角を整える", R.normalizeChoreTitleForCompare("　ＡＢＣ　"), "ABC");

// ---- 文言 ----
assertEqual(
  "確認の本文（統括承認の例）",
  R.renameConfirmMessage("おふろそうじ", "げんかんそうじ"),
  "『おふろそうじ』を『げんかんそうじ』に変えます"
);
assertEqual(
  "確認の本文: 前後の空白は除いて出す",
  R.renameConfirmMessage(" おふろそうじ ", "　げんかんそうじ "),
  "『おふろそうじ』を『げんかんそうじ』に変えます"
);
assertEqual("ボタン: 変える", R.RENAME_CONFIRM_KEEP_LABEL, "変える");
assertEqual("ボタン: 新しいクエストとして登録する", R.RENAME_CONFIRM_AS_NEW_LABEL, "新しいクエストとして登録する");
assertEqual("ボタン: やめる", R.RENAME_CONFIRM_CANCEL_LABEL, "やめる");
assertEqual("見出し", R.editingBannerText("おふろそうじ"), "「おふろそうじ」を編集中");
assertEqual("見出し: 前後の空白は除く", R.editingBannerText(" おふろそうじ "), "「おふろそうじ」を編集中");

// ---- 「新しいクエストとして登録する」の注記 ----
assertEqual("注記: 1回だけ・上限なし → 無し", R.newRegistrationNotes({ isRepeatable: false, dailyLimitText: "" }), []);
assertEqual("注記: くり返す・上限あり → 無し", R.newRegistrationNotes({ isRepeatable: true, dailyLimitText: "3" }), []);
assertEqual("注記: くり返す・上限が空欄 → 1日1回", R.newRegistrationNotes({ isRepeatable: true, dailyLimitText: "" }), [
  "1日の上限が空欄のため、新しいクエストは1日1回として登録されます。",
]);
assertEqual("注記: 上限が空白だけも空欄扱い", R.newRegistrationNotes({ isRepeatable: true, dailyLimitText: "  " }).length, 1);
assertEqual("注記: 1回だけなら上限欄は関係しない", R.newRegistrationNotes({ isRepeatable: false, dailyLimitText: "" }).length, 0);
assertEqual("注記: みまもりの自分専用から", R.newRegistrationNotes({ isRepeatable: false, dailyLimitText: "", isPersonalScope: true }), [
  "新しいクエストは、みまもりメンバーなら誰でも完了報告できるクエストになります。",
]);
assertEqual(
  "注記: 両方",
  R.newRegistrationNotes({ isRepeatable: true, dailyLimitText: "", isPersonalScope: true }).length,
  2
);

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
