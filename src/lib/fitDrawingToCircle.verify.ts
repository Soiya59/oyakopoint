/**
 * fitDrawingToCircle.ts の単体検証。
 * Node.js単体実行で動かす（`node src/lib/fitDrawingToCircle.verify.ts`、
 * drawingZoomPan.verify.ts と同じ方式）。
 * 参照: 主要画面ワイヤーフレーム.md 48章、開発部/成果物/実装メモ.md 236章。
 *
 * このファイルはNode単体実行専用のためtsconfig.jsonの`exclude`
 * （`**\/*.verify.ts`）でtscの型チェック対象から外している。
 */
import { fitDrawingLinesToCircle, FIT_TO_CIRCLE_DIAGONAL_THRESHOLD } from "./fitDrawingToCircle.ts";

let failCount = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "OK  " : "NG  "} ${label}`);
  if (!ok) failCount++;
}

type Line = { c: string; p: number[]; w?: number };

function diagonalOf(lines: Line[]): number {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.p.length; i += 2) {
      const x = line.p[i];
      const y = line.p[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2);
}

function centerOf(lines: Line[]): { cx: number; cy: number } {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.p.length; i += 2) {
      const x = line.p[i];
      const y = line.p[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

// (a) 右上の小さな正方形が対角線1000・中心(500,500)になる。
{
  const lines: Line[] = [{ c: "#2E2E2E", p: [800, 800, 900, 800, 900, 900, 800, 900], w: 4 }];
  const result = fitDrawingLinesToCircle(lines);
  check("(a) changed=true", result.changed === true);
  const diag = diagonalOf(result.lines);
  check(`(a) 対角線が1000に近い（実測${diag.toFixed(2)}）`, Math.abs(diag - 1000) <= 2);
  const { cx, cy } = centerOf(result.lines);
  check(`(a) 中心が(500,500)に近い（実測(${cx},${cy})）`, Math.abs(cx - 500) <= 2 && Math.abs(cy - 500) <= 2);
}

// (b) 右半分の半月（外接矩形500×1000）は何も変わらない（対角線が既に998以上）。
{
  // 外接矩形 500(幅)×1000(高さ) の半月相当の点群。
  const lines: Line[] = [
    { c: "#000000", p: [500, 0, 1000, 500, 500, 1000, 750, 500], w: 2 },
  ];
  const before = JSON.stringify(lines);
  const result = fitDrawingLinesToCircle(lines);
  check("(b) changed=false（対角線が既に998以上）", result.changed === false);
  check("(b) 座標が一切変わらない", JSON.stringify(result.lines) === before);
  const diag = diagonalOf(lines);
  check(`(b) 元の対角線は998以上（実測${diag.toFixed(2)}）`, diag >= FIT_TO_CIRCLE_DIAGONAL_THRESHOLD);
}

// (c) 2回適用しても2回目は不変（冪等）。
// [注記] 20倍の上限（決定5）に頭打ちになる小さすぎる図形だと、1回目の変換後も
// 対角線が1000へ届かず998未満のままになり、2回目も変換されてしまう
// （20倍の上限そのものは決定4の0〜1000保証を崩さないが、決定18の冪等性は
// 「1回目でちょうど1000近くまで拡大できる」図形でのみ成立する）。そのため
// ここでは上限に掛からない中程度の大きさ（一辺100、対角線約141）を使う。
{
  const lines: Line[] = [{ c: "#2E2E2E", p: [10, 10, 110, 10, 110, 110, 10, 110], w: 7 }];
  const first = fitDrawingLinesToCircle(lines);
  check("(c) 1回目はchanged=true", first.changed === true);
  const second = fitDrawingLinesToCircle(first.lines);
  check("(c) 2回目はchanged=false（丸め誤差込みで998以上に収まる）", second.changed === false);
  check("(c) 2回目で座標が変わらない", JSON.stringify(second.lines) === JSON.stringify(first.lines));
}

// (d) 極小の点で上限20倍が効く。
{
  // 対角線1（500,500）→（501,500）。1000/1=1000倍になるところを20倍で頭打ちにする。
  const lines: Line[] = [{ c: "#000000", p: [500, 500, 501, 500], w: 2 }];
  const result = fitDrawingLinesToCircle(lines);
  check("(d) changed=true", result.changed === true);
  // 中心(500.5,500)。scale=20なら 500 - 0.5*20=490, 500+0.5*20=510 のはず（丸め後）。
  const xs = result.lines[0].p.filter((_, i) => i % 2 === 0);
  const spanX = Math.max(...xs) - Math.min(...xs);
  check(`(d) 上限20倍が適用され、幅が約20になる（実測${spanX}）`, Math.abs(spanX - 20) <= 1);
}

// (e) 変換後の全座標が0〜1000内。
{
  // 中心が丸のふちギリギリ・非常に不均衡な矩形で、クランプが効くかを確認する。
  const lines: Line[] = [
    { c: "#000000", p: [0, 0, 50, 0, 50, 10, 0, 10], w: 2 }, // 幅50・高さ10、左上寄り
  ];
  const result = fitDrawingLinesToCircle(lines);
  let allInRange = true;
  for (const line of result.lines) {
    for (const v of line.p) {
      if (v < 0 || v > 1000) allInRange = false;
    }
  }
  check("(e) 変換後の全座標が0〜1000内", allInRange);
}

// (f) 線の本数・各線の点数・w・cが変わらない。
{
  const lines: Line[] = [
    { c: "#2E2E2E", p: [10, 10, 20, 20, 30, 10], w: 2 },
    { c: "#E85D75", p: [100, 100, 110, 110], w: 7 },
  ];
  const result = fitDrawingLinesToCircle(lines);
  check("(f) changed=true", result.changed === true);
  check("(f) 線の本数が変わらない", result.lines.length === lines.length);
  check(
    "(f) 各線の点数が変わらない",
    result.lines.every((l, i) => l.p.length === lines[i].p.length)
  );
  check(
    "(f) wが変わらない",
    result.lines.every((l, i) => l.w === lines[i].w)
  );
  check(
    "(f) cが変わらない",
    result.lines.every((l, i) => l.c === lines[i].c)
  );
}

// 追加: 線が1本も無いときはchanged=falseのまま（ボタン自体は非表示になる想定だが、
// 関数自体も安全であることを確認する）。
{
  const result = fitDrawingLinesToCircle([]);
  check("線が0本のときchanged=false", result.changed === false);
  check("線が0本のとき空配列のまま", result.lines.length === 0);
}

console.log("");
if (failCount === 0) {
  console.log("全件OK");
} else {
  console.log(`${failCount}件NG`);
  process.exitCode = 1;
}
