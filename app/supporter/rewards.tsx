import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { EmptyState } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * S8 自分専用のごほうび一覧（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S8、API仕様.md 7b章
 *
 * 自分が登録した自分専用reward（scope='personal', created_by=自分）を一覧し、
 * 新規登録・編集（→S9）、交換（→S10）への入口にする。
 */
export default function SupporterRewardsScreen() {
  const { state, memberPoints } = useAppData();
  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const balance = me ? memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0 : 0;
  const myRewards = state.rewards.filter((r) => r.is_active && r.scope === "personal" && r.created_by === me?.id);

  return (
    <Screen tone="supporter">
      <View style={styles.header}>
        <Text style={theme.typography.supporterTitle}>🎯 じぶんのごほうび</Text>
        <AppButton tone="supporter" label="＋ 新規" variant="secondary" onPress={() => router.push("/supporter/reward-edit")} />
      </View>
      <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s1 }]}>いま {balance}pt</Text>

      {myRewards.length === 0 && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <EmptyState emoji="🎁" title="まだじぶんのごほうびが登録されていません" />
        </View>
      )}

      {myRewards.length > 0 && (
        <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
          {myRewards.map((r) => (
            <Card key={r.id} tone="supporter" style={{ backgroundColor: theme.colors.supporterAccentSoft, borderColor: theme.colors.supporterAccent }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ fontSize: 20 }}>{r.emoji ?? "🎁"}</Text>
                <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s3 }]}>{r.name}</Text>
                <Text style={theme.typography.supporterBodyMedium}>{r.cost}pt</Text>
              </View>
              <Pressable onPress={() => router.push({ pathname: "/supporter/reward-edit", params: { id: r.id } })}>
                <Text style={[styles.editLink, { marginTop: theme.spacing.s2 }]}>編集する</Text>
              </Pressable>
            </Card>
          ))}
        </View>
      )}

      <AppButton
        tone="supporter"
        label="じぶんのごほうびと交換する"
        style={{ marginTop: theme.spacing.s6 }}
        disabled={myRewards.length === 0}
        onPress={() => router.push("/supporter/reward-redeem")}
      />
      <AppButton tone="supporter" label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  editLink: { color: theme.colors.supporterAccent, fontWeight: "700" },
});
