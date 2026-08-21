import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import MemberAvatar from "@/components/MemberAvatar";

/**
 * C5 やることリスト（ホーム）（主要5画面のひとつ）
 * 参照: 主要画面ワイヤーフレーム.md 1章
 * 状態: 読み込み中・空・通常・上限到達（個別カード）・通信エラー を実装。
 * 上限到達カードは赤・グレーアウトにせず達成トーンで表現する（デザイントークン.md 1.4）。
 */
type LoadState = "loading" | "error" | "ready";

export default function ChildHomeScreen() {
  const { state, memberPoints, isChoreLimitReached } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    const t = setTimeout(() => setLoadState("ready"), 500);
    return () => clearTimeout(t);
  }, []);

  const me = state.members.find((m) => m.id === state.activeChildMemberId)!;
  const myPoints = memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0;

  // [変更] 2026-08-15改訂: 承認フロー廃止によりc.status（審査待ち件数）は廃止された。
  // 代わりに、自分の完了報告に直近24時間で届いた保護者リアクション件数を「お知らせ」として
  // 表示する（主要画面ワイヤーフレーム.md 4章「新着リアクションあり」の考え方をC5ヘッダーにも
  // 適用。催促ではなく届いたお知らせという位置づけ、デザイントークン.md 1.4節参照）。
  const myCompletionIds = new Set(state.completions.filter((c) => c.reported_by === me.id).map((c) => c.id));
  const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
  const newReactionCount = state.reactions.filter(
    (r) => myCompletionIds.has(r.completion_id) && new Date(r.created_at).getTime() >= oneDayAgoMs
  ).length;

  const chores = state.chores.filter(
    (c) => c.is_active && (c.assigned_to === null || c.assigned_to === me.id)
  );

  return (
    <Screen tone="child" scroll={false}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <MemberAvatar name={me.display_name} color={me.avatar_color} size={36} />
          <Text style={theme.typography.childBody}>{me.display_name}</Text>
        </View>
        <Pressable onPress={() => router.push("/child/profile-switch")}>
          <Text style={styles.notifBadge}>🔔{newReactionCount}</Text>
        </Pressable>
      </View>

      <View style={styles.pointsRow}>
        <Text style={theme.typography.childHeadline}>🌟 いま {myPoints}pt</Text>
      </View>

      {/* [2026-08-20追加] 双方向リアクション（子→親）への導線。
          app/child/family-activity.tsx参照。 */}
      <Pressable onPress={() => router.push("/child/family-activity")}>
        <Text style={[theme.typography.childBody, styles.familyActivityLink]}>
          👨‍👩‍👧‍👦 かぞくのがんばりを見る →
        </Text>
      </Pressable>

      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4 }]}>やることリスト</Text>

      <View style={{ flex: 1, marginTop: theme.spacing.s2 }}>
        {loadState === "loading" && <SkeletonList count={4} />}
        {loadState === "error" && (
          <ErrorState
            tone="child"
            title="つうしんがおやすみ中みたい"
            onRetry={() => setLoadState("ready")}
          />
        )}
        {loadState === "ready" && chores.length === 0 && (
          <EmptyState tone="child" emoji="🌱" title="まだやることがないよ。おうちの人にきいてみてね" />
        )}
        {loadState === "ready" && chores.length > 0 && (
          <View style={styles.grid}>
            {chores.map((chore) => {
              const limitReached = isChoreLimitReached(chore, me.id);
              return (
                <Pressable
                  key={chore.id}
                  disabled={limitReached}
                  onPress={() => router.push({ pathname: "/child/report", params: { choreId: chore.id } })}
                  style={[styles.card, limitReached && styles.cardDone]}
                >
                  <Text style={{ fontSize: 32 }}>{chore.emoji}</Text>
                  <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s1 }]}>{chore.title}</Text>
                  {limitReached ? (
                    <Text style={styles.doneLabel}>✅ きょうは{"\n"}がんばったね</Text>
                  ) : (
                    <Text style={styles.pointLabel}>+{chore.points}pt</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  notifBadge: { fontSize: 16, fontWeight: "700" },
  pointsRow: { alignItems: "center", marginTop: theme.spacing.s4 },
  familyActivityLink: {
    textAlign: "center",
    marginTop: theme.spacing.s2,
    color: theme.colors.brandPrimaryStrong,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s3 },
  card: {
    width: "47%",
    minHeight: theme.tapTarget.childPrimary,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  cardDone: {
    backgroundColor: theme.colors.brandPrimarySoft,
  },
  pointLabel: { marginTop: theme.spacing.s1, color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  doneLabel: { marginTop: theme.spacing.s1, textAlign: "center", color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
});
