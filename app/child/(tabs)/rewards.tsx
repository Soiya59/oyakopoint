import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * C9 ごほうび交換（一覧）（主要5画面のひとつ）
 * 参照: 主要画面ワイヤーフレーム.md 5章
 * 残高で買えるものはボタン活性、足りないものは「あと◯pt」表示（交換不可はボタンでなく前向きな不足表示に）。
 */
type LoadState = "loading" | "error" | "ready";

export default function ChildRewardsScreen() {
  const { state, memberPoints } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    const t = setTimeout(() => setLoadState("ready"), 450);
    return () => clearTimeout(t);
  }, []);

  const me = state.members.find((m) => m.id === state.activeChildMemberId)!;
  const balance = memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0;
  // [2026-09-01修正・本部長] 保護者側（app/parent/my-rewards.tsx）と同じ不具合が
  // 子ども側にもあった。みまもりメンバーの自分専用ごほうびが交換一覧に混ざる。
  // 3ロールとも同時に直す（実装メモ106章）。
  const rewards = state.rewards.filter((r) => r.is_active && r.scope === "family");

  return (
    <Screen tone="child">
      <Text style={theme.typography.childBody}>🎁 ごほうびこうかんじょ</Text>
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s1 }]}>いま {balance}pt もってるよ</Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={4} />
        </View>
      )}
      {loadState === "error" && (
        <ErrorState tone="child" title="つうしんがおやすみ中みたい" onRetry={() => setLoadState("ready")} />
      )}
      {loadState === "ready" && rewards.length === 0 && (
        <EmptyState tone="child" emoji="🎁" title="まだごほうびがないよ。おうちの人にリクエストしてみよう" />
      )}
      {loadState === "ready" && rewards.length > 0 && (
        <View style={styles.grid}>
          {rewards.map((r) => {
            const canAfford = balance >= r.cost;
            return (
              <View key={r.id} style={styles.card}>
                <Text style={{ fontSize: 32 }}>{r.emoji}</Text>
                <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s1 }]}>{r.name}</Text>
                <Text style={theme.typography.parentCaption}>{r.cost}pt</Text>
                {canAfford ? (
                  <Pressable
                    onPress={() => router.push({ pathname: "/child/reward-confirm", params: { rewardId: r.id } })}
                    style={styles.exchangeBtn}
                  >
                    <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>こうかん</Text>
                  </Pressable>
                ) : (
                  <View style={styles.notEnoughBox}>
                    <Text style={styles.notEnoughText}>あと{r.cost - balance}pt</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s3, marginTop: theme.spacing.s4 },
  card: {
    width: "47%",
    minHeight: theme.tapTarget.childPrimary,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    alignItems: "center",
    padding: theme.spacing.s4,
  },
  exchangeBtn: {
    marginTop: theme.spacing.s2,
    backgroundColor: theme.colors.brandPrimary,
    borderRadius: theme.radius.childXl,
    paddingHorizontal: theme.spacing.s4,
    paddingVertical: theme.spacing.s2,
    minHeight: theme.tapTarget.child,
    alignItems: "center",
    justifyContent: "center",
  },
  notEnoughBox: {
    marginTop: theme.spacing.s2,
    backgroundColor: theme.colors.statusPendingSoft,
    borderRadius: theme.radius.childXl,
    paddingHorizontal: theme.spacing.s4,
    paddingVertical: theme.spacing.s2,
  },
  notEnoughText: { color: theme.colors.statusPending, fontWeight: "700" },
});
