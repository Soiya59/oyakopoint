/**
 * requestChoreText.ts の検証スクリプト（70章の文言表と、禁止語のチェック。70.10 D18）。
 *
 *   node src/lib/requestChoreText.verify.ts
 */
import * as T from "./requestChoreText.ts";

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

// ---- 70.3節の文言表 ----
assertEqual("切り替え", [T.TAB_LABEL_THANKS, T.TAB_LABEL_REQUEST], ["ありがとうを贈る", "おねがいする"]);
assertEqual(
  "説明（3文）",
  T.REQUEST_TAB_INTRO,
  "お子さんの画面に「おねがい」として届きます。ポイントは付きません。やってくれたら、完了報告に届きます。"
);
assertEqual("見出し: 子ども1人", T.requestWhoHeading(1), "だれに？");
assertEqual("見出し: 子ども2人以上", T.requestWhoHeading(2), "だれに？（複数選べます）");
assertEqual("選んだ人の案内: 1人以下は出さない", T.requestSelectedCaption(["ちひろ"]), null);
assertEqual("選んだ人の案内: 2人", T.requestSelectedCaption(["ちひろ", "そら"]), "ちひろ・そらに、それぞれ届きます");
assertEqual("なにを", T.REQUEST_TITLE_HEADING, "なにを？");
assertEqual("placeholder", T.REQUEST_TITLE_PLACEHOLDER, "例：おふろのそうじ");
assertEqual("保存ボタン: 1人", T.requestSubmitLabel(1, false), "おねがいする");
assertEqual("保存ボタン: 2人", T.requestSubmitLabel(2, false), "2人におねがいする");
assertEqual("保存中: 1人", T.requestSubmitLabel(1, true), "おねがいしています…");
assertEqual("保存中: 2人", T.requestSubmitLabel(2, true), "おねがいしています…（2人ぶん送っています…）");
assertEqual("成功", [T.REQUEST_SUCCESS_TITLE, T.requestSuccessDetail(["ちひろ", "そら"])], ["おねがいしました", "ちひろ・そらの画面に届きました"]);
assertEqual("フォールバック", T.REQUEST_CREATE_FAILED_MESSAGE, "おねがいを送れませんでした。もう一度お試しください");
assertEqual("子どもがいない", T.REQUEST_NO_CHILD_TITLE, "おねがいできるお子さんがまだいません。先にお子さんを登録してください");

// ---- D19 ----
assertEqual(
  "理由の文（1人）",
  T.requestFullReasonText(["そら"], 3),
  "そらさんへのおねがいは3つまでです。やってくれたあとか、取り下げたあとに、また頼めます。"
);
assertEqual(
  "理由の文（複数）",
  T.requestFullReasonText(["そら", "ちひろ"], 3),
  "そら・ちひろさんへのおねがいは3つまでです。やってくれたあとか、取り下げたあとに、また頼めます。"
);
assertEqual("満杯の子の結果行", T.requestResultFullLine("そら", 3), "⏳ そら の分は、おねがいが3つ出ているため、まだできていません");
assertEqual("成功の結果行", T.requestResultOkLine("ちひろ"), "✅ ちひろ の分はおねがいできました");
assertEqual("失敗の結果行", T.requestResultFailedLine("そら"), "⏳ そら の分はまだできていません");
assertEqual("やり直しボタン", T.requestRetryLabel(["そら"]), "そら の分だけ、もう一度おねがいする");

// ---- D14 ----
assertEqual(
  "残り0の案内",
  T.GRATITUDE_LIMIT_CARD_LINES.join(""),
  "きょうは、もう贈れません。あした、また贈れます。スタンプなら、いまでも送れます。"
);

