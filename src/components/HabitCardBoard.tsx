/**
 * タップ先「シール帳」画面の中身（P38・保護者／S26・みまもりメンバー／子どもは
 * 軽量モーダル、主要画面ワイヤーフレーム.md 49-B.5章決定45〜46、全面改訂）。
 *
 * 役割を「進行中の内訳」に絞る（決定45）: ①進行中の冊の詳しい進捗（段階
 * ゲージ・いまの10マス・数字、帯から移設）、②進行中の内訳（多い順上位5件＋
 * ほか◯件）、③絵柄の選び直し（累計0件のときのみ）、④他メンバーの閲覧
 * （決定12・18を維持）。「しまった冊」の一覧・「おわりにする」操作は置かない
 * （コレクションへ移設、依頼文決定11／手動終了は撤去、決定27）。
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import HabitCardKindPicker from "./HabitCardKindPicker";
import MemberAvatar from "./MemberAvatar";
import { ErrorState, SkeletonList } from "./StatusViews";
import { groupHabitFigureCatalogByKind, useChooseHabitCardKindAction, computeHabitCardTierInfo } from "@/hooks/useHabitCards";
import {
  computeCurrentPageFilledCells,
  computeHabitCardPageTier,
  formatHabitCardProgressText,
  getHabitCardKindInfo,
  summarizeHabitCardBreakdown,
} from "@/lib/habitCardDisplay";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import type { Chore, FamilyMember, HabitCard, HabitCardChoreBreakdownRow, HabitFigureCatalogItem, HabitFigureGrantWithCatalog } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";

const TIER_LABEL_ADULT: Record<string, string> = { bronze: "銅", silver: "銀", gold: "金", crystal: "クリスタル" };
const TIER_LABEL_CHILD: Record<string, string> = { bronze: "どう", silver: "ぎん", gold: "きん", crystal: "クリスタル" };

export interface HabitCardBoardProps {
  tone: Tone;
  members: FamilyMember[];
  myMemberId: string;
  selectedMemberId: string;
  onSelectMember: (id: string) => void;
  chores: Chore[];
  catalog: HabitFigureCatalogItem[];
  loadState: LoadState;
  card: HabitCard | null;
  breakdown: HabitCardChoreBreakdownRow[];
  totalCount: number;
  /**
   * 【2026-09-19差分修正・主要画面ワイヤーフレーム.md 49-B.4章決定60】
   * 進行中の冊（`card`）に紐づく獲得済みフィギュア。選び直し可否は
   * `totalCount === 0`ではなく、この配列が空かどうか（存在チェック）で
   * 判定する。`count < 10`等の数値比較は使わない（決定60必須要件）。
   */
  grants: HabitFigureGrantWithCatalog[];
  onRetry: () => void;
  /** 絵柄の選び直しが成功したら呼ぶ（呼び出し元が再取得する）。 */
  onKindChosen: () => void;
}

/** 決定11-A「段階の目盛り」。銅(10)・銀(30)・金(50)・クリスタル(100)の4点を横一列に置く。 */
function TierGauge({ tone, count }: { tone: Tone; count: number }) {
  const { currentTier } = computeHabitCardTierInfo(count);
  const isChild = tone === "child";
  const order: ("bronze" | "silver" | "gold" | "crystal")[] = ["bronze", "silver", "gold", "crystal"];
  const label = isChild ? TIER_LABEL_CHILD : TIER_LABEL_ADULT;
  return (
    <View style={styles.gaugeRow}>
      {order.map((tier) => {
        const reached = currentTier != null && order.indexOf(tier) <= order.indexOf(currentTier);
        return (
          <Text key={tier} style={[styles.gaugeItem, reached && styles.gaugeItemReached]}>
            {label[tier]}
          </Text>
        );
      })}
    </View>
  );
}

// [2026-09-20新設・本部長差し戻し対応（49-B.14節決定64・69）] セル幅は
// `width: "18%"`という相対値のため、端末幅によって実際のpx幅が変わる
// （本部長の実測は保護者画面で81px）。borderRadius（決定69「一辺の約25%」）・
// 絵文字サイズ（本部長の指示「マスの半分弱35〜40px程度」）を固定pxで決め打ち
// すると幅の違う端末で崩れるため、1つ目のセルのonLayoutで実測したpx幅から
// 比率で算出する。onLayout発火前（初回描画の一瞬）だけは、本部長が実測した
// 81px（保護者のシール帳画面、3枚貼った状態）を仮定したフォールバック値を使う。
const CELL_SIZE_FALLBACK_PX = 81; // 本部長実測値（差し戻しコメント記載の実測）
const CELL_BORDER_RADIUS_RATIO = 0.25; // 決定69「一辺の約25%」
const CELL_EMOJI_SIZE_RATIO = 0.45; // 差し戻し指示「マスの半分弱（35〜40px程度）」→81px×0.45≒36px

