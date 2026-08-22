import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * P25 かぞくのみまもりメンバーのお手伝い（参考一覧）
 * 参照: 画面一覧・遷移図.md P25行・3.13節（07-7章、2026-08-22新規追加・5回目のスコープ変更）
 *
 * 家族のみまもりメンバーが登録した自分専用のお手伝い（chore定義）を、アイデアの
 * 参考として一覧で眺める画面。完了報告の実績はP8/P18側で確認できるため、本画面は
 * chore定義そのものの参考閲覧に限定し、編集・完了報告の導線は一切持たない
 * （行のUIコンポーネント自体をタップ不可の表示専用リストとして実装する）。
 */
type LoadState = "loading" | "error" | "ready";

export default function ParentSupporterChoresScreen() {
  const { state, loading, loadError } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    if (!loading) setLoadState(loadError ? "error" : "ready");
  }, [loading, loadError]);

  const personalChores = state.chores.filter((c) => c.is_active && c.scope === "personal" && c.created_by);
  const byCreator = personalChores.reduce<Record<string, typeof personalChores>>((acc, c) => {
    const key = c.created_by as string;
    (acc[key] ??= []).push(c);
    return acc;
  }, {});
  const creatorOf = (id: string) => state.members.find((m) => m.id === id);

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>かぞくのみまもりメンバーのお手伝い</Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={3} />
        </View>
      )}

      {loadState === "error" && (
        <ErrorState title="読み込みに失敗しました" onRetry={() => setLoadState("ready")} />
      )}

      {loadState === "ready" && Object.keys(byCreator).length === 0 && (
        <EmptyState emoji="🌱" title="まだ登録されているお手伝いがありません" />
      )}

      {loadState === "ready" && Object.keys(byCreator).length > 0 && (
        <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s3 }}>
          {Object.entries(byCreator).map(([creatorId, chores]) => {
            const creator = creatorOf(creatorId);
            return (
              <Card key={creatorId} style={styles.groupCard}>
                <Text style={theme.typography.parentBodyMedium}>{creator?.display_name ?? "みまもりメンバー"}</Text>
                <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
                  {chores.map((c) => (
                    <View key={c.id} style={styles.item}>
                      <Text style={{ fontSize: 18 }}>{c.emoji}</Text>
                      <Text style={[theme.typography.parentBody, { flex: 1, marginLeft: theme.spacing.s2 }]}>{c.title}</Text>
                      <Text style={theme.typography.parentBodyMedium}>+{c.points}pt</Text>
                    </View>
                  ))}
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <Text style={[theme.typography.parentCaption, styles.footNote]}>
        みんなの参考にどうぞ。ここから直接完了報告や編集はできません
      </Text>

      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  groupCard: {},
  item: { flexDirection: "row", alignItems: "center" },
  footNote: { marginTop: theme.spacing.s6, textAlign: "center", color: theme.colors.neutralTextSecondary },
});
