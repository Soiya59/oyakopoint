/**
 * 累計到達バッジのリスト表示（P16/C8/S1で共通利用）。
 * 参照: 主要画面ワイヤーフレーム.md 32.4節・32.5節、デザイントークン.md 1.12節。
 *
 * バッジは新しい絵を増やさず、既存の絵文字1種＋到達値の数字併記のみで表現する
 * （決定13・決定28）。未達成のバッジも「あと◯」という進捗として常に表示し、
 * 「未獲得」「ロック中」等の欠落・制限を示す表現は使わない（0.1節）。
 */
import React from "react";
import { StyleSheet, Text, TextStyle, View } from "react-native";
import theme from "@/theme/theme";
import type { BadgeRow } from "@/hooks/useBadges";
import { SkeletonList } from "./StatusViews";

export interface BadgeListProps {
  isChild: boolean;
  loadState: "loading" | "error" | "ready";
  rows: BadgeRow[];
  headingStyle?: TextStyle;
  rowStyle?: TextStyle;
}

export function BadgeList({ isChild, loadState, rows, headingStyle, rowStyle }: BadgeListProps) {
  if (loadState === "loading") return <SkeletonList count={2} />;
  // [32.4節状態一覧] 通信エラー: バッジ区画専用のエラー状態は設けず、呼び出し側
  // （通帳全体・S1カード全体）のエラー表示に含める設計のため、ここでは何も描画しない。
  if (loadState === "error") return null;

  return (
    <View>
      <Text style={[theme.typography.parentBody, styles.heading, headingStyle]}>バッジ</Text>
      <View style={{ gap: theme.spacing.s1 }}>
        {rows.map((row) => {
          const achieved = row.achievedTier !== null;
          const label = isChild ? row.nameChild : row.nameParent;
          const achievedLabel = isChild ? "たっせい！" : "達成";
          const progressLabel =
            row.remaining !== null
              ? isChild
                ? `あと${row.remaining}${row.key === "lifetime_points_earned" ? "pt" : "かい"}`
                : `あと${row.remaining}${row.key === "lifetime_points_earned" ? "pt" : "回"}`
              : null;
          return (
            <Text key={row.key} style={[theme.typography.parentBody, rowStyle]}>
              {row.emoji} {label}
              {achieved ? `${isChild ? " " : "（"}${achievedLabel}${isChild ? "" : "）"}` : ""}
              {progressLabel && row.nextTier !== null
                ? `（つぎの${isChild ? "" : "段階"}${row.nextTier}${row.key === "lifetime_points_earned" ? "pt" : isChild ? "かい" : "回"}まで ${progressLabel}）`
                : progressLabel
                ? `（${progressLabel}）`
                : ""}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { color: theme.colors.neutralTextSecondary, marginBottom: theme.spacing.s2 },
});

export default BadgeList;
