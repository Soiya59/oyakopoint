import React, { useMemo, useState } from "react";
import {
  GestureResponderEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextStyle,
  View,
  useWindowDimensions,
} from "react-native";
import theme from "@/theme/theme";
import type { StickerRarity, StickerShape } from "@/theme/theme";
import type { FamilyTreeCompletionDot, FamilyTreeHabitFigurePlacement, FamilyTreeStickerPlacement } from "@/data/api";
import type { FamilyMember, FamilyTreeMemberBreakdown, FamilyTreeWeeklyCompletionCount } from "@/types/domain";
import MemberAvatar from "./MemberAvatar";
import Svg, { Circle as SvgCircle, Line as SvgLine, Path as SvgPath } from "react-native-svg";
import { DrawingThumbnail } from "./DrawingCanvas";
import { StickerIcon } from "./StickerIcon";
import FigureIcon from "./FigureIcon";
import FigureFrame from "./FigureFrame";
import { useAppData } from "@/data/store";
import { addDaysToDateString, formatDateShort, getJstToday, getJstWeekStartDate } from "@/lib/calendarDates";
import { pickNearestTreeTapTarget } from "@/lib/treeTapTargets";

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
export const PRIZE_DOT_SIZE = 36;
/**
 * [2026-09-07追加・要件定義書07-19-9a章、2026-09-10改訂・実装メモ149章]
 * 木を飾るステッカー（購入品）の表示直径。旧デザイントークン.md 1.11節は
 * 「木の上での表示直径 24pt固定」だったが、統括要望（本部長経由・149章）を
 * 受けて30ptに拡大した。通常の色丸13pt超・景品〈家族の絵〉36pt未満の中間
 * サイズという既存の原則（07-13-4章・32章）は30ptでも変わらず満たす。誰が
 * 何回購入しても大きさは変動しない（レアリティは大きさではなく色・質感のみで
 * 表現、決定3）。
 * [未反映] デザイントークン.md 1.11節の「24pt固定」表記は本改訂時点でまだ
 * 更新していない（設計部側の作業。実装メモ149章「迷った点」参照）。
 */
export const STICKER_DOT_SIZE = 30;
/**
 * 花（stage3）の花芯の色。個人色に染めない固定色（木の共有部分と同じ扱い）。
 * [2026-09-01変更] 旧値`#FFF3B0`はメンバーカラー「レモン」と完全一致していたため、
 * デザイントークン.md 1.8節の新規トークン`color-tree-flower-center`に差し替えた
 * （theme.ts側の値を正とし、ここではハードコードしない。実装メモ100章）。
 */
const FLOWER_CENTER_COLOR = theme.treeColors.flowerCenter;

/** 景品の識別リング（交換した本人のavatar_color、2pt実線）の太さ。 */
export const PRIZE_RING_WIDTH = 2;
/** かざりつけモードで自分の色丸に添える「淡い強調」のはみ出し幅（決定8）。 */
const MINE_HALO_PADDING = 4;

/**
 * [2026-09-17追加・主要画面ワイヤーフレーム.md 46.14節 決定13・開発部への実装メモ2]
 * 景品の識別リング（`PRIZE_RING_WIDTH`、2pt実線）の内側に絵柄が収まる直径を計算する。
 * `PrizeDotView`・`FreeStickerView`の`innerSize`計算と完全に同じ式をここに1箇所だけ
 * 定義し、お絵かきの縮小見本（DrawingBoard.tsx）もこの関数を呼ぶことで、木側の直径
 * （`PRIZE_DOT_SIZE`）が将来変わっても見本側だけ古い値のまま残る事故を防ぐ。
 */
export function prizeInnerSize(size: number): number {
  return Math.max(size - PRIZE_RING_WIDTH * 2 - 2, 0);
}

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
// [2026-09-07・要件定義書07-19-9a章「決定5」・主要画面ワイヤーフレーム.md
// 32.0節決定5] 景品（ガチャ）は40スロットの中で優先確保する（上限の対象外に
// しない）。一度「木に飾る」を確定した装飾が確率的な間引きで偶発的に表示から
// 漏れると「置いたはずなのに消えた」という体験になるため（07-9章「後退しない」
// 原則・21.0節決定10と同じ理由）。
// [2026-09-08改訂・スキーマ設計.sql 49章「決定49-8」] 木を飾るステッカー（購入品）は
// 自由配置化に伴い、この40スロット・reservoir samplingの対象から外れた
// （`dot.sticker`というフィールド自体が廃止された。ステッカーは`chore_completions`
// を一切参照しなくなったため、そもそも本関数が扱う`dots`〈色丸〉の集合には
// 含まれ得ない）。自由配置ステッカーは`stickerPlacements`という完全に独立した
// 表示レイヤーとして扱い、最前面固定で描画する（下記TreeStageVisualの
// stickerPlacementsプロパティ参照）。
function isPrioritizedDot(d: FamilyTreeCompletionDot): boolean {
  return d.prize !== null;
}

/**
 * [2026-09-14追加・実装メモ223章の調査を受けて224章で実装・案A（統括選択）]
 * 「選んでいる最中の完了報告は、40個の枠から外れないよう必ず表示する」対応。
 *
 * 223章で判明した不具合: かざりつけモードで一覧から選んだ完了報告（まだ
 * `prize`が付いていない＝`normalDots`側）が、今シーズンの合計が40件を超える
 * 家庭ではreservoir samplingで表示対象から漏れることがあり、「選んだ瞬間は
 * 木の上に何も出ないのに、確定すると別の場所に景品が現れる」という体験に
 * なっていた（真の原因は223.1節）。
 *
 * 直し方（案A）: 景品（`isPrioritizedDot`）が40スロットの中で優先確保されて
 * いるのと**全く同じ考え方**を、まだ確定していない「選択中」の完了報告にも
 * 適用する。`forceIncludeId`（選択中の完了報告ID）を指定すると、既存の
 * reservoir sampling計算（`keptPrizes`・`keptNormal`）は一切変更せず、
 * その計算結果に選択中の対象が含まれていなければ**追加で1件だけ付け足す**。
 *
 * 既存の計算をそのまま使う（間引かない）ため、`forceIncludeId`を渡さない
 * 呼び出し（飾り付けモードでない各ロールのfamily-tree.tsx等）は従来と
 * 完全に同じ結果になる（本関数の冒頭〜returnまでの計算経路は無変更。
 * 224.2節でNode実行により実測確認済み）。
 *
 * 犠牲になる点（統括が了承済み・避けようとしなくてよい）: 選んでいる間だけ、
 * 表示される色丸の合計が一時的に40個を超える（例: 40個＋選択中の1個）。
 * 木から離れれば（選択中でなくなれば）通常どおり40個以下に戻る。
 */
