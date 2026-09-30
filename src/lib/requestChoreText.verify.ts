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
  "説明（2文。再改訂）",
  T.REQUEST_TAB_INTRO,
  "お子さんの画面に「おねがい」として届きます。決めたポイントは、やってくれたら自動で入ります（あとから変えられません）。"
);
assertEqual("見出し: 子ども1人", T.requestWhoHeading(1), "だれに？");
assertEqual("見出し: 子ども2人以上", T.requestWhoHeading(2), "だれに？（複数選べます）");
assertEqual("選んだ人の案内: 1人以下は出さない", T.requestSelectedCaption(["ちひろ"], 2), null);
assertEqual("選んだ人の案内: 2人・ポイント未選択", T.requestSelectedCaption(["ちひろ", "そら"], null), "ちひろ・そらに、それぞれ届きます");
assertEqual("選んだ人の案内: 2人・ポイントなし（0）は額を出さない", T.requestSelectedCaption(["ちひろ", "そら"], 0), "ちひろ・そらに、それぞれ届きます");
assertEqual("選んだ人の案内: 2人・2pt", T.requestSelectedCaption(["ちひろ", "そら"], 2), "ちひろ・そらに、それぞれ 2pt で届きます");

// ---- 70.3節 D20・D21（ポイントの欄） ----
assertEqual("ポイントの見出し", T.REQUEST_POINTS_HEADING, "ポイントは？（必須）");
assertEqual("チップ: 0は「ポイントなし」（「0pt」と書かない）", T.requestPointChipLabel(0), "ポイントなし");
assertEqual("チップ: 1pt", T.requestPointChipLabel(1), "1pt");
assertEqual("チップ: 3pt", T.requestPointChipLabel(3), "3pt");
assertEqual("読み上げ: 0", T.requestPointChipAccessibilityLabel(0), "ポイントなし");
assertEqual("読み上げ: 1は「1ポイント」", T.requestPointChipAccessibilityLabel(1), "1ポイント");
assertEqual("押せない理由: ポイントだけ足りない", T.requestSubmitBlockedReason({ hasTitle: true, hasChild: true, hasPoints: false }), "ポイントを選ぶと、おねがいできます。");
assertEqual("押せない理由: だれにだけ足りない", T.requestSubmitBlockedReason({ hasTitle: true, hasChild: false, hasPoints: true }), "だれに頼むか選ぶと、おねがいできます。");
assertEqual("押せない理由: どちらも足りない", T.requestSubmitBlockedReason({ hasTitle: true, hasChild: false, hasPoints: false }), "だれに頼むかとポイントを選ぶと、おねがいできます。");
assertEqual("押せない理由: 題名が空なら出さない", T.requestSubmitBlockedReason({ hasTitle: false, hasChild: true, hasPoints: false }), null);
assertEqual("押せない理由: そろっていれば出さない", T.requestSubmitBlockedReason({ hasTitle: true, hasChild: true, hasPoints: true }), null);
assertEqual("押せない理由: 全員がいっぱいなら出さない（D19の文が出ている）", T.requestSubmitBlockedReason({ hasTitle: true, hasChild: false, hasPoints: false, allFull: true }), null);
assertEqual("押せない理由: 保存中は出さない", T.requestSubmitBlockedReason({ hasTitle: true, hasChild: true, hasPoints: false, saving: true }), null);
assertEqual("成功の3行目: 1人・2pt", T.requestSuccessPointsLine(1, 2), "やってくれたら、2pt 入ります");
assertEqual("成功の3行目: 2人・2pt", T.requestSuccessPointsLine(2, 2), "やってくれたら、それぞれ 2pt 入ります");
assertEqual("成功の3行目: 0は行ごと出さない", T.requestSuccessPointsLine(2, 0), null);
assertEqual("P22の案内（P8・P9から開いたとき）", T.GRATITUDE_FROM_APPROVALS_NOTE, "ここでは、ひとことと、上乗せの贈り物ができます。");
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
assertEqual("P10: 0ptはptを出さない（今までどおり）", T.requestListRightLabel(false, "ちひろ", 0), "おねがい・ちひろ");
assertEqual("P10: 2pt（再改訂）", T.requestListRightLabel(false, "ちひろ", 2), "2pt・おねがい・ちひろ");
assertEqual("P10: 済・1pt（再改訂）", T.requestListRightLabel(true, "そら", 1), "1pt・おねがい（済）・そら");
assertEqual("P11: 未完了・2pt（表示のみ）", T.requestEditPointsLine(2, false), "ポイント：2pt（変更できません）");
assertEqual("P11: 未完了・0は「ポイントなし」", T.requestEditPointsLine(0, false), "ポイントなし");
assertEqual("P11: 済・1pt", T.requestEditPointsLine(1, true), "ポイント：1pt");
assertEqual("P11: 済・0は行ごと出さない", T.requestEditPointsLine(0, true), null);
assertEqual("P11: 変えたいときの案内", T.REQUEST_EDIT_CHANGE_HINT, "変えたいときは、取り下げて、もう一度おねがいしてください。");
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
  T.requestSuccessPointsLine(2, 3) ?? "",
  T.requestSelectedCaption(["ちひろ", "そら"], 3) ?? "",
  T.requestSubmitBlockedReason({ hasTitle: true, hasChild: false, hasPoints: false }) ?? "",
  T.requestPointChipLabel(0),
  T.requestPointChipLabel(2),
  T.requestEditPointsLine(2, false) ?? "",
  T.REQUEST_EDIT_CHANGE_HINT,
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
