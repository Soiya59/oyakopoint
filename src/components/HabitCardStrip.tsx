/**
 * じぶんタブのシール帳カード（帯、要件定義書07-28章、主要画面ワイヤーフレーム.md
 * 49-B.3章決定36〜40）。新しい画面・新しいタブは作らず、保護者・みまもり
 * メンバー・子どものそれぞれの既存「じぶん」タブ入口に1枚追加するカード。
 *
 * [2026-09-19全面改訂・シール帳の作り替え] 決定27「1人1冊ずつ・進行中は
 * 常に1冊」により、複数カードの横スクロール切り替え（旧実装）は無くなった。
 * 帯は「種類の見出し＋n/100の1行」＋「進み具合を示す細いバー（10・30・50・
 * 100の目盛り入り）」の2行構成のみに絞る（決定37・38）。段階ゲージ・
 * 10マスグリッド・キャプション3行はタップ先の画面（HabitCardBoard.tsx）へ
 * 移設した。
 *
 * 家族に参加した瞬間に必ず1冊が自動作成される（決定27・57.4章）ため、
 * 「まだシール帳が無い」状態は構造的に発生しない（決定36）。0/100の状態も
 * 通常の帯と全く同じ形で表示する（決定39、不在を強調する表示にしない）。
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import { ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";
import { computeHabitCardTierInfo } from "@/hooks/useHabitCards";
import { computeHabitCardProgressRatio, getHabitCardKindInfo } from "@/lib/habitCardDisplay";
import type { HabitCard, HabitFigureCatalogItem } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";

/** 決定38「バー上の4目盛り」。銅(10)・銀(30)・金(50)・クリスタル(100)を100分率の位置に置く。 */
const TIER_MARKS: { threshold: number; tier: "bronze" | "silver" | "gold" | "crystal" }[] = [
  { threshold: 10, tier: "bronze" },
  { threshold: 30, tier: "silver" },
  { threshold: 50, tier: "gold" },
  { threshold: 100, tier: "crystal" },
];

export interface HabitCardStripProps {
  tone: Tone;
  loadState: LoadState;
  /** 自分の進行中のシール帳（常に1件、`useActiveHabitCard`の`card`をそのまま渡す）。 */
  card: HabitCard | null;
  /** 帯に出すn/100の進み具合（`useActiveHabitCard`の`totalCount`をそのまま渡す）。 */
  totalCount: number;
  catalog: HabitFigureCatalogItem[];
  onPress: () => void;
  onRetry: () => void;
}

/** 決定38の細いバー。塗り幅は進み具合（0〜100%）、上に段階の目盛りを重ねる。 */
function ProgressBar({ count }: { count: number }) {
  const ratio = computeHabitCardProgressRatio(count);
  const { currentTier } = computeHabitCardTierInfo(count);
  const reachedOrder: Record<string, number> = { bronze: 1, silver: 2, gold: 3, crystal: 4 };
  const currentOrder = currentTier ? reachedOrder[currentTier] : 0;
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${ratio * 100}%` }]} />
      {TIER_MARKS.map((m) => {
        const reached = reachedOrder[m.tier] <= currentOrder;
        return (
          <View
            key={m.tier}
            style={[
              styles.barMark,
              { left: `${m.threshold}%` },
              reached ? styles.barMarkReached : styles.barMarkUnreached,
            ]}
          />
        );
      })}
    </View>
  );
}

export function HabitCardStrip({ tone, loadState, card, totalCount, catalog, onPress, onRetry }: HabitCardStripProps) {
  const isChild = tone === "child";
  const headingStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBodyMedium : theme.typography.parentBodyMedium;

  if (loadState === "loading") return <SkeletonList count={1} />;
  if (loadState === "error") {
    return (
      <ErrorState
        tone={isChild ? "child" : "parent"}
        title={isChild ? "つうしんがおやすみ中みたい" : "シール帳の読み込みに失敗しました"}
        onRetry={onRetry}
      />
    );
  }

  // [2026-09-20改訂・主要画面ワイヤーフレーム.md 49-B.15章決定70(#1・#2)]
  // 子ども向けは漢字「シール帳」ではなく「シールちょう」。大人・みまもりは変更なし。
  const heading = isChild ? "📔 シールちょう" : "📔 シール帳";

  // [決定36] card===nullは異常系のみ（家族参加時に必ず1冊自動作成されるため）。
  // 画面を壊さないよう、見出しだけの控えめな表示にとどめる（新しい導線は足さない）。
  if (!card) {
    return (
      <View style={{ marginTop: theme.spacing.s3 }}>
        <Text style={[headingStyle, styles.heading]}>{heading}</Text>
        <Card tone={tone} style={styles.card}>
          <Text style={isChild ? theme.typography.childBody : theme.typography.parentCaption}>
            {isChild ? "また あとで みてみてね" : "読み込めませんでした"}
          </Text>
        </Card>
      </View>
    );
  }

  // [決定71] 絵柄の名前も子ども向けはひらがな（isChildをそのまま渡す）。
  const kindInfo = getHabitCardKindInfo(card, catalog, isChild);

  return (
    <View style={{ marginTop: theme.spacing.s3 }}>
      <Text style={[headingStyle, styles.heading]}>{heading}</Text>
      <Pressable onPress={onPress}>
        <Card tone={tone} style={styles.card}>
          <View style={styles.row}>
            <Text style={headingStyle} numberOfLines={1}>
              {kindInfo.kindEmoji ?? "🏳️"} {kindInfo.kindDisplayName}
            </Text>
            <Text style={headingStyle}>{totalCount}/100</Text>
          </View>
          <ProgressBar count={totalCount} />
        </Card>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: theme.spacing.s2, color: theme.colors.brandPrimaryStrong },
  card: { width: "100%" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  barTrack: {
    marginTop: theme.spacing.s1,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.neutralBorder,
    overflow: "hidden",
  },
  barFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: theme.colors.brandPrimaryStrong,
    borderRadius: 4,
  },
  barMark: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
  },
  barMarkReached: { backgroundColor: theme.colors.brandPrimaryStrong },
  barMarkUnreached: { backgroundColor: theme.colors.neutralBorder },
});

export default HabitCardStrip;
