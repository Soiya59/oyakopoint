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
 * [注意] 本番のNG_WORDSは空配列のまま（企画部からのリスト到着待ち。
 * ngWordFilter.ts冒頭コメント参照）のため、containsNgWord()の判定ロジック
 * そのものはこのスクリプトが渡すダミーの語リスト（本番のNG_WORDSではない、
 * テスト専用の仮の語）で検証する。本番リストの中身を検証するものではない。
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

// ---- 0. 本番のNG_WORDSは空配列のまま（企画部からのリスト到着待ち） ----
assertEqual("本番のNG_WORDSは空配列（企画部からのリスト到着待ち。勝手に語を選んでいない）", NG_WORDS.length, 0);
assertEqual("NG_WORDSが空の間、containsNgWord()は何を入力しても常にfalse", containsNgWord("テスト用のダミー入力"), false);

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
