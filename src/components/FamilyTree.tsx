import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import theme from "@/theme/theme";
import type { FamilyTreeCompletionDot } from "@/data/api";
import type { FamilyTreeMemberBreakdown } from "@/types/domain";
import MemberAvatar from "./MemberAvatar";
import Svg, { Circle as SvgCircle, Path as SvgPath } from "react-native-svg";
import { DrawingThumbnail } from "./DrawingCanvas";

/**
 * 家族の木の共通ビジュアル（P26/C20/S14の3画面から共有）。
 * 参照: 主要画面ワイヤーフレーム.md 20章、デザイントークン.md 1.8節。
 *
 * 決定1: 木の共有部分（土・幹・葉の土台）は個人色に一切染めない（固定色）。
 * 決定2: 完了報告1件ごとの視覚要素は絵文字自体の着色ではなく、avatar_colorで
 *   塗った小さな色丸として表現する。
 * 決定3・4: 表示上限40スロット。上限到達後は新しい完了報告のたびに、
 *   完了報告のIDをシードにした決定論的な計算で既存スロットを置き換える
 *   （reservoir sampling。クライアント側の乱数は使わない）。
 *
 * [2026-08-24改訂・本部長] 実機で「見た目が微妙」との指摘を受けて描画を作り直した。
 * 旧実装は「段階の絵文字1個＋その上に色丸をflex-wrapで並べる」構成だったため、
 * 色丸が木と無関係な升目のように上空に浮いて見え、さらに芽（stage1）以下では
 * 葉の土台が透明で色丸の置き場所が無かった。本実装では葉・幹・土をViewで
 * 実際に描き、色丸は葉の内側に決定論的に散らして配置する（色丸が「木に実った
 * もの」として読めるようにする）。段階の絵文字は木の絵の代わりではなく、
 * 各画面の段階名テキストに添える役割へ移した。
 *
 * [2026-08-26追加・第4段階] 木への飾り付け（要件定義書07-13-4章）対応。
 * 主要画面ワイヤーフレーム.md 21.0節決定7のとおり、独立した別ビジュアルは新設せず
 * 本コンポーネントに「かざりつけモード」を追加する形にした。
 *   決定8: 交換相手の選択は木の絵の直接タップではなく専用の一覧UIから行う。
 *     木の絵の上では`highlightMemberId`に一致する自分の色丸にのみ「淡い強調」を
 *     加算的に添え（`mineHalo`）、他人の丸の描画には一切手を加えない
 *     （グレーアウト・縮小のような減算的表現は行わない）。
 *   決定10（本部長裁定）: 景品（36pt、`PRIZE_DOT_SIZE`）は40スロット上限の対象外に
 *     せず、`pickDisplaySlots`が「全景品を優先確保→残り枠を通常の色丸で
 *     reservoir samplingして埋める」処理を行う（詳細は同関数のコメント参照）。
 *   景品の重なり判定は既存の「互いの半径の合計＋余白」方式をそのまま使う
 *   （下記2026-08-24コメント「将来ガチャの絵と交換された丸は…」で既に想定済み）。
 */

const MAX_SLOTS = 40;
// [2026-08-24拡大] 木の拡大にあわせて色丸も少し大きくする。樹冠の面積が約2.9倍に
// なったため、丸を大きくしても拡大前より密度は下がる（＝重なりにくくなる）。
const DOT_SIZE = 13;
// [2026-08-26追加・第4段階] ガチャの景品に交換された丸（デザイントークン.md 1.8節
// 「ガチャの景品（36pt）の表示ルール」）。大きさは「これは景品だ」という意味のみを
// 持ち、貢献度に応じて変動させない（誰が何回引いても常に同じ36pt）。
const PRIZE_DOT_SIZE = 36;
/**
 * 花（stage3）の花芯の色。個人色に染めない固定色（木の共有部分と同じ扱い）。
 * [2026-09-01変更] 旧値`#FFF3B0`はメンバーカラー「レモン」と完全一致していたため、
 * デザイントークン.md 1.8節の新規トークン`color-tree-flower-center`に差し替えた
 * （theme.ts側の値を正とし、ここではハードコードしない。実装メモ100章）。
 */
const FLOWER_CENTER_COLOR = theme.treeColors.flowerCenter;

/** 景品の識別リング（交換した本人のavatar_color、2pt実線）の太さ。 */
const PRIZE_RING_WIDTH = 2;
/** かざりつけモードで自分の色丸に添える「淡い強調」のはみ出し幅（決定8）。 */
const MINE_HALO_PADDING = 4;

/**
 * 文字列から決定論的な非負整数ハッシュを作る（FNV-1a＋最終ミックス）。
 *
 * [2026-08-24修正] FNV-1aは最後の演算が奇数の素数との乗算であるため、
 * 入力によっては**最下位ビットがほぼ固定される**という偏りがある。実際に
 * `dot-0`〜`dot-19` の20件すべてで `hash % 2 === 0` となることを確認した。
 * このため `% 2` での左右振り分けが全て片側に寄り、さらに
 * pickDisplaySlots の `% (i + 1)` も、i+1が偶数のときは置き換え先が
 * 偶数スロットにしか当たらないという偏りを生んでいた（40件超過時のみ
 * 影響する潜在不具合）。
 * 全ビットが均等に散るよう、最後にavalanche（lowbias32）を掛ける。
 */
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