/**
 * 決定11-B「いまの10マス」。5×2のマス目で表示する。
 * [2026-09-20改訂・主要画面ワイヤーフレーム.md 49-B.14章決定64〜69、同日本部長差し戻し
 * 対応] 円（⬤/◯）から角丸四角形へ変更（決定69）。埋まっているマスは、いまの頁が
 * 目指す段階の色（決定66・67）で塗り、中央にその種類の絵文字（決定65）を表示する。
 * 未到達マスは形はそのまま、塗りを透明にし縁取りだけneutralBorderにする
 * （決定68、絵文字は出さない）。borderRadius・絵文字サイズは実測セル幅に追従する。
 */
function TenCellsGrid({
  filled,
  kindEmoji,
  pageTier,
}: {
  filled: number;
  kindEmoji: string | null;
  pageTier: "bronze" | "silver" | "gold" | "crystal";
}) {
  // [差し戻し対応] 1つ目のセル（常に描画される）のonLayoutで実測px幅を取得する。
  // 全セルは同じstyles.cell（width: "18%", aspectRatio: 1）のため、1回の測定で足りる。
  const [measuredCellSize, setMeasuredCellSize] = useState<number | null>(null);
  const cellSizePx = measuredCellSize ?? CELL_SIZE_FALLBACK_PX;
  const borderRadius = Math.round(cellSizePx * CELL_BORDER_RADIUS_RATIO);
  const emojiFontSize = Math.round(cellSizePx * CELL_EMOJI_SIZE_RATIO);

  const cells = Array.from({ length: 10 }, (_, i) => i < filled);
  const fillColor = theme.habitCardCellColors[pageTier];
  return (
    <View style={styles.cellsWrap}>
      {cells.map((isFilled, i) => (
        <View
          key={i}
          onLayout={
            i === 0
              ? (e) => {
                  const w = e.nativeEvent.layout.width;
                  if (w > 0 && w !== measuredCellSize) setMeasuredCellSize(w);
                }
              : undefined
          }
          style={[
            styles.cell,
            { borderRadius },
            isFilled
              ? { backgroundColor: fillColor, borderColor: theme.habitCardCellBorderColor }
              : { backgroundColor: "transparent", borderColor: theme.colors.neutralBorder },
          ]}
        >
          {isFilled && <Text style={[styles.cellEmoji, { fontSize: emojiFontSize }]}>{kindEmoji ?? "🏳️"}</Text>}
        </View>
      ))}
    </View>
  );
}