// ---- D10・D9・D12・D15 ----
assertEqual("C7の見出し", T.requestReportSentTitle("おふろのそうじ"), "「おふろのそうじ」とどいたよ！");
assertEqual("ベル（子ども）", T.BELL_HEADLINE_REQUEST_ARRIVED, "💌 おねがいが とどいたよ");
assertEqual("ベル（依頼者）", T.BELL_HEADLINE_REQUEST_DONE, "✅ おねがいを やってくれました");
assertEqual("P8の印とボタン", [T.APPROVAL_REQUEST_MARK, T.APPROVAL_THANKS_BUTTON_LABEL], ["💌 おねがい", "ありがとうを贈る"]);
assertEqual("P10: 未完了", T.requestListRightLabel(false, "ちひろ"), "おねがい・ちひろ");
assertEqual("P10: 済", T.requestListRightLabel(true, "そら"), "おねがい（済）・そら");
assertEqual("P10: 担当なし", T.requestListRightLabel(true, null), "おねがい（済）・担当なし");
assertEqual("P11: おねがい先", T.requestEditTarget("ちひろ"), "おねがい先：ちひろ");
assertEqual("P11: 取り下げ確認", T.requestWithdrawConfirmTitle("おふろのそうじ"), "「おふろのそうじ」のおねがいを取り下げますか？");
assertEqual("P11: 取り下げ確認の本文", T.requestWithdrawConfirmBody("ちひろ"), "ちひろさんの画面から消えます。お知らせはしません。");
assertEqual("P11: 済", T.requestDoneNote("そら"), "そらさんがやってくれました");
assertEqual("P40の見出し", T.NOTIFY_SWITCH_HEADING, "お知らせの通知（家族みんな共通）");
assertEqual(
  "P40の説明",
  T.NOTIFY_SWITCH_DESCRIPTION,
  "書き込み・おねがい・ありがとうのポイントが届いたときに、スマホでお知らせします。"
);

// ---- 70.10 禁止語（催促・期限・比較・額の予告）が、文言のどれにも入っていないこと ----
const all: string[] = [];
for (const v of Object.values(T)) {
  if (typeof v === "string") all.push(v);
  if (Array.isArray(v)) all.push(...v.filter((x): x is string => typeof x === "string"));
}
all.push(
  T.requestFullReasonText(["そら"], 3),
  T.requestWhoHeading(2),
  T.requestSubmitLabel(2, true),
  T.requestSuccessDetail(["ちひろ"]),
  T.requestResultFullLine("そら", 3),
  T.requestListRightLabel(false, "ちひろ"),
  T.requestWithdrawConfirmTitle("そうじ"),
  T.requestWithdrawConfirmBody("ちひろ")
);
const FORBIDDEN = ["はやく", "早く", "のこり", "残り", "期限", "催促", "もらえる", "ポイントがもらえ", "ランキング", "まだやって"];
// 「まだ」は保護者向けの結果カード（一部失敗）にだけある（子どもの画面には出ない）。
// 子どもの画面の文言（C6・C7・ベル）に限って「まだ」を許さない。
const childFacing = [
  T.requestReportSentTitle("そうじ"),
  T.BELL_HEADLINE_REQUEST_ARRIVED,
  T.BELL_HEADLINE_REQUEST_DONE,
];
for (const s of all) {
  // 「残りを確認できません」は感謝ポイントの1日の原資の話（「ありがとうを贈る」タブ）で、おねがいの語ではない。
  const hit = FORBIDDEN.find((w) => s.includes(w) && !(w === "残り" && s === T.GRATITUDE_BALANCE_ERROR_TEXT));
  if (hit) {
    failed += 1;
    console.log(`NG   禁止語「${hit}」を含む文言: ${s}`);
  }
}
console.log(`OK   禁止語チェック（${all.length}件の文言に、催促・期限・額の予告の語が無い）`);
for (const s of childFacing) {
  if (s.includes("まだ")) {
    failed += 1;
    console.log(`NG   子どもの画面の文言に「まだ」: ${s}`);
  }
}
console.log("OK   子どもの画面の文言に「まだ」が無い");

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
