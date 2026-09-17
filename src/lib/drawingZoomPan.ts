/**
 * お絵かき画面の拡大表示（主要画面ワイヤーフレーム.md 47章、開発部/成果物/実装メモ.md
 * 235章）で使う、キャンバスの基準直径のクランプ・パン（移動）位置のクランプを
 * 行う純粋関数。UIにもDrawingCanvas.tsx（react-native-svgに依存）にも依存しない形に
 * 切り出し、`node`で直接実行できるようにする（src/lib/treeTapTargets.ts と同じ方針）。
 *
 * - 47.1節 決定1・2: 基準直径は280〜360ptにクランプする。
 * - 47.3節 決定11: パンの範囲は「窓（基準直径）が、拡大後のキャンバス
 *   （基準直径×倍率）の内側に常に収まる」よう、translateX・translateYを
 *   それぞれ [-(基準直径×(倍率−1)), 0] にクランプする。初期値・倍率切替直後の
 *   値はこの範囲の中央。1倍のときは範囲が[0, 0]になり、常にtranslate=0になる
 *   （47.3節「倍率が1倍のときは...translateは常に0でよい」と一致）。
 */

/** 47.1節 決定2: 下限280pt・上限360pt。 */
export const DRAWING_BASE_DIAMETER_MIN = 280;
export const DRAWING_BASE_DIAMETER_MAX = 360;

/** 47.2節 決定4: 倍率は1倍・2倍・3倍の3段階のみ。 */
export const DRAWING_ZOOM_LEVELS = [1, 2, 3] as const;
export type DrawingZoomLevel = (typeof DRAWING_ZOOM_LEVELS)[number];

/**
 * `Screen.tsx`のcontent幅を`onLayout`で実測した値を、280〜360ptにクランプする
 * （47.1節 決定1・2）。`Dimensions.get('window')`は使わず、呼び出し元
 * （`ZoomableDrawingCanvas.tsx`）が実測した値をそのまま渡すこと。
 */
export function clampBaseDiameter(
  measuredWidth: number,
  min: number = DRAWING_BASE_DIAMETER_MIN,
  max: number = DRAWING_BASE_DIAMETER_MAX
): number {
  if (!Number.isFinite(measuredWidth)) return min;
  return Math.max(min, Math.min(max, measuredWidth));
}

/**
 * パンの許容範囲（47.3節 決定11）。窓（基準直径）の中に、基準直径×倍率の
 * キャンバスの端が常に収まるようにする。1倍のときは[0, 0]（常に中央=移動不可）。
 * x軸・y軸で同じ範囲を使う（窓・キャンバスともに正方形/円形で縦横対称のため）。
 */
export function drawingPanRange(baseDiameter: number, zoom: number): { min: number; max: number } {
  const span = baseDiameter * (zoom - 1);
  return { min: -span, max: 0 };
}

/** 倍率切替直後の初期パン位置＝クランプ範囲の中央（47.3節 決定11）。 */
export function centerDrawingPan(baseDiameter: number, zoom: number): number {
  const { min } = drawingPanRange(baseDiameter, zoom);
  return min / 2;
}

/** 2本指ドラッグ中の候補パン位置を、許容範囲内にクランプする（47.10節「空振り」）。 */
export function clampDrawingPan(value: number, baseDiameter: number, zoom: number): number {
  const { min, max } = drawingPanRange(baseDiameter, zoom);
  return Math.max(min, Math.min(max, value));
}
