/**
 * お絵かきキャンバスの「実ピクセル座標 ⇔ 0〜1000正規化座標」の変換を担う純粋関数。
 * `DrawingCanvas.tsx`の`toNormalized`（タッチ→保存用データ）・`pointsToPolylineString`
 * （保存済みデータ→描画）が使う式をここへ集約し、`node`単体実行で検証できるように
 * する（`src/lib/drawingZoomPan.ts`と同じ方針）。
 *
 * 参照: 開発部/成果物/実装メモ.md 245章「お絵かきの線がずれる（Android、拡大表示
 * 導入後の退行）」。
 *
 * [245章の教訓——この2つの式は235章より前から一度も変わっていない]
 * 実際の不具合は、この関数自体の数式ではなく「`DrawingCanvas.tsx`側で
 * `normalizeDrawingPoint`に渡す`size`引数が、`useRef(PanResponder.create({...}))`の
 * クロージャに固定された『マウント時点の古い値』になっていた」ことにあった
 * （詳細は`DrawingCanvas.tsx`の`sizeRef`宣言のコメント）。そのため、この関数
 * 単体のテスト（`drawingCanvasCoords.verify.ts`前半）は「式は正しい」ことしか
 * 示せない。退行の再発防止には、同ファイル後半の「sizeが変化する状況の再現」
 * （旧実装のようにnormalize側だけ古いsizeを使うとどうなるか）が要る。
 */

/**
 * 実ピクセル座標（px, py）を0〜1000の整数へ正規化する。
 * `size`は必ず「このタッチを受け取ったキャンバス自身の、その瞬間の実サイズ」を渡すこと
 * （`DrawingCanvas.tsx`では`sizeRef.current`。245章参照）。
 */
export function normalizeDrawingPoint(px: number, py: number, size: number): [number, number] {
  const nx = Math.max(0, Math.min(1000, Math.round((px / size) * 1000)));
  const ny = Math.max(0, Math.min(1000, Math.round((py / size) * 1000)));
  return [nx, ny];
}

/**
 * 0〜1000の正規化座標を、指定サイズの実ピクセル座標へ戻す
 * （`pointsToPolylineString`が1点ごとに行っている計算と同じ式）。
 */
export function denormalizeDrawingPoint(nx: number, ny: number, size: number): [number, number] {
  return [(nx / 1000) * size, (ny / 1000) * size];
}