/**
 * 決定3・4のreservoir sampling本体。`slotCount`個の枠に対して`dots`をreservoir
 * samplingで割り当てる（`dots.length <= slotCount`ならそのまま全件を返す）。
 * dotsは`reported_at`昇順であることを前提とする
 * （src/data/api.ts fetchFamilyTreeCompletionDots がその順で返す）。
 */
function reservoirSample(dots: FamilyTreeCompletionDot[], slotCount: number): FamilyTreeCompletionDot[] {
  if (slotCount <= 0) return [];
  const slots: (FamilyTreeCompletionDot | null)[] = Array.from({ length: slotCount }, () => null);
  dots.forEach((dot, i) => {
    if (i < slotCount) {
      slots[i] = dot;
      return;
    }
    const j = stableHash(dot.id) % (i + 1);
    if (j < slotCount) slots[j] = dot;
  });
  return slots.filter((d): d is FamilyTreeCompletionDot => d !== null);
}

/**
 * [2026-08-26改訂・第4段階・本部長裁定（決定10）] 景品は40スロットの中で
 * 「優先確保」する（上限の対象外にはしない）。
 *   1. その季節の全景品（`dot.prize !== null`）をまず確定的に表示枠へ入れる。
 *   2. 残った枠数を、従来どおり通常の色丸のreservoir samplingで埋める。
 *   3. 合計は常に40スロット以下を維持する。
 *   4. 万一景品だけで40スロットを超える場合は、景品側もreservoir sampling
 *      （4-a. 古い順ではなく既存と同じ決定論的アルゴリズムを流用）で間引く。
 *      1シーズンに景品40個＝完了報告200件が必要なため実運用ではまず起こらない
 *      （デザイントークン.md 1.8節・主要画面ワイヤーフレーム.md 21.0節決定10参照）。
 *
 * 景品（36pt）は通常の色丸（13pt）の約7.7倍の面積があるため、上限の対象外に
 * すると20章決定3が守ろうとした視覚的な予算（40個）を超えてしまう、というのが
 * この方式を採用した理由（当初のUIUXデザイン部案からの本部長修正）。
 */
export function pickDisplaySlots(dots: FamilyTreeCompletionDot[]): FamilyTreeCompletionDot[] {
  const prizeDots = dots.filter((d) => d.prize !== null);
  const normalDots = dots.filter((d) => d.prize === null);

  const keptPrizes = prizeDots.length <= MAX_SLOTS ? prizeDots : reservoirSample(prizeDots, MAX_SLOTS);
  const remainingSlots = MAX_SLOTS - keptPrizes.length;
  const keptNormal = reservoirSample(normalDots, remainingSlots);

  return [...keptPrizes, ...keptNormal];
}

/**
 * 段階ごとの木の形。
 *
 * [2026-08-24再改訂・本部長] 初回の作り直しでは段階ごとに「大きさ」だけを変え、
 * 形はどの段階も同じ樹冠にしていた。その結果、芽（stage1）が「小さい木」に
 * 見えてしまい、ユーザーから「これは芽なのかは疑問」との指摘を受けた。
 * 芽は木の縮小版ではなく双葉という別の形であるため、段階ごとに
 * 「形の種類（kind）」自体を変える設計に改めた。
 *   seed  : まだ何も生えていない。土と種のみ
 *   sprout: 双葉。細く短い茎＋左右に開いた2枚の葉（樹冠は作らない）
 *   tree  : 幹＋樹冠。若木→花→実で単調に大きくなる
 */
type StageShape =
  | { kind: "seed" }
  | { kind: "sprout"; stemHeight: number; leafWidth: number; leafHeight: number }
  | { kind: "tree"; leafRadius: number; trunkWidth: number; trunkHeight: number };

// [2026-08-24拡大・本部長] ユーザーから「家族の木はもっと大きくてもよい、
// スマホ画面の3分の2くらい」との要望を受けて全段階を拡大した。
// 制約は縦ではなく**横**にある。スマホ幅375ptから余白を引いた実質340ptに
// 樹冠の横幅（leafRadius * 2.7）が収まる必要があり、leafRadius=125 が上限に近い
// （125 * 2.7 = 337.5pt）。この横幅に対して樹冠の高さは自動的に決まるため、
// 画面の3分の2に近づけるぶんは幹を長くして稼いでいる（幹が長いほど、将来
// 枝先に飾りを吊るす余地も増える）。実の段階で全体約480pt≒画面の約60%。
// 樹冠の面積は拡大前の約2.9倍になり、色丸40個が重なりにくくなる。
const STAGE_GEOMETRY: readonly StageShape[] = [
  { kind: "seed" },
  { kind: "sprout", stemHeight: 62, leafWidth: 116, leafHeight: 70 },
  { kind: "tree", leafRadius: 82, trunkWidth: 20, trunkHeight: 88 },
  { kind: "tree", leafRadius: 105, trunkWidth: 27, trunkHeight: 110 },
  { kind: "tree", leafRadius: 125, trunkWidth: 34, trunkHeight: 130 },
] as const;

