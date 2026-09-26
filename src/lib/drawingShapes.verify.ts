/**
 * drawingShapes.ts の検証スクリプト。simplifyPolyline.verify.ts（実装メモ137.4章）と
 * 同じ方針・同じ書き方（テストランナー未導入のため、Node単体実行の検証スクリプト）。
 *
 *   node src/lib/drawingShapes.verify.ts
 *
 * このファイルは`.verify.ts`で終わるため`tsconfig.json`のexcludeでtsc型チェック対象外。
 * 型の妥当性は
 *   npx tsc --noEmit --allowImportingTsExtensions src/lib/drawingShapes.verify.ts
 * で個別に確認できる。
 */
import { shapeToPolyline } from "./drawingShapes.ts";

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

function assert(label: string, condition: boolean): void {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    failed += 1;
    console.log(`NG   ${label}`);
  }
}

// ---- 1. 四角（rect）: 範囲の長方形、5点で閉じる ----
{
  const result = shapeToPolyline("rect", 100, 200, 400, 500);
  assertEqual("四角：4隅＋始点に戻る5点", result, [100, 200, 400, 200, 400, 500, 100, 500, 100, 200]);
}

// ---- 2. 四角：始点・終点の順序が逆（右下→左上にドラッグ）でも同じ結果 ----
{
  const result = shapeToPolyline("rect", 400, 500, 100, 200);
  assertEqual("四角：逆方向ドラッグでも同じ長方形になる", result, [100, 200, 400, 200, 400, 500, 100, 500, 100, 200]);
}

// ---- 3. 三角（triangle）: 上向き二等辺三角形、頂点は上辺中央 ----
{
  const result = shapeToPolyline("triangle", 100, 200, 400, 500);
  // 頂点(cx,yMin) → 右下(xMax,yMax) → 左下(xMin,yMax) → 頂点に戻る、の4点。
  assertEqual("三角：頂点は上辺中央、底辺は左下・右下、4点で閉じる", result, [250, 200, 400, 500, 100, 500, 250, 200]);
}

// ---- 4. 丸（circle）: 範囲に内接する楕円、閉じている・範囲内に収まる ----
{
  const result = shapeToPolyline("circle", 100, 200, 500, 600);
  const n = result.length / 2;
  assert("丸：49点（48分割＋閉じる1点）", n === 49);
  assert("丸：始点と終点が一致する（閉じたポリライン）", result[0] === result[result.length - 2] && result[1] === result[result.length - 1]);
  let allInRange = true;
  for (let i = 0; i < result.length; i += 2) {
    const x = result[i];
    const y = result[i + 1];
    if (x < 100 || x > 500 || y < 200 || y > 600) allInRange = false;
  }
  assert("丸：全ての点がバウンディングボックス内に収まる", allInRange);
  // 角度0（右端）はcx+rx＝(100+500)/2 + (500-100)/2 = 500、cy＝(200+600)/2=400。
  assertEqual("丸：角度0の点は右端の中央（cx+rx, cy）", [result[0], result[1]], [500, 400]);
}

// ---- 5. 始点＝終点（ドラッグせずタップのみ）は空配列（形にならない） ----
{
  assertEqual("四角：始点=終点は空配列", shapeToPolyline("rect", 300, 300, 300, 300), []);
  assertEqual("三角：始点=終点は空配列", shapeToPolyline("triangle", 300, 300, 300, 300), []);
  assertEqual("丸：始点=終点は空配列", shapeToPolyline("circle", 300, 300, 300, 300), []);
}

// ---- 6. 全ての座標が整数（DB側chk_family_drawings_line_dataの整数制約を満たす） ----
{
  const result = shapeToPolyline("circle", 0, 0, 999, 777);
  assert("丸：全ての座標が整数", result.every((v) => Number.isInteger(v)));
  assert("丸：全ての座標が0〜1000の範囲内", result.every((v) => v >= 0 && v <= 1000));
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
