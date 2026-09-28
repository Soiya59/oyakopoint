/**
 * drawingLineMove.ts の検証スクリプト。drawingShapes.verify.ts（実装メモ309.4章相当）と
 * 同じ方針・同じ書き方（テストランナー未導入のため、Node単体実行の検証スクリプト）。
 *
 *   node src/lib/drawingLineMove.verify.ts
 *
 * このファイルは`.verify.ts`で終わるため`tsconfig.json`のexcludeでtsc型チェック対象外。
 * 型の妥当性は
 *   npx tsc --noEmit --allowImportingTsExtensions src/lib/drawingLineMove.verify.ts
 * で個別に確認できる。
 */
import {
  findLineIndexAtPoint,
  translateLinePoints,
  rotateLinePoints,
  removeLineAtIndex,
  type HitTestLine,
} from "./drawingLineMove.ts";

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

// ---- 1. findLineIndexAtPoint: 線の近くの点はつかめる、遠い点はつかめない ----
{
  const lines: HitTestLine[] = [{ p: [0, 0, 1000, 0], halfWidth: 1 }];
  assertEqual("線のすぐ上の点はつかめる（index 0）", findLineIndexAtPoint(lines, 500, 0, 0), 0);
  assertEqual("線から遠い点はつかめない（null）", findLineIndexAtPoint(lines, 500, 500, 0), null);
}

// ---- 2. extraTolerance: 細い線でも判定の幅を広げればつかめる ----
{
  const thin: HitTestLine[] = [{ p: [0, 0, 1000, 0], halfWidth: 1 }];
  assertEqual(
    "太さの半分より少し離れた点は、広げの許容値が無いとつかめない",
    findLineIndexAtPoint(thin, 500, 10, 0),
    null
  );
  assertEqual(
    "同じ点でも、判定の幅(extraTolerance)を広げるとつかめる",
    findLineIndexAtPoint(thin, 500, 10, 15),
    0
  );
}

// ---- 3. 重なっているときは、あとから描いた（配列の後ろ）ものを優先する ----
{
  const overlapping: HitTestLine[] = [
    { p: [0, 500, 1000, 500], halfWidth: 2 }, // 先に描いた横線
    { p: [500, 0, 500, 1000], halfWidth: 2 }, // あとから描いた縦線（交点は同じ(500,500)）
  ];
  assertEqual("交点ではあとから描いた縦線（index 1）が優先される", findLineIndexAtPoint(overlapping, 500, 500, 0), 1);
}

// ---- 4. 塗った形は内側を押してもつかめる（輪郭から離れていても） ----
{
  // shapeToPolyline("rect", 100, 200, 400, 500) と同じ矩形（drawingShapes.verify.tsのケース1）。
  const rectPoints = [100, 200, 400, 200, 400, 500, 100, 500, 100, 200];
  const filledRect: HitTestLine[] = [{ p: rectPoints, halfWidth: 1, filled: true }];
  const outlineOnlyRect: HitTestLine[] = [{ p: rectPoints, halfWidth: 1, filled: false }];
  // (250,350)は矩形の中心。最も近い辺までの距離は150で、halfWidth+extraToleranceよりずっと大きい。
  assertEqual("塗った形は中心を押してもつかめる（index 0）", findLineIndexAtPoint(filledRect, 250, 350, 5), 0);
  assertEqual(
    "線だけ（塗っていない）は中心を押してもつかめない（null）",
    findLineIndexAtPoint(outlineOnlyRect, 250, 350, 5),
    null
  );
  // 塗った形でも、外側の点はつかめない。
  assertEqual("塗った形でも外側の点はつかめない（null）", findLineIndexAtPoint(filledRect, 50, 50, 5), null);
}

// ---- 5. 何もつかめないとき（空配列）はnull ----
{
  assertEqual("線が1本も無ければnull", findLineIndexAtPoint([], 500, 500, 100), null);
}

// ---- 6. translateLinePoints: 単純な平行移動 ----
{
  // [2026-09-27修正] 形ごと端で止まる。1点目のy=0は上端にあるので、上へ(-20)は動かず、
  // 形全体のyは変わらない（点ごとにつぶさない）。xは10だけ動く。
  assertEqual(
    "(dx,dy)ぶん全ての点が同じだけ動く。端より外へは形ごと止まる",
    translateLinePoints([0, 0, 500, 500, 100, 200], 10, -20),
    [10, 0, 510, 500, 110, 200]
  );
}

