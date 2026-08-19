import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * じぶんのごほうび（保護者、要件定義書07-4章「親も一緒に頑張る」の延長）
 *
 * [2026-08-18追加・本部長] ユーザーから「親のコマンドでもご褒美ができるように
 * したい。今はご褒美の登録しかできない」との指摘があった。確認したところ、
 * `app/parent/rewards.tsx`（P12）・`app/parent/reward-edit.tsx`（P13）はごほうびの
 * 管理（作成・編集）のみで、保護者自身が自分のポイントでごほうびと交換する画面が
 * 存在しなかった。P19「じぶんのお手伝い」（app/parent/my-chores.tsx）と同じ構成で、
 * 子ども向けC9〜C11（ごほうび交換）相当の機能を保護者向けに新設する。
 * 子ども版とは異なり、絵文字グリッド・達成演出は使わず「淡々とした記録」トーン
 * （主要画面ワイヤーフレーム.md 9.0決定1）でP19と統一する。
 */
type LoadState = "loading" | "error" | "ready";

export default function ParentMyRewardsScreen() {
  const { state, memberPoints } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const params = useLocalSearchParams<{ justRewardId?: string; justName?: string; justCost?: string }>();
  const [snackbar, setSnackbar] = useState<{ rewardId: string; name: string; cost: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setLoadState("ready"), 350);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (params.justRewardId && params.justName && params.justCost) {
      setSnackbar({ rewardId: params.justRewardId, name: params.justName, cost: params.justCost });
      const t = setTimeout(() => setSnackbar(null), 1500);
      return () => clearTimeout(t);
    }
  }, [params.justRewardId, params.justName, params.justCost]);

  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const balance = me ? memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0 : 0;
  const rewards = state.rewards.filter((r) => r.is_active);

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>じぶんのごほうび</Text>
      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s1 }]}>いま {balance}pt</Text>

      {snackbar && (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText}>こうかんしました -{snackbar.cost}pt</Text>
        </View>
      )}

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={4} />
        </View>
      )}

      {loadState === "error" && (
        <ErrorState title="読み込みに失敗しました" onRetry={() => setLoadState("ready")} />
      )}

      {loadState === "ready" && rewards.length === 0 && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <EmptyState emoji="🎁" title="ごほうびがまだ登録されていません" />
          <AppButton
            label="ごほうび管理で追加する"
            variant="secondary"
            style={{ marginTop: theme.spacing.s2 }}
            onPress={() => router.push("/parent/reward-edit")}
          />
        </View>
      )}

      {loadState === "ready" && rewards.length > 0 && (
        <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
          {rewards.map((r) => {
            const canAfford = balance >= r.cost;
            const highlighted = snackbar?.rewardId === r.id;
            return (
              <Pressable
                key={r.id}
                disabled={!canAfford || !me}
                onPress={() => router.push({ pathname: "/parent/my-reward-confirm", params: { rewardId: r.id } })}
              >
                <Card style={{ ...styles.row, ...(highlighted ? styles.rowHighlighted : null) }}>
                  <Text style={{ fontSize: 20 }}>{r.emoji ?? "🎁"}</Text>
                  <Text style={[theme.typography.parentBody, { flex: 1, marginLeft: theme.spacing.s3 }]}>
                    {r.name}
                  </Text>
                  {canAfford ? (
                    <>
                      <Text style={theme.typography.parentBodyMedium}>-{r.cost}pt</Text>
                      <Text style={styles.chevron}>›</Text>
                    </>
                  ) : (
                    <Text style={styles.notEnoughLabel}>あと{r.cost - balance}pt</Text>
                  )}
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}

      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  rowHighlighted: { backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  notEnoughLabel: { color: theme.colors.statusPending },
  chevron: { color: theme.colors.neutralTextSecondary, marginLeft: theme.spacing.s2, fontSize: 18 },
  snackbar: {
    marginTop: theme.spacing.s3,
    backgroundColor: theme.colors.neutralTextPrimary,
    borderRadius: theme.radius.parentMd,
    paddingVertical: theme.spacing.s3,
    paddingHorizontal: theme.spacing.s4,
    alignItems: "center",
  },
  snackbarText: { color: "#FFFFFF", fontWeight: "600" },
});
