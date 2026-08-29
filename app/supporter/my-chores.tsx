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
 * S5 自分専用のお手伝い一覧（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S5、API仕様.md 3b章
 *
 * 自分が登録した自分専用chore（scope='personal', created_by=自分）を一覧し、
 * 新規登録（→S6）・完了報告（→S7）・編集（→S6）への入口にする。
 *
 * [2026-08-23改訂・5回目のスコープ変更] 自分専用choreは家族全員に公開される方針へ
 * 反転したため（`chores_select_scoped`は`family_id`一致のみで判定する）、
 * `state.chores`には他のみまもりメンバーが登録した自分専用choreも含まれるように
 * なった。ユーザーの発言「個人の登録したものが上位に登場し、他のお手伝いも参考に
 * できる」を踏まえ、上段＝自分の登録分（フル操作）、下段＝他のみまもりメンバーの
 * 登録分（登録者名付き・閲覧専用、編集・完了報告の導線なし）という2段構成にした
 * （画面一覧・遷移図.md S5行）。編集・完了報告できるのはクライアント側の表示制御では
 * なく、`chores_write_personal_by_creator`・`chore_completions_insert_self`RLSに
 * よって作成者本人に限定される。
 */
export default function SupporterMyChoresScreen() {
  const { state, isChoreLimitReached, isOneOffFinished } = useAppData();
  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  // [2026-08-27修正・本部長] 実施済みの「単発」は除く（app/child/(tabs)/home.tsxと同じ理由）。
  // 自分の分も他の人の分も、役目を終えた単発は一覧から外す。
  const personalChores = state.chores.filter(
    (c) => c.is_active && c.scope === "personal" && !isOneOffFinished(c)
  );
  const myChores = personalChores.filter((c) => c.created_by === me?.id);
  const othersChores = personalChores.filter((c) => c.created_by && c.created_by !== me?.id);

  const othersByCreator = othersChores.reduce<Record<string, typeof othersChores>>((acc, c) => {
    const key = c.created_by as string;
    (acc[key] ??= []).push(c);
    return acc;
  }, {});
  const creatorOf = (id: string) => state.members.find((m) => m.id === id);

  return (
    <Screen tone="supporter">
      <View style={styles.header}>
        <Text style={theme.typography.supporterTitle}>🎯 じぶんのクエスト</Text>
        <AppButton tone="supporter" label="＋ 新規" variant="secondary" onPress={() => router.push("/supporter/chore-edit")} />
      </View>
      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        ダイエット・運動・勉強など、じぶんの目標を登録できます。完了報告には通常どおりポイントが付きます。ここに登録したクエストは家族みんなに見えます。
      </Text>

      {myChores.length === 0 && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <EmptyState emoji="🎯" title="まだじぶんのクエストが登録されていません" />
        </View>
      )}

      {myChores.length > 0 && (
        <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
          {myChores.map((c) => {
            const done = me ? isChoreLimitReached(c, me.id) : false;
            return (
              <Card key={c.id} tone="supporter" style={{ ...styles.row, backgroundColor: theme.colors.supporterAccentSoft, borderColor: theme.colors.supporterAccent }}>
                <Pressable
                  disabled={done || !me}
                  onPress={() => router.push({ pathname: "/supporter/chore-report", params: { choreId: c.id } })}
                  style={styles.rowMain}
                >
                  <Text style={{ fontSize: 20 }}>{c.emoji}</Text>
                  <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s3 }]}>{c.title}</Text>
                  {done ? (
                    <Text style={styles.doneLabel}>きろくずみ</Text>
                  ) : (
                    <Text style={theme.typography.supporterBodyMedium}>+{c.points}pt</Text>
                  )}
                </Pressable>
                <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s2 }}>
                  <Text style={styles.publicLabel}>👀 家族に公開中</Text>
                  <Text style={{ flex: 1 }} />
                  <Pressable onPress={() => router.push({ pathname: "/supporter/chore-edit", params: { id: c.id } })}>
                    <Text style={styles.editLink}>編集する</Text>
                  </Pressable>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {Object.keys(othersByCreator).length > 0 && (
        <>
          <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s6 }]}>
            かぞくのほかのみまもりメンバーのクエスト
          </Text>
          <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
            みんなの参考にどうぞ。ここから直接完了報告や編集はできません。
          </Text>
          <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
            {Object.entries(othersByCreator).map(([creatorId, chores]) => {
              const creator = creatorOf(creatorId);
              return (
                <Card key={creatorId} tone="supporter" style={styles.refRow}>
                  <Text style={theme.typography.supporterBodyMedium}>{creator?.display_name ?? "みまもりメンバー"}</Text>
                  <View style={{ marginTop: theme.spacing.s1, gap: theme.spacing.s1 }}>
                    {chores.map((c) => (
                      <View key={c.id} style={styles.refItem}>
                        <Text style={{ fontSize: 16 }}>{c.emoji}</Text>
                        <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s2 }]}>{c.title}</Text>
                        <Text style={theme.typography.supporterCaption}>+{c.points}pt</Text>
                      </View>
                    ))}
                  </View>
                </Card>
              );
            })}
          </View>
        </>
      )}

      <AppButton tone="supporter" label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  row: {},
  rowMain: { flexDirection: "row", alignItems: "center" },
  doneLabel: { color: theme.colors.neutralTextSecondary },
  editLink: { color: theme.colors.supporterAccent, fontWeight: "700" },
  publicLabel: { color: theme.colors.neutralTextSecondary, fontSize: 12 },
  refRow: { backgroundColor: theme.colors.neutralSurface },
  refItem: { flexDirection: "row", alignItems: "center" },
});