/**
 * 表示領域の高さを全段階で固定するための値（実の段階の全高に合わせる）。
 * 段階ごとに高さが変わると、成長した瞬間に画面がガタつくうえ、
 * 種・芽の段階で「まだ小さい」ことが余白の少なさとして伝わってしまう。
 * 高さを固定して下端（地面）を揃えることで、小さい段階では上方向に
 * 伸びしろが見える＝「これから育つ」ことが余白として伝わるようにする。
 */
// 樹冠256(=125*2.05) + 幹130 + 土110 ≒ 496。
// [2026-08-24再改訂] 地面を下方向に広げた分だけ全体も高くした（木の位置は変えず、
// 下に伸ばすだけ）。スマホ812ptに対して約64%で、当初の要望「画面の3分の2くらい」
// にほぼ一致する。
const CANVAS_HEIGHT = 520;

/** 双葉の開き角（左右対称）。 */
const SPROUT_LEAF_ANGLE_DEG = 26;

/**
 * 色丸の色を決める。
 *
 * [2026-08-24] 一時は「avatar_colorがNULLなら報告者IDから色を導出する」という
 * 表示側フォールバックを入れたが、**内訳リストのアバター（MemberAvatar）には
 * 同じ処理が無いため、木の色丸と内訳の色が食い違う**という不整合をユーザーの
 * 実機確認で指摘された。表示箇所ごとにフォールバックを実装して回る方式は
 * 漏れが必ず起きるため撤回し、データ側で全メンバーに色を持たせる方式に変更した
 * （マイグレーション 20260824221436_assign_avatar_color_to_all_members.sql。
 * 保護者・みまもりメンバーを作る3つのRPCが avatar_color を一切設定していない
 * という根本原因を修正し、既存メンバーにも色を補充した）。
 * よってここは素直にavatar_colorを使う。万一NULLが残っていた場合はグレーに
 * なるが、それは内訳リスト側の表示とも一致する（食い違わない）。
 */
function dotColor(dot: FamilyTreeCompletionDot): string {
  return dot.avatar_color ?? theme.colors.neutralBorder;
}

/**
 * [2026-08-26追加・第4段階] 表示直径。景品に交換された丸だけ36pt、それ以外は
 * 通常どおり13pt固定。要件定義書07-13-4章の必須条件どおり、この大きさは
 * 「これは景品だ」という意味のみを持ち、報告者の貢献度・完了報告数では変動しない。
 */
function dotDisplaySize(dot: FamilyTreeCompletionDot): number {
  return dot.prize ? PRIZE_DOT_SIZE : DOT_SIZE;
}

// [2026-08-24再改訂] 当初は段階ごとに土の幅を変えていたが、
// 「地面は端まで届かせて、下方向に広げてよい」との指摘を受けて全段階で
// 画面幅いっぱいに変更した。地面は木と違って「育つもの」ではないので、
// 段階によって広さが変わる必然性がそもそも無い。
// 面積が広がったことで、色丸の「地面タイプ」の配分が意味を持つようになる。
const SOIL_HEIGHT = 110;
/** stage0（種）で、まかれた種を散らす範囲の半径。地面に沿うよう縦は潰す。 */
const SEED_SCATTER_RADIUS = 56;

/**
 * 完了報告IDから、葉の円の内側の座標を決定論的に求める。
 * 極座標で求め、半径にsqrtを掛けることで円内に偏りなく散る（中心に密集しない）。
 * 乱数を使わないため、どの家族メンバーの端末で見ても必ず同じ配置になる。
 */
function dotOffsetInEllipse(id: string, rx: number, ry: number): { x: number; y: number } {
  const h = stableHash(id);
  const angle = ((h % 3600) / 3600) * Math.PI * 2;
  const normalized = Math.sqrt(((h >>> 11) % 1000) / 1000);
  return { x: Math.cos(angle) * normalized * rx, y: Math.sin(angle) * normalized * ry };
}


/**
 * 色丸どうしが重ならないように配置する。
 *
 * [2026-08-24追加・本部長] 「ひとつひとつに一定の間隔（近づきすぎない）を」との
 * 要望に対応。各点を独立にランダム配置していたため重なりが頻発していた。
 *
 * 方式は棄却サンプリング。候補位置を順に試し、既に置いた点すべてと
 * 「互いの半径の合計＋余白」以上離れている最初の位置を採用する。
 * 候補も完了報告IDから作る（`id|0`, `id|1`, …）ため乱数を使わず、
 * どの端末でも必ず同じ配置になるという決定4の性質を維持している。
 *
 * 将来ガチャの絵と交換された丸は半径が大きくなるが、判定を固定距離ではなく
 * 「互いの半径の合計」にしてあるため、そのまま正しく動く。絵の周囲に小さい丸が
 * 寄るのは、絵が丸で縁取られたように見えるため許容する（本部長判断）。
 */
type PlacedDot = { x: number; y: number; r: number };
type PlacementBounds = { cx: number; cy: number; rx: number; ry: number };

