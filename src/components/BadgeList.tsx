/**
 * 累計到達回数のリスト表示（P16/C8/S1で共通利用）。
 * 参照: 主要画面ワイヤーフレーム.md 32.4節・32.5節・58章、デザイントークン.md 1.12節。
 *
 * 新しい絵を増やさず、既存の絵文字1種＋到達値の数字併記のみで表現する
 * （決定13・決定28）。未達成の行も「あと◯」という進捗として常に表示し、
 * 「未獲得」「ロック中」等の欠落・制限を示す表現は使わない（0.1節）。
 *
 * [2026-09-21改訂・主要画面ワイヤーフレーム.md 58章] 見出しは「バッジ」から
 * 「これまでの回数」（保護者・みまもりメンバー向け）「ここまでの かず」（子ども向け）に
 * 変更した（58.2節決定1）。統括の実機指摘「バッジといってもバッジのそれがない」
 * （実物の絵が伴わない）に対応する。あわせて`lifetime_points_earned`
 * （🌟 はじめの100pt）を廃止した（58.3節決定2。theme.badgeDefinitions側で対応）。
 *
 * [2026-09-08追加・2026-09-21削除・主要画面ワイヤーフレーム.md 58.5a節決定3]
 * コレクター棚「集めたもの」区画（個別メンバー選択時）に達成済みのみを複製表示する
 * 対応（`achievedOnly`/`hideHeading`props、CollectorShelfPanel.tsxからの呼び出し）は
 * 統括判断で削除した（絵が無く集めるものでもないため、コレクター棚には表示しない）。
 * 呼び出し元が本コンポーネントのみになった（通帳P16/C8・S1「MyPointsCard」の3箇所）ため、
 * 呼び出し側が0件時の空状態文言を出す想定や進捗の省略に使っていた2つのprops
 * （`achievedOnly`・`hideHeading`）は、他に使うところが無くなったため本コンポーネントからも
 * 削除した（開発部・実装メモ272章、2026-09-21）。
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
  // [32.4節状態一覧] 通信エラー: この区画専用のエラー状態は設けず、呼び出し側
  // （通帳全体・S1カード全体）のエラー表示に含める設計のため、ここでは何も描画しない。
  if (loadState === "error") return null;

  return (
    <View>
      <Text style={[theme.typography.parentBody, styles.heading, headingStyle]}>
        {isChild ? "ここまでの かず" : "これまでの回数"}
      </Text>
      <View style={{ gap: theme.spacing.s1 }}>
        {rows.map((row) => {
          const achieved = row.achievedTier !== null;
          const label = isChild ? row.nameChild : row.nameParent;
          const achievedLabel = isChild ? "たっせい！" : "達成";
          // [2026-09-08改訂・本部長／軽微変更ルート] 従来は「ポイント以外は一律で
          // 回／かい」と書いていたため、「えかき10まい（つぎの段階10回まで あと3回）」
          // のように名前と単位が食い違っていた（統括の実機確認）。単位は
          // theme.badgeDefinitions の unit を使う。
          const unit = row.unit[isChild ? 1 : 0];
          const progressLabel = row.remaining !== null ? `あと${row.remaining}${unit}` : null;
          return (
            <Text key={row.key} style={[theme.typography.parentBody, rowStyle]}>
              {row.emoji} {label}
              {achieved ? `${isChild ? " " : "（"}${achievedLabel}${isChild ? "" : "）"}` : ""}
              {progressLabel && row.nextTier !== null
                ? `（つぎの${isChild ? "" : "段階"}${row.nextTier}${unit}まで ${progressLabel}）`
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
