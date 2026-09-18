/**
 * `FamilyTree.tsx`の色丸の「座標」の単体検証（実装メモ252章、本部長差し戻しを
 * 受けて2026-09-18に改訂）。
 * Node.js単体実行で動かす（`node src/components/treeDotPlacement.verify.ts`、
 * `pickTreeRegion.verify.ts`と同じ方式）。
 *
 * [本ファイルが検証すること・139/140章との違い] `pickTreeRegion.verify.ts`
 * （139〜140章）は「かざりつけモードで選択中の色丸が、確定前後で**同じ部位**
 * （樹冠・幹・地面など）になるか」を検証済みであり、これは既に正しく実装されて
 * いる（`isPrioritizedDot(dot) || isPreviewTarget(dot)`が確定前後どちらも
 * `true`を返すため、`pickTreeRegion`への入力が同じになり、純粋関数として
 * 数学的に同じ結果が保証される）。
 *
 * しかし2026-09-18の統括の実機報告「木に飾る場所を選んだのに、確定後は
 * 別の場所に出た」は、**部位（region）ではなく部位の“中”の座標（x, y）**が
 * ずれることで起きていた（実装メモ252章で特定）。`pickTreeRegion.verify.ts`は
 * 部位しか見ていないため、この不具合を検出できなかった。本ファイルは
 * `placeGroup`（重なり回避の座標決定）まで含めて検証する。
 *
 * [原因の要約] `pickDisplaySlots`は`[...景品, ...通常]`の順で配列を返す
 * （景品優先確保、07-13-4章決定10）。この配列順がそのまま`placeWithoutOverlap`
 * の処理順になり、「自分より先に処理された色丸を避けて位置を決める」ため、
 * ある色丸が「通常」（配列の後ろのほう）から「景品」（配列の前のほう）へ
 * 変わると、同じ部位に決まっていても処理順が変わり、実際の座標が
 * 大きくずれることがある。
 *
 * [直し方（2026-09-18改訂）] 最初は`slots`配列全体を`reported_at`昇順に
 * 並べ替える方式で直したが、本部長から2点差し戻された。
 *   1. 景品（36pt）は通常の色丸（13pt）より必要な空きが大きく、
 *      `[...景品, ...通常]`という順序は「景品に先に良い場所を取らせる」
 *      意味を持っていた。配列全体を時刻順にすると、直近の景品が既存の
 *      通常の色丸すべての後に処理されることになり、重なる確率が上がる
 *      （2026-08-27の本番不具合と地続きの退行リスク）。
 *   2. 座標はDBに保存されておらず毎回計算しているため、並べ替えの基準を
 *      変えると、次のビルドで**既存の木の色丸が全家庭で一度だけ動いてしまう**
 *      （`highlightCompletionId`が無い通常表示の並びまで変わってしまうため）。
 * 直し方を`reorderPreviewTargetAmongPrizes`（選択中の色丸だけを、景品グループの
 * 中の正しい時刻位置へ差し込み直す。配列全体は並べ替えない）に変更した。
 * 本ファイルもこれに合わせて改訂し、上記1・2が実際に起きないことを検証する
 * テストを追加した（検証4・5）。
 *
 * FamilyTree.tsxは`react-native`・`react-native-svg`をimportするためNode単体
 * 実行できず、対象の定義をそのまま複製する（139章と同じ方式。複製した行は
 * FamilyTree.tsxの該当行と完全に一致させてあり、**FamilyTree.tsx側を変更したら
 * このファイルも追随させること。**）。
 */

// ---- FamilyTree.tsx からそのまま複製 ----
const DOT_SIZE = 13;
const PRIZE_DOT_SIZE = 36;
const MAX_SLOTS = 40;
const PLACEMENT_TRIES = 24;
const PLACEMENT_GAP = 2;
const SKY_WEIGHT = 17;

type TreeRegion = "canopy" | "lobeLeft" | "lobeRight" | "trunk" | "soil" | "sky";

interface Dot {
  id: string;
  reported_at: string;
  prize: unknown | null;
}

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

const REGION_WEIGHTS: readonly (readonly [TreeRegion, number])[] = [
  ["canopy", 45],
  ["lobeLeft", 11],
  ["lobeRight", 11],
  ["trunk", 5],
  ["soil", 11],
  ["sky", 17],
] as const;

function pickTreeRegion(id: string, isPrize = false): TreeRegion {
  const h = stableHash(`${id}|region`) % 100;
  let acc = 0;
  for (const [region, weight] of REGION_WEIGHTS) {
    const w = isPrize && region === "canopy" ? weight + SKY_WEIGHT : weight;
    if (isPrize && region === "sky") continue;
    acc += w;
    if (h < acc) return region;
  }
  return "canopy";
}

