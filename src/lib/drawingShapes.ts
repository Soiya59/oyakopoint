/**
 * お絵かきの「形ツール」（ペン／〇／△／□、実装メモ.md 309章、本部長依頼
 * 2026-09-26・軽微変更ルート）で使う純粋関数。UIにもDrawingCanvas.tsx
 * （react-native-svgに依存）にも依存しない形に切り出し、`node`単体実行で
 * 検証できるようにする（src/lib/fitDrawingToCircle.ts・drawingCanvasCoords.ts
 * と同じ方針）。
 *
 * [仕様の要点・依頼文どおり]
 * - なぞった始点・終点（0〜1000正規化座標、スキーマ設計.sql 33b章）が作る
 *   バウンディングボックスの中に、選んだ形の輪郭だけ（中は塗らない）を
 *   1本の閉じたポリラインとして組み立てる。
 * - 三角は「なぞった範囲の中に上向きの二等辺三角形」。
 * - 四角は「なぞった範囲の長方形」。
 * - 丸は「なぞった範囲に内接する楕円」。
 * - 戻り値は`FamilyDrawingLine.p`と同じ[x1,y1,x2,y2,...]のフラット配列。
 *   保存形式・DBスキーマは一切変えない（依頼文「データベースの変更はしない」）。
 * - 始点と終点が同一点（ドラッグせずタップだけ）のときは空配列を返す。
 *   呼び出し元（DrawingCanvas.tsx）は「1点だけのタップは線として保存しない」
 *   既存ルール（finishStroke）と同じ基準（長さ2未満は破棄）で扱えばよい。
 *
 * [線を間引く処理（simplifyPolyline.ts）は使わない]
 * ここで組み立てる点はもともと少数（丸でも49点、1本あたり上限300点
 * ＝theme.drawingLimits.maxPointsPerLineに対して十分小さい）かつ、形の輪郭を
 * 保つのに全点が必要なため、Douglas-Peucker型の間引きをかけると角が丸まって
 * 崩れる（依頼文の指示どおり、呼び出し元でも適用しないこと）。
 */

/** 現在選択中の道具。"pen"＝自由な線（既定・従来どおり）。 */
export type DrawingTool = "pen" | "circle" | "triangle" | "rect";

/** "pen"を除いた3種類（道具ボタンの並び・DrawingCanvas.tsxの分岐で使う）。 */
export const DRAWING_SHAPE_TOOLS: readonly Exclude<DrawingTool, "pen">[] = [
  "circle",
  "triangle",
  "rect",
];

/**
 * 丸の輪郭を近似する頂点数。1本あたりの点数上限（300、theme.drawingLimits.
 * maxPointsPerLine）に対して十分小さく保ちつつ、280〜360pt程度のキャンバスで
 * 見た目がなめらかな円に見える数を選んだ（+1で始点に戻って閉じるため、
 * 実際の点数は49）。
 */
const CIRCLE_SEGMENTS = 48;

/** DrawingCanvas.tsxのtoNormalized・fitDrawingToCircle.tsのclampNormalizedと同じ最終防衛クランプ。 */
function clampNormalized(value: number): number {
  return Math.max(0, Math.min(1000, Math.round(value)));
}

/**
 * なぞった始点(x0,y0)・終点(x1,y1)（0〜1000正規化座標、順不同でよい）から、
 * 選んだ形の輪郭を1本の閉じたポリラインとして組み立てる。
 */
export function shapeToPolyline(
  tool: Exclude<DrawingTool, "pen">,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number[] {
  const xMin = Math.min(x0, x1);
  const xMax = Math.max(x0, x1);
  const yMin = Math.min(y0, y1);
  const yMax = Math.max(y0, y1);
  // ドラッグせずタップしただけ（始点=終点）は形にならない。
  if (xMin === xMax && yMin === yMax) return [];

  if (tool === "rect") {
    // 長方形。左上から時計回りに4隅を結び、始点に戻って閉じる（5点）。
    return [xMin, yMin, xMax, yMin, xMax, yMax, xMin, yMax, xMin, yMin];
  }

  if (tool === "triangle") {
    // 上向きの二等辺三角形。頂点は範囲上辺の中央、底辺は範囲の左下・右下。
    const apexX = clampNormalized((xMin + xMax) / 2);
    return [apexX, yMin, xMax, yMax, xMin, yMax, apexX, yMin];
  }

  // circle: 範囲に内接する楕円。中心から等角度でCIRCLE_SEGMENTS個の点を打ち、
  // 最後に始点（角度0）へ戻って閉じる。
  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  const rx = (xMax - xMin) / 2;
  const ry = (yMax - yMin) / 2;
  const points: number[] = [];
  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    points.push(clampNormalized(cx + rx * Math.cos(angle)), clampNormalized(cy + ry * Math.sin(angle)));
  }
  return points;
}
