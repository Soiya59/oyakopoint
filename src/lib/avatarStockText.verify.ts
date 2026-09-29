/**
 * avatarStockText.ts の検証スクリプト（実装メモ.md 334章、主要画面ワイヤーフレーム.md 69.5節）。
 *
 *   node src/lib/avatarStockText.verify.ts
 *
 * 確かめること: ①子ども向けに漢字が混ざっていない（未就学児〜小学生でも読める。69.5節の原則）、
 * ②代理（他の人の分）の文言に「{名前}さん」が入り、相手が誰でも同じ書き方、③「注意」「警告」
 * 「制限」の語を使っていない（見守り・達成のトーン）、④69.5節の表と食い違わない主要な文言。
 */
import { getAvatarStockText, type AvatarStockText } from "./avatarStockText.ts";

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

/** 文字列のプロパティだけを取り出す（slotLabelは関数なので呼んだ結果も含める）。 */
function allStrings(t: AvatarStockText): string[] {
  const out: string[] = [];
  for (const v of Object.values(t)) {
    if (typeof v === "string") out.push(v);
  }
  out.push(t.slotLabel(1), t.slotLabel(3));
  return out;
}

// 漢字（CJK統合漢字）。「ー」「ア」等のカタカナ・ひらがなは含まない。
const KANJI = /[㐀-鿿]/;
const FORBIDDEN_WORDS = /注意|警告|制限/;

const child = getAvatarStockText({ tone: "child", isProxy: false, displayName: "たろう" });
const parent = getAvatarStockText({ tone: "parent", isProxy: false, displayName: "母" });
const supporter = getAvatarStockText({ tone: "supporter", isProxy: false, displayName: "祖母" });
const proxyChild = getAvatarStockText({ tone: "parent", isProxy: true, displayName: "たろう" });
const proxyAdult = getAvatarStockText({ tone: "parent", isProxy: true, displayName: "祖母" });

// ---- 1. 子ども向けは漢字を含まない ----
{
  const bad = allStrings(child).filter((s) => KANJI.test(s));
  assertEqual("子ども向け: 漢字を含む文言が0件", bad.join(" / "), "");
}

// ---- 2. 禁止語を使わない（全ロール） ----
for (const [name, t] of [
  ["子ども", child],
  ["保護者", parent],
  ["みまもり", supporter],
  ["代理", proxyChild],
] as const) {
  const bad = allStrings(t).filter((s) => FORBIDDEN_WORDS.test(s));
  assertEqual(`${name}: 「注意・警告・制限」を使わない`, bad.join(" / "), "");
}

// ---- 3. 69.5節の表との一致（主要な文言） ----
assertEqual("子ども: 見出し", child.heading, "まえの アバター");
assertEqual("保護者: 見出し", parent.heading, "まえのアバター");
assertEqual("子ども: いっぱいで保存できない理由", child.fullReasonSave, "まえの アバターが いっぱいです。1まい けしてから ほぞんしてね");
assertEqual("保護者: いっぱいで保存できない理由", parent.fullReasonSave, "まえのアバターがいっぱいです。1枚消してから保存してください");
assertEqual("保護者: いっぱいで色にもどせない理由", parent.fullReasonReset, "まえのアバターがいっぱいです。1枚消してから色にもどしてください");
assertEqual("子ども: 戻すボタン", child.restoreLabel, "これに もどす");
assertEqual("保護者: 戻すボタン", parent.restoreLabel, "これに戻す");
assertEqual("全ロール共通: 消すボタンは「けす」", [child, parent, supporter, proxyChild].every((t) => t.deleteLabel === "けす"), true);
assertEqual("みまもりと保護者（本人）は同じ文言（69.5節「同左」）", JSON.stringify(allStrings(supporter)), JSON.stringify(allStrings(parent)));
assertEqual("子ども: 消す確定は「ほんとうに けす」", child.deleteConfirmActionLabel, "ほんとうに けす");
assertEqual("大人: 消す確定は「消す」", parent.deleteConfirmActionLabel, "消す");
assertEqual("子ども: 保存成功（前の絵が残った）", child.saveSuccessStocked, "あたらしい すがたに なったよ！まえの えは「まえの アバター」に のこったよ");
assertEqual("子ども: 保存成功（残らなかった）は既存どおり", child.saveSuccess, "あたらしい すがたに なったよ！");
assertEqual("保護者: 保存成功（残らなかった）は既存どおり", parent.saveSuccess, "アバターを保存しました");
assertEqual("枠のラベル（子ども）", child.slotLabel(2), "まえの アバター 2まいめ");
assertEqual("空き枠のラベル（子ども）", child.emptySlotLabel, "からの わく");
assertEqual("戻し中（子ども）", child.restoring, "もどしています…");
assertEqual("戻し中（大人）", parent.restoring, "戻しています…");
assertEqual("色の状態から戻したとき（左端に入る絵が無い）は「左端」に触れない", [child, parent, proxyChild].some((t) => t.restoreSuccessNoCurrent.includes("左端") || t.restoreSuccessNoCurrent.includes("ひだりはし")), false);
assertEqual("今が色だけのとき、説明は1文だけ（子ども）", child.previewTextNoCurrent, "この えに もどす？");

// ---- 4. 代理（他の人の分）は「{名前}さん」。相手が子どもでも大人でも書き方は同じ ----
assertEqual("代理: 見出し（子どもの分）", proxyChild.heading, "たろうさんのまえのアバター");
assertEqual("代理: 見出し（大人の分）", proxyAdult.heading, "祖母さんのまえのアバター");
assertEqual(
  "代理: 見出し以外も{名前}さん入り（子どもの分と大人の分で、名前以外が同じ）",
  [proxyChild.note, proxyChild.previewText, proxyChild.restoreSuccess, proxyChild.deleteConfirm, proxyChild.resetConfirm].join("|"),
  [proxyAdult.note, proxyAdult.previewText, proxyAdult.restoreSuccess, proxyAdult.deleteConfirm, proxyAdult.resetConfirm].join("|").replaceAll("祖母", "たろう")
);
assertEqual("代理: いっぱいで保存できない理由", proxyChild.fullReasonSave, "たろうさんの「まえのアバター」がいっぱいです。1枚消してから保存してください");
assertEqual("代理: 色にもどす確認", proxyChild.resetConfirm, "たろうさんのアバターを色にもどしますか？今の絵は「まえのアバター」に残ります");
assertEqual("代理: 保存成功（残った）", proxyChild.saveSuccessStocked, "たろうさんのアバターを保存しました。前の絵は「まえのアバター」に残っています");
assertEqual("代理: 保存成功（残らなかった）は既存の「{名前}さんのアバターを保存しました」", proxyChild.saveSuccess, "たろうさんのアバターを保存しました");
assertEqual("代理: 消す確認", proxyChild.deleteConfirm, "たろうさんのこの絵を消しますか？消すと元に戻せません");

// ---- 5. 「色にもどす」の確認・成功は「残る」前提（消える前提の旧文言が残っていない） ----
for (const [name, t] of [
  ["子ども", child],
  ["保護者", parent],
  ["代理", proxyChild],
] as const) {
  assertEqual(`${name}: 色にもどす確認は「まえのアバター」に残る前提`, t.resetConfirm.includes("まえの") && t.resetConfirm.includes("アバター") && !t.resetConfirm.includes("消えます") && !t.resetConfirm.includes("きえて"), true);
}

if (failed > 0) {
  console.log(`\n${failed}件 NG`);
  process.exit(1);
}
console.log("\n全件OK");
