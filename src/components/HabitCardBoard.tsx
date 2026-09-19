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
import { computeCurrentPageFilledCells, formatHabitCardProgressText, getHabitCardKindInfo, summarizeHabitCardBreakdown } from "@/lib/habitCardDisplay";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import type { Chore, FamilyMember, HabitCard, HabitCardChoreBreakdownRow, HabitFigureCatalogItem } from "@/types/domain";

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

/** 決定11-B「いまの10マス」。5×2のマス目で表示する。 */
function TenCellsGrid({ filled }: { filled: number }) {
  const cells = Array.from({ length: 10 }, (_, i) => i < filled);
  return (
    <View style={styles.cellsWrap}>
      {cells.map((isFilled, i) => (
        <Text key={i} style={styles.cell}>
          {isFilled ? "⬤" : "◯"}
        </Text>
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

  const kindInfo = getHabitCardKindInfo(card, catalog);
  const filled = card ? computeCurrentPageFilledCells(totalCount) : 0;
  const progressText = card
    ? formatHabitCardProgressText(totalCount, (tier) => (isChild ? TIER_LABEL_CHILD[tier] : TIER_LABEL_ADULT[tier]))
    : "";
  const summary = summarizeHabitCardBreakdown(breakdown, chores, 5);
  const isViewingSelf = selectedMemberId === myMemberId;
  const canChooseKind = isViewingSelf && card != null && totalCount === 0;

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
            <TenCellsGrid filled={filled} />
            <Text style={[captionStyle, { marginTop: theme.spacing.s1 }]}>{progressText}</Text>

            {/* [決定42②副経路・決定45③] 累計0件のときだけ、絵柄の選び直しリンクを常設する。 */}
            {canChooseKind && !kindPickerOpen && (
              <Pressable onPress={() => setKindPickerOpen(true)}>
                <Text style={[captionStyle, styles.link]}>えらびなおす →</Text>
              </Pressable>
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
  cellsWrap: { flexDirection: "row", flexWrap: "wrap", width: 110, marginTop: theme.spacing.s1 },
  cell: { fontSize: 16, width: 22 },
  link: { color: theme.colors.brandPrimaryStrong, marginTop: theme.spacing.s2 },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});

export default HabitCardBoard;
