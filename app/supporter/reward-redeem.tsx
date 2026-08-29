import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { EmptyState } from "@/components/StatusViews";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * S10 自分専用のごほうびと交換（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S10、API仕様.md 7b章
 *
 * 自分専用choreで貯めたポイント（家族共有choreへの参加分も合算、実装メモ.md参照）を
 * 使って、自分専用のごほうびカタログとのみ交換できる。「本人専用」であることを
 * 明示する注記を表示し、子ども向けごほうび交換画面との混同を防ぐ。
 */
export default function SupporterRewardRedeemScreen() {
  const { state, memberPoints } = useAppData();
  const params = useLocalSearchParams<{ justRewardId?: string; justName?: string; justCost?: string }>();
  const [snackbar, setSnackbar] = useState<{ rewardId: string; name: string; cost: string } | null>(null);

  useEffect(() => {
    if (params.justRewardId && params.justName && params.justCost) {
      setSnackbar({ rewardId: params.justRewardId, name: params.justName, cost: params.justCost });
      const t = setTimeout(() => setSnackbar(null), 1500);
      return () => clearTimeout(t);
    }
  }, [params.justRewardId, params.justName, params.justCost]);

  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const balance = me ? memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0 : 0;
  const myRewards = state.rewards.filter((r) => r.is_active && r.scope === "personal" && r.created_by === me?.id);

  return (
    <Screen tone="supporter">
      <ScreenBackLink tone="supporter" onPress={() => router.replace("/supporter/home")} />
      <Text style={theme.typography.supporterTitle}>じぶんのごほうびと交換</Text>
      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        本人専用のごほうびです（家族共有のごほうびとは別のカタログです）
      </Text>
      <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s2 }]}>いま {balance}pt</Text>

      {snackbar && (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText}>こうかんしました -{snackbar.cost}pt</Text>
        </View>
      )}

      {myRewards.length === 0 && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <EmptyState emoji="🎁" title="まだじぶんのごほうびが登録されていません" />
          <AppButton
            tone="supporter"
            label="じぶんのごほうびを登録する"
            variant="secondary"
            style={{ marginTop: theme.spacing.s2 }}
            onPress={() => router.push("/supporter/reward-edit")}
          />
        </View>
      )}

      {myRewards.length > 0 && (
        <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
          {myRewards.map((r) => {
            const canAfford = balance >= r.cost;
            const highlighted = snackbar?.rewardId === r.id;
            return (
              <Pressable
                key={r.id}
                disabled={!canAfford || !me}
                onPress={() => router.push({ pathname: "/supporter/reward-confirm", params: { rewardId: r.id } })}
              >
                <Card
                  tone="supporter"
                  style={
                    highlighted
                      ? { ...styles.row, backgroundColor: theme.colors.supporterAccentSoft, borderColor: theme.colors.supporterAccent }
                      : styles.row
                  }
                >
                  <Text style={{ fontSize: 20 }}>{r.emoji ?? "🎁"}</Text>
                  <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s3 }]}>{r.name}</Text>
                  {canAfford ? (
                    <>
                      <Text style={theme.typography.supporterBodyMedium}>-{r.cost}pt</Text>
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

      <AppButton tone="supporter" label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/supporter/home")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
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
