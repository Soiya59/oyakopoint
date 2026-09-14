/**
 * `pickDisplaySlots`（FamilyTree.tsx）の単体検証（実装メモ224章・案A）。
 * Node.js単体実行で動かす（`node src/components/pickDisplaySlots.verify.ts`、
 * 139/140章の`pickTreeRegion.verify.ts`と同じ方式）。
 *
 * [経緯] 223章の調査で、かざりつけモードで一覧から選んだ完了報告（まだ`prize`が
 * 付いていない色丸）が、今シーズンの合計が40件を超える家庭ではreservoir sampling
 * によって表示対象から漏れることがあり、「選んだ瞬間は木の上に何も出ないのに、
 * 確定すると別の場所に景品が現れる」という不具合になっていた（223.1節）。
 * 統括は223.4節の**案A**（選択中の完了報告を、景品と同じ「40枠の優先確保」の
 * 対象に格上げする）を選んだ（2026-09-14）。
 *
 * 本ファイルは`pickDisplaySlots`に`forceIncludeId`引数を追加した変更を検証する。
 * FamilyTree.tsxは`react-native`・`react-native-svg`をimportしJSXも含むため
 * （Node単体実行の型ストリッピングはJSXを消せない）、`pickDisplaySlots`本体を
 * 直接importできない。139/140章と同じ方式で、検証対象の定義
 * （`FamilyTreeCompletionDot`相当の最小型・`stableHash`・`reservoirSample`・
 * `isPrioritizedDot`・`pickDisplaySlots`）をFamilyTree.tsxから**そのまま複製**する。
 * 複製した行はFamilyTree.tsxの該当行と完全に一致させてあり、
 * **FamilyTree.tsx側を変更したらこのファイルも追随させること。**
 *
 * 加えて、「変更前（224章より前）の`pickDisplaySlots`」も
 * `oldPickDisplaySlots`として複製し、`forceIncludeId`を渡さない新実装の結果と
 * 突き合わせる（検証2「変更なし」の本体）。
 */

// ---- FamilyTree.tsx からそのまま複製（最小のDot型。avatar_color・prizeのみ使う） ----
interface Dot {
  id: string;
  avatar_color: string | null;
  prize: { dummy: true } | null;
}