export function HabitCardBoard({
  tone,
  members,
  myMemberId,
  selectedMemberId,
  onSelectMember,
  chores,
  catalog,
  loadState,
  card,
  breakdown,
  totalCount,
  grants,
  onRetry,
  onKindChosen,
}: HabitCardBoardProps) {
  const isChild = tone === "child";
  const bodyStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  const captionStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;
  const { memberAvatars } = useAppData();
  const { choosing, choose } = useChooseHabitCardKindAction();
  const [kindPickerOpen, setKindPickerOpen] = useState(false);
  const [chooseError, setChooseError] = useState<string | null>(null);

  const kindGroups = groupHabitFigureCatalogByKind(catalog);

  const handleChoose = async (kindKey: string) => {
    if (!card) return;
    setChooseError(null);
    const res = await choose(card.id, kindKey);
    if (!res.ok) {
      setChooseError(res.error.message);
      return;
    }
    setKindPickerOpen(false);
    onKindChosen();
  };

  if (loadState === "loading") return <SkeletonList count={3} />;
  if (loadState === "error") {
    return <ErrorState tone={isChild ? "child" : "parent"} title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"} onRetry={onRetry} />;
  }

  const kindInfo = getHabitCardKindInfo(card, catalog, isChild);
  const filled = card ? computeCurrentPageFilledCells(totalCount) : 0;
  const pageTier = computeHabitCardPageTier(totalCount);
  const progressText = card
    ? formatHabitCardProgressText(totalCount, (tier) => (isChild ? TIER_LABEL_CHILD[tier] : TIER_LABEL_ADULT[tier]))
    : "";
  const summary = summarizeHabitCardBreakdown(breakdown, chores, 5);
  const isViewingSelf = selectedMemberId === myMemberId;
  // [決定60・必須] 判定は`habit_figure_grants`の存在チェックで行う。
  // `totalCount === 0`（完了報告の累計）や`count < 10`のような数値比較には
  // 戻さないこと（銅のしきい値が将来変わると直し忘れる事故になる）。
  const canChooseKind = isViewingSelf && card != null && grants.length === 0;

  return (
    <View>
      {/* 決定18: メンバーチップは家族全員（本人1人のみならチップ行自体を出さない）。 */}
      {members.filter((m) => m.is_active).length > 1 && (
        <View style={styles.memberRow}>
          {members
            .filter((m) => m.is_active)
            .map((m) => (
              <Pressable
                key={m.id}
                onPress={() => onSelectMember(m.id)}
                style={[styles.memberChip, m.id === selectedMemberId && styles.memberChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: m.id === selectedMemberId }}
              >
                <MemberAvatar name={m.display_name} color={m.avatar_color} size={20} lineData={memberAvatars[m.id]} />
                <Text style={captionStyle}>{m.id === myMemberId ? (isChild ? "じぶん" : "自分") : m.display_name}</Text>
              </Pressable>
            ))}
        </View>
      )}

      {!card ? (
        <Text style={[bodyStyle, { marginTop: theme.spacing.s4 }]}>
          {isChild ? "また あとで みてみてね" : "読み込めませんでした"}
        </Text>
      ) : (
        <>
          <View style={{ marginTop: theme.spacing.s3 }}>
            <Text style={bodyStyle}>
              {kindInfo.kindEmoji ?? "🏳️"} {kindInfo.kindDisplayName}　{totalCount}/100
            </Text>
            <TierGauge tone={tone} count={totalCount} />
            <TenCellsGrid filled={filled} kindEmoji={kindInfo.kindEmoji} pageTier={pageTier} />
            <Text style={[captionStyle, { marginTop: theme.spacing.s1 }]}>{progressText}</Text>

            {/* [決定42②副経路・決定45③・決定60] まだフィギュアを1体も獲得していない
                間だけ、絵柄の選び直しリンクを常設する（habit_figure_grantsの
                存在チェック。決定61の気づける案内をリンクの直前に置く）。 */}
            {canChooseKind && !kindPickerOpen && (
              <>
                <Text style={[captionStyle, { marginTop: theme.spacing.s2 }]}>
                  {isChild
                    ? "まだ 1こも もらってないから、えを かえられるよ（かえなくても いいよ）"
                    : "まだフィギュアを1体も獲得していないため、絵柄を変えられます（変えなくても大丈夫です）"}
                </Text>
                <Pressable onPress={() => setKindPickerOpen(true)}>
                  <Text style={[captionStyle, styles.link]}>えらびなおす →</Text>
                </Pressable>
              </>
            )}
            {canChooseKind && kindPickerOpen && (
              <View style={{ marginTop: theme.spacing.s3 }}>
                <HabitCardKindPicker
                  tone={tone}
                  groups={kindGroups}
                  currentKindKey={card.kind_key}
                  onChoose={handleChoose}
                  choosing={choosing}
                  error={chooseError}
                />
                <Pressable onPress={() => setKindPickerOpen(false)}>
                  <Text style={[captionStyle, styles.link]}>とじる</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* [決定45②・46] 進行中の内訳。多い順上位5件＋ほか◯件。 */}
          <View style={{ marginTop: theme.spacing.s4 }}>
            <Text style={[bodyStyle, { fontWeight: "700" }]}>
              {isViewingSelf
                ? isChild
                  ? "いま やっていること"
                  : "いま やっていること"
                : `${members.find((m) => m.id === selectedMemberId)?.display_name ?? ""}の いま やっていること`}
            </Text>
            {summary.total === 0 ? (
              <Text style={[captionStyle, { marginTop: theme.spacing.s2 }]}>
                {isChild ? "まだ なにも やっていないよ" : "まだ実施記録がありません"}
              </Text>
            ) : (
              <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s1 }}>
                {summary.top.map((entry) => (
                  <View key={entry.choreId ?? entry.title} style={styles.breakdownRow}>
                    <Text style={bodyStyle} numberOfLines={1}>
                      {entry.emoji ?? "📝"} {entry.title}
                    </Text>
                    <Text style={captionStyle}>{isChild ? `${entry.count}かい` : `${entry.count}回`}</Text>
                  </View>
                ))}
                {summary.otherCount > 0 && (
                  <Text style={captionStyle}>{isChild ? `ほか${summary.otherCount}けん` : `ほか${summary.otherCount}件`}</Text>
                )}
              </View>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  memberRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginBottom: theme.spacing.s3 },
  memberChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.s1,
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  memberChipActive: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
  gaugeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: theme.spacing.s1 },
  gaugeItem: { fontSize: 11, color: theme.colors.neutralTextSecondary },
  gaugeItemReached: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  // [決定64] 固定110px幅を廃止し、5列×2行の並びは維持したままコンテナ幅
  // いっぱいに敷き詰める。列間の余白（justifyContent: space-between）を
  // 差し引いた比率として各セル幅を18%前後にする。
  cellsWrap: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: theme.spacing.s1 },
  // [決定69・2026-09-20本部長差し戻し対応] 丸ではなく角丸四角形。borderRadiusは
  // 固定値をやめ、TenCellsGrid内で実測セル幅×25%を算出してインラインで指定する
  // （ここでは幅・アスペクト比など、実測に依存しない部分のみ定義する）。
  cell: {
    width: "18%",
    aspectRatio: 1,
    marginBottom: theme.spacing.s1,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // fontSizeはTenCellsGrid内で実測セル幅から算出しインライン指定する（ここでは指定しない）。
  cellEmoji: {},
  link: { color: theme.colors.brandPrimaryStrong, marginTop: theme.spacing.s2 },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});

export default HabitCardBoard;
