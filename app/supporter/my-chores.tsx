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
 * 新規登録（→S6）・完了報告（→S7）・編集（→S6）への入口にする。RLS
 * （chores_select_scoped）により他人のscope='personal'行はそもそも取得できないため、
 * クライアント側のフィルタは`created_by`一致の確認のみでよい。
 */
export default function SupporterMyChoresScreen() {
  const { state, isChoreLimitReached } = useAppData();
  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const myChores = state.chores.filter((c) => c.is_active && c.scope === "personal" && c.created_by === me?.id);

  return (
    <Screen tone="supporter">
      <View style={styles.header}>
        <Text style={theme.typography.supporterTitle}>🎯 じぶんのお手伝い</Text>
        <AppButton tone="supporter" label="＋ 新規" variant="secondary" onPress={() => router.push("/supporter/chore-edit")} />
      </View>
      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        ダイエット・運動・勉強など、じぶんの目標を登録できます。完了報告には通常どおりポイントが付きます。
      </Text>

      {myChores.length === 0 && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <EmptyState emoji="🎯" title="まだじぶんのお手伝いが登録されていません" />
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
                  {!c.is_shared_with_family && <Text style={styles.privateLabel}>🔒 非公開</Text>}
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
  privateLabel: { color: theme.colors.neutralTextSecondary, fontSize: 12 },
});