function isPrioritizedDot(d: Dot): boolean {
  return d.prize !== null;
}

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

// ---- FamilyTree.tsx `reorderPreviewTargetAmongPrizes`をそのまま複製 ----
function reorderPreviewTargetAmongPrizes(
  slots: Dot[],
  highlightCompletionId: string | null | undefined,
  previewDecorationSize: number | null | undefined
): Dot[] {
  if (highlightCompletionId == null || previewDecorationSize == null) return slots;
  const target = slots.find((d) => d.id === highlightCompletionId);
  if (!target || isPrioritizedDot(target)) return slots;

  const rest = slots.filter((d) => d.id !== highlightCompletionId);
  const targetTime = new Date(target.reported_at).getTime();
  let insertIndex = 0;
  while (
    insertIndex < rest.length &&
    isPrioritizedDot(rest[insertIndex]) &&
    new Date(rest[insertIndex].reported_at).getTime() <= targetTime
  ) {
    insertIndex++;
  }
  rest.splice(insertIndex, 0, target);
  return rest;
}

// 252章で最初に試して撤回した「配列全体を時刻順に並べ替える」版。
// 検証4・5で「なぜ撤回したか」を数値で裏付けるための比較対象として残す。
function reorderAllByReportedAt(slots: Dot[]): Dot[] {
  return [...slots].sort((a, b) => new Date(a.reported_at).getTime() - new Date(b.reported_at).getTime());
}

function dotOffsetInEllipse(id: string, rx: number, ry: number): { x: number; y: number } {
  const h = stableHash(id);
  const angle = ((h % 3600) / 3600) * Math.PI * 2;
  const normalized = Math.sqrt(((h >>> 11) % 1000) / 1000);
  return { x: Math.cos(angle) * normalized * rx, y: Math.sin(angle) * normalized * ry };
}

type PlacedDot = { x: number; y: number; r: number };
type PlacementBounds = { cx: number; cy: number; rx: number; ry: number };

function placeWithoutOverlap(
  id: string,
  radius: number,
  bounds: PlacementBounds,
  placed: readonly PlacedDot[]
): { x: number; y: number } {
  let best = { x: bounds.cx, y: bounds.cy };
  let bestSlack = -Infinity;
  for (let t = 0; t < PLACEMENT_TRIES; t++) {
    const off = dotOffsetInEllipse(`${id}|${t}`, bounds.rx, bounds.ry);
    const x = bounds.cx + off.x;
    const y = bounds.cy + off.y;
    let slack = Infinity;
    for (const p of placed) {
      const d = Math.hypot(x - p.x, y - p.y) - (p.r + radius + PLACEMENT_GAP);
      if (d < slack) slack = d;
    }
    if (slack >= 0) return { x, y };
    if (slack > bestSlack) {
      bestSlack = slack;
      best = { x, y };
    }
  }
  return best;
}

function dotDisplaySize(dot: Dot): number {
  return dot.prize ? PRIZE_DOT_SIZE : DOT_SIZE;
}

function placeGroup(
  items: readonly { dot: Dot; bounds: PlacementBounds }[],
  getSize: (dot: Dot) => number = dotDisplaySize
): { dot: Dot; x: number; y: number; r: number }[] {
  const placed: PlacedDot[] = [];
  return items.map(({ dot, bounds }) => {
    const radius = getSize(dot) / 2;
    const p = placeWithoutOverlap(dot.id, radius, bounds, placed);
    placed.push({ x: p.x, y: p.y, r: radius });
    return { dot, x: p.x, y: p.y, r: radius };
  });
}

// ---- FamilyTree.tsx `TreeStageVisual`内の計算を再現 ----
// 252章改訂後（reorderPreviewTargetAmongPrizesを使う版）。
function computeSlots(dots: Dot[], highlightCompletionId: string | null, previewDecorationSize: number | null): Dot[] {
  const picked = pickDisplaySlots(dots, highlightCompletionId);
  return reorderPreviewTargetAmongPrizes(picked, highlightCompletionId, previewDecorationSize);
}

// 252章で最初に試して撤回した版（配列全体を時刻順に並べ替える）。比較用に残す。
function computeSlotsFullSortRejected(dots: Dot[], highlightCompletionId: string | null): Dot[] {
  const picked = pickDisplaySlots(dots, highlightCompletionId);
  return reorderAllByReportedAt(picked);
}