const PLACEMENT_TRIES = 24;
const PLACEMENT_GAP = 2;

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
  // 候補を試し切っても空きが無い場合は、最も余裕のあった位置を使う
  // （点が多すぎて物理的に収まらないケース。重なりは残るが最小限になる）。
  return best;
}

/**
 * 同じ座標系に属する色丸をまとめて配置する（互いの重なりを避ける）。
 * [2026-08-26改訂・第4段階] 半径は`radius`引数で一律に受け取るのではなく、
 * `dotDisplaySize`でドットごとに個別算出するよう変更した（景品36pt・通常13ptが
 * 混在するグループに対応するため）。重なり判定自体は既存の「互いの半径の合計＋
 * 余白」方式のままで正しく動く（本ファイル冒頭コメント参照）。
 */
function placeGroup(
  items: readonly { dot: FamilyTreeCompletionDot; bounds: PlacementBounds }[]
): { dot: FamilyTreeCompletionDot; x: number; y: number }[] {
  const placed: PlacedDot[] = [];
  return items.map(({ dot, bounds }) => {
    const radius = dotDisplaySize(dot) / 2;
    const p = placeWithoutOverlap(dot.id, radius, bounds, placed);
    placed.push({ x: p.x, y: p.y, r: radius });
    return { dot, x: p.x, y: p.y };
  });
}

/**
 * 木の段階（stage2以降）で、色丸をどの部位に置くかを決める。
 *
 * [2026-08-24追加・本部長] 当初は樹冠の中央の円の内側にしか置いていなかったが、
 * ユーザーから「木全体に色を散らばせたい。そのほうが1つ1つの木に特徴が出て
 * 面白い」との要望を受けて、幹・地面・葉の左右のふくらみにも置けるようにした。
 * 割合は樹冠を主役に保ちつつ、他の部位にも必ず幾つか乗るよう調整している。
 *
 * 位置決め（dotOffsetInEllipse）とは**別のハッシュ**を使う。同じハッシュの
 * 別ビットを使うと部位と座標に相関が出て、特定の部位だけ角度が偏るため。
 */
type TreeRegion = "canopy" | "lobeLeft" | "lobeRight" | "trunk" | "soil" | "sky";

/** 空の重み。景品のときはこの分を樹冠へ振り替える（pickTreeRegion参照）。 */
const SKY_WEIGHT = 17;

const REGION_WEIGHTS: readonly (readonly [TreeRegion, number])[] = [
  ["canopy", 45],
  ["lobeLeft", 11],
  ["lobeRight", 11],
  ["trunk", 5],
  ["soil", 11],
  ["sky", 17],
] as const;

/**
 * 空に散る色丸の配置範囲。木より少し広めにとり、木の**背面**に描画する。
 * 背面に置くことで、木に重なった分は隠れて「空いている場所にだけ現れる」形になり、
 * 段階によって空の広さが変わっても（若木は上が広く、実は左右だけ空く）
 * 自動的に馴染む。
 */
/** 幅を実測できるまでの初期値。実測後は onLayout の値を使う。 */
const FALLBACK_WIDTH = 320;

/**
 * 色丸をどの部位に置くか決める。
 *
 * [2026-08-27修正・本部長] **景品（36pt）は絶対に「空」へ置かない。**
 * 空の色丸は木の**背面**に描画する設計（空いている場所にだけ現れるようにするため。
 * SKY_WIDTHのコメント参照）だが、13ptの通常の丸と違い36ptの景品が空に落ちると
 * **樹冠の裏に隠れて完全に見えなくなる**。
 *
 * ユーザーが実機で「引いたのに木に反映されていない」と報告し調査したところ、
 * 飾り4件のうち2件が空に割り当てられて隠れていた（データ・APIともに正常で、
 * この配置ロジックだけが原因だった）。景品は樹冠・葉・幹・土のいずれかに置く。
 *
 * 空の分の重みは樹冠へ寄せる（樹冠がもっとも面積が広く、景品が最も自然に見える）。
 */
function pickTreeRegion(id: string, isPrize = false): TreeRegion {
  const h = stableHash(`${id}|region`) % 100;
  let acc = 0;
  for (const [region, weight] of REGION_WEIGHTS) {
    // 景品のときは空の枠を樹冠に振り替える（空の重み分だけ樹冠が広がる）。
    const w = isPrize && region === "canopy" ? weight + SKY_WEIGHT : weight;
    if (isPrize && region === "sky") continue;
    acc += w;
    if (h < acc) return region;
  }
  return "canopy";
}

/**
 * [2026-08-26新設・第4段階] 景品に交換された丸（36pt）の中身の表現。
 * デザイントークン.md 1.8節「ガチャの景品（36pt）の表示ルール」対応。
 * - 既製の飾り: 円の中にカタログの絵文字を配置する。
 * - 家族の絵: 線データを`DrawingThumbnail`（第2段階、DrawingCanvas.tsx）で
 *   円の内側に静止レンダリングする。
 * - 識別リング: 交換した本人の`avatar_color`（=通常の色丸と同じ色決定ロジック）を
 *   2pt実線で外周に添える（07-10章「識別表現を残すか」への回答。サイズ自体は
 *   「景品である」という意味のみを持たせ、誰の記録かはリングという別チャンネルで持たせる）。
 */
