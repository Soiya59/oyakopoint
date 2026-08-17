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

      {/* 検証用: 通信エラー状態の見た目を確認するためのトグル */}
      <Pressable onPress={() => setLoadState(loadState === "error" ? "ready" : "error")}>
        <Text style={styles.debugToggle}>（検証用）通信エラー状態を切り替える</Text>
      </Pressable>

      {/* 検証用: 実機NFCが無いため、NFCタグ読み取り（C13→C14）を
          モックchoreのnfc_tag_idからランダムに選んでシミュレートする導線。
          設計書には存在しない開発検証専用のショートカット（P1の既存の検証用導線と同じ位置づけ）。 */}
      <Pressable onPress={() => router.push({ pathname: "/child/nfc-scan", params: { tagValue: pickRandomTagValue(state.chores) } })}>
        <Text style={styles.debugToggle}>（検証用）NFCタグを読み取る（シミュレート）</Text>
      </Pressable>
    </Screen>
  );
}

/**
 * 登録済みの nfc_tag_id からランダムに1つ選ぶ。ときどき（約4回に1回）
 * どのchoreにも一致しないダミー値を混ぜ、C14「タグ未登録／他家族のタグ」状態も
 * ランダム選択の中で確認できるようにする。
 */
function pickRandomTagValue(chores: { nfc_tag_id: string | null }[]): string {
  const registeredTags = chores
    .map((c) => c.nfc_tag_id)
    .filter((tag): tag is string => !!tag);
  const pool = [...registeredTags, "unregistered-tag-does-not-match-any-chore"];
  return pool[Math.floor(Math.random() * pool.length)];
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  notifBadge: { fontSize: 16, fontWeight: "700" },
  pointsRow: { alignItems: "center", marginTop: theme.spacing.s4 },
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
  debugToggle: { textAlign: "center", fontSize: 11, color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s2 },
});