// 252章より前（`pickDisplaySlots`の結果をそのまま使う、今回の不具合が
// 実際に起きていた版）。比較用に残す。
function computeSlotsPreFix(dots: Dot[], highlightCompletionId: string | null): Dot[] {
  return pickDisplaySlots(dots, highlightCompletionId);
}

function isPreviewTargetOf(highlightCompletionId: string | null, previewDecorationSize: number | null) {
  return (dot: Dot) => previewDecorationSize != null && highlightCompletionId != null && dot.id === highlightCompletionId;
}

function effectiveDotSizeOf(highlightCompletionId: string | null, previewDecorationSize: number | null) {
  const isPreviewTarget = isPreviewTargetOf(highlightCompletionId, previewDecorationSize);
  return (dot: Dot) => (isPreviewTarget(dot) && previewDecorationSize != null ? previewDecorationSize : dotDisplaySize(dot));
}

// 樹冠（stage4「実」、leafRadius=125。木の中で最も色丸が集まる部位）の座標系。
// FamilyTree.tsx STAGE_GEOMETRY[4]・canopy描画部分の式をそのまま複製。
const LEAF_RADIUS = 125;
const BOX_WIDTH = LEAF_RADIUS * 2.7;
const BOX_HEIGHT = LEAF_RADIUS * 2.05;
const CANOPY_DOT_RADIUS = Math.max(LEAF_RADIUS - DOT_SIZE, 0);
const CANOPY_BOUNDS: PlacementBounds = { cx: BOX_WIDTH / 2, cy: LEAF_RADIUS, rx: CANOPY_DOT_RADIUS, ry: CANOPY_DOT_RADIUS };
const SIDE_SIZE = LEAF_RADIUS * 1.3;
const LOBE_LEFT_BOUNDS: PlacementBounds = {
  cx: SIDE_SIZE / 2,
  cy: BOX_HEIGHT - SIDE_SIZE / 2,
  rx: SIDE_SIZE / 2 - DOT_SIZE,
  ry: SIDE_SIZE / 2 - DOT_SIZE,
};
const LOBE_RIGHT_BOUNDS: PlacementBounds = {
  cx: BOX_WIDTH - SIDE_SIZE / 2,
  cy: BOX_HEIGHT - SIDE_SIZE / 2,
  rx: SIDE_SIZE / 2 - DOT_SIZE,
  ry: SIDE_SIZE / 2 - DOT_SIZE,
};

function byRegionOf(slots: Dot[], highlightCompletionId: string | null, previewDecorationSize: number | null) {
  const isPreviewTarget = isPreviewTargetOf(highlightCompletionId, previewDecorationSize);
  const map: Record<TreeRegion, Dot[]> = { canopy: [], lobeLeft: [], lobeRight: [], trunk: [], soil: [], sky: [] };
  for (const dot of slots) {
    const isPrize = isPrioritizedDot(dot) || isPreviewTarget(dot);
    map[pickTreeRegion(dot.id, isPrize)].push(dot);
  }
  return map;
}

/** 樹冠＋左右のふくらみ（`renderGroup`が1回でまとめて配置する範囲）の座標一覧を計算する。 */
function computeCanopyGroupPositions(
  dots: Dot[],
  highlightCompletionId: string | null,
  previewDecorationSize: number | null,
  slots: Dot[]
) {
  const byRegion = byRegionOf(slots, highlightCompletionId, previewDecorationSize);
  const items = [
    ...byRegion.canopy.map((dot) => ({ dot, bounds: CANOPY_BOUNDS })),
    ...byRegion.lobeLeft.map((dot) => ({ dot, bounds: LOBE_LEFT_BOUNDS })),
    ...byRegion.lobeRight.map((dot) => ({ dot, bounds: LOBE_RIGHT_BOUNDS })),
  ];
  return placeGroup(items, effectiveDotSizeOf(highlightCompletionId, previewDecorationSize));
}

function makeSeasonDots(n: number, prizeCount: number): Dot[] {
  const dots: Dot[] = [];
  for (let i = 0; i < n; i++) {
    dots.push({
      id: `completion-${i}-${(i * 2654435761) >>> 0}`,
      reported_at: new Date(2026, 0, 1, i).toISOString(),
      prize: i < prizeCount ? { dummy: true } : null,
    });
  }
  return dots;
}

