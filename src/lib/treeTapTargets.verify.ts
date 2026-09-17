/**
 * treeTapTargets.ts（`pickNearestTreeTapTarget`）の単体検証。
 * Node.js単体実行で動かす（`node src/lib/treeTapTargets.verify.ts`、
 * simplifyPolyline.verify.ts・sequentialSave.verify.ts と同じ方式）。
 * 参照: 主要画面ワイヤーフレーム.md 46.2節、開発部/成果物/実装メモ.md 233章。
 *
 * このファイルはNode単体実行専用のためtsconfig.jsonの`exclude`
 * （`**\/*.verify.ts`）でtscの型チェック対象から外している。
 */
import { pickNearestTreeTapTarget, type TreeTapTarget } from "./treeTapTargets.ts";

let failCount = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "OK  " : "NG  "} ${label}`);
  if (!ok) failCount++;
}

// 1. 決定4: どの対象のキャッチ範囲にも入らないタップ（空振り）はnullになる。
{
  const targets: TreeTapTarget[] = [{ id: "a", x: 100, y: 100, catchRadius: 20 }];
  const result = pickNearestTreeTapTarget(0, 0, targets);
  check("空振り（どのキャッチ範囲にも入らない）はnullになる", result === null);
}

// 2. 対象が1つも無いとき（色丸しか無い等）は必ずnull。
{
  const result = pickNearestTreeTapTarget(50, 50, []);
  check("対象が1つも無いときはnull", result === null);
}

// 3. 決定3: 重なった2対象は、タップ位置に近い方が選ばれる。
//    景品（36pt相当・キャッチ半径28）とステッカー（30pt相当・キャッチ半径28）が
//    近接して重なっている状況を想定。
{
  const targets: TreeTapTarget[] = [
    { id: "prize:1", x: 100, y: 100, catchRadius: 28 },
    { id: "sticker:1", x: 115, y: 100, catchRadius: 28 },
  ];
  // タップ位置(105,100)は両方のキャッチ範囲に入るが、prize:1の方が近い（距離5 vs 10）。
  const nearPrize = pickNearestTreeTapTarget(105, 100, targets);
  check("重なった2対象: prize寄りのタップはprizeが選ばれる（近い方優先）", nearPrize === "prize:1");

  // タップ位置(112,100)は両方のキャッチ範囲に入るが、sticker:1の方が近い（距離3 vs 12）。
  const nearSticker = pickNearestTreeTapTarget(112, 100, targets);
  check("重なった2対象: sticker寄りのタップはstickerが選ばれる（近い方優先）", nearSticker === "sticker:1");
}

// 4. ちょうど中間（距離が同じ）でも、どちらか一方が必ず決定論的に選ばれる
//    （タップの位置とターゲットの並び順だけで決まり、乱数は使わない）。
{
  const targets: TreeTapTarget[] = [
    { id: "left", x: 90, y: 100, catchRadius: 28 },
    { id: "right", x: 110, y: 100, catchRadius: 28 },
  ];
  const a = pickNearestTreeTapTarget(100, 100, targets);
  const b = pickNearestTreeTapTarget(100, 100, targets);
  check("同じ入力を2回計算しても同じ結果になる（決定性）", a === b);
  check("距離が同じ場合は先に一致した対象（配列の先頭側）が選ばれる", a === "left");
}

// 5. キャッチ半径ちょうど（境界値）は「範囲内」として拾う（距離<=catchRadius）。
{
  const targets: TreeTapTarget[] = [{ id: "a", x: 0, y: 0, catchRadius: 10 }];
  const onBoundary = pickNearestTreeTapTarget(10, 0, targets); // 距離ちょうど10
  const justOutside = pickNearestTreeTapTarget(10.01, 0, targets); // 距離10.01
  check("キャッチ半径ちょうどの距離は範囲内として拾う", onBoundary === "a");
  check("キャッチ半径をわずかに超えると空振りになる", justOutside === null);
}

// 6. 3対象以上でも、最も近い1件だけを選ぶ（複数一致しない）。
{
  const targets: TreeTapTarget[] = [
    { id: "a", x: 0, y: 0, catchRadius: 50 },
    { id: "b", x: 20, y: 0, catchRadius: 50 },
    { id: "c", x: 40, y: 0, catchRadius: 50 },
  ];
  const result = pickNearestTreeTapTarget(22, 0, targets);
  check("3対象が重なっていても最も近い1件だけが選ばれる", result === "b");
}

console.log("");
if (failCount === 0) {
  console.log("全件OK");
} else {
  console.log(`${failCount}件NG`);
  process.exitCode = 1;
}
