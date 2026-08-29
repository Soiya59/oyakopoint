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
 * C19 みまもりメンバーのおてつだい（さんこう、子ども向け）
 * 参照: 画面一覧・遷移図.md 1章C19・3.13節「かぞくのみまもりメンバーのお手伝い
 * （参考一覧）」フロー（07-7章、2026-08-22新規追加・5回目のスコープ変更）
 *
 * おじいちゃん・おばあちゃんたちが登録した自分専用のお手伝い（chore定義）を、
 * アイデアの参考として眺めるだけの画面。完了報告の実績（いつ・何ptやったか）は
 * C18側で確認できるため、本画面はchore定義そのものの参考閲覧に限定し、
 * 完了報告・編集・削除の導線は一切持たない（行のUIコンポーネント自体を
 * タップ不可の表示専用リストとして実装する）。
 *
 * [2026-08-23追加] 「ごほうびも家族に見せたい」というユーザー要望を受け、お手伝いと
 * 同じ扱いでごほうび（rewards, scope='personal'）も参考表示に加えた
 * （交換できるのは引き続き作成者本人だけ、rewards_redemptions_insert_scoped）。
 */
type LoadState = "loading" | "error" | "ready";

export default function SupporterChoresReferenceScreen() {
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
  const personalRewards = state.rewards.filter((r) => r.is_active && r.scope === "personal" && r.created_by);
  const rewardsByCreator = personalRewards.reduce<Record<string, typeof personalRewards>>((acc, r) => {
    const key = r.created_by as string;
    (acc[key] ??= []).push(r);
    return acc;
  }, {});
  const creatorOf = (id: string) => state.members.find((m) => m.id === id);

  return (
    <Screen tone="child">
      <Text style={theme.typography.childHeadline}>👀 みまもりメンバーのクエスト</Text>
      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        おじいちゃん・おばあちゃんたちの クエストを さんこうに してみよう
      </Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={3} />
        </View>
      )}

      {loadState === "error" && (
        <ErrorState tone="child" title="つうしんがおやすみ中みたい" onRetry={() => setLoadState("ready")} />
      )}

      {loadState === "ready" && Object.keys(byCreator).length === 0 && (
        <EmptyState tone="child" emoji="🌱" title="まだ とうろくされている クエストは ないよ" />
      )}

      {loadState === "ready" && Object.keys(byCreator).length > 0 && (
        <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s3 }}>
          {Object.entries(byCreator).map(([creatorId, chores]) => {
            const creator = creatorOf(creatorId);
            return (
              <Card key={creatorId} tone="child" style={styles.groupCard}>
                <Text style={theme.typography.childBody}>{creator?.display_name ?? "みまもりメンバー"}</Text>
                <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
                  {chores.map((c) => (
                    <View key={c.id} style={styles.item}>
                      <Text style={{ fontSize: 22 }}>{c.emoji}</Text>
                      <Text style={[theme.typography.childBody, { flex: 1, marginLeft: theme.spacing.s2 }]}>{c.title}</Text>
                      <Text style={theme.typography.childBody}>+{c.points}pt</Text>
                    </View>
                  ))}
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {loadState === "ready" && Object.keys(rewardsByCreator).length > 0 && (
        <>
          <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s6 }]}>🎁 みんなの ごほうび</Text>
          <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s3 }}>
            {Object.entries(rewardsByCreator).map(([creatorId, rewards]) => {
              const creator = creatorOf(creatorId);
              return (
                <Card key={creatorId} tone="child" style={styles.groupCard}>
                  <Text style={theme.typography.childBody}>{creator?.display_name ?? "みまもりメンバー"}</Text>
                  <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
                    {rewards.map((r) => (
                      <View key={r.id} style={styles.item}>
                        <Text style={{ fontSize: 22 }}>{r.emoji ?? "🎁"}</Text>
                        <Text style={[theme.typography.childBody, { flex: 1, marginLeft: theme.spacing.s2 }]}>{r.name}</Text>
                        <Text style={theme.typography.childBody}>{r.cost}pt</Text>
                      </View>
                    ))}
                  </View>
                </Card>
              );
            })}
          </View>
        </>
      )}

      <Text style={[theme.typography.childBody, styles.footNote]}>
        みんなの さんこうに どうぞ。ここから かんりょうほうこくや こうかんは できないよ
      </Text>

      <AppButton label="もどる" variant="secondary" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  groupCard: {},
  item: { flexDirection: "row", alignItems: "center" },
  footNote: { marginTop: theme.spacing.s6, textAlign: "center", color: theme.colors.neutralTextSecondary },
});