/**
 * [2026-08-27追加・本部長] 完了報告1件の色丸を、木の段階に応じた「形」で描く。
 *
 * ユーザーの指摘:「花や実は木の状態だと思う。若木と変化はないと思う」。実際、
 * 若木・花・実はいずれも`kind: "tree"`で樹冠の半径が違うだけであり、
 * **「花」と呼びながら花が無く、「実」と呼びながら実が無い**状態だった。
 * 芽（stage1）を双葉に作り直したとき（2026-08-24）と同じ問題で、
 * 上位3段階には同じ考えを適用できていなかった。
 *
 * [なぜ木に飾りを足すのではなく、色丸の形を変えるのか]
 * 1. 要素を増やさない。木に装飾を追加すると色丸・景品（36pt）と視覚的に競合する
 * 2. 意味が正しくなる。色丸は「誰かがお手伝いした1回」であり、それが
 *    つぼみ→花→実と変化するのは「家族の積み重ねが実っていく」という
 *    07-9章の趣旨そのものになる
 * 3. 07-10章の必須3条件に抵触しない。全員の丸が同じように変わるため個人間の
 *    比較は生まれない（大きさ・色は従来どおり変えていない）
 *
 * 色は従来どおり報告者のavatar_colorをそのまま使い、形だけが段階で変わる。
 */
function StageDot({ color, size, stage }: { color: string; size: number; stage: number }) {
  if (stage < 3) {
    return (
      <View
        style={[styles.dot, { backgroundColor: color, width: size, height: size, borderRadius: size / 2 }]}
      />
    );
  }
  const isFlower = stage === 3;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {isFlower ? (
        <>
          {[0, 72, 144, 216, 288].map((deg) => (
            <SvgCircle
              key={deg}
              cx={50 + 26 * Math.cos((deg - 90) * (Math.PI / 180))}
              cy={50 + 26 * Math.sin((deg - 90) * (Math.PI / 180))}
              r={22}
              fill={color}
            />
          ))}
          <SvgCircle cx={50} cy={50} r={15} fill={FLOWER_CENTER_COLOR} />
        </>
      ) : (
        <>
          <SvgPath d="M50 6 C58 12 62 20 58 28 L42 28 C38 20 42 12 50 6 Z" fill={theme.treeColors.trunk} />
          <SvgCircle cx={50} cy={60} r={38} fill={color} />
        </>
      )}
    </Svg>
  );
}

function PrizeDotView({
  dot,
  x,
  y,
  size,
}: {
  dot: FamilyTreeCompletionDot;
  x: number;
  y: number;
  size: number;
}) {
  const prize = dot.prize;
  if (!prize) return null;
  const ringColor = dotColor(dot);
  const innerSize = Math.max(size - PRIZE_RING_WIDTH * 2 - 2, 0);
  return (
    <View
      style={[
        styles.prizeDot,
        {
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: ringColor,
        },
      ]}
    >
      {prize.prizeKind === "preset_ornament" ? (
        <Text style={styles.prizeEmoji}>{prize.presetOrnament?.emoji ?? "🎁"}</Text>
      ) : prize.drawing ? (
        <DrawingThumbnail lineData={prize.drawing.line_data} size={innerSize} />
      ) : null}
    </View>
  );
}

