/**
 * 保護者・みまもりメンバー向けの「いまの自分のポイント」カード。
 *
 * [2026-08-27追加・本部長] ユーザーの指摘「保護者側も今のポイントがわかるようなUIが良い」
 * への対応。子どもホームには `🌟 いま Npt` が大きく出るのに、保護者ホーム（P7）にも
 * みまもりホーム（S1）にもポイント表示が一切無く、通帳を開かないと自分の残高が分からなかった。
 * 本番では保護者の「せいや」が47ptと家族で最多だったにもかかわらず本人の画面に出ていない、
 * という状態だった。07-4章で保護者を「対等な参加者」と位置づけた以降、この非対称を
 * 残す理由が無い。
 *
 * 表現は子どもの祝祭的な大見出しではなく、主要画面ワイヤーフレーム.md 9.0章決定1
 * 「淡々とした記録」トーンに合わせた控えめなカード1枚にする。
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import theme from "@/theme/theme";

export interface MyPointsCardProps {
  tone: "parent" | "supporter";
  points: number;
  /**
   * タップ時の遷移先。保護者は通帳（P16）へ飛ばす（メニューの「📔 通帳」への近道を兼ねる）。
   * みまもりメンバーには通帳画面が存在しないため未指定とし、その場合は表示専用になる。
   */
  onPress?: () => void;
}

export function MyPointsCard({ tone, points, onPress }: MyPointsCardProps) {
  const isSupporter = tone === "supporter";
  const labelStyle = isSupporter ? theme.typography.supporterCaption : theme.typography.parentCaption;

  const body = (
    <Card tone={tone} style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={[labelStyle, { color: theme.colors.neutralTextSecondary }]}>じぶんのポイント</Text>
        <Text style={styles.points}>{points}pt</Text>
      </View>
      {onPress && <Text style={styles.chevron}>›</Text>}
    </Card>
  );

  if (!onPress) return body;
  return <Pressable onPress={onPress}>{body}</Pressable>;
}

const styles = StyleSheet.create({
  card: {
    marginTop: theme.spacing.s3,
    flexDirection: "row",
    alignItems: "center",
  },
  // 子どもの childHeadline ほど大きくせず、しかし一目で読める程度にはする。
  points: { fontSize: 24, fontWeight: "700", marginTop: theme.spacing.s1 },
  chevron: { fontSize: 24, color: theme.colors.neutralTextSecondary },
});

export default MyPointsCard;