// ---- 7. translateLinePoints: 形の外枠が0〜1000に収まるところで止まる（形はつぶさない） ----
{
  // 右へ50動かそうとしても、右端の点(999)が1000に着いたところ(+1)で止まる。上へは既に0なので動かない。
  const result = translateLinePoints([0, 0, 500, 500, 999, 999], 50, -1000);
  assertEqual("形の外枠が端に着いたところで止まり、点どうしの間隔は変わらない", result, [1, 0, 501, 500, 1000, 999]);
}

// ---- 8. translateLinePoints: 整数に丸める（DB側chk_family_drawings_line_dataの整数制約） ----
{
  const result = translateLinePoints([0, 0], 2.6, -0.4);
  assert("結果は整数のまま", result.every((v) => Number.isInteger(v)));
  assertEqual("小数のdx/dyも四捨五入・0未満は0にクランプされる", result, [3, 0]);
}

// ---- 9. rotateLinePoints: 90度は時計回り（yが下向きの正規化座標での向きの確認） ----
{
  // 中心(500,500)の水平な線分[(400,500)-(600,500)]。90度時計回りに回すと、
  // 「右（3時の位置）」が「下（6時の位置）」へ、「左（9時）」が「上（12時）」へ動く
  // 垂直な線分になるはず（実装メモ316章のコメントで示した向きの根拠と対応）。
  assertEqual(
    "90度回すと、右向きの線が下向きの線になる（時計回り）",
    rotateLinePoints([400, 500, 600, 500], 90),
    [500, 400, 500, 600]
  );
}

// ---- 10. rotateLinePoints: 360度回すと、ほぼ元の座標に戻る（浮動小数の丸め後は完全一致） ----
{
  assertEqual(
    "360度回すと元の座標と一致する（キャンバス内に収まる形の場合）",
    rotateLinePoints([100, 200, 900, 300, 500, 800], 360),
    [100, 200, 900, 300, 500, 800]
  );
}

// ---- 11. rotateLinePoints: はみ出す場合は315章と同じく形ごと端で止まる（つぶさない） ----
{
  // 上端いっぱいの水平線[(0,0)-(1000,0)]を、中心(500,0)のまわりに90度回すと、
  // 数学的には(500,-500)-(500,500)という上へはみ出す垂直線になる。
  // 315章のtranslateLinePointsと同じ「形ごとずらして収める」により、
  // 下へ500ずらした(500,0)-(500,1000)（長さ1000を保ったまま）になるはず。
  assertEqual(
    "回した結果が端からはみ出すときは、形をつぶさず形全体をずらして収める",
    rotateLinePoints([0, 0, 1000, 0], 90),
    [500, 0, 500, 1000]
  );
}

// ---- 12. rotateLinePoints: 点が1つだけ（2要素）の退化データはそのまま返す ----
{
  assertEqual("点が1つだけの線は回しても変わらない", rotateLinePoints([300, 400], 45), [300, 400]);
}

// ---- 13. removeLineAtIndex: 指定した位置の1本だけ取り除く、他の並び順は変えない ----
{
  assertEqual(
    "真ん中の要素を取り除くと、残りは元の順序のまま詰まる",
    removeLineAtIndex(["a", "b", "c"], 1),
    ["a", "c"]
  );
  assertEqual("先頭を取り除く", removeLineAtIndex(["a", "b", "c"], 0), ["b", "c"]);
  assertEqual("末尾を取り除く", removeLineAtIndex(["a", "b", "c"], 2), ["a", "b"]);
}

// ---- 14. removeLineAtIndex: 範囲外のindexは何もしない（元の内容のコピーを返す） ----
{
  assertEqual("負のindexは変更しない", removeLineAtIndex(["a", "b"], -1), ["a", "b"]);
  assertEqual("配列長と同じindex（範囲外）は変更しない", removeLineAtIndex(["a", "b"], 2), ["a", "b"]);
  assertEqual("空配列にindex 0を渡しても変更しない", removeLineAtIndex([], 0), []);
  assertEqual("整数でないindexは変更しない", removeLineAtIndex(["a", "b"], 1.5), ["a", "b"]);
}

// ---- 15. removeLineAtIndex: 元の配列は書き換えない（副作用が無い） ----
{
  const original = ["a", "b", "c"];
  removeLineAtIndex(original, 1);
  assertEqual("元の配列はそのまま", original, ["a", "b", "c"]);
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