export function TreeStageVisual({
  stage,
  dots,
  highlightMemberId = null,
  highlightCompletionId = null,
}: {
  stage: number;
  dots: FamilyTreeCompletionDot[];
  /**
   * [2026-08-26新設・第4段階] 木への飾り付け「かざりつけモード」用（決定7・決定8）。
   * 指定すると、このmember_idが報告者の色丸にのみ「淡い強調」を加算的に添える。
   * 他人の丸の描画には一切手を加えない（グレーアウト・縮小のような減算的表現は
   * 行わない）。通常表示（家族の木画面）ではnullのまま渡し、従来どおりの見た目にする。
   */
  highlightMemberId?: string | null;
  /** 一覧UIで選択中の完了報告ID。40スロットの表示対象に含まれる場合のみ木の上でも強調する。 */
  highlightCompletionId?: string | null;
}) {
  const slots = useMemo(() => pickDisplaySlots(dots), [dots]);
  const shape = STAGE_GEOMETRY[stage] ?? STAGE_GEOMETRY[0];
  // 幅は固定値ではなく実測する。固定値だと画面幅とずれ、はみ出した分が
  // React Nativeの既定の切り取りで消える（空の色丸が出ない不具合の原因になった）。
  const [canvasWidth, setCanvasWidth] = useState(FALLBACK_WIDTH);

  // 木の段階だけ、色丸を部位ごとに振り分ける（種・芽は従来どおり地面／双葉に置く）。
  const byRegion = useMemo(() => {
    const map: Record<TreeRegion, FamilyTreeCompletionDot[]> = {
      canopy: [], lobeLeft: [], lobeRight: [], trunk: [], soil: [], sky: [],
    };
    if (shape.kind === "tree") {
      for (const dot of slots) map[pickTreeRegion(dot.id, dot.prize !== null)].push(dot);
    } else if (shape.kind === "sprout") {
      // 芽は樹冠・幹が無いので双葉と空だけに振り分ける。芽の段階は完了報告が
      // 10〜29件あり、2枚の葉だけでは密集しがちなため、空に逃がす意味もある。
      for (const dot of slots) {
        const r = pickTreeRegion(dot.id, dot.prize !== null);
        if (r === "sky") map.sky.push(dot);
        else if (r === "soil" || r === "trunk") map.soil.push(dot); // 芽には幹が無いので地面へ寄せる
        else if (stableHash(dot.id) % 2 === 0) map.lobeLeft.push(dot);
        else map.lobeRight.push(dot);
      }
    }
    return map;
  }, [slots, shape.kind]);

  const bounds = (cx: number, cy: number, rx: number, ry: number): PlacementBounds => ({
    cx, cy, rx: Math.max(rx, 0), ry: Math.max(ry, 0),
  });

  /**
   * 重なりを避けて配置済みの色丸を描く。
   * [2026-08-26改訂・第4段階] 景品（`dot.prize`非null）は`PrizeDotView`で描き、
   * 通常の色丸は従来どおり単色の円で描く。`highlightMemberId`と一致する報告者の
   * 丸には、決定8の「淡い強調」（`mineHalo`）を丸の背面に加算的に添える
   * （他人の丸のスタイルは一切変更しない）。
   */
  const renderPlaced = (items: { dot: FamilyTreeCompletionDot; x: number; y: number }[]) =>
    items.map(({ dot, x, y }) => {
      const size = dotDisplaySize(dot);
      const isMine = highlightMemberId != null && dot.reported_by === highlightMemberId;
      const isSelected = isMine && highlightCompletionId != null && dot.id === highlightCompletionId;
      const haloSize = size + MINE_HALO_PADDING * 2;
      return (
        <React.Fragment key={dot.id}>
          {isMine && (
            <View
              pointerEvents="none"
              style={[
                styles.mineHalo,
                {
                  left: x - haloSize / 2,
                  top: y - haloSize / 2,
                  width: haloSize,
                  height: haloSize,
                  borderRadius: haloSize / 2,
                },
                isSelected && styles.mineHaloSelected,
              ]}
            />
          )}
          {dot.prize ? (
            <PrizeDotView dot={dot} x={x} y={y} size={size} />
          ) : (
            <View style={[styles.dotWrap, { left: x - size / 2, top: y - size / 2, width: size, height: size }]}>
              <StageDot color={dotColor(dot)} size={size} stage={stage} />
            </View>
          )}
        </React.Fragment>
      );
    });

  /** 1つの座標系に属する色丸をまとめて配置して描く。 */
  const renderGroup = (
    items: { dot: FamilyTreeCompletionDot; bounds: PlacementBounds }[]
  ) => renderPlaced(placeGroup(items));

  return (
    <View
      style={styles.canvas}
      onLayout={(e) => setCanvasWidth(e.nativeEvent.layout.width)}
    >
      {/* 背景（晴れた空）。太陽と雲は固定色で、個人色には染めない。
          いちばん背面に置き、木や色丸より目立たないよう彩度を抑える。 */}
      <View style={styles.skyBackground} pointerEvents="none">
        <View style={styles.sun} />
        <View style={[styles.cloudPuff, { width: 58, height: 58, borderRadius: 29, left: 18, top: 96 }]} />
        <View style={[styles.cloudPuff, { width: 42, height: 42, borderRadius: 21, left: 56, top: 108 }]} />
        <View style={[styles.cloudPuff, { width: 36, height: 36, borderRadius: 18, left: 0, top: 112 }]} />
        <View style={[styles.cloudPuff, { width: 46, height: 46, borderRadius: 23, right: 24, top: 168 }]} />
        <View style={[styles.cloudPuff, { width: 34, height: 34, borderRadius: 17, right: 58, top: 178 }]} />
      </View>

      {/* 空に散る色丸。木より背面になるよう木の前に置く。木に重なった分は
          隠れる＝空いている場所にだけ現れる（SKY_WIDTHのコメント参照）。 */}
      <View style={styles.skyLayer} pointerEvents="none">
        {renderGroup(
          byRegion.sky.map((dot) => ({
            dot,
            bounds: bounds(canvasWidth / 2, CANVAS_HEIGHT * 0.36, canvasWidth / 2 - DOT_SIZE, CANVAS_HEIGHT * 0.32),
          }))
        )}
      </View>

      {shape.kind === "tree" && (
        <>
          {/* 樹冠は大小3つの円を重ねて作る（1つの楕円だけだと棒付きキャンディに
              見えてしまうため）。色丸は中央の大きい円の内側にだけ配置し、
              常に葉の上に乗っているように見せる。 */}
          {(() => {
            const { leafRadius } = shape;
            const boxWidth = leafRadius * 2.7;
            const boxHeight = leafRadius * 2.05;
            const mainSize = leafRadius * 2;
            const sideSize = leafRadius * 1.3;
            const dotRadius = Math.max(leafRadius - DOT_SIZE, 0);
            return (
              <View style={{ width: boxWidth, height: boxHeight }}>
                <View
                  style={[
                    styles.leafShape,
                    { width: sideSize, height: sideSize, borderRadius: sideSize / 2, left: 0, top: boxHeight - sideSize },
                  ]}
                />
                <View
                  style={[
                    styles.leafShape,
                    { width: sideSize, height: sideSize, borderRadius: sideSize / 2, right: 0, top: boxHeight - sideSize },
                  ]}
                />
                <View
                  style={[
                    styles.leafShape,
                    { width: mainSize, height: mainSize, borderRadius: leafRadius, left: (boxWidth - mainSize) / 2, top: 0 },
                  ]}
                />
                {/* 樹冠と左右のふくらみは同じ座標系なので、まとめて配置して
                    部位をまたいだ重なりも避ける。 */}
                {renderGroup([
                  ...byRegion.canopy.map((dot) => ({
                    dot,
                    bounds: bounds(boxWidth / 2, leafRadius, dotRadius, dotRadius),
                  })),
                  ...byRegion.lobeLeft.map((dot) => ({
                    dot,
                    bounds: bounds(sideSize / 2, boxHeight - sideSize / 2, sideSize / 2 - DOT_SIZE, sideSize / 2 - DOT_SIZE),
                  })),
                  ...byRegion.lobeRight.map((dot) => ({
                    dot,
                    bounds: bounds(boxWidth - sideSize / 2, boxHeight - sideSize / 2, sideSize / 2 - DOT_SIZE, sideSize / 2 - DOT_SIZE),
                  })),
                ])}
              </View>
            );
          })()}
          <View
            style={{
              width: shape.trunkWidth,
              height: shape.trunkHeight,
              marginTop: -2,
              backgroundColor: theme.treeColors.trunk,
              borderBottomLeftRadius: 3,
              borderBottomRightRadius: 3,
            }}
          >
            {renderGroup(
              byRegion.trunk.map((dot) => ({
                dot,
                bounds: bounds(
                  shape.trunkWidth / 2,
                  shape.trunkHeight / 2,
                  shape.trunkWidth / 2 - DOT_SIZE / 2,
                  shape.trunkHeight / 2 - DOT_SIZE
                ),
              }))
            )}
          </View>
        </>
      )}

      {/* stage1（芽）は双葉。細い茎の先に左右へ開いた葉を2枚つける。
          色丸は葉の子要素として置くので、葉の傾きに合わせて一緒に傾く
          （＝葉の表面に乗っているように見える）。 */}
      {shape.kind === "sprout" && (() => {
        const { stemHeight, leafWidth, leafHeight } = shape;
        const rx = leafWidth / 2 - DOT_SIZE / 2 - 2;
        const ry = leafHeight / 2 - DOT_SIZE / 2 - 2;
        // 空に振り分けられた分は上のskyLayerが描くので、ここでは葉の分だけを使う
        // （両方で描くと同じ色丸が二重に出てしまう）。
        const leftDots = byRegion.lobeLeft;
        const rightDots = byRegion.lobeRight;
        // 双葉は左右の葉を「外側の先端が上・内側の付け根が下」に傾けてV字に開く。
        // 回転方向を逆にすると2枚が外へ垂れて1つの塊に重なり、茂みのように
        // 見えてしまう（初回実装の不具合）。CSSの正の回転は時計回りなので、
        // 左の葉が時計回り(+)・右の葉が反時計回り(-)でV字になる。
        const renderLeaf = (leafDots: FamilyTreeCompletionDot[], side: "left" | "right") => (
          <View
            style={[
              styles.leafShape,
              {
                width: leafWidth,
                height: leafHeight,
                borderRadius: leafWidth / 2,
                [side]: 0,
                top: 0,
                transform: [{ rotate: `${side === "left" ? SPROUT_LEAF_ANGLE_DEG : -SPROUT_LEAF_ANGLE_DEG}deg` }],
              },
            ]}
          >
            {renderGroup(
              leafDots.map((dot) => ({ dot, bounds: bounds(leafWidth / 2, leafHeight / 2, rx, ry) }))
            )}
          </View>
        );
        return (
          <View style={{ width: leafWidth * 2, height: leafHeight + stemHeight, alignItems: "center" }}>
            {renderLeaf(leftDots, "left")}
            {renderLeaf(rightDots, "right")}
            <View style={[styles.sproutStem, { height: stemHeight + 8, top: leafHeight - 8 }]} />
          </View>
        );
      })()}

      {/* stage0（種）はまだ何も生えていないので、まかれた種を土の上に散らして見せる。
          色丸が土に埋もれないよう、土より前面へ重ねる。 */}
      {shape.kind === "seed" && (
        <View style={styles.groundScatter}>
          {renderGroup(
            slots.map((dot) => ({
              dot,
              // 地面に沿うよう縦を潰した楕円の中に散らす。
              bounds: bounds(
                SEED_SCATTER_RADIUS,
                SEED_SCATTER_RADIUS * 0.42,
                SEED_SCATTER_RADIUS - DOT_SIZE / 2,
                SEED_SCATTER_RADIUS * 0.42 - DOT_SIZE / 2
              ),
            }))
          )}
          <View style={styles.seed} />
        </View>
      )}

      {/* 地面は全段階で画面幅いっぱい。上端だけ緩く丸めて、平らな板ではなく
          なだらかな地平線に見せる。 */}
      <View style={styles.soil}>
        {renderGroup(
          byRegion.soil.map((dot) => ({
            dot,
            bounds: bounds(canvasWidth / 2, SOIL_HEIGHT / 2 + 6, canvasWidth / 2 - DOT_SIZE, SOIL_HEIGHT / 2 - DOT_SIZE),
          }))
        )}
      </View>
    </View>
  );
}