// ---- FamilyTree.tsx からそのまま複製（stableHash） ----
function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = (h * 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = (h * 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// ---- FamilyTree.tsx からそのまま複製（reservoirSample） ----
function reservoirSample(dots: Dot[], slotCount: number): Dot[] {
  if (slotCount <= 0) return [];
  const slots: (Dot | null)[] = Array.from({ length: slotCount }, () => null);
  dots.forEach((dot, i) => {
    if (i < slotCount) {
      slots[i] = dot;
      return;
    }
    const j = stableHash(dot.id) % (i + 1);
    if (j < slotCount) slots[j] = dot;
  });
  return slots.filter((d): d is Dot => d !== null);
}

const MAX_SLOTS = 40;

// ---- FamilyTree.tsx からそのまま複製（isPrioritizedDot） ----
function isPrioritizedDot(d: Dot): boolean {
  return d.prize !== null;
}

// ---- 224章より前の実装（比較対象・旧実装） ----
function oldPickDisplaySlots(dots: Dot[]): Dot[] {
  const prizeDots = dots.filter(isPrioritizedDot);
  const normalDots = dots.filter((d) => !isPrioritizedDot(d));

  const keptPrizes = prizeDots.length <= MAX_SLOTS ? prizeDots : reservoirSample(prizeDots, MAX_SLOTS);
  const remainingSlots = MAX_SLOTS - keptPrizes.length;
  const keptNormal = reservoirSample(normalDots, remainingSlots);

  return [...keptPrizes, ...keptNormal];
}

// ---- FamilyTree.tsx からそのまま複製（224章・案Aの現行実装） ----
function pickDisplaySlots(dots: Dot[], forceIncludeId?: string | null): Dot[] {
  const prizeDots = dots.filter(isPrioritizedDot);
  const normalDots = dots.filter((d) => !isPrioritizedDot(d));

  const keptPrizes = prizeDots.length <= MAX_SLOTS ? prizeDots : reservoirSample(prizeDots, MAX_SLOTS);
  const remainingSlots = MAX_SLOTS - keptPrizes.length;
  const keptNormal = reservoirSample(normalDots, remainingSlots);

  const result = [...keptPrizes, ...keptNormal];
  if (forceIncludeId != null && !result.some((d) => d.id === forceIncludeId)) {
    const forced = dots.find((d) => d.id === forceIncludeId);
    if (forced) result.push(forced);
  }
  return result;
}

// ---- テスト用データ生成 ----
function makeDots(count: number, prizeRatio: number, seed: number): Dot[] {
  const dots: Dot[] = [];
  for (let i = 0; i < count; i++) {
    const id = `completion-${seed}-${String(i).padStart(3, "0")}`;
    const isPrize = (stableHash(`${id}|prize|${seed}`) % 1000) / 1000 < prizeRatio;
    dots.push({ id, avatar_color: null, prize: isPrize ? { dummy: true } : null });
  }
  return dots;
}

function sameSet(a: Dot[], b: Dot[]): boolean {
  if (a.length !== b.length) return false;
  const idsA = a.map((d) => d.id).sort();
  const idsB = b.map((d) => d.id).sort();
  return idsA.every((id, i) => id === idsB[i]);
}

let failCount = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "OK  " : "NG  "} ${label}`);
  if (!ok) failCount++;
}

const TRIALS = 500;

// 1. 検収条件「選択中IDを渡さないときは変更前とまったく同じ結果になること」。
//    224章より前の実装（oldPickDisplaySlots）と、forceIncludeIdを渡さない
//    新実装（引数省略・undefined・null の3通り）を、45件・0〜120件など
//    件数を変えながら500回突き合わせる。
{
  let allMatch = true;
  let mismatchExample: string | null = null;
  for (let t = 0; t < TRIALS; t++) {
    const count = t % 121; // 0〜120件（40件超え・以下の両方を網羅）
    const prizeRatio = (t % 5) / 10; // 0, 0.1, 0.2, 0.3, 0.4
    const dots = makeDots(count, prizeRatio, t);

    const oldResult = oldPickDisplaySlots(dots);
    const newNoArg = pickDisplaySlots(dots);
    const newUndefined = pickDisplaySlots(dots, undefined);
    const newNull = pickDisplaySlots(dots, null);

    if (!sameSet(oldResult, newNoArg) || !sameSet(oldResult, newUndefined) || !sameSet(oldResult, newNull)) {
      allMatch = false;
      mismatchExample = `trial=${t} count=${count} prizeRatio=${prizeRatio}`;
      break;
    }
  }
  if (!allMatch) console.log(`INFO 不一致の例: ${mismatchExample}`);
  check(
    `選択中IDを渡さないとき（省略・undefined・null）は変更前と全件一致（${TRIALS}試行、件数0〜120・景品比率0〜40%を横断）`,
    allMatch
  );
}

// 2. 検収条件「選択中IDを渡したとき、そのIDが必ず結果に含まれること」。
//    候補（一覧から選べる＝prizeが無い＝normalDots側）からランダムに1件を
//    forceIncludeIdとして渡し、結果に含まれることを確認する。
//    45件・スロット数40超えという223.2節の実測条件を踏襲しつつ、0〜120件を横断する。
{
  let allIncluded = true;
  let neverExceeded = true; // 「40+1」を一度も観測できていない、の意味ではなく単なる保険フラグ
  let observedOver40 = 0;
  let mismatchExample: string | null = null;
  for (let t = 0; t < TRIALS; t++) {
    const count = t % 121;
    const prizeRatio = (t % 5) / 10;
    const dots = makeDots(count, prizeRatio, t + 100000); // 検証1と重複しないシード

    const normalDots = dots.filter((d) => !isPrioritizedDot(d));
    if (normalDots.length === 0) continue; // 選べる候補が無いtrialはスキップ
    const target = normalDots[stableHash(`pick|${t}`) % normalDots.length];

    const result = pickDisplaySlots(dots, target.id);
    const included = result.some((d) => d.id === target.id);
    if (!included) {
      allIncluded = false;
      mismatchExample = `trial=${t} count=${count} targetId=${target.id}`;
    }
    if (result.length > MAX_SLOTS) observedOver40++;
  }
  if (!allIncluded) console.log(`INFO 不一致の例: ${mismatchExample}`);
  console.log(`INFO 40件を超える結果になった試行数: ${observedOver40}/${TRIALS}件（案Aで了承済みの犠牲、40＋選択中の1個）`);
  check(`選択中ID（一覧から選べる候補）を渡したとき、そのIDが必ず結果に含まれる（${TRIALS}試行）`, allIncluded);
  check("40件を超える結果が実際に観測できる（案Aの犠牲が起きていることの実測確認）", observedOver40 > 0);
  void neverExceeded;
}

// 3. 境界ケース: 選択中の対象がもともと表示対象に含まれている場合（40件以下、
//    または40件超えでもたまたま残ったケース）は、追加の1件が増えず件数が変わらない。
{
  const dots = makeDots(20, 0, 999901); // 20件のみ・景品なし＝40件以下なので必ず全件表示される
  const target = dots[3];
  const withoutForce = pickDisplaySlots(dots);
  const withForce = pickDisplaySlots(dots, target.id);
  check(
    "選択中の対象がもともと表示対象に含まれる場合は件数が変わらない（20件のまま）",
    withoutForce.length === withForce.length && withForce.length === 20
  );
}

// 4. 境界ケース: 存在しないIDを渡した場合は何も追加されず、通常時と完全に一致する
//    （DBの状態と一覧の選択がずれた場合の安全確認）。
{
  const dots = makeDots(60, 0.1, 999902); // 60件（40件超え）
  const withoutForce = pickDisplaySlots(dots);
  const withUnknownId = pickDisplaySlots(dots, "completion-does-not-exist");
  check("存在しないIDをforceIncludeIdに渡しても結果は変わらない（何も追加されない）", sameSet(withoutForce, withUnknownId));
}

// 5. 決定性: 同じ入力（同じforceIncludeId込み）を2回計算しても同じ結果になる
//    （乱数を使っていないことの確認、20章決定4）。
{
  const dots = makeDots(80, 0.15, 999903);
  const target = dots.filter((d) => !isPrioritizedDot(d))[10];
  const a = pickDisplaySlots(dots, target.id);
  const b = pickDisplaySlots(dots, target.id);
  check("決定性: 同じforceIncludeIdで2回計算しても同じ結果", sameSet(a, b));
}

console.log("");
if (failCount === 0) {
  console.log("全件OK");
} else {
  console.log(`${failCount}件NG`);
  process.exitCode = 1;
}
