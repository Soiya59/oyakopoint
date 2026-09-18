/**
 * drawingCanvasCoords.ts の単体検証（`node src/lib/drawingCanvasCoords.verify.ts`、
 * drawingZoomPan.verify.ts と同じ方式）。
 * 参照: 開発部/成果物/実装メモ.md 245章「お絵かきの線がずれる（Android、拡大表示
 * 導入後の退行）」。
 *
 * このファイルはNode単体実行専用のためtsconfig.jsonの`exclude`
 * （`**\/*.verify.ts`）でtscの型チェック対象から外している。
 */
import { normalizeDrawingPoint, denormalizeDrawingPoint } from "./drawingCanvasCoords.ts";
import {
  clampBaseDiameter,
  centerDrawingPan,
  drawingPanRange,
  type DrawingZoomLevel,
} from "./drawingZoomPan.ts";

let failCount = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "OK  " : "NG  "} ${label}`);
  if (!ok) failCount++;
}
function approxEqual(a: number, b: number, tolerance = 1): boolean {
  return Math.abs(a - b) <= tolerance;
}

// 1. normalizeDrawingPoint / denormalizeDrawingPoint 単体の基本動作。
{
  check("中央(size/2, size/2)は[500, 500]になる", (() => {
    const [nx, ny] = normalizeDrawingPoint(140, 140, 280);
    return nx === 500 && ny === 500;
  })());
  check("左上(0,0)は[0, 0]", (() => {
    const [nx, ny] = normalizeDrawingPoint(0, 0, 280);
    return nx === 0 && ny === 0;
  })());
  check("右下(size,size)は[1000, 1000]", (() => {
    const [nx, ny] = normalizeDrawingPoint(280, 280, 280);
    return nx === 1000 && ny === 1000;
  })());
  check("size範囲外（負のpx）は0にクランプ", normalizeDrawingPoint(-10, -10, 280)[0] === 0);
  check("size範囲外（size超過のpx）は1000にクランプ", normalizeDrawingPoint(9999, 9999, 280)[0] === 1000);
  check("denormalize(500,500,280)は中央(140,140)に戻る", (() => {
    const [x, y] = denormalizeDrawingPoint(500, 500, 280);
    return x === 140 && y === 140;
  })());
}

// 2. [本題] normalize→denormalizeの往復が、1倍・2倍・3倍のどのinnerSizeでも
//    正確に戻ることの確認（式自体は正しいことの確認。245章コメントのとおり、
//    これだけでは退行の再発は防げない。3節が本体）。
{
  const baseDiameters = [280, 320, 360]; // クランプ範囲の下限・中間・上限（drawingZoomPan.ts）
  const zooms: DrawingZoomLevel[] = [1, 2, 3];
  for (const base of baseDiameters) {
    for (const zoom of zooms) {
      const innerSize = base * zoom;
      // キャンバス内のいろいろな位置（隅・中央寄り）で往復を確認する。
      const samplePoints: Array<[number, number]> = [
        [0, 0],
        [innerSize, innerSize],
        [innerSize / 2, innerSize / 3],
        [innerSize * 0.9, innerSize * 0.1],
      ];
      for (const [px, py] of samplePoints) {
        const [nx, ny] = normalizeDrawingPoint(px, py, innerSize);
        const [rx, ry] = denormalizeDrawingPoint(nx, ny, innerSize);
        check(
          `基準${base}pt・${zoom}倍（innerSize=${innerSize}）: (${px.toFixed(1)},${py.toFixed(1)})の往復誤差が1pt以内`,
          approxEqual(rx, px) && approxEqual(ry, py)
        );
      }
    }
  }
}

// 3. [本題] 実装メモ245章の退行そのものの再現とサイズの確認。
//    235章導入前、DrawingCanvas.tsxのsizeは呼び出し元がずっと固定値で渡すものだった
//    （AvatarDrawingPanel.tsxは今もsize propを渡さずtheme.drawingLimits.canvasDiameter
//    ＝280固定のまま。だから無傷だった）。235章でZoomableDrawingCanvas.tsxが
//    「初回レンダー後にonLayoutで実測して変わる・倍率ボタンで変わる」sizeを渡すように
//    なったことで、`useRef(PanResponder.create({...}))`が
//    （node_modules/react-native/Libraries/Renderer/implementations/
//    ReactFabric-dev.jsのuseRef実装どおり）マウント時点のsizeだけを一生使い続ける
//    という前提が崩れた。
//
// ここでは「窓が実測される前のsize（常に280＝clampBaseDiameter(280)、
// theme.drawingLimits.canvasDiameter）」を`staleSize`、「その後の再レンダーで
// 確定した、その時点の本当のinnerSize」を`currentInnerSize`として、
// - 直したtoNormalized相当（`normalizeThenRender`のsizeArgに`currentInnerSize`を渡す）
//   は誤差0
// - 235章時点の実装相当（sizeArgに`staleSize`を渡す＝normalize時とrender時で
//   使うsizeが食い違う）は、baseDiameterが280ちょうどでない限り誤差が出て、
//   かつ倍率が上がるほど誤差が大きくなる
// ことを確認する。
{
  const STALE_SIZE = 280; // theme.drawingLimits.canvasDiameter（onLayout確定前のデフォルト）

  /**
   * 「窓の中でのタッチ位置（windowRelativeTouch、0〜baseDiameter）」→
   * 「キャンバス自身の座標（canvasRelative）」への変換。
   * ZoomableDrawingCanvas.tsxの`transform: [{translateX: pan.x}, ...]`により、
   * キャンバスの実際の左上は窓の左上からpanぶんずれている
   * （pan<=0なので、canvasRelative = windowRelativeTouch - pan は常に
   * windowRelativeTouch以上になる）。
   */
  function toCanvasRelative(windowRelativeTouch: number, pan: number): number {
    return windowRelativeTouch - pan;
  }

  /**
   * 一往復（タッチ→normalize→denormalize→画面上の位置）をシミュレートする。
   * `normalizeSize`と`renderSize`をわざと別引数にしているのは、235章の実装が
   * まさに「normalize（タッチ取得）は古いsize・render（描画）は新しいsize」という
   * 食い違いを起こしていたことを再現するため。
   */
  function simulateRoundTrip(
    windowRelativeTouch: number,
    pan: number,
    normalizeSize: number,
    renderSize: number
  ): number {
    const canvasRelative = toCanvasRelative(windowRelativeTouch, pan);
    const [nx] = normalizeDrawingPoint(canvasRelative, canvasRelative, normalizeSize);
    const [rx] = denormalizeDrawingPoint(nx, nx, renderSize);
    return rx + pan; // 窓基準の「実際に絵が描かれる位置」に戻す
  }

  // 3-1. 直した実装（sizeRef.current、常にnormalize/renderとも「今のinnerSize」）は
  //      1倍・2倍・3倍・パン後のどれでも誤差ゼロ。
  {
    const realBaseDiameters = [280, 320, 360];
    const zooms: DrawingZoomLevel[] = [1, 2, 3];
    // 「端のほう」を含む複数のタッチ位置（窓は常にbaseDiameterの大きさ）。
    for (const base of realBaseDiameters) {
      for (const zoom of zooms) {
        const innerSize = base * zoom;
        const { min: panMin } = drawingPanRange(base, zoom);
        const pans = [0, centerDrawingPan(base, zoom), panMin]; // 中央リセット直後・2本指パンで端まで寄せた場合
        const windowTouches = [0, base * 0.1, base / 2, base * 0.9, base];
        for (const pan of pans) {
          for (const w of windowTouches) {
            const rendered = simulateRoundTrip(w, pan, innerSize, innerSize);
            check(
              `[修正後] 基準${base}pt・${zoom}倍・pan=${pan.toFixed(1)}・窓上${w.toFixed(1)}pt: ` +
                `誤差1pt以内（実測=${rendered.toFixed(2)}）`,
              approxEqual(rendered, w)
            );
          }
        }
      }
    }
  }

  // 3-2. 235章時点の実装（normalizeだけSTALE_SIZE=280のまま）を再現し、
  //      (a) baseDiameterがちょうど280のときは誤差が出ない
  //      (b) baseDiameterが280より大きい実機ではズームが上がるほど誤差が
  //          大きくなる（本部長の「誤差はinnerSizeに比例する」という解釈と
  //          整合する。ただしパン量・タッチ位置によっては誤差が単純な
  //          「2倍」にとどまらず、正規化が1000に張り付いて更に大きく歪む
  //          こともある——実機の「1cm→2cm」という体感値はおおよその目安であり、
  //          厳密な比例ではないことも合わせて確認する）
  //      ことを示す。
  {
    check(
      "[退行] 実測直径がちょうど280pt（下限）のときはstaleSizeと一致するため誤差ゼロ",
      (() => {
        const base = 280;
        const zoom = 1;
        const innerSize = base * zoom;
        const rendered = simulateRoundTrip(base / 2, 0, STALE_SIZE, innerSize);
        return approxEqual(rendered, base / 2);
      })()
    );

    // 実機でよくある「280より広い」ケース（例: 320pt）。窓の同じ相対位置
    // （左端寄り、10%の位置）を1倍・2倍・3倍で比較する。
    const base = 320;
    const touchFraction = 0.1; // 窓の左端から10%の位置（統括の「1cm」テストに近い、
    // 中央付近ではなく偏った位置を選ぶ——中央だと2倍以降でclamp(1000)に張り付いて
    // 比較にならないため。詳しくは本節の説明コメント参照）。
    const errorsByZoom: number[] = [];
    for (const zoom of [1, 2, 3] as DrawingZoomLevel[]) {
      const innerSize = base * zoom;
      const pan = centerDrawingPan(base, zoom); // 倍率ボタン押下直後を想定
      const w = base * touchFraction;
      const rendered = simulateRoundTrip(w, pan, STALE_SIZE, innerSize);
      const error = Math.abs(rendered - w);
      errorsByZoom.push(error);
      console.log(
        `    参考値: 基準${base}pt・${zoom}倍・窓上${w.toFixed(1)}pt → 描画位置${rendered.toFixed(
          2
        )}pt（誤差${error.toFixed(2)}pt）`
      );
    }
    check("[退行] 1倍でも誤差が発生する（基準320pt ≠ staleSize280pt のため）", errorsByZoom[0] > 2);
    check(
      "[退行] 誤差は倍率が上がるほど大きくなる（本部長の指摘と整合。厳密な2倍・3倍は保証しない）",
      errorsByZoom[1] > errorsByZoom[0] && errorsByZoom[2] > errorsByZoom[1]
    );
  }
}

console.log("");
if (failCount === 0) {
  console.log("全件OK");
} else {
  console.log(`${failCount}件NG`);
  process.exitCode = 1;
}
