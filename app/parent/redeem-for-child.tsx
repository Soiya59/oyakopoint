import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * P35 だれの代わりに交換するか選ぶ（保護者、2026-09-03新設）
 * 参照: 画面一覧・遷移図.md P35、主要画面ワイヤーフレーム.md 5.5.2節
 *
 * 在籍中の子ども（role='child' && is_active）が2人以上いる場合のみ
 * app/parent/reward-edit.tsx（P13）から遷移してくる。1人の場合はP13から
 * app/parent/redeem-for-child-confirm.tsx（P36）へ直行するため、この画面自体が
 * 存在しない家庭もある（5.5.0節決定2）。
 *
 * 残高不足の子はC9・P15（app/parent/my-rewards.tsx）と同じトーンで
 * タップ不可＋「あと◯pt」表示にする（5.5.0節決定3。押させてからP36で
 * エラーを出す、という異なる体験にしない）。
 */
export default function RedeemForChildScreen() {
  const { rewardId } = useLocalSearchParams<{ rewardId: string }>();
  const { state, memberPoints } = useAppData();
  const reward = state.rewards.find((r) => r.id === rewardId);
  const children = state.members.filter((m) => m.role === "child" && m.is_active);

  // 5.5.2節「対象データが見つからない（edge case）」: rewardが見つからない、
  // または在籍中の子どもが0人になっていた（P13表示後に退会等が起きた場合）。
  if (!reward || children.length === 0) {
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentBody}>見つかりませんでした</Text>
        <AppButton
          label="ごほうび管理へもどる"
          variant="secondary"
          style={{ marginTop: theme.spacing.s4 }}
          onPress={() => router.replace("/parent/rewards")}
        />
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.parentBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3 }]}>
        {reward.emoji ?? "🎁"} {reward.name} を だれの代わりに交換する？
      </Text>

      <View style={{ marginTop: theme.spacing.s4, gap: theme.spacing.s2 }}>
        {children.map((child) => {
          const balance = memberPoints.find((m) => m.member_id === child.id)?.current_points ?? 0;
          const canAfford = balance >= reward.cost;
          return (
            <Pressable
              key={child.id}
              disabled={!canAfford}
              onPress={() =>
                router.push({
                  pathname: "/parent/redeem-for-child-confirm",
                  params: { rewardId: reward.id, memberId: child.id },
                })
              }
            >
              <Card style={styles.row}>
                <MemberAvatar name={child.display_name} color={child.avatar_color} size={32} />
                <Text style={[theme.typography.parentBody, styles.name]}>{child.display_name}さん</Text>
                {canAfford ? (
                  <>
                    <Text style={theme.typography.parentBodyMedium}>いま{balance}pt</Text>
                    <Text style={styles.chevron}>›</Text>
                  </>
                ) : (
                  <Text style={styles.notEnoughLabel}>あと{reward.cost - balance}pt</Text>
                )}
              </Card>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  name: { flex: 1, marginLeft: theme.spacing.s3 },
  notEnoughLabel: { color: theme.colors.statusPending },
  chevron: { color: theme.colors.neutralTextSecondary, marginLeft: theme.spacing.s2, fontSize: 18 },
});
