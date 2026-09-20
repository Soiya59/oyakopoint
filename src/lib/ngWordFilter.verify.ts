/**
 * ngWordFilter.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md（本部長依頼2026-09-20「ブロックとNGワード
 * フィルタを実装」章）。
 *
 * このリポジトリにはテストランナー（jest等）が導入されていないため、
 * src/lib/groupDuplicateRows.verify.ts の前例に倣い「Node で直接実行する
 * 検証スクリプト」として書いた。
 *
 *   node src/lib/ngWordFilter.verify.ts
 *
 * [2026-09-21改訂・確定版17語] 企画部が要件定義書07-32-5章末尾「決定36の
 * 実施」を2回差し戻し・訂正し、21語→18語→17語の確定版になった
 * （デブ・ブス・あほ・まぬけ・どじ・うざい・あっちいけの7語が、外来語・
 * 日常語との部分一致で除外された）。0番でこの17語自体を実際に検証する
 * （本番リストの中身を検証する）。0b番は「誤爆しないこと」（確定前の版で
 * 実際に誤爆していた文が、いまは止まらないこと）の確認。1番以降は、
 * 判定ロジック自体（正規化・部分一致）をダミーの語リストで引き続き検証する。
 */
import { containsNgWord, normalizeForNgWordCheck, NG_WORDS } from "./ngWordFilter.ts";

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

// ---- 0. 本番のNG_WORDS（確定版17語）を実際に検証する ----
assertEqual("本番のNG_WORDSは確定版の17語（要件定義書07-32-5章末尾・2026-09-21訂正版）", NG_WORDS.length, 17);

// 17語それぞれが、それを含む文で実際に止まることを1件ずつ確認する
// （次に誰かが語を足したときも、この表に1行足せば同じ形で検証できる）。
const shouldBlock: [string, string][] = [
  ["死ね", "死ねばいいのに"],
  ["殺す", "殺すぞといわれた"],
  ["消えろ", "消えろとおもった"],
  ["きえろ", "きえろといわれた"],
  ["くたばれ", "くたばれといわれた"],
  ["なぐる", "なぐるのはだめ"],
  ["たたきのめす", "たたきのめすぞ"],
  ["のろま", "のろまといわれた"],
  ["へたくそ", "へたくそな絵だね"],
  ["役立たず", "役立たずだといわれた"],
  ["邪魔者", "邪魔者あつかいされた"],
  ["きらわれもの", "きらわれものだといわれた"],
  ["おまえなんかきらいだ", "おまえなんかきらいだといわれた"],
  ["ばかにするな", "ばかにするなといった"],
  ["生まれてこなければよかった", "生まれてこなければよかった"],
  ["いなくなればいいのに", "いなくなればいいのに"],
  ["きょうだいなんかいなければいいのに", "きょうだいなんかいなければいいのに"],
];
for (const [word, sentence] of shouldBlock) {
  assertEqual(`[止まるべき] 「${word}」を含む文「${sentence}」→true`, containsNgWord(sentence), true);
}

assertEqual(
  "ひらがな「しね」は17語に含めていない（『楽しんで』への誤爆回避のため見送り）→false",
  containsNgWord("しねばいいのに"),
  false
);
assertEqual("該当語を含まない通常の文章→false", containsNgWord("きょうはこうえんへいきました"), false);

// ---- 0b. [2026-09-21最終確認] 企画部が確定版（17語）に絞り込んだあとの
// 「誤爆しないこと」の確認。旧版（21語・18語）で実際に誤爆していた語
// （デブ・ブス・あほ・まぬけ・どじ・うざい・あっちいけ）を含む日常文が、
// 確定版ではもう止まらないことを1件ずつ確認する。加えて本部長の指示どおり
// 「ばいきんまん」「ばかり」「ゴミ出し」「楽しんで」も引き続き確認する。
const shouldNotBlock: [string, string][] = [
  ["デブ（除外済み）", "すいぞくかんでロブスターをみたよ"],
  ["デブ（除外済み）", "コロンブスのたまご"],
  ["デブ（除外済み）", "うちゅうせんがランデブーした"],
  ["あほ（除外済み）", "ドアほぼ閉まってるよ"],
  ["まぬけ（除外済み）", "あたまぬけてるよね"],
  ["まぬけ（除外済み）", "てまぬけるよ"],
  ["どじ（除外済み）", "まどじまり確認して"],
  ["どじ（除外済み）", "りんごなどじつは"],
  ["うざい（除外済み）", "ちょうざいをうけとった"],
  ["あっちいけ（除外済み）", "あっちいけないよ"],
  ["あっちいけ（除外済み）", "プールにあっちいけなかった"],
  ["ばいきん（もともと未採用）", "ばいきんまんの絵をかいた"],
  ["ばか（もともと未採用）", "しゅくだいばかりしている"],
  ["ゴミ（もともと未採用）", "ゴミ出しをした"],
  ["しね（もともと未採用）", "たのしんでやりました"],
];
for (const [word, sentence] of shouldNotBlock) {
  assertEqual(`[止まってはいけない] 「${word}」を含む文「${sentence}」→false`, containsNgWord(sentence), false);
}

// ---- 以下、ダミーの語リストを明示的に渡して判定ロジック自体を検証する ----
const dummyWords = ["ばか", "アホ"];

// ---- 1. 部分一致で検出する（決定16） ----
assertEqual("部分一致で検出する: 「このばかやろう」→true", containsNgWord("このばかやろう", dummyWords), true);
assertEqual("該当語を含まない文章→false", containsNgWord("きょうもげんきです", dummyWords), false);

// ---- 2. 正規化: ひらがな/カタカナを区別しない（決定16） ----
assertEqual(
  "リスト側がひらがな「ばか」、入力がカタカナ「バカ」→検出する（ひらがな/カタカナ正規化）",
  containsNgWord("このバカ", dummyWords),
  true
);
assertEqual(
  "リスト側がカタカナ「アホ」、入力がひらがな「あほ」→検出する",
  containsNgWord("このあほ", dummyWords),
  true
);

// ---- 3. 正規化: 全角/半角・大文字/小文字を区別しない（決定16） ----
const dummyWordsAscii = ["baka"];
assertEqual(
  "全角英字「ＢＡＫＡ」でも半角リスト「baka」を検出する（NFKC正規化）",
  containsNgWord("ＢＡＫＡだ", dummyWordsAscii),
  true
);
assertEqual(
  "大文字/小文字を区別しない: 「BAKA」→検出する",
  containsNgWord("BAKAだ", dummyWordsAscii),
  true
);

// ---- 4. 空文字・空リストはfalse（例外を投げない） ----
assertEqual("空文字の入力→false", containsNgWord("", dummyWords), false);
assertEqual("空のリストを渡す→false", containsNgWord("ばか", []), false);

// ---- 5. normalizeForNgWordCheck 単体の確認 ----
assertEqual("normalizeForNgWordCheck: ひらがな→カタカナ", normalizeForNgWordCheck("あいう"), "アイウ");
assertEqual("normalizeForNgWordCheck: 全角英字→半角・小文字化", normalizeForNgWordCheck("ＡＢＣ"), "abc");

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
