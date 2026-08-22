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
 * S3 一緒にやることリスト（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S3・3.12節、API仕様.md 3b章「一覧上の区別」
 *
 * 家族の「誰でも実行可」（assigned_to=null）なお手伝い（scope='family'）に限定した
 * 一覧を表示する。この絞り込みはRLSでは強制されないため、クライアント側の責務として
 * ここでフィルタする（スキーマ設計.sql 19章「設計判断」・API仕様.md 3b章参照）。
 * app/parent/my-chores.tsx（P19）とほぼ同じ構成だが、みまもりメンバー向けトーン
 * （supporterAccent、🤝バッジ）に差し替えた。3回目のスコープ変更により通常どおり
 * ポイントを表示・付与する。
 */
type LoadState = "loading" | "error" | "ready";

export default function SharedChoresScreen() {
  const { state, isChoreLimitReached } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const params = useLocalSearchParams<{ justChoreId?: string; justTitle?: string; justPoints?: string }>();
  const [snackbar, setSnackbar] = useState<{ choreId: string; title: string; points: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setLoadState("ready"), 350);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (params.justChoreId && params.justTitle && params.justPoints) {
      setSnackbar({ choreId: params.justChoreId, title: params.justTitle, points: params.justPoints });
      const t = setTimeout(() => setSnackbar(null), 1500);
      return () => clearTimeout(t);
    }
  }, [params.justChoreId, params.justTitle, params.justPoints]);

  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const sharedChores = state.chores.filter((c) => c.is_active && c.scope === "family" && c.assigned_to === null);

  return (
    <Screen tone="supporter">
      <Text style={theme.typography.supporterTitle}>🤝 いっしょにやることリスト</Text>
      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        誰でもできる家族のお手伝いです。やってみると、通常どおりポイントがもらえます。
      </Text>

      {snackbar && (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText}>いっしょにやりました +{snackbar.points}pt</Text>
        </View>
      )}

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={4} />
        </View>
      )}

      {loadState === "error" && <ErrorState title="読み込みに失敗しました" onRetry={() => setLoadState("ready")} />}

      {loadState === "ready" && sharedChores.length === 0 && (
        <EmptyState emoji="🧺" title="いまは誰でも実行できるお手伝いがありません" />
      )}

      {loadState === "ready" && sharedChores.length > 0 && (
        <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
          {sharedChores.map((c) => {
            const done = me ? isChoreLimitReached(c, me.id) : false;
            const highlighted = snackbar?.choreId === c.id;
            return (
              <Pressable
                key={c.id}
                disabled={done || !me}
                onPress={() => router.push({ pathname: "/supporter/shared-chore-report", params: { choreId: c.id } })}
              >
                <Card
                  tone="supporter"
                  style={highlighted ? { ...styles.row, backgroundColor: theme.colors.supporterAccentSoft, borderColor: theme.colors.supporterAccent } : styles.row}
                >
                  <Text style={{ fontSize: 20 }}>{c.emoji}</Text>
                  <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s3 }]}>{c.title}</Text>
                  {done ? (
                    <Text style={styles.doneLabel}>きょうはやったよ</Text>
                  ) : (
                    <>
                      <Text style={theme.typography.supporterBodyMedium}>+{c.points}pt</Text>
                      <Text style={styles.chevron}>›</Text>
                    </>
                  )}
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}

      <AppButton tone="supporter" label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  doneLabel: { color: theme.colors.neutralTextSecondary },
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
