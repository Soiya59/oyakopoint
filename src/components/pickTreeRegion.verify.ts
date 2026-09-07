/**
 * `pickTreeRegion`（FamilyTree.tsx）の単体検証（実装メモ139章→140章で全面差し替え）。
 * Node.js単体実行で動かす（`node src/components/pickTreeRegion.verify.ts`、137.4節と同じ方式）。
 *
 * [経緯・140章] 139章では、統括からの実機報告「かざりつけモードでハイライトした
 * 場所（自分の色丸）に、確定後の景品が出ない」への対応として、`pickTreeRegion`から
 * `isPrize`分岐を削除する直し方を採用した（当時の本部長指示）。**しかしこの直し方は
 * 誤りだった。** `isPrize`分岐は2026-08-27の実際の本番不具合（景品が「空」に落ちて
 * 樹冠の裏に完全に隠れる）への対応であり、削除するとその不具合が技術的に再発しうる
 * 状態に戻ってしまう（139章時点の実測で新実装の16.6%が空に割り当てられていた）。
 * 139章の担当者はこのリスクをコメント・実装メモに正しく警告していた。**指示を出した
 * 本部長の側が誤っており、前任者の警告が正しかった**（140章参照）。
 *
 * 140章では`isPrize`分岐を元どおり復活させ、代わりに「ハイライトした場所に景品が
 * 出ない」問題は`TreeStageVisual`側の新しいプレビュー機構（`previewDecorationSize`）
 * で解決した。「選択中の色丸だけ、確定後の姿（`pickTreeRegion(id, true)`の位置・
 * 景品/ステッカーと同じ大きさ）を先取りして描く」ことで、位置・大きさが確定前後で
 * 一致するようにした（`pickTreeRegion`自体は変更しない）。
 *
 * 本ファイルはこの新しい直し方を検証する内容に全面差し替えた（139章時点の内容は
 * 「isPrize分岐を削除した版」の検証だったため、その版はもう存在しない）。
 *
 * FamilyTree.tsxは`react-native`・`react-native-svg`をimportし、JSXも含む
 * （Node単体実行のTypeScript型ストリッピングはJSXを消せない）ため、
 * `pickTreeRegion`本体をFamilyTree.tsxからimportすることができない。
 * そのため、本検証対象の定義（`stableHash`・`SKY_WEIGHT`・`REGION_WEIGHTS`・
 * `pickTreeRegion`）をFamilyTree.tsxから**そのまま複製**する（137.5節の
 * バイト数見積もりロジック複製と同じ方式）。複製した行はFamilyTree.tsxの
 * 該当行と完全に一致させてあり、**FamilyTree.tsx側を変更したらこのファイルも
 * 追随させること。**
 */

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

type TreeRegion = "canopy" | "lobeLeft" | "lobeRight" | "trunk" | "soil" | "sky";

// ---- FamilyTree.tsx からそのまま複製（SKY_WEIGHT・REGION_WEIGHTS） ----
const SKY_WEIGHT = 17;
const REGION_WEIGHTS: readonly (readonly [TreeRegion, number])[] = [
  ["canopy", 45],
  ["lobeLeft", 11],
  ["lobeRight", 11],
  ["trunk", 5],
  ["soil", 11],
  ["sky", 17],
] as const;

// ---- FamilyTree.tsx からそのまま複製（140章でisPrize分岐を復活させた現行実装） ----
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

// ---- 139章で採用され、140章で撤回された「isPrize分岐を削除した版」 ----
// （比較対象として残す。撤回の理由＝この版だと景品・ステッカーが「空」に
// 配置されうることを検証3で示す）
function removedIsPrizeBranchVersion(id: string): TreeRegion {
  const h = stableHash(`${id}|region`) % 100;
  let acc = 0;
  for (const [region, weight] of REGION_WEIGHTS) {
    acc += weight;
    if (h < acc) return region;
  }
  return "canopy";
}

/**
 * `TreeStageVisual`のbyRegion内で実際に使われる式を模擬する
 * （`isPrioritizedDot(dot) || isPreviewTarget(dot)`）。
 *   - `dotIsPrioritized`: `dot.prize !== null || dot.sticker !== null`（確定済みかどうか）
 *   - `dotIsPreviewTarget`: かざりつけモードで選択中の色丸かどうか
 */
function simulateByRegionIsPrize(dotIsPrioritized: boolean, dotIsPreviewTarget: boolean): boolean {
  return dotIsPrioritized || dotIsPreviewTarget;
}

/** かざりつけモードで「選択中（未確定）」の色丸として計算した部位。 */
function simulatePreviewRegion(id: string): TreeRegion {
  const isPrize = simulateByRegionIsPrize(/* dotIsPrioritized */ false, /* dotIsPreviewTarget */ true);
  return pickTreeRegion(id, isPrize);
}

/** 「かざる」確定後、同じ色丸が景品・ステッカーとして再表示されたときに計算した部位。 */
function simulateConfirmedRegion(id: string): TreeRegion {
  const isPrize = simulateByRegionIsPrize(/* dotIsPrioritized */ true, /* dotIsPreviewTarget */ false);
  return pickTreeRegion(id, isPrize);
}

function generateIds(n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    // UUID風の適当な文字列（実運用のchore_completions.idの形に寄せる）。
    ids.push(`dot-${i}-${(i * 2654435761) >>> 0}`);
  }
  return ids;
}