let failCount = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "OK  " : "NG  "} ${label}`);
  if (!ok) failCount++;
}

// ============================================================
// 検証1・2・3: 座標のずれの再現と、今回の直し方（reorderPreviewTargetAmongPrizes）
// による解消（表示上限＝40スロット未到達の家庭を想定）。
// ============================================================
const SEASON_SIZE = 30;
const EXISTING_PRIZE_COUNT = 6;

let shiftedBeforeFix = 0;
let shiftedAfterFix = 0;
let canopyCandidates = 0;

for (let targetIndex = 0; targetIndex < SEASON_SIZE; targetIndex++) {
  const before = makeSeasonDots(SEASON_SIZE, EXISTING_PRIZE_COUNT);
  const target = before[targetIndex];
  if (target.prize !== null) continue; // 既に景品済みの色丸は対象外（今回選ぶのは未交換のもの）
  if (pickTreeRegion(target.id, true) !== "canopy") continue; // 樹冠に決まるIDだけを対象にする
  canopyCandidates++;

  const after = before.map((d) => (d.id === target.id ? { ...d, prize: { dummy: true } } : d));

  // --- 252章の修正前（並べ替え無し。今回の不具合が実際に起きていた版） ---
  const previewPre = computeCanopyGroupPositions(before, target.id, PRIZE_DOT_SIZE, computeSlotsPreFix(before, target.id));
  const confirmedPre = computeCanopyGroupPositions(after, null, null, computeSlotsPreFix(after, null));
  const pPre = previewPre.find((p) => p.dot.id === target.id)!;
  const cPre = confirmedPre.find((p) => p.dot.id === target.id)!;
  if (Math.hypot(pPre.x - cPre.x, pPre.y - cPre.y) > 1) shiftedBeforeFix++;

  // --- 252章の修正後（reorderPreviewTargetAmongPrizes） ---
  const previewPost = computeCanopyGroupPositions(before, target.id, PRIZE_DOT_SIZE, computeSlots(before, target.id, PRIZE_DOT_SIZE));
  const confirmedPost = computeCanopyGroupPositions(after, null, null, computeSlots(after, null, null));
  const pPost = previewPost.find((p) => p.dot.id === target.id)!;
  const cPost = confirmedPost.find((p) => p.dot.id === target.id)!;
  if (Math.hypot(pPost.x - cPost.x, pPost.y - cPost.y) > 1) shiftedAfterFix++;
}

console.log(`INFO 樹冠に決まる候補: ${canopyCandidates}件`);
console.log(
  `INFO 修正前（並べ替え無し）: 座標が1pt超ずれた件数 ${shiftedBeforeFix}/${canopyCandidates}件（${((shiftedBeforeFix / canopyCandidates) * 100).toFixed(1)}%）`
);
check("修正前は座標のずれが実際に発生する（不具合の再現。0件だと再現できていない）", shiftedBeforeFix > 0);
check(
  `修正後（reorderPreviewTargetAmongPrizes）は表示上限未到達の家庭（${SEASON_SIZE}件）で座標のずれが1件も発生しない`,
  shiftedAfterFix === 0
);

// 決定性（同じ入力なら同じ結果になる。乱数を使っていないことの確認）。
{
  const dots = makeSeasonDots(SEASON_SIZE, EXISTING_PRIZE_COUNT);
  const a = computeCanopyGroupPositions(dots, null, null, computeSlots(dots, null, null));
  const b = computeCanopyGroupPositions(dots, null, null, computeSlots(dots, null, null));
  const same = a.every((p, i) => p.x === b[i].x && p.y === b[i].y && p.dot.id === b[i].dot.id);
  check("決定性: 同じ入力を2回計算しても同じ座標になる", same);
}

// ============================================================
// 検証4（本部長差し戻し2.への回答）: `highlightCompletionId`が無い（かざりつけ
// モードでない）通常表示の並びが、252章の変更前後で完全に同じであること。
// これが崩れると「次のビルドで既存の木の色丸が全家庭で一度だけ動く」が起きる。
// ============================================================
{
  let allIdentical = true;
  for (let trial = 0; trial < 20; trial++) {
    const dots = makeSeasonDots(20 + trial, Math.min(5 + trial, 15));
    const before252 = computeSlotsPreFix(dots, null); // 252章より前の挙動
    const after252 = computeSlots(dots, null, null); // 252章改訂後の挙動（highlightCompletionId無し）
    const identical =
      before252.length === after252.length && before252.every((d, i) => d.id === after252[i].id);
    if (!identical) allIdentical = false;
  }
  check(
    "検証4: highlightCompletionId無し（通常表示）の並びは252章の変更前後で完全に一致する（既存の木が動かないことの証明）",
    allIdentical
  );
}

// ============================================================
// 検証5（本部長差し戻し1.への回答）: 景品を含む混雑した樹冠で、
// 既存の本物の景品どうしの重なり件数が、変更前（プレビュー無し）と
// 比べて増えないこと。あわせて「配列全体を時刻順に並べ替える版
// （撤回済み）」だと重なりが増えることも記録として残す。
// ============================================================
{
  // 樹冠が混雑するよう、景品を多め・通常も一定数含む季節を作る。
  const CROWDED_SEASON_SIZE = 48;
  const CROWDED_PRIZE_COUNT = 24; // 36pt級の景品を24件、通常も残り24件（樹冠だけに絞ると相当数が密集する）

  function countOverlaps(placed: { x: number; y: number; r: number }[]): number {
    let overlaps = 0;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const dist = Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y);
        if (dist < placed[i].r + placed[j].r) overlaps++;
      }
    }
    return overlaps;
  }

  // ベースライン: プレビュー無し（highlightCompletionIdを渡さない、現状の木の見え方そのもの）。
  const baseDots = makeSeasonDots(CROWDED_SEASON_SIZE, CROWDED_PRIZE_COUNT);
  const baseSlots = computeSlots(baseDots, null, null);
  const basePositions = computeCanopyGroupPositions(baseDots, null, null, baseSlots);
  const basePrizePositions = basePositions.filter((p) => isPrioritizedDot(p.dot));
  const baselineOverlaps = countOverlaps(basePrizePositions);

  // 今回の直し方（reorderPreviewTargetAmongPrizes）でプレビュー中の、
  // 「既存の本物の景品どうし」の重なり件数（対象の選択中の色丸自体は除く）。
  let newApproachWorseCount = 0;
  // 撤回した「配列全体を時刻順に並べ替える」版で、同条件だと重なりが
  // 増えるケースが実際にあることの記録用カウント。
  let rejectedApproachWorseCount = 0;
  const TRIALS = 20;

  for (let trial = 0; trial < TRIALS; trial++) {
    const dots = makeSeasonDots(CROWDED_SEASON_SIZE, CROWDED_PRIZE_COUNT);
    // まだ景品になっていない通常の色丸から1件選ぶ（trialごとに違うIDを選ぶ）。
    const normalCandidates = dots.filter((d) => d.prize === null);
    const target = normalCandidates[trial % normalCandidates.length];

    const slotsBase = computeSlots(dots, null, null);
    const posBase = computeCanopyGroupPositions(dots, null, null, slotsBase);
    const prizePosBase = posBase.filter((p) => isPrioritizedDot(p.dot));
    const overlapsBase = countOverlaps(prizePosBase);

    const slotsNew = computeSlots(dots, target.id, PRIZE_DOT_SIZE);
    const posNew = computeCanopyGroupPositions(dots, target.id, PRIZE_DOT_SIZE, slotsNew);
    // 選択中の対象（まだ本物の景品ではない）は除き、既存の本物の景品どうしだけを見る。
    const prizePosNew = posNew.filter((p) => isPrioritizedDot(p.dot));
    const overlapsNew = countOverlaps(prizePosNew);
    if (overlapsNew > overlapsBase) newApproachWorseCount++;

    const slotsRejected = computeSlotsFullSortRejected(dots, target.id);
    const posRejected = computeCanopyGroupPositions(dots, target.id, PRIZE_DOT_SIZE, slotsRejected);
    const prizePosRejected = posRejected.filter((p) => isPrioritizedDot(p.dot));
    const overlapsRejected = countOverlaps(prizePosRejected);
    if (overlapsRejected > overlapsBase) rejectedApproachWorseCount++;
  }

  console.log(`INFO ベースライン（プレビュー無し）の景品どうしの重なり件数: ${baselineOverlaps}件（1試行の代表値）`);
  console.log(
    `INFO 今回の直し方でプレビュー中、既存の景品どうしの重なりが増えた試行数: ${newApproachWorseCount}/${TRIALS}件`
  );
  console.log(
    `INFO 参考: 撤回した「配列全体を時刻順に並べ替える」版でプレビュー中、既存の景品どうしの重なりが増えた試行数: ${rejectedApproachWorseCount}/${TRIALS}件`
  );
  check(
    "検証5: 今回の直し方（reorderPreviewTargetAmongPrizes）は、プレビュー中でも既存の本物の景品どうしの重なりを増やさない",
    newApproachWorseCount === 0
  );
}

console.log("");
if (failCount === 0) {
  console.log("全件OK");
} else {
  console.log(`${failCount}件NG`);
  process.exitCode = 1;
}
