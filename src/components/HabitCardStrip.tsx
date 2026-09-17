/**
 * じぶんタブの台紙カード（要件定義書07-28章、主要画面ワイヤーフレーム.md 49.4章）。
 * 新しい画面・新しいタブは作らず、保護者・みまもりメンバー・子どものそれぞれの
 * 既存「じぶん」タブ入口に1枚追加するカード（決定9）。
 *
 * 台紙が2枚以上ある場合は横スクロールで切り替える（決定10）。1枚の中身は
 * 「種類の見出し」「段階の目盛り（銅・銀・金・クリスタル）」「いまの10マス」
 * 「数字（累計/次の段階・あと何件）」の4要素で構成する（決定11のハイブリッド案）。
 * 対象クエストを1件も持たないメンバーには、このカード自体を表示しない（決定9）。
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import theme from "@/theme/theme";
import type { HabitCardWithProgress } from "@/hooks/useHabitCards";
import { computeHabitCardTierInfo } from "@/hooks/useHabitCards";
import { computeCurrentPageFilledCells, formatHabitCardProgressText, getHabitCardKindInfo } from "@/lib/habitCardDisplay";
import type { Chore, HabitFigureCatalogItem } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

const TIER_LABEL: Record<"bronze" | "silver" | "gold" | "crystal", { child: string; adult: string }> = {
  bronze: { child: "どう", adult: "銅" },
  silver: { child: "ぎん", adult: "銀" },
  gold: { child: "きん", adult: "金" },
  crystal: { child: "クリスタル", adult: "クリスタル" },
};

export interface HabitCardStripProps {
  tone: Tone;
  cards: HabitCardWithProgress[];
  chores: Chore[];
  catalog: HabitFigureCatalogItem[];
  onPressCard: (card: HabitCardWithProgress) => void;
}

/** 決定11-A「段階の目盛り」。銅(10)・銀(30)・金(50)・クリスタル(100)の4点を横一列に置く。 */
function TierGauge({ tone, count }: { tone: Tone; count: number }) {
  const { currentTier } = computeHabitCardTierInfo(count);
  const isChild = tone === "child";
  const order: ("bronze" | "silver" | "gold" | "crystal")[] = ["bronze", "silver", "gold", "crystal"];
  return (
    <View style={styles.gaugeRow}>
      {order.map((tier) => {
        const reached =
          currentTier != null &&
          order.indexOf(tier) <= order.indexOf(currentTier);
        return (
          <Text key={tier} style={[styles.gaugeItem, reached && styles.gaugeItemReached]}>
            {isChild ? TIER_LABEL[tier].child : TIER_LABEL[tier].adult}
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

function OneHabitCard({ tone, entry, chores, catalog }: { tone: Tone; entry: HabitCardWithProgress; chores: Chore[]; catalog: HabitFigureCatalogItem[] }) {
  const isChild = tone === "child";
  const bodyStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  const captionStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;
  const chore = chores.find((c) => c.id === entry.card.chore_id);
  const kindInfo = getHabitCardKindInfo(chore, catalog);
  const filled = computeCurrentPageFilledCells(entry.count);
  const progressText = formatHabitCardProgressText(entry.count, (tier) => (isChild ? TIER_LABEL[tier].child : TIER_LABEL[tier].adult));

  return (
    <View style={styles.cardInner}>
      <Text style={bodyStyle}>
        {kindInfo.kindEmoji ?? "🏳️"} {kindInfo.kindDisplayName}
      </Text>
      <TierGauge tone={tone} count={entry.count} />
      <TenCellsGrid filled={filled} />
      <Text style={[captionStyle, { marginTop: theme.spacing.s1 }]}>{progressText}</Text>
    </View>
  );
}

export function HabitCardStrip({ tone, cards, chores, catalog, onPressCard }: HabitCardStripProps) {
  if (cards.length === 0) return null;
  const isChild = tone === "child";
  const headingStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBodyMedium : theme.typography.parentBodyMedium;

  return (
    <View style={{ marginTop: theme.spacing.s3 }}>
      <Text style={[headingStyle, styles.heading]}>📔 台紙</Text>
      {cards.length === 1 ? (
        <Pressable onPress={() => onPressCard(cards[0])}>
          <Card tone={tone} style={styles.singleCard}>
            <OneHabitCard tone={tone} entry={cards[0]} chores={chores} catalog={catalog} />
          </Card>
        </Pressable>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
          {cards.map((entry) => (
            <Pressable key={entry.card.id} onPress={() => onPressCard(entry)}>
              <Card tone={tone} style={styles.scrollCard}>
                <OneHabitCard tone={tone} entry={entry} chores={chores} catalog={catalog} />
              </Card>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: theme.spacing.s2, color: theme.colors.brandPrimaryStrong },
  singleCard: { width: "100%" },
  scroll: { flexDirection: "row" },
  scrollCard: { width: 260, marginRight: theme.spacing.s3 },
  cardInner: { gap: theme.spacing.s1 },
  gaugeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: theme.spacing.s1 },
  gaugeItem: { fontSize: 11, color: theme.colors.neutralTextSecondary },
  gaugeItemReached: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  cellsWrap: { flexDirection: "row", flexWrap: "wrap", width: 110, marginTop: theme.spacing.s1 },
  cell: { fontSize: 16, width: 22 },
});

export default HabitCardStrip;
