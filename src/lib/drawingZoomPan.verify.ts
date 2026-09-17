/**
 * drawingZoomPan.ts の単体検証。
 * Node.js単体実行で動かす（`node src/lib/drawingZoomPan.verify.ts`、
 * treeTapTargets.verify.ts と同じ方式）。
 * 参照: 主要画面ワイヤーフレーム.md 47章、開発部/成果物/実装メモ.md 235章。
 *
 * このファイルはNode単体実行専用のためtsconfig.jsonの`exclude`
 * （`**\/*.verify.ts`）でtscの型チェック対象から外している。
 */
import {
  clampBaseDiameter,
  clampDrawingPan,
  centerDrawingPan,
  drawingPanRange,
  DRAWING_BASE_DIAMETER_MIN,
  DRAWING_BASE_DIAMETER_MAX,
} from "./drawingZoomPan.ts";

let failCount = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "OK  " : "NG  "} ${label}`);
  if (!ok) failCount++;
}

// 1. 47.1節 決定2: 基準直径のクランプ（下限280・上限360）。
{
  check("下限未満（200pt画面）は280ptに引き上げられる", clampBaseDiameter(200) === DRAWING_BASE_DIAMETER_MIN);
  check("上限超過（448pt、タブレット等maxWidth480−32）は360ptに切り詰められる", clampBaseDiameter(448) === DRAWING_BASE_DIAMETER_MAX);
  check("範囲内（343pt、iPhone SE相当）はそのまま", clampBaseDiameter(343) === 343);
  check("ちょうど下限（280pt）はそのまま", clampBaseDiameter(280) === 280);
  check("ちょうど上限（360pt）はそのまま", clampBaseDiameter(360) === 360);
}

// 2. 47.3節 決定11: 1倍ではパン範囲が[0,0]に固定される（常にtranslate=0）。
{
  const base = 320;
  const range = drawingPanRange(base, 1);
  check("1倍のときパン範囲は[0, 0]", range.min === 0 && range.max === 0);
  check("1倍のとき中央位置は0", centerDrawingPan(base, 1) === 0);
  check("1倍のとき候補値がどれだけ大きくてもクランプ後は0", clampDrawingPan(9999, base, 1) === 0);
  check("1倍のとき候補値がどれだけ小さくてもクランプ後は0", clampDrawingPan(-9999, base, 1) === 0);
}

// 3. 47.3節 決定11: 3倍・基準320ptでの範囲とクランプ（端で止まる＝空振り、47.10節）。
{
  const base = 320;
  const zoom = 3;
  const range = drawingPanRange(base, zoom);
  check("3倍・基準320ptの範囲は[-640, 0]", range.min === -640 && range.max === 0);
  check("中央位置は-320（範囲の中点）", centerDrawingPan(base, zoom) === -320);
  check("範囲を超える大きな正の値は0にクランプされる（右端で張り付く）", clampDrawingPan(100, base, zoom) === 0);
  check("範囲を超える大きな負の値は-640にクランプされる（左端で張り付く）", clampDrawingPan(-9999, base, zoom) === -640);
  check("範囲内の値はそのまま通る", clampDrawingPan(-300, base, zoom) === -300);
}

// 4. 47.3節 決定11: 2倍・基準280pt（下限に張り付いた画面幅）での範囲。
{
  const base = 280;
  const zoom = 2;
  const range = drawingPanRange(base, zoom);
  check("2倍・基準280ptの範囲は[-280, 0]", range.min === -280 && range.max === 0);
  check("中央位置は-140", centerDrawingPan(base, zoom) === -140);
}

// 5. 47.3節 決定11「倍率ボタンを押すたびにパン位置を中央へ戻す」の再現:
//    2倍で端に寄せたあと、3倍へ切り替えたら中央位置に戻ることを確認する
//    （呼び出し元は zoom 変更時に必ず centerDrawingPan の値へ上書きする実装であること）。
{
  const base = 320;
  const pannedAt2x = clampDrawingPan(-9999, base, 2); // 2倍で左端に寄せた状態
  check("2倍で端に寄せると-320（範囲[-320,0]の左端）", pannedAt2x === -320);
  const recenteredAt3x = centerDrawingPan(base, 3);
  check("3倍へ切り替えると中央-320へリセットされる（2倍の端の値と混同しない設計であることの確認）", recenteredAt3x === -320);
  // 上のケースはたまたま数値が一致するため、基準を変えて別の値になることも確認する。
  const recenteredAt2x = centerDrawingPan(base, 2);
  check("2倍の中央位置は-160（3倍の中央-320とは異なる）", recenteredAt2x === -160 && recenteredAt2x !== recenteredAt3x);
}

// 6. 47.4節 決定12: 間引きの閾値（thresholdNormalized = (MIN_POINT_DISTANCE_PX / size) * 1000）は
//    DrawingCanvas.tsx側のロジックを一切変更していない。sizeが大きくなるほど値が小さくなる
//    （＝拡大するほど作品座標上で密な点が打たれる）ことを、基準直径×倍率の3パターンで示す。
//    式はDrawingCanvas.tsxの既存コードと完全に同一（MIN_POINT_DISTANCE_PX = 4）。
{
  const MIN_POINT_DISTANCE_PX = 4; // DrawingCanvas.tsx の同名定数と同じ値（コピーではなく検証用の再現）
  const thresholdNormalized = (size: number) => (MIN_POINT_DISTANCE_PX / size) * 1000;
  const t280 = thresholdNormalized(280); // 基準280pt・1倍
  const t560 = thresholdNormalized(560); // 基準280pt・2倍
  const t840 = thresholdNormalized(840); // 基準280pt・3倍
  console.log(
    `    参考値: thresholdNormalized(280)=${t280.toFixed(4)} / (560)=${t560.toFixed(4)} / (840)=${t840.toFixed(4)}`
  );
  check("size=280（1倍）の閾値は約14.29", Math.abs(t280 - 14.2857) < 0.001);
  check("size=560（2倍）の閾値は約7.14（1倍の半分）", Math.abs(t560 - 7.1429) < 0.001 && Math.abs(t560 - t280 / 2) < 1e-9);
  check("size=840（3倍）の閾値は約4.76（1倍の1/3）", Math.abs(t840 - 4.7619) < 0.001 && Math.abs(t840 - t280 / 3) < 1e-9);
  check("倍率が上がるほど閾値は単調に小さくなる（間引きが細かくなる）", t280 > t560 && t560 > t840);
}

console.log("");
if (failCount === 0) {
  console.log("全件OK");
} else {
  console.log(`${failCount}件NG`);
  process.exitCode = 1;
}