export function pickDisplaySlots(
  dots: FamilyTreeCompletionDot[],
  forceIncludeId?: string | null
): FamilyTreeCompletionDot[] {
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
// [2026-09-08追加・スキーマ設計.sql 49章] exportする。自由配置ステッカーの
// ドラッグ配置・移動UI（TreeStickerDragCanvas.tsx）が、木のキャンバスと同じ
// 高さの重なり合うオーバーレイを作るために必要（座標変換 pos_y/1000*CANVAS_HEIGHT）。
export const CANVAS_HEIGHT = 520;

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
 * [2026-09-08改訂・49章] `dot.sticker`分岐は廃止した（isPrioritizedDot直上の
 * コメント参照）。ステッカーの表示直径（`STICKER_DOT_SIZE`）は自由配置レイヤー
 * （`FreeStickerView`）が個別に使う。
 */
function dotDisplaySize(dot: FamilyTreeCompletionDot): number {
  if (dot.prize) return PRIZE_DOT_SIZE;
  return DOT_SIZE;
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
 * [2026-09-07追加・140章] `getSize`を省略可能にし、既定は`dotDisplaySize`のまま。
 * `TreeStageVisual`はプレビュー中の色丸だけ大きさを差し替えた`getSize`を渡す
 * （プレビューでも重なり回避の半径計算に反映されるようにするため）。
 */
function placeGroup(
  items: readonly { dot: FamilyTreeCompletionDot; bounds: PlacementBounds }[],
  getSize: (dot: FamilyTreeCompletionDot) => number = dotDisplaySize
): { dot: FamilyTreeCompletionDot; x: number; y: number }[] {
  const placed: PlacedDot[] = [];
  return items.map(({ dot, bounds }) => {
    const radius = getSize(dot) / 2;
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

/** 空の重み。景品・ステッカーのときはこの分を樹冠へ振り替える（pickTreeRegion参照）。 */
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
 *
 * [2026-09-08誤り・撤回済み] 一時、`isPrize`分岐を削除し常にIDだけで部位を決める
 * 版に変更したことがあった（前任者による対応・139章）。理由は「かざりつけモードで
 * ハイライトした場所と、確定後に景品が現れる場所が食い違う」という統括報告への
 * 対応だったが、**この直し方自体が本部長の指示ミスだった**。`isPrize`分岐は
 * 直上のコメントのとおり2026-08-27の実際の本番不具合（景品が空に落ちて樹冠の裏に
 * 隠れる）への対応であり、削除すると同じ不具合が再発する（前任者の実測で新実装の
 * 16.6%が空に割り当てられていた。139章）。前任者は変更前にこの再発リスクを
 * コメント・実装メモにきちんと明記しており、指摘は正しかった。**指示を出した
 * 本部長の側が誤っていた**（140章に記録）。
 *
 * 統括報告の真の原因は「置き場所の規則」ではなく「ハイライトの出し方」だった。
 * `TreeDecoratePanel`は、まだ景品になっていない色丸をそのまま渡してハイライトして
 * いたため、ハイライトは`isPrize=false`の位置に出て、確定後に`isPrize=true`へ
 * 切り替わると別の場所へ移動していた。正しい直し方は本関数を変えることではなく、
 * `TreeStageVisual`の`previewDecorationSize`（後述）で「選択中の色丸だけ確定後の
 * 姿（位置・大きさ）を先取りしてプレビューする」こと。本関数は`isPrize`分岐ごと
 * 元の実装に戻した（140章）。
 */
export function pickTreeRegion(id: string, isPrize = false): TreeRegion {
  const h = stableHash(`${id}|region`) % 100;
  let acc = 0;
  for (const [region, weight] of REGION_WEIGHTS) {
    // 景品・ステッカーのときは空の枠を樹冠に振り替える（空の重み分だけ樹冠が広がる）。
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
 *
 * [2026-09-03追加・下位3段階＋実の再設計] 統括「芽と若木の時も同じように変えることって
 * できる？」を受け、`stage < 3`が「ただの丸」のまま残っていた欠落を埋めた。
 * デザイントークン.md 1.8節「下位3段階（種・芽・若木）の色丸の形」・
 * 「実（stage4）の形の再設計（2026-09-03・統括判断）」対応。
 *   種＝粒（対称なレンズ形）、芽＝双葉（葉2枚）、若木＝葉1枚。
 * 芽と若木の葉のパスは、2026-09-03に差し替えたアプリアイコン（実装メモ121章、
 * `宣伝部/成果物/アプリアイコン/候補B.html`）の葉の曲線をそのまま流用している
 * （拡大縮小と平行移動のみを適用し、曲線＝制御点の相対位置は変えていない）。
 * アイコン→スプラッシュ→木の色丸の3箇所で同じ曲線が使われることになる。
 * 実（stage4）は「丸＋まっすぐの太いヘタ」だった旧形が13ptでは風船に見えていた
 * ため、りんご（本体＋軸＋葉）に作り直した。**小さいと本体の輪郭の凹凸は消える
 * ため、りんごらしさは葉の有無で担保する**（丸だけでは花・実の区別が付かない）。
 *
 * [2026-09-03再改訂・統括の実機レビュー] 上記で作った芽（双葉2枚）・若木（葉1枚）
 * を統括が実機で見て2点指摘した。(1) 芽が「ちょうちょみたいになっている」
 * （双葉の2枚を下端1点で接合し左右対称に描いたため、蝶の羽に見えた）。
 * (2) 「背景が双葉だから、芽のときに1枚、若木で2枚は変」（芽の段階の背景の木
 * そのものが双葉であり、印は双葉であるべきなのに若木側に葉が2枚残っていた）。
 * **色丸は「その段階の木の姿」を表すという考え方に統一**し、種＝粒、芽＝双葉、
 * 若木＝小さな木（幹＋雲形の樹冠。背景の若木の縮小版）、花＝花、実＝りんご、
 * とした（デザイントークン.md「芽・若木の形の再設計」節、統括採択済み）。
 * 芽は軸を足し開き角を±30°にして双葉として読めるようにし、若木は葉1枚をやめて
 * 背景の若木と同じ「幹＋大小3円の樹冠」構成の縮小版に差し替えた。
 */
const DOT_STROKE_COLOR = "rgba(0,0,0,0.16)";
const DOT_STROKE_WIDTH = 1;

/**
 * [2026-09-08追加・実装メモ153章] 保護者ホーム（P7）の家族の木ミニウィジェットが、
 * カード内に「いまの段階の木の絵」を小さく（40pt目安）添えるために、この段階専用の
 * 形をそのまま再利用したいという理由でexportした。新しい絵は描かず、この部品を
 * そのまま呼ぶ（統括判断・本部長具申「木の全体はホームに置かない」を踏まえたA案）。
 * `color`には報告者の`avatar_color`ではなく`theme.treeColors.foliageBase`
 * （木の共有部分・樹冠の背景と同じ固定色）を渡すこと。個人の色は使わない。
 */
export function StageDot({ color, size, stage }: { color: string; size: number; stage: number }) {
  if (stage <= 0) {
    // 種: 対称なレンズ形（粒）。
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <SvgPath
          d="M50 18 C64 18 74 34 74 50 C74 66 64 82 50 82 C36 82 26 66 26 50 C26 34 36 18 50 18 Z"
          fill={color}
          stroke={DOT_STROKE_COLOR}
          strokeWidth={DOT_STROKE_WIDTH}
        />
      </Svg>
    );
  }
  if (stage === 1) {
    // 芽: 双葉（軸＋左右2枚）。
    // [2026-09-03再改訂・統括の実機レビュー] 旧実装（下端1点で接合し左右対称に
    // 描いた双葉）は「ちょうちょみたいになっている」と指摘された。原因は
    // 「軸が無い」「左右対称で閉じ気味」の2点。軸を足し、開き角を±30°にして
    // 双葉として読めるようにした。葉はアプリアイコンの葉パス（候補B.html）を
    // transformで配置する（座標を手計算して書き写すと転記ミスの元になるため。
    // デザイントークン.md「芽・若木の形の再設計」節参照）。
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <SvgLine
          x1={50}
          y1={98}
          x2={50}
          y2={68}
          stroke={theme.treeColors.trunk}
          strokeWidth={5.5}
          strokeLinecap="round"
        />
        <SvgPath
          d="M0 0 C-44 2 -76 -30 -74 -84 C-22 -86 8 -48 0 0 Z"
          transform="translate(50 72) rotate(-30) scale(0.52 0.52)"
          fill={color}
          stroke={DOT_STROKE_COLOR}
          strokeWidth={DOT_STROKE_WIDTH}
        />
        <SvgPath
          d="M0 0 C-44 2 -76 -30 -74 -84 C-22 -86 8 -48 0 0 Z"
          transform="translate(50 72) rotate(30) scale(-0.52 0.52)"
          fill={color}
          stroke={DOT_STROKE_COLOR}
          strokeWidth={DOT_STROKE_WIDTH}
        />
      </Svg>
    );
  }
  if (stage === 2) {
    // 若木: 小さな木（幹＋雲形の樹冠）。
    // [2026-09-03再改訂・統括の実機レビュー] 旧実装（葉1枚）は「背景が双葉なのに
    // 芽が1枚・若木が2枚は変」と指摘された。色丸は「その段階の木の姿」を表す
    // という考え方に統一し、若木は背景の若木（幹＋雲形の樹冠）の縮小版にした。
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <SvgLine
          x1={50}
          y1={96}
          x2={50}
          y2={58}
          stroke={theme.treeColors.trunk}
          strokeWidth={9}
          strokeLinecap="round"
        />
        <SvgCircle cx={36} cy={50} r={20} fill={color} stroke={DOT_STROKE_COLOR} strokeWidth={DOT_STROKE_WIDTH} />
        <SvgCircle cx={64} cy={50} r={20} fill={color} stroke={DOT_STROKE_COLOR} strokeWidth={DOT_STROKE_WIDTH} />
        <SvgCircle cx={50} cy={36} r={24} fill={color} stroke={DOT_STROKE_COLOR} strokeWidth={DOT_STROKE_WIDTH} />
      </Svg>
    );
  }
  if (stage === 3) {
    // 花: 花びら5枚＋花芯（固定色）。既存のまま変更なし。
    return (
      <Svg width={size} height={size} viewBox="0 0 100 100">
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
      </Svg>
    );
  }
  // 実（stage4以上）: りんご。本体（avatar_color）→軸（trunkと同じ固定色）→
  // 葉（新規固定色fruitLeaf）の順に描く。旧「丸＋まっすぐの太いヘタ」形は置き換えた。
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <SvgPath
        d="M50 30 C70 20 92 32 92 56 C92 80 72 94 50 88 C28 94 8 80 8 56 C8 32 30 20 50 30 Z"
        fill={color}
        stroke={DOT_STROKE_COLOR}
        strokeWidth={DOT_STROKE_WIDTH}
      />
      <SvgPath
        d="M48 30 C49 20 52 13 57 9 C60 13 55 22 52 30 Z"
        fill={theme.treeColors.trunk}
        stroke={DOT_STROKE_COLOR}
        strokeWidth={DOT_STROKE_WIDTH}
      />
      <SvgPath
        d="M56 17 C72 3 94 10 90 22 C74 30 60 26 56 17 Z"
        fill={theme.treeColors.fruitLeaf}
        stroke={DOT_STROKE_COLOR}
        strokeWidth={DOT_STROKE_WIDTH}
      />
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
  const innerSize = prizeInnerSize(size);
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

/**
 * [2026-09-07新設・要件定義書07-19-9a章、2026-09-08改訂・スキーマ設計.sql 49章]
 * 木を飾るステッカー（購入品）の中身の表現。デザイントークン.md 1.11節。景品
 * （PrizeDotView）と全く同じ「識別リング（配置した本人のavatar_color、2pt実線）
 * ＋円形クリップした内側の絵柄」という構造を流用する（主要画面
 * ワイヤーフレーム.md 32.0節決定4。新しいリング仕様を増やさない。直径は
 * 2026-09-10改訂で24pt→30ptに拡大、実装メモ149章）。内側の絵柄は
 * `StickerIcon`（決定2）。[2026-09-10改訂・149章] `StickerIcon`はSVG自前描画から
 * 統括提供の画像表示へ切り替わり、gradient idの一意性のために渡していた`uid`は
 * 不要になったため呼び出しから外した（本部長申し送り事項6は画像化により解消）。
 *
 * [49章での変更点] 旧`StickerDotView`は`dot: FamilyTreeCompletionDot`（色丸）を
 * 受け取っていたが、自由配置後のステッカーは色丸を参照しないため、代わりに
 * `FamilyTreeStickerPlacement`（family_tree_decorations単独のクエリ結果）を
 * 受け取る`FreeStickerView`に置き換えた。`x`・`y`は呼び出し元
 * （`renderStickerPlacements`）が`pos_x`/`pos_y`（0〜1000）から
 * キャンバスの実ピクセル座標へ変換した値を渡す。
 */
function FreeStickerView({
  placement,
  x,
  y,
  size,
}: {
  placement: FamilyTreeStickerPlacement;
  x: number;
  y: number;
  size: number;
}) {
  const ringColor = placement.avatarColor ?? theme.colors.neutralBorder;
  const innerSize = prizeInnerSize(size);
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
      <StickerIcon shape={placement.shape} rarity={placement.rarity} size={innerSize} />
    </View>
  );
}

/**
 * [2026-09-17新設・要件定義書07-28章決定21、設計部/成果物/スキーマ設計.sql
 * 55.9章決定55-18] 習慣カード（台紙）の段階報酬フィギュアの木への自由配置表示。
 * `FreeStickerView`と全く同じ「自由配置レイヤー」に乗るが、メダルと混同されない
 * よう五角形の枠（`FigureFrame`）を使う（主要画面ワイヤーフレーム.md 49.2章決定3。
 * 既存のメダル関連コンポーネント〈StickerIcon・FreeStickerView〉は一切変更せず、
 * 新しい独立したコンポーネントとして実装する、49.14章開発部への申し送り(3)）。
 */
function FreeHabitFigureView({
  placement,
  x,
  y,
  size,
}: {
  placement: FamilyTreeHabitFigurePlacement;
  x: number;
  y: number;
  size: number;
}) {
  return (
    <View style={{ position: "absolute", left: x - size / 2, top: y - size / 2, width: size, height: size }}>
      <FigureFrame size={size} ringColor={placement.avatarColor}>
        <FigureIcon figureKey={placement.figureKey} kindEmoji={placement.kindEmoji} size={size * 0.5} />
      </FigureFrame>
    </View>
  );
}

/**
 * [2026-09-17新設・主要画面ワイヤーフレーム.md 46.2節] 双葉（stage1）の葉は
 * CSSの`rotate`で左右に開いているため（`SPROUT_LEAF_ANGLE_DEG`）、葉の中の
 * 色丸のタップ判定用の座標も、葉の中心を軸に同じ角度だけ回転させる必要がある
 * （レイアウト計算だけでは回転前の位置のままになってしまうため）。
 */
function rotatePointAroundCenter(
  x: number,
  y: number,
  cx: number,
  cy: number,
  degrees: number
): { x: number; y: number } {
  const rad = (degrees * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/**
 * [2026-09-17新設・主要画面ワイヤーフレーム.md 46.1〜46.9節] タップ拡大表示の対象
 * （景品またはステッカー1件）＋キャンバス絶対座標＋キャッチ半径。
 * `targetId`は`src/lib/treeTapTargets.ts`の`pickNearestTreeTapTarget`に渡す
 * 一意キー（`prize:<completion_id>` / `sticker:<decoration_id>`）。
 */
type TapExpandCandidate =
  | { kind: "prize"; targetId: string; dot: FamilyTreeCompletionDot; x: number; y: number; catchRadius: number }
  | { kind: "sticker"; targetId: string; placement: FamilyTreeStickerPlacement; x: number; y: number; catchRadius: number };

type TreeTone = "parent" | "child" | "supporter";

/** [2026-09-17新設・225章と同じ考え方] 拡大表示モーダルの「閉じる」ボタンの一辺の長さ。 */
const treeCloseTapSizeFor = (tone: TreeTone) =>
  tone === "child" ? theme.tapTarget.child : tone === "supporter" ? theme.tapTarget.supporterPrimary : theme.tapTarget.parent;

/**
 * [2026-09-17新設・225.7章と同じ式] 拡大表示カードの上端の余白（閉じるボタンの下端＋余白）。
 * [2026-09-18改訂・統括の実機スクリーンショット指摘「×の位置はだいぶ上にあるので、
 * 絵の位置をもう少し下げてもよいかも」・実装メモ246章] `CollectorShelfPanel.tsx`の
 * `expandedCardPaddingTopFor`と全く同じ改訂（`src/components/CollectorShelfPanel.tsx`
 * のコメント参照）。ボタン下端から絵までの余白を`theme.spacing.s2`（8pt）から
 * `theme.spacing.s4`（16pt）に広げた（式は消さず2個目の項だけ変更）。
 */
const treeExpandedCardPaddingTopFor = (tone: TreeTone) => treeCloseTapSizeFor(tone) + theme.spacing.s2 + theme.spacing.s4;

/** [2026-09-17新設・225章と同じ式] 拡大表示で絵を表示する一辺の長さを画面サイズから計算する。 */
function computeTreeExpandedImageSize(windowWidth: number, windowHeight: number): number {
  const overlayPadding = theme.spacing.s4;
  const cardHorizontalPadding = theme.spacing.s4;
  const maxByWidth = windowWidth - overlayPadding * 2 - cardHorizontalPadding * 2;
  const maxByHeight = windowHeight * 0.5;
  const available = Math.min(maxByWidth, maxByHeight);
  return Math.max(160, Math.min(320, available));
}

function treeFormatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

/**
 * [2026-09-17新設・CollectorShelfPanel.tsxのstickerShapeLabel/stickerRarityLabelと
 * 同じ内容を複製] `CollectorShelfPanel.tsx`は本ファイル（FamilyTree.tsx）の
 * `TreeStageVisual`をimportしているため、逆方向のimport（本ファイルから
 * `CollectorShelfPanel.tsx`）は循環importになり避ける必要がある
 * （225章の`ShelfItemsGrid`拡大モーダルをこちらへ複製したのと同じ理由）。
 */
const treeStickerShapeLabel: Record<StickerShape, { child: string; parent: string }> = {
  beetle: { child: "カブトムシ", parent: "カブトムシ" },
  butterfly: { child: "ちょうちょ", parent: "ちょうちょ" },
  flower: { child: "おはな", parent: "おはな" },
  dragon: { child: "ドラゴン", parent: "ドラゴン" },
};

const treeStickerRarityLabel: Record<StickerRarity, { child: string; parent: string }> = {
  bronze: { child: "どう", parent: "銅" },
  silver: { child: "ぎん", parent: "銀" },
  gold: { child: "きん", parent: "金" },
  crystal: { child: "クリスタル", parent: "クリスタル" },
};

function treeStickerEntryLabel(tone: TreeTone, shape: StickerShape, rarity: StickerRarity): string {
  const isChild = tone === "child";
  return `${isChild ? treeStickerShapeLabel[shape].child : treeStickerShapeLabel[shape].parent} ${
    isChild ? treeStickerRarityLabel[rarity].child : treeStickerRarityLabel[rarity].parent
  }`;
}

/**
 * [2026-09-17新設・主要画面ワイヤーフレーム.md 46.3節 決定6] 「誰が・いつ」の1行。
 * 46.3節の文言例（子ども向け「そらが 8/20に かざったよ／きに かざったよ」、
 * 保護者・みまもり向け「パパが8/20に木に飾りました」）をそのまま踏襲する。
 */
function treeDecoratedAtLine(tone: TreeTone, memberName: string, dateStr: string, isDrawing: boolean): string {
  if (tone === "child") {
    return isDrawing ? `${memberName}が ${dateStr}に きに かざったよ` : `${memberName}が ${dateStr}に かざったよ`;
  }
  return `${memberName}が${dateStr}に木に飾りました`;
}

/**
 * [2026-09-17新設・主要画面ワイヤーフレーム.md 46.3節 決定5〜7] 木の飾り
 * （景品・ステッカー）のタップ拡大表示。`CollectorShelfPanel.tsx`の
 * `ShelfItemsGrid`拡大モーダル（Modal・overlay・expandedCard・ScrollView・
 * closeButton、実装メモ225章・225.7章）と同じ部品構成・同じ見た目を複製した
 * （決定5「新しいモーダルの型は作らない」。225.7章の差し戻し理由〈`paddingTop`の
 * 式・`ScrollView`での内側スクロール〉をそのまま踏襲している）。
 */
function TreeDecorationExpandModal({
  target,
  tone,
  memberName,
  onClose,
}: {
  target: TapExpandCandidate;
  tone: TreeTone;
  memberName: string;
  onClose: () => void;
}) {
  const isChild = tone === "child";
  const { width, height } = useWindowDimensions();
  const expandedImageSize = computeTreeExpandedImageSize(width, height);
  const closeSize = treeCloseTapSizeFor(tone);
  const expandedCardPaddingTop = treeExpandedCardPaddingTopFor(tone);
  const modalMaxHeight = height - theme.spacing.s4 * 2;
  const closeLabel = isChild ? "とじる" : "閉じる";
  const bodyMediumStyle = isChild
    ? theme.typography.childBody
    : tone === "supporter"
    ? theme.typography.supporterBodyMedium
    : theme.typography.parentBodyMedium;
  const captionStyle = isChild
    ? theme.typography.childBody
    : tone === "supporter"
    ? theme.typography.supporterCaption
    : theme.typography.parentCaption;

  const decoratedAt = target.kind === "prize" ? target.dot.prize?.decoratedAt : target.placement.decoratedAt;
  const dateStr = decoratedAt ? treeFormatShortDate(decoratedAt) : "";

  const prizeDrawing = target.kind === "prize" ? target.dot.prize?.drawing ?? null : null;
  const isPresetOrnament = target.kind === "prize" && target.dot.prize?.prizeKind === "preset_ornament";

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.expandOverlay}>
        {/* [2026-09-17・やること.md 4-42・実装メモ238章] 統括の実機報告「カードの外の暗い部分を
                押しても閉じない（アバターの拡大は閉じる）」への対処。従来は overlay の Pressable の
                中に ScrollView を抱えた Pressable を入れ子にしていたが、ScrollView を含む入れ子では
                外側の Pressable が押下を受け取れない端末があった。**背景の受け皿を absoluteFill の
                Pressable として下に敷き、カードを兄弟として上に置く**（入れ子に依存しない）。
                あわせて統括の要望「絵と×以外はどこを押しても閉じる」を入れる：本文ブロックを
                閉じる Pressable にし、絵（絵文字・お絵かき・ステッカー）だけ無反応の Pressable で包む。 */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
        />
        <View style={{ maxHeight: modalMaxHeight }}>
          <ScrollView
            style={{ maxHeight: modalMaxHeight }}
            contentContainerStyle={[styles.expandCard, { paddingTop: expandedCardPaddingTop }]}
            showsVerticalScrollIndicator={false}
          >
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={[styles.expandCloseButton, { width: closeSize, height: closeSize, borderRadius: closeSize / 2 }]}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
            >
              <Text style={styles.expandCloseButtonText}>×</Text>
            </Pressable>

            {target.kind === "prize" && isPresetOrnament && (
              <Pressable style={styles.expandContentWrap} onPress={onClose}>
                <Pressable onPress={() => {}}>
                  <Text style={[styles.expandEmoji, { fontSize: Math.round(expandedImageSize * 0.5) }]}>
                    {target.dot.prize?.presetOrnament?.emoji ?? "🎁"}
                  </Text>
                </Pressable>
                <View style={styles.expandTextWrap}>
                  <Text style={[bodyMediumStyle, styles.expandCenterText]}>
                    「{target.dot.prize?.presetOrnament?.display_name ?? "かざり"}」
                  </Text>
                  <Text style={[captionStyle, styles.expandCenterText, { marginTop: theme.spacing.s1 }]}>
                    {treeDecoratedAtLine(tone, memberName, dateStr, false)}
                  </Text>
                </View>
              </Pressable>
            )}

            {target.kind === "prize" && !isPresetOrnament && prizeDrawing && (
              <Pressable style={styles.expandContentWrap} onPress={onClose}>
                <Pressable onPress={() => {}}>
                  <DrawingThumbnail lineData={prizeDrawing.line_data} size={expandedImageSize} />
                </Pressable>
                <View style={styles.expandTextWrap}>
                  <Text style={[bodyMediumStyle, styles.expandCenterText]}>「{prizeDrawing.artistName}」の絵</Text>
                  {prizeDrawing.title && (
                    <Text style={[captionStyle, styles.expandCenterText, { marginTop: theme.spacing.s1 }]}>
                      {isChild ? "だいめい：" : "題名："}
                      {prizeDrawing.title}
                    </Text>
                  )}
                  <Text style={[captionStyle, styles.expandCenterText, { marginTop: theme.spacing.s1 }]}>
                    {treeDecoratedAtLine(tone, memberName, dateStr, true)}
                  </Text>
                </View>
              </Pressable>
            )}

            {target.kind === "sticker" && (
              <Pressable style={styles.expandContentWrap} onPress={onClose}>
                <Pressable onPress={() => {}}>
                  <StickerIcon shape={target.placement.shape} rarity={target.placement.rarity} size={expandedImageSize} highRes />
                </Pressable>
                <View style={styles.expandTextWrap}>
                  <Text style={[bodyMediumStyle, styles.expandCenterText]}>
                    {treeStickerEntryLabel(tone, target.placement.shape, target.placement.rarity)}
                  </Text>
                  <Text style={[captionStyle, styles.expandCenterText, { marginTop: theme.spacing.s1 }]}>
                    {treeDecoratedAtLine(tone, memberName, dateStr, false)}
                  </Text>
                </View>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function TreeStageVisual({
  stage,
  dots,
  highlightMemberId = null,
  highlightCompletionId = null,
  previewDecorationSize = null,
  stickerPlacements = null,
  hiddenStickerDecorationId = null,
  habitFigurePlacements = null,
  hiddenHabitFigureDecorationId = null,
  enableTapExpand = false,
  tone = "parent",
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
  /**
   * [2026-09-07新設・140章・本部長裁定] ガチャの「かざりつけモード」で選択中の
   * 色丸を、確定後の姿（景品36pt）でプレビュー表示するための直径。
   * `highlightCompletionId`と組み合わせて使う。指定すると、`highlightCompletionId`に
   * 一致する色丸だけ、
   *   1. `pickTreeRegion(id, true)`（＝景品時の重み配分）で部位を計算し、
   *   2. 表示直径もこの値を使う
   * ことで、「かざる」確定前から確定後と全く同じ場所・大きさが見える。
   * 呼び出し元は`PRIZE_DOT_SIZE`（このファイルからexport済み）を渡す。
   * nullなら（通常の家族の木画面・過去の木など）従来どおり一切プレビューしない。
   *
   * [2026-09-08改訂・49章] ステッカーは自由配置化により色丸を参照しなくなった
   * ため、本プロパティは以後ガチャの景品専用になった（`decorationKind`のような
   * 種類切替は不要）。ステッカーの配置・移動プレビューは`stickerPlacements`
   * ではなく専用の`TreeStickerDragCanvas`（ドラッグ中の座標をそのまま描画する
   * だけで足り、`pickTreeRegion`のような領域計算・重なり回避は不要。49.11章）で行う。
   *
   * 元は`pickTreeRegion`から`isPrize`分岐を削除する形で「ハイライトした場所に
   * 景品が出ない」問題に対応していたが、それは2026-08-27の本番不具合（景品が
   * 空に落ちて隠れる）を再発させる誤った直し方だった（139章・140章、`pickTreeRegion`
   * 直上のコメント参照）。正しい直し方は`pickTreeRegion`自体を変えず、
   * プレビュー側だけを「確定後の姿」に寄せることだった。
   */
  previewDecorationSize?: number | null;
  /**
   * [2026-09-08新設・スキーマ設計.sql 49.6章・決定49-8] 木の上の自由配置ステッカー
   * （`fetchFamilyTreeStickerPlacements`の結果）。指定すると、木の全レイヤーより
   * 前面（最前面固定）に描画する。`pickTreeRegion`・40スロットの優先確保からは
   * 完全に独立しており、`pos_x`/`pos_y`（0〜1000）をそのままキャンバスの実
   * ピクセル座標に変換して描くだけの単純な層である（重なり回避も行わない、
   * 決定49-11「重なりを許容する」）。通常の家族の木画面・過去の木のいずれでも
   * このプロパティを渡すことで表示できる。nullまたは省略時は何も描画しない
   * （既存呼び出し元との後方互換のため既定値null）。
   */
  stickerPlacements?: FamilyTreeStickerPlacement[] | null;
  /**
   * [2026-09-08新設] `stickerPlacements`のうち、この`decorationId`と一致する1件を
   * 描画から除外する。`TreeStickerDragCanvas`が「移動中の1件だけドラッグ中の
   * プレビューとして別途描画し、静的な最前面レイヤー側には重複して出さない」
   * ために使う。
   */
  hiddenStickerDecorationId?: string | null;
  /**
   * [2026-09-17新設・要件定義書07-28章決定21、スキーマ設計.sql 55.9章決定55-18]
   * 木の上の自由配置フィギュア（`fetchFamilyTreeHabitFigurePlacements`の結果）。
   * `stickerPlacements`と全く同じ「最前面固定・重なり回避なし」の独立レイヤーとして
   * 描画する。nullまたは省略時（既存呼び出し元）は何も描画しない
   * （後方互換のため既定値null、既存のメダル描画には一切影響しない）。
   */
  habitFigurePlacements?: FamilyTreeHabitFigurePlacement[] | null;
  /** `habitFigurePlacements`のうち、この`decorationId`と一致する1件を描画から除外する（`TreeHabitFigureDragCanvas`の移動中プレビュー用、`hiddenStickerDecorationId`と同じ役割）。 */
  hiddenHabitFigureDecorationId?: string | null;
  /**
   * [2026-09-17新設・主要画面ワイヤーフレーム.md 46.5節 決定9] 景品・ステッカーの
   * タップ拡大表示（46.1〜46.9節）を有効にするかどうか。**既定はfalse（無効）**で、
   * 既存の呼び出し元（`TreeDecoratePanel.tsx`・`TreeStickerDragCanvas.tsx`・
   * `CollectorShelfPanel.tsx`の過去の木）は本プロパティを渡さない限り1行も
   * 変更せずに現状のまま動く（オプトイン方式、決定9・決定10）。
   */
  enableTapExpand?: boolean;
  /**
   * [2026-09-17新設] `enableTapExpand`が真のときのみ使う、拡大表示モーダルの
   * 文体・タップ領域の書き分け（46.4節決定8）。既定は"parent"だが、
   * `enableTapExpand`を渡さない既存呼び出し元では一切参照されない。
   */
  tone?: "parent" | "child" | "supporter";
}) {
  /**
   * [2026-09-14追加・224章・案A] `highlightCompletionId`（一覧UIで選択中の完了報告ID、
   * `TreeDecoratePanel`→本コンポーネントの経路で渡ってくる）を`pickDisplaySlots`の
   * `forceIncludeId`にそのまま渡す。選択中の対象を40枠から漏れないよう優先確保する
   * （`pickDisplaySlots`直上のコメント参照）。
   * 通常表示（家族の木画面・過去の木・コレクター棚等）は`highlightCompletionId`を
   * 渡さない＝`undefined`のままなので、`pickDisplaySlots`は`forceIncludeId`無しの
   * 経路を通り、従来と完全に同じ結果になる（既存呼び出し元は無変更で動く）。
   */
  const slots = useMemo(
    () => pickDisplaySlots(dots, highlightCompletionId),
    [dots, highlightCompletionId]
  );
  const shape = STAGE_GEOMETRY[stage] ?? STAGE_GEOMETRY[0];
  // 幅は固定値ではなく実測する。固定値だと画面幅とずれ、はみ出した分が
  // React Nativeの既定の切り取りで消える（空の色丸が出ない不具合の原因になった）。
  const [canvasWidth, setCanvasWidth] = useState(FALLBACK_WIDTH);

  /**
   * この色丸を「確定後の姿」でプレビューすべきか（140章）。
   * `previewDecorationSize`が指定されていて、かつ選択中の完了報告と一致する場合のみ。
   */
  const isPreviewTarget = (dot: FamilyTreeCompletionDot): boolean =>
    previewDecorationSize != null && highlightCompletionId != null && dot.id === highlightCompletionId;

  // 木の段階だけ、色丸を部位ごとに振り分ける（種・芽は従来どおり地面／双葉に置く）。
  const byRegion = useMemo(() => {
    const map: Record<TreeRegion, FamilyTreeCompletionDot[]> = {
      canopy: [], lobeLeft: [], lobeRight: [], trunk: [], soil: [], sky: [],
    };
    if (shape.kind === "tree") {
      for (const dot of slots) {
        const isPrize = isPrioritizedDot(dot) || isPreviewTarget(dot);
        map[pickTreeRegion(dot.id, isPrize)].push(dot);
      }
    } else if (shape.kind === "sprout") {
      // 芽は樹冠・幹が無いので双葉と空だけに振り分ける。芽の段階は完了報告が
      // 10〜29件あり、2枚の葉だけでは密集しがちなため、空に逃がす意味もある。
      for (const dot of slots) {
        const isPrize = isPrioritizedDot(dot) || isPreviewTarget(dot);
        const r = pickTreeRegion(dot.id, isPrize);
        if (r === "sky") map.sky.push(dot);
        else if (r === "soil" || r === "trunk") map.soil.push(dot); // 芽には幹が無いので地面へ寄せる
        else if (stableHash(dot.id) % 2 === 0) map.lobeLeft.push(dot);
        else map.lobeRight.push(dot);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, shape.kind, highlightCompletionId, previewDecorationSize]);

  const bounds = (cx: number, cy: number, rx: number, ry: number): PlacementBounds => ({
    cx, cy, rx: Math.max(rx, 0), ry: Math.max(ry, 0),
  });

  /**
   * ドットの表示直径。通常は`dotDisplaySize`のまま。ただし`isPreviewTarget`に
   * 一致する色丸（かざりつけモードで選択中のもの）だけ`previewDecorationSize`を
   * 使う（140章。確定後の大きさを先取りしてプレビューする）。
   */
  const effectiveDotSize = (dot: FamilyTreeCompletionDot): number =>
    isPreviewTarget(dot) && previewDecorationSize != null ? previewDecorationSize : dotDisplaySize(dot);

  /**
   * 重なりを避けて配置済みの色丸を描く。
   * [2026-08-26改訂・第4段階] 景品（`dot.prize`非null）は`PrizeDotView`で描き、
   * 通常の色丸は従来どおり単色の円で描く。`highlightMemberId`と一致する報告者の
   * 丸には、決定8の「淡い強調」（`mineHalo`）を丸の背面に加算的に添える
   * （他人の丸のスタイルは一切変更しない）。
   * [2026-09-07改訂・140章] 大きさは`dotDisplaySize`ではなく`effectiveDotSize`を使う
   * （プレビュー中の色丸だけ大きく描くため）。
   */
  const renderPlaced = (items: { dot: FamilyTreeCompletionDot; x: number; y: number }[]) =>
    items.map(({ dot, x, y }) => {
      const size = effectiveDotSize(dot);
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
  ) => renderPlaced(placeGroup(items, effectiveDotSize));

  // [2026-09-17追加・主要画面ワイヤーフレーム.md 46.5節 決定9] enableTapExpandが
  // falseの既存呼び出し元では、以下の状態・計算は一切使われない
  // （tapTargetsは空配列のまま、expandedTargetは常にnull、handleCanvasPressは
  // 呼ばれない）ため、既存呼び出し元の見た目・挙動には影響しない。
  const [expandedTarget, setExpandedTarget] = useState<TapExpandCandidate | null>(null);
  const { state: appState } = useAppData();

  /**
   * [2026-09-17追加・主要画面ワイヤーフレーム.md 46.2節・46.9節、開発部/成果物/
   * 実装メモ.md 233章] 景品・ステッカーのタップ拡大表示のための、キャンバス全体を
   * 基準にした絶対座標の一覧。
   *
   * [なぜ描画用のx/yをそのまま使えないか] 景品は樹冠の箱・幹・双葉・地面にまいた
   * 種など、木の部位ごとに用意された「その部位を原点とするローカルな入れ物
   * （View）」の中に配置される（下のJSX参照）。この入れ物自体がキャンバス内の
   * どこに置かれるかはRNのflexレイアウト（`styles.canvas`の
   * `justifyContent:"flex-end"`・`alignItems:"center"`）が決めるため、部位ごとの
   * 入れ物の絶対位置（キャンバスの左上を原点とするオフセット）を、下のJSXが
   * 実際に使っているのと同じ定数・同じ式で再現し、ローカル座標へ加算する。
   * 双葉（stage1の葉）はCSSの`rotate`で開いているため、葉の中心を軸に同じ角度
   * だけ回転させてから加算する（`rotatePointAroundCenter`）。
   *
   * [JSXを直接は変更しない理由] 木の見た目は統括の実機フィードバックを何度も
   * 経て調整されたものであり（本ファイル冒頭のコメント群参照）、当たり判定の
   * ためにJSXの構造を組み替えると見た目を壊すリスクが大きい。本ブロックは
   * 既存のJSX（下のreturn内）を一切変更せず、`byRegion`・`placeGroup`という
   * 既存の計算結果を再利用して並行に計算するだけの独立したロジックにしてある
   * （46.2節「開発部への実装メモ」の『既存の計算結果をタップ判定にも使い回す』を、
   * JSXへの侵襲を避けつつ実現する方法）。木のレイアウト定数（SOIL_HEIGHT・幹の
   * marginTop:-2 等）や座標式を変更した場合は、本ブロックも必ず追随させること。
   */
  const tapTargets = useMemo((): TapExpandCandidate[] => {
    if (!enableTapExpand) return [];
    const targets: TapExpandCandidate[] = [];
    const catchDiameter =
      tone === "child" ? theme.tapTarget.child : tone === "supporter" ? theme.tapTarget.supporterPrimary : theme.tapTarget.parent;
    const catchRadius = catchDiameter / 2;
    // [重要] styles.canvasは`paddingBottom: theme.spacing.s4`を持つ（下記styles参照）。
    // 土（soil）を含む流し込みレイアウトの子要素は、この内側の余白の分だけ
    // キャンバスの外枠より上に詰められる（`justifyContent:"flex-end"`はpadding
    // box基準）。sky/stickerOverlayのような`position:"absolute"`の層は
    // padding boxの外枠（＝キャンバス自身の外枠）を基準にするため影響を受けない
    // （sky/stickerOverlayのoffsetを0のままにしているのはこのため）。
    const soilTop = CANVAS_HEIGHT - theme.spacing.s4 - SOIL_HEIGHT;

    const pushPrizeDots = (
      items: { dot: FamilyTreeCompletionDot; bounds: PlacementBounds }[],
      offsetX: number,
      offsetY: number,
      rotate?: { deg: number; cx: number; cy: number }
    ) => {
      if (items.length === 0) return;
      const placed = placeGroup(items, effectiveDotSize);
      for (const { dot, x, y } of placed) {
        if (!dot.prize) continue; // 決定1: 色丸（絵の無いもの）はタップ対象外
        const point = rotate ? rotatePointAroundCenter(x, y, rotate.cx, rotate.cy, rotate.deg) : { x, y };
        targets.push({
          kind: "prize",
          targetId: `prize:${dot.id}`,
          dot,
          x: offsetX + point.x,
          y: offsetY + point.y,
          catchRadius,
        });
      }
    };

    // 空（sky）。skyLayerはtop:0/left:0でキャンバスと同寸のためオフセット無し。
    pushPrizeDots(
      byRegion.sky.map((dot) => ({
        dot,
        bounds: bounds(canvasWidth / 2, CANVAS_HEIGHT * 0.36, canvasWidth / 2 - DOT_SIZE, CANVAS_HEIGHT * 0.32),
      })),
      0,
      0
    );

    // 土（soil）。左端0・幅いっぱいのため縦方向のオフセットのみ加える。
    pushPrizeDots(
      byRegion.soil.map((dot) => ({
        dot,
        bounds: bounds(canvasWidth / 2, SOIL_HEIGHT / 2 + 6, canvasWidth / 2 - DOT_SIZE, SOIL_HEIGHT / 2 - DOT_SIZE),
      })),
      0,
      soilTop
    );

    if (shape.kind === "tree") {
      const { leafRadius, trunkWidth, trunkHeight } = shape;
      const boxWidth = leafRadius * 2.7;
      const boxHeight = leafRadius * 2.05;
      const sideSize = leafRadius * 1.3;
      const dotRadius = Math.max(leafRadius - DOT_SIZE, 0);
      // 幹の下端はsoilの上端に接し（幹のmarginTop:-2は樹冠との間だけに影響）、
      // 樹冠の下端は幹の上端より2pt下（幹のmarginTop:-2、下のJSX参照）。
      const trunkTop = soilTop - trunkHeight;
      const canopyBottom = trunkTop + 2;
      const canopyTop = canopyBottom - boxHeight;
      const canopyLeft = (canvasWidth - boxWidth) / 2;
      const trunkLeft = (canvasWidth - trunkWidth) / 2;

      pushPrizeDots(
        [
          ...byRegion.canopy.map((dot) => ({ dot, bounds: bounds(boxWidth / 2, leafRadius, dotRadius, dotRadius) })),
          ...byRegion.lobeLeft.map((dot) => ({
            dot,
            bounds: bounds(sideSize / 2, boxHeight - sideSize / 2, sideSize / 2 - DOT_SIZE, sideSize / 2 - DOT_SIZE),
          })),
          ...byRegion.lobeRight.map((dot) => ({
            dot,
            bounds: bounds(boxWidth - sideSize / 2, boxHeight - sideSize / 2, sideSize / 2 - DOT_SIZE, sideSize / 2 - DOT_SIZE),
          })),
        ],
        canopyLeft,
        canopyTop
      );

      pushPrizeDots(
        byRegion.trunk.map((dot) => ({
          dot,
          bounds: bounds(trunkWidth / 2, trunkHeight / 2, trunkWidth / 2 - DOT_SIZE / 2, trunkHeight / 2 - DOT_SIZE),
        })),
        trunkLeft,
        trunkTop
      );
    } else if (shape.kind === "sprout") {
      const { stemHeight, leafWidth, leafHeight } = shape;
      const rx = leafWidth / 2 - DOT_SIZE / 2 - 2;
      const ry = leafHeight / 2 - DOT_SIZE / 2 - 2;
      const wrapperHeight = leafHeight + stemHeight;
      const wrapperTop = soilTop - wrapperHeight;
      const wrapperLeft = (canvasWidth - leafWidth * 2) / 2;
      const leafCenter = { cx: leafWidth / 2, cy: leafHeight / 2 };

      // 左の葉（left:0、SPROUT_LEAF_ANGLE_DEGだけ時計回りに回転、下のJSX参照）。
      pushPrizeDots(
        byRegion.lobeLeft.map((dot) => ({ dot, bounds: bounds(leafWidth / 2, leafHeight / 2, rx, ry) })),
        wrapperLeft,
        wrapperTop,
        { deg: SPROUT_LEAF_ANGLE_DEG, ...leafCenter }
      );
      // 右の葉（right:0＝wrapperLeft+leafWidthから開始、-SPROUT_LEAF_ANGLE_DEGだけ回転）。
      pushPrizeDots(
        byRegion.lobeRight.map((dot) => ({ dot, bounds: bounds(leafWidth / 2, leafHeight / 2, rx, ry) })),
        wrapperLeft + leafWidth,
        wrapperTop,
        { deg: -SPROUT_LEAF_ANGLE_DEG, ...leafCenter }
      );
    } else {
      // seed: byRegionは使わずslotsそのものが1つのgroundScatterへまとまる（下のJSX参照）。
      const groundScatterHeight = SEED_SCATTER_RADIUS * 0.42 * 2;
      const groundScatterWidth = SEED_SCATTER_RADIUS * 2;
      // groundScatterのmarginBottom(-R*0.42)によりsoilTopとR*0.42分重なる。
      const groundScatterBottom = soilTop + SEED_SCATTER_RADIUS * 0.42;
      const groundScatterTop = groundScatterBottom - groundScatterHeight;
      const groundScatterLeft = (canvasWidth - groundScatterWidth) / 2;
      pushPrizeDots(
        slots.map((dot) => ({
          dot,
          bounds: bounds(
            SEED_SCATTER_RADIUS,
            SEED_SCATTER_RADIUS * 0.42,
            SEED_SCATTER_RADIUS - DOT_SIZE / 2,
            SEED_SCATTER_RADIUS * 0.42 - DOT_SIZE / 2
          ),
        })),
        groundScatterLeft,
        groundScatterTop
      );
    }

    // ステッカーは元々キャンバス絶対座標（stickerOverlayがtop:0/left:0で
    // キャンバスと同寸）で描かれているため、変換不要でそのまま使う。
    if (stickerPlacements) {
      for (const p of stickerPlacements) {
        if (p.decorationId === hiddenStickerDecorationId) continue;
        targets.push({
          kind: "sticker",
          targetId: `sticker:${p.decorationId}`,
          placement: p,
          x: (p.posX / 1000) * canvasWidth,
          y: (p.posY / 1000) * CANVAS_HEIGHT,
          catchRadius,
        });
      }
    }

    return targets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableTapExpand, tone, byRegion, shape, canvasWidth, slots, stickerPlacements, hiddenStickerDecorationId]);

  const expandedMemberName = useMemo(() => {
    if (!expandedTarget) return "";
    const memberId = expandedTarget.kind === "prize" ? expandedTarget.dot.reported_by : expandedTarget.placement.memberId;
    return appState.members.find((m) => m.id === memberId)?.display_name ?? (tone === "child" ? "だれか" : "だれか");
  }, [expandedTarget, appState.members, tone]);

  /** [46.2節決定3・決定4] タップ位置に最も近い対象を選ぶ（無ければ何も起きない）。 */
  const handleCanvasPress = (e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const nearestId = pickNearestTreeTapTarget(
      locationX,
      locationY,
      tapTargets.map((t) => ({ id: t.targetId, x: t.x, y: t.y, catchRadius: t.catchRadius }))
    );
    if (nearestId == null) return;
    const found = tapTargets.find((t) => t.targetId === nearestId) ?? null;
    setExpandedTarget(found);
  };

  const canvasContent = (
    <>
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
              /**
               * [2026-09-18追加・やること.md 症状1「木の飾りをタップしても拡大しない」・
               * 実装メモ246章] `pointerEvents="none"`。理由は下のtrunk View・soil View
               * ・sprout葉View・groundScatter Viewと共通のため、そちらのコメント
               * （trunk View側）にまとめて書いた。
               */
              <View style={{ width: boxWidth, height: boxHeight }} pointerEvents="none">
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
          {/**
           * [2026-09-18追加・やること.md 症状1「木の飾りをタップしても拡大しない」・
           * 実装メモ246章] `pointerEvents="none"`。
           *
           * [原因] `handleCanvasPress`が受け取る`e.nativeEvent.locationX/locationY`は、
           * Reactの`onPress`ハンドラが付いたView（＝木全体を覆う外側の`Pressable`、
           * `styles.canvas`）ではなく、**実際にタップされた一番深いネイティブView**
           * 基準で返る（React Nativeのタッチ判定の仕組み、
           * `TouchTargetHelper.findTargetTagAndCoordinatesForTouch`が
           * `locationX/Y`の基準にする「target」を決める処理。`pointerEvents`が
           * `none`の祖先を持たない限り、子Viewが自分自身を対象にできてしまう）。
           * 景品（`PrizeDotView`）・ステッカー（`FreeStickerView`）は樹冠・幹・
           * 双葉・地面の「部位ごとの入れ物View」の内側に描かれるが、この入れ物に
           * `pointerEvents="none"`が付いていなかったため、景品を直接タップすると
           * その景品自身の小さなView（36pt角ほど）が対象になり、`locationX/Y`が
           * 「景品の中の位置（0〜36程度）」になっていた。これを`tapTargets`の
           * キャンバス絶対座標と比べても一致せず、`pickNearestTreeTapTarget`が
           * 常に空振り（null）を返していた＝**まったく反応しない**という報告と一致する。
           *
           * [なぜ空（sky）・自由配置ステッカー（stickerOverlay）は元から動いていたか]
           * この2層は元々`pointerEvents="none"`が付いていた（本ファイル内`skyLayer`・
           * `stickerOverlay`参照）。景品は`pickTreeRegion`の設計上、空には絶対に
           * 割り当てられない（139〜140章の理由）ため、景品は必ず樹冠・幹・双葉・
           * 地面のいずれかに乗り、そのどれもが本コメントの修正まで
           * `pointerEvents`未設定（既定値`auto`）のままだった＝**景品は原理的に
           * 一度も正しく反応したことが無かった**。
           *
           * [直し方] 木の見た目を描くJSX（色・形・レイアウト）は一切変更せず、
           * 各部位の入れ物Viewに`pointerEvents="none"`を追加するだけにした。
           * `pointerEvents="none"`は見た目（レンダリング）に一切影響しない
           * （タッチ判定のみに効く）ため、既存の見た目は完全に変わらない。
           * これにより、部位の入れ物とその中の色丸・景品はどれもタップの対象に
           * ならなくなり、タップは必ず一番外側の`Pressable`（`styles.canvas`）まで
           * 素通りする。`handleCanvasPress`が受け取る`locationX/Y`は常にキャンバス
           * 基準になり、`tapTargets`（同じくキャンバス基準で計算済み）との距離比較が
           * 正しく機能する。`enableTapExpand`が`false`の既存呼び出し元
           * （`TreeDecoratePanel.tsx`・`TreeStickerDragCanvas.tsx`・
           * `CollectorShelfPanel.tsx`の過去の木）は、この4箇所の入れ物の内側に
           * そもそも`onPress`を持つ要素が無いため、影響が無い
           * （`pointerEvents="none"`にしてもしなくても元から無反応だった）。
           */}
          <View
            style={{
              width: shape.trunkWidth,
              height: shape.trunkHeight,
              marginTop: -2,
              backgroundColor: theme.treeColors.trunk,
              borderBottomLeftRadius: 3,
              borderBottomRightRadius: 3,
            }}
            pointerEvents="none"
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
          // [2026-09-18追加・やること.md 症状1・実装メモ246章] pointerEvents="none"。
          // trunk View直上のコメント参照（部位の入れ物Viewをタップ対象から外す）。
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
            pointerEvents="none"
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
        // [2026-09-18追加・やること.md 症状1・実装メモ246章] pointerEvents="none"。
        // trunk View直上のコメント参照。
        <View style={styles.groundScatter} pointerEvents="none">
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
      {/* [2026-09-18追加・やること.md 症状1・実装メモ246章] pointerEvents="none"。
          trunk View直上のコメント参照。 */}
      <View style={styles.soil} pointerEvents="none">
        {renderGroup(
          byRegion.soil.map((dot) => ({
            dot,
            bounds: bounds(canvasWidth / 2, SOIL_HEIGHT / 2 + 6, canvasWidth / 2 - DOT_SIZE, SOIL_HEIGHT / 2 - DOT_SIZE),
          }))
        )}
      </View>

      {/* [2026-09-08追加・スキーマ設計.sql 49.6章・決定49-8] 自由配置ステッカー。
          最後の子要素として置くことで、木のどの部位よりも前面（最前面固定）に
          描画される。pickTreeRegion・reservoirSample・placeGroup（重なり回避）の
          いずれも通さず、pos_x/pos_y（0〜1000）をそのままキャンバスの実ピクセル
          座標に変換するだけの単純な層（決定49-11「重なりを許容する」）。 */}
      {stickerPlacements && stickerPlacements.length > 0 && (
        <View style={styles.stickerOverlay} pointerEvents="none">
          {stickerPlacements
            .filter((p) => p.decorationId !== hiddenStickerDecorationId)
            .map((p) => (
              <FreeStickerView
                key={p.decorationId}
                placement={p}
                x={(p.posX / 1000) * canvasWidth}
                y={(p.posY / 1000) * CANVAS_HEIGHT}
                size={STICKER_DOT_SIZE}
              />
            ))}
        </View>
      )}

      {/* [2026-09-17新設・要件定義書07-28章決定21] 自由配置フィギュア。ステッカーと
          同じ最前面固定レイヤー（メダルの表示コンポーネント自体は変更していない）。 */}
      {habitFigurePlacements && habitFigurePlacements.length > 0 && (
        <View style={styles.stickerOverlay} pointerEvents="none">
          {habitFigurePlacements
            .filter((p) => p.decorationId !== hiddenHabitFigureDecorationId)
            .map((p) => (
              <FreeHabitFigureView
                key={p.decorationId}
                placement={p}
                x={(p.posX / 1000) * canvasWidth}
                y={(p.posY / 1000) * CANVAS_HEIGHT}
                size={STICKER_DOT_SIZE}
              />
            ))}
        </View>
      )}
    </>
  );

  // [2026-09-17追加・主要画面ワイヤーフレーム.md 46.2節 開発部への実装メモ] 木の
  // キャンバス全体に1つのタップ検出を置く（景品・ステッカーごとに個別の
  // `Pressable`を重ねない）。`enableTapExpand`がfalseのとき（既存呼び出し元）は
  // 従来どおり`View`のみを描画し、`Pressable`化・当たり判定は一切行わない
  // （決定9「既存呼び出し元は1行も変えなくても動く」）。
  return (
    <>
      {enableTapExpand ? (
        <Pressable
          style={styles.canvas}
          onLayout={(e) => setCanvasWidth(e.nativeEvent.layout.width)}
          onPress={handleCanvasPress}
        >
          {canvasContent}
        </Pressable>
      ) : (
        <View style={styles.canvas} onLayout={(e) => setCanvasWidth(e.nativeEvent.layout.width)}>
          {canvasContent}
        </View>
      )}
      {enableTapExpand && expandedTarget && (
        <TreeDecorationExpandModal
          target={expandedTarget}
          tone={tone}
          memberName={expandedMemberName}
          onClose={() => setExpandedTarget(null)}
        />
      )}
    </>
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
  // [2026-09-11追加・要件定義書07-27章 決定9] アバターを自分で描いた絵にできる
  // ようにする機能。27箇所すべてのMemberAvatarで同じ見た目にするため、この
  // コンポーネントの内部だけで完結させる（呼び出し元への新しいprop追加はしない）。
  const { memberAvatars } = useAppData();
  return (
    <View style={{ gap: theme.spacing.s2 }}>
      {breakdown.map((row) => (
        <View key={row.member_id} style={styles.breakdownRow}>
          <MemberAvatar name={row.display_name} color={row.avatar_color} size={28} lineData={memberAvatars[row.member_id]} expandOnTap />
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

/**
 * 週ごとの記録（要件定義書07-9章新設節、20.1a節・21.0節決定11）。
 *
 * [ゼロ埋めの方針] Viewは0件の週を行として返さない設計判断（スキーマ設計.sql 41章
 * 冒頭コメント「ゼロ埋めしない」）だが、UIUXデザイン部は20.1a節「0件の週：特別な強調・
 * 非表示にせず、他の週と同じ書式でそのまま『◯回』と表示する」でゼロ埋め表示を選んだ
 * （API仕様.md 9.6章がクライアント側での補完手順を明記済み）。本関数は
 * シーズン開始週（`jst_week_start_date(season_start)`）から対象範囲の最終週まで
 * 「あるべき週の一覧」を自前で列挙し、Viewの結果に無い週を0件として補う。
 *
 * [並び順・上限] 新しい週が先頭（20.1a節・決定9）、最大5週（20.1a節「上限」）。
 * 端数週（シーズン開始が月曜以外の場合）も按分・補正せず実件数のみを表示する
 * （07-9章「端数の週」）。
 *
 * [相対呼称] `useRelativeLabels=true`（現在の木、P26/C20/S14）のときのみ直近2週を
 * 今週／先週（子どもはこんしゅう／せんしゅう）とし、3週目以降・過去の木
 * （`useRelativeLabels=false`、21.0節決定11「過去シーズンは相対呼称が意味を持たない」）
 * は常に`M/D週`（子どもは`M/Dしゅう`）で表す。
 */
export interface FamilyTreeWeeklyItem {
  weekStart: string; // "YYYY-MM-DD"
  count: number;
  label: string;
}

export function buildFamilyTreeWeeklyItems({
  weeklyCounts,
  seasonStart,
  seasonEnd,
  isChild,
  useRelativeLabels,
  todayStr = getJstToday(),
  maxWeeks = 5,
}: {
  weeklyCounts: FamilyTreeWeeklyCompletionCount[];
  seasonStart: string;
  seasonEnd: string | null;
  isChild: boolean;
  useRelativeLabels: boolean;
  todayStr?: string;
  maxWeeks?: number;
}): FamilyTreeWeeklyItem[] {
  const firstWeekStart = getJstWeekStartDate(seasonStart);
  // season_endは排他的上限（reported_at < season_end）のため、シーズン最終日は
  // season_endの前日（スキーマ設計.sql 41章のView定義と同じ境界の考え方）。
  const lastWeekStart = seasonEnd
    ? getJstWeekStartDate(addDaysToDateString(seasonEnd, -1))
    : getJstWeekStartDate(todayStr);

  const allWeekStarts: string[] = [];
  let cursor = firstWeekStart;
  // シーズンは暦月区切り（4〜5週）が前提のため実運用では数回のループで終わるが、
  // 万一の異常データでの無限ループを避ける安全策として上限を設ける。
  for (let guard = 0; cursor <= lastWeekStart && guard < 600; guard++) {
    allWeekStarts.push(cursor);
    cursor = addDaysToDateString(cursor, 7);
  }

  const countByWeek = new Map(weeklyCounts.map((w) => [w.week_start, w.completion_count]));
  const withCounts = allWeekStarts.map((weekStart) => ({ weekStart, count: countByWeek.get(weekStart) ?? 0 }));
  // 上限5週（20.1a節「上限」）: 最新の方から数えて5週分のみ残す。
  const limited = withCounts.slice(-maxWeeks);
  // 新しい週が先頭（決定9）。
  const descending = [...limited].reverse();

  const currentWeekStart = getJstWeekStartDate(todayStr);
  const previousWeekStart = addDaysToDateString(currentWeekStart, -7);

  return descending.map(({ weekStart, count }) => {
    let label: string;
    if (useRelativeLabels && weekStart === currentWeekStart) {
      label = isChild ? "こんしゅう" : "今週";
    } else if (useRelativeLabels && weekStart === previousWeekStart) {
      label = isChild ? "せんしゅう" : "先週";
    } else {
      label = isChild ? `${formatDateShort(weekStart)}しゅう` : `${formatDateShort(weekStart)}週`;
    }
    return { weekStart, count, label };
  });
}

export function FamilyTreeWeeklyList({
  items,
  countLabel = "回",
  labelStyle,
  countStyle,
}: {
  items: FamilyTreeWeeklyItem[];
  countLabel?: string;
  labelStyle?: TextStyle;
  countStyle?: TextStyle;
}) {
  return (
    <View style={{ width: "100%" }}>
      {items.map((item) => (
        <View key={item.weekStart} style={styles.weeklyRow}>
          <Text style={[theme.typography.parentBody, labelStyle]}>{item.label}</Text>
          <Text style={[theme.typography.parentBodyMedium, countStyle]}>
            {item.count}
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
  // [2026-09-08追加・49.6章] 自由配置ステッカーの最前面固定オーバーレイ。skyLayerと
  // 同じ絶対配置・同じ寸法だが、JSX上で最後に置くことで最前面に描画される
  // （本ファイル冒頭のスタック順コメント参照）。
  stickerOverlay: {
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
  // [2026-09-03削除] `dot`（Viewのみの単色丸）はstage<3もSVG形状化した
  // ため未使用になった（StageDot参照）。縁取り色`rgba(0,0,0,0.16)`は
  // `DOT_STROKE_COLOR`としてStageDot側に残している。
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
  // [2026-09-02追加] 週ごとの記録（20.1a節）。矢印・棒グラフ・色分けを使わない
  // 縦並びの数字リストのみ（決定9）。
  weeklyRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: theme.spacing.s1 },
  // [2026-09-17新設・主要画面ワイヤーフレーム.md 46.3節] 木の飾りのタップ拡大表示。
  // `CollectorShelfPanel.tsx`の`overlay`/`expandedCard`/`expandedCloseButton`と
  // 見た目を揃えるため複製した（トークン参照のため値そのものは一致する。225章）。
  expandOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  expandCard: {
    alignItems: "center",
    backgroundColor: theme.colors.neutralSurface,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentLg,
    paddingHorizontal: theme.spacing.s4,
    paddingBottom: theme.spacing.s4,
  },
  expandCloseButton: {
    position: "absolute",
    top: theme.spacing.s2,
    right: theme.spacing.s2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  expandCloseButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.neutralTextPrimary,
    lineHeight: 20,
  },
  expandContentWrap: { alignItems: "center" },
  expandTextWrap: { marginTop: theme.spacing.s3, alignItems: "center" },
  expandCenterText: { textAlign: "center" },
  expandEmoji: { fontSize: 40 },
});

export default TreeStageVisual;