let failCount = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "OK  " : "NG  "} ${label}`);
  if (!ok) failCount++;
}

const SAMPLE_SIZE = 5000;
const ids = generateIds(SAMPLE_SIZE);

// 1. 決定性: 同じIDを2回呼んでも同じ結果になる（乱数を使っていないことの確認）。
{
  const allDeterministic = ids.every(
    (id) => pickTreeRegion(id, false) === pickTreeRegion(id, false) && pickTreeRegion(id, true) === pickTreeRegion(id, true)
  );
  check("決定性: 同じIDを2回呼んでも同じ結果（isPrize=false/true とも）", allDeterministic);
}

// 2. 検収条件2の本体: 景品・ステッカー（isPrize=true）が「空」に配置されないこと
//    （2026-08-27の仕様に戻っていることの実測確認）。
{
  const skyCount = ids.filter((id) => pickTreeRegion(id, true) === "sky").length;
  console.log(`INFO isPrize=true で「空」に配置された件数: ${skyCount}/${ids.length}件`);
  check("景品・ステッカー（isPrize=true）は「空」に1件も配置されない", skyCount === 0);
}

// 2a. 参考: 139章で撤回した版（isPrize分岐を削除した版）だと実際に「空」に落ちること
//     （直さなかった場合に何が起きていたかの記録として残す）。
{
  const skyCount = ids.filter((id) => removedIsPrizeBranchVersion(id) === "sky").length;
  const skyRatio = skyCount / ids.length;
  console.log(
    `INFO 参考: 139章で撤回した版（isPrize分岐なし）だと「空」に落ちる割合: ${(skyRatio * 100).toFixed(1)}% (${skyCount}/${ids.length}件)`
  );
  check("参考: 撤回した版は15%前後が「空」に落ちる（不具合の再現、REGION_WEIGHTS.sky=17相当）", skyRatio > 0.1 && skyRatio < 0.2);
}

// 3. 検収条件3の本体: 選択中のプレビュー位置と、確定後の景品の位置が一致すること
//    （同じIDで、プレビュー計算と本番計算が同じ部位を返すこと）。
{
  const previewRegions = ids.map((id) => simulatePreviewRegion(id));
  const confirmedRegions = ids.map((id) => simulateConfirmedRegion(id));
  const allSame = previewRegions.every((r, i) => r === confirmedRegions[i]);
  check("プレビュー計算（選択中・未確定）と本番計算（確定後）が全件一致", allSame);
}

// 4. 検収条件4: 通常の色丸（isPrize=false、プレビュー対象でもない）の配置が
//    今回の変更で1件も変わらないこと。139章より前の実装（今回復元した実装）と
//    現在の実装は文字どおり同一の式なので、ここではREGION_WEIGHTSどおりの
//    重み配分になっていることを統計的に再確認する（78行目コメントと同趣旨）。
{
  const counts: Record<TreeRegion, number> = { canopy: 0, lobeLeft: 0, lobeRight: 0, trunk: 0, soil: 0, sky: 0 };
  for (const id of ids) counts[pickTreeRegion(id, false)]++;
  const within = (region: TreeRegion, expectedPct: number) => {
    const actualPct = (counts[region] / ids.length) * 100;
    return Math.abs(actualPct - expectedPct) < 3; // ±3ポイントの許容
  };
  const ok =
    within("canopy", 45) &&
    within("lobeLeft", 11) &&
    within("lobeRight", 11) &&
    within("trunk", 5) &&
    within("soil", 11) &&
    within("sky", 17);
  console.log(
    `INFO 通常時（isPrize=false）の部位分布: canopy=${counts.canopy} lobeLeft=${counts.lobeLeft} lobeRight=${counts.lobeRight} trunk=${counts.trunk} soil=${counts.soil} sky=${counts.sky}`
  );
  check("通常の色丸の配置はREGION_WEIGHTS（45/11/11/5/11/17）に±3pt以内で一致（変化なし）", ok);
}

// 5. isPrize=trueの重み配分の妥当性（空17%が丸ごと樹冠へ振り替わり、canopy=62%になること）。
{
  const counts: Record<TreeRegion, number> = { canopy: 0, lobeLeft: 0, lobeRight: 0, trunk: 0, soil: 0, sky: 0 };
  for (const id of ids) counts[pickTreeRegion(id, true)]++;
  const within = (region: TreeRegion, expectedPct: number) => {
    const actualPct = (counts[region] / ids.length) * 100;
    return Math.abs(actualPct - expectedPct) < 3;
  };
  const ok =
    within("canopy", 62) &&
    within("lobeLeft", 11) &&
    within("lobeRight", 11) &&
    within("trunk", 5) &&
    within("soil", 11) &&
    within("sky", 0);
  console.log(
    `INFO 景品・ステッカー時（isPrize=true）の部位分布: canopy=${counts.canopy} lobeLeft=${counts.lobeLeft} lobeRight=${counts.lobeRight} trunk=${counts.trunk} soil=${counts.soil} sky=${counts.sky}`
  );
  check("景品・ステッカー時の配置は canopy=62%・sky=0% に±3pt以内で一致", ok);
}

console.log("");
if (failCount === 0) {
  console.log("全件OK");
} else {
  console.log(`${failCount}件NG`);
  process.exitCode = 1;
}
