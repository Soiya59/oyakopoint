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
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import BadgeList from "./BadgeList";
import theme from "@/theme/theme";
import { useMemberBadgeRows } from "@/hooks/useBadges";

export interface MyPointsCardProps {
  tone: "parent" | "supporter";
  points: number;
  /**
   * タップ時の遷移先。保護者は通帳（P16）へ飛ばす（メニューの「📔 通帳」への近道を兼ねる）。
   * みまもりメンバーには通帳画面が存在しないため未指定とし、その場合は表示専用になる。
   */
  onPress?: () => void;
  /**
   * [2026-09-07追加・要件定義書07-19-9b章、主要画面ワイヤーフレーム.md 32.5節]
   * みまもりメンバー唯一のポイント表示手段であるS1「MyPointsCard」にバッジの
   * アコーディオン展開を追加する（決定14。新しい画面を一切作らない）。
   * `memberId`を渡した場合のみ「実績を見る」リンクを表示する（保護者向け〈P7〉は
   * P16で既にバッジを表示済みのため、ここでは表示しない＝渡さない）。
   */
  memberId?: string;
}

export function MyPointsCard({ tone, points, onPress, memberId }: MyPointsCardProps) {
  const isSupporter = tone === "supporter";
  const labelStyle = isSupporter ? theme.typography.supporterCaption : theme.typography.parentCaption;
  const [expanded, setExpanded] = useState(false);
  const { loadState: badgeLoadState, rows: badgeRows } = useMemberBadgeRows(expanded ? memberId ?? "" : "");

  // [2026-09-07改訂・32.5節ワイヤーフレーム] 「実績を見る」トグル・展開後の
  // バッジリストは同一カード内に収める（20章決定5「内訳を見る」と同型の
  // アコーディオン。新しい画面遷移は発生しない）。
  return (
    <Card tone={tone} style={styles.card}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={styles.headerRow}
        accessibilityRole={onPress ? "button" : undefined}
      >
        <View style={{ flex: 1 }}>
          <Text style={[labelStyle, { color: theme.colors.neutralTextSecondary }]}>じぶんのポイント</Text>
          <Text style={styles.points}>{points}pt</Text>
        </View>
        {onPress && <Text style={styles.chevron}>›</Text>}
      </Pressable>

      {memberId && (
        <>
          <Pressable onPress={() => setExpanded((v) => !v)} accessibilityRole="button" style={styles.badgeToggle}>
            <Text style={[labelStyle, { color: theme.colors.supporterAccent }]}>
              {expanded ? "実績を見る ▲" : "実績を見る ▼"}
            </Text>
          </Pressable>
          {expanded && (
            <View style={{ marginTop: theme.spacing.s2 }}>
              <BadgeList isChild={false} loadState={badgeLoadState} rows={badgeRows} rowStyle={theme.typography.supporterBody} />
            </View>
          )}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: theme.spacing.s3 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  // 子どもの childHeadline ほど大きくせず、しかし一目で読める程度にはする。
  points: { fontSize: 24, fontWeight: "700", marginTop: theme.spacing.s1 },
  chevron: { fontSize: 24, color: theme.colors.neutralTextSecondary },
  badgeToggle: { marginTop: theme.spacing.s2, alignSelf: "flex-end" },
});

export default MyPointsCard;