/**
 * 詳細内訳（タップ表示）。07-10章必須3条件:
 * ①ソートしない（呼び出し元がmember_created_at昇順で渡す前提。本コンポーネントは
 *   受け取った配列の順序をそのまま表示するのみで、内部で再ソートしない）
 * ②勝者演出を入れない（強調枠・ハイライト・1位ラベル等を一切描画しない）
 * ③比較誘発コピーを使わない（呼び出し元の見出し文言側で担保）
 */
export function FamilyTreeBreakdownList({
  breakdown,
  countLabel = "回",
}: {
  breakdown: FamilyTreeMemberBreakdown[];
  countLabel?: string;
}) {
  return (
    <View style={{ gap: theme.spacing.s2 }}>
      {breakdown.map((row) => (
        <View key={row.member_id} style={styles.breakdownRow}>
          <MemberAvatar name={row.display_name} color={row.avatar_color} size={28} />
          <Text style={[theme.typography.parentBody, styles.breakdownName]}>{row.display_name}</Text>
          <Text style={theme.typography.parentBodyMedium}>
            {row.completion_count}
            {countLabel}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // 高さを固定し、下端（地面）を揃える。段階が上がっても画面がガタつかない。
  canvas: {
    // 空の色丸レイヤーを収めるため横幅いっぱいに広げる。木の幅しか無いと
    // はみ出した空の色丸が切り取られて消える。
    width: "100%",
    height: CANVAS_HEIGHT,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: theme.spacing.s4,
  },
  skyBackground: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: CANVAS_HEIGHT,
    backgroundColor: theme.treeColors.sky,
    borderRadius: theme.radius.childXl,
    overflow: "hidden",
  },
  sun: {
    position: "absolute",
    right: 26,
    top: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.treeColors.sun,
  },
  cloudPuff: {
    position: "absolute",
    backgroundColor: theme.treeColors.cloud,
    opacity: 0.85,
  },
  skyLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: CANVAS_HEIGHT,
  },
  leafShape: {
    position: "absolute",
    backgroundColor: theme.treeColors.foliageBase,
  },
  sproutStem: {
    position: "absolute",
    width: 6,
    backgroundColor: theme.treeColors.trunk,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  dotWrap: { position: "absolute" },
  dot: {
    position: "absolute",
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    borderWidth: 1,
    // [2026-08-24修正] 当初は白の縁取りにしていたが、メンバーカラーが
    // パステル調（1.3節の8色）で葉の下地とも明度が近いため、白縁が色を
    // 洗い流して全部が白っぽく見えてしまっていた。暗い半透明の縁に変更して
    // 輪郭だけを締める（勝者演出ではなく単なる視認性確保）。
    borderColor: "rgba(0,0,0,0.16)",
  },
  // [2026-08-26追加・第4段階] 景品（36pt）の円。識別リング（avatar_color）の内側に
  // 既製の飾りの絵文字、または家族の絵のサムネイル（DrawingThumbnail）を収める。
  prizeDot: {
    position: "absolute",
    borderWidth: PRIZE_RING_WIDTH,
    backgroundColor: theme.colors.neutralSurface,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  prizeEmoji: {
    fontSize: 20,
  },
  // [2026-08-26追加・第4段階] かざりつけモードで自分の色丸にのみ添える「淡い強調」
  // （決定8、加算的表現）。他人の丸にはこのViewを一切描かない。
  mineHalo: {
    position: "absolute",
    backgroundColor: "rgba(255,201,77,0.28)", // gachaColors.accentのソフト版
  },
  mineHaloSelected: {
    backgroundColor: "rgba(255,201,77,0.55)",
    borderWidth: 1,
    borderColor: theme.gachaColors.accent,
  },
  soil: {
    alignSelf: "stretch",
    height: SOIL_HEIGHT,
    backgroundColor: theme.treeColors.soil,
    borderTopLeftRadius: 44,
    borderTopRightRadius: 44,
  },
  groundScatter: {
    width: SEED_SCATTER_RADIUS * 2,
    height: SEED_SCATTER_RADIUS * 0.42 * 2,
    marginBottom: -SEED_SCATTER_RADIUS * 0.42,
    zIndex: 1,
  },
  seed: {
    position: "absolute",
    left: SEED_SCATTER_RADIUS - 7,
    bottom: -2,
    width: 14,
    height: 11,
    borderRadius: 7,
    backgroundColor: theme.treeColors.trunk,
  },
  breakdownRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  breakdownName: { flex: 1 },
});

export default TreeStageVisual;
