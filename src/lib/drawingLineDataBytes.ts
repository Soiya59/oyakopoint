/**
 * お絵かきの線データ（family_drawings.line_data）のシリアライズ後バイト数を見積もる。
 * 参照: 設計部/成果物/API仕様.md 12.2b節・44.8.1章（開発部/成果物/実装メモ.md 131章）。
 *
 * DB側の`octet_length(line_data::text)`（スキーマ設計.sql 33b章・44.5章のCHECK制約
 * `chk_family_drawings_line_data`）が最終防衛線であり、ここでの計算はあくまで
 * クライアント側のUX目的の事前見積もりである。
 *
 * [2026-09-05・実装メモ131章で発見・訂正] API仕様.md 44.8.1章(2)は「JSON.stringifyは
 * 既定でキーの間・区切り文字の前後に空白を入れない圧縮形式であり、これはPostgreSQLの
 * jsonb::textが生成する圧縮形式と一致する」としていたが、**ローカルのPostgreSQL 17.6で
 * 実測した結果これは誤りだった。** PostgreSQLの`jsonb::text`は`:`の後・`,`の後に必ず
 * 半角スペースを1つ挿入する（例: `{"c": "#2E2E2E", "p": [10, 10]}`）。素の
 * `JSON.stringify`（区切り文字の前後に空白なし）とは総バイト数が異なり、線の本数・
 * 座標点数が多いほど差が開く（実測: 8本・2122組＝約4250個の数値を含む線データで
 * 21,504byteちょうどのとき、素のJSON.stringify換算だと約17,219byteにしかならず、
 * 4,000byte以上もの過小評価になった）。**この過小評価を放置すると、クライアントは
 * 「まだ余裕がある」と表示したまま、実際には保存時にDBのCHECK制約で弾かれる**という、
 * この機能が解消しようとしている無言の行き詰まりを別の形で再現してしまう。
 * そのため、素のJSON.stringifyではなく、PostgreSQLの実際の直列化形式を模した
 * `pgJsonbLineDataText`でバイト数を見積もる（線データの内容は数値と8色パレットの
 * HEXコード文字列のみで、コロン・カンマを含む文字列値が混入する余地が無いため、
 * 直接組み立てる方式で安全に模倣できる）。ローカルDBでの実測による裏付けは
 * 開発部/成果物/実装メモ.md 131章参照。
 */
import type { FamilyDrawingLine } from "@/types/domain";

/** 線1本を`{"c": "...", "p": [...], "w": N}`（PostgreSQLのjsonb::text形式）へ直列化する。 */
function pgJsonbLineText(line: FamilyDrawingLine): string {
  const parts = [`"c": ${JSON.stringify(line.c)}`, `"p": [${line.p.join(", ")}]`];
  if (line.w !== undefined) parts.push(`"w": ${line.w}`);
  return `{${parts.join(", ")}}`;
}

/** {v:1, lines} 全体をPostgreSQLのjsonb::text形式で直列化する。 */
function pgJsonbLineDataText(lines: FamilyDrawingLine[]): string {
  return `{"v": 1, "lines": [${lines.map(pgJsonbLineText).join(", ")}]}`;
}

/** {v:1, lines} のペイロードをDBと同じ形式でシリアライズしたときのバイト数。 */
export function estimateLineDataBytes(lines: FamilyDrawingLine[]): number {
  return new TextEncoder().encode(pgJsonbLineDataText(lines)).byteLength;
}

/**
 * 線を1本（最小構成: 座標1組・w付き）追加するために最低限必要なバイト数
 * （すでに1本以上の線がある配列へ追加する場合の、区切り文字込みの限界費用）。
 * ハードコードした数値ではなく、実際に最小の線データをシリアライズして
 * 起動時に一度だけ計算する（line_dataのキー構成が将来変わっても追随できるように
 * するため）。
 */
const MIN_LINE_SAMPLE: FamilyDrawingLine = { c: "#000000", p: [0, 0], w: 2 };
export const MIN_DRAWING_LINE_BYTES =
  new TextEncoder().encode(pgJsonbLineDataText([MIN_LINE_SAMPLE, MIN_LINE_SAMPLE])).byteLength -
  new TextEncoder().encode(pgJsonbLineDataText([MIN_LINE_SAMPLE])).byteLength;
