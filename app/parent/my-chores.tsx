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
 * P19 じぶんのお手伝い一覧（保護者、要件定義書07-4章「親の完了報告」）
 * 参照: 主要画面ワイヤーフレーム.md 9.1章、画面一覧・遷移図.md P19・3.9章
 *
 * 自分が担当（assigned_to=自分）、または誰でも実行可（assigned_to=NULL）なchoreを
 * 行形式のリストで一覧する。C5の保護者版だが、絵文字グリッド・達成演出は使わず
 * 「淡々とした記録」トーン（9.0決定1）にする。
 *
 * API仕様.md 4b章のとおり、chore/chore_completionsのAPI自体はC5/C6と全く同じもの
 * （スキーマ設計.sql 12章「構造変更なし」）。choreの取得クエリはuseAppData()の
 * 既存state.choresをそのまま流用し、reported_by=自分のmember_idでREPORT_COMPLETIONを
 * dispatchするだけでよい。
 */
type LoadState = "loading" | "error" | "ready";

export default function ParentMyChoresScreen() {
  const { state, isChoreLimitReached } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  // [2026-08-16] P20からの復帰時のみ一時的に表示する、控えめな確認表示（スナックバー）。
  // 主要画面ワイヤーフレーム.md 9.2章「送信成功時の表現（新規画面を作らない）」対応。
  // ナビゲーションパラメータを「一度きりの合図」として使うパターンは、既存のC6→C7
  // （choreTitle/points）やP15（stepパラメータ）と同じ設計方針を踏襲した。
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
  const myChores = state.chores.filter(
    (c) => c.is_active && (c.assigned_to === null || c.assigned_to === me?.id)
  );

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>じぶんのお手伝い</Text>

      {/* 送信成功後の控えめな確認表示（1.5秒程度で自動的に消える。主要画面ワイヤーフレーム.md
          9.2章「新しい画面へは遷移せず、[P19]へ戻り控えめな確認表示」）。ScrollView内でも
          位置がずれないよう、絶対配置のスナックバーではなくインラインのバナーとして表現した
          （設計書に固定位置の指定は無いため、Screenコンポーネントの構造に合わせた実装判断）。 */}
      {snackbar && (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText}>きろくしました +{snackbar.points}pt</Text>
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

      {loadState === "ready" && myChores.length === 0 && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <EmptyState emoji="🧺" title="じぶんの担当のお手伝いはまだ登録されていません" />
          <AppButton
            label="お手伝い管理で追加する"
            variant="secondary"
            style={{ marginTop: theme.spacing.s2 }}
            onPress={() => router.push("/parent/chore-edit")}
          />
        </View>
      )}

      {loadState === "ready" && myChores.length > 0 && (
        <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
          {myChores.map((c) => {
            const done = me ? isChoreLimitReached(c, me.id) : false;
            const highlighted = snackbar?.choreId === c.id;
            return (
              <Pressable
                key={c.id}
                disabled={done || !me}
                onPress={() => router.push({ pathname: "/parent/my-chore-report", params: { choreId: c.id } })}
              >
                <Card style={{ ...styles.row, ...(highlighted ? styles.rowHighlighted : null) }}>
                  <Text style={{ fontSize: 20 }}>{c.emoji}</Text>
                  <Text style={[theme.typography.parentBody, { flex: 1, marginLeft: theme.spacing.s3 }]}>
                    {c.title}
                  </Text>
                  {done ? (
                    <Text style={styles.doneLabel}>きろくずみ</Text>
                  ) : (
                    <>
                      <Text style={theme.typography.parentBodyMedium}>+{c.points}pt</Text>
                      <Text style={styles.chevron}>›</Text>
                    </>
                  )}
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* [2026-08-16修正・本部長] ユーザーが実際に操作した際、ホームへ戻る手段が
          この画面に無いことを発見した。既存のP10（app/parent/chores.tsx）と同じ
          「ホームへ戻る」ボタン（ghost variant・router.back()）のパターンをそのまま
          踏襲した。ワイヤーフレームには画面下部の戻る導線までは明記されていないが、
          既存の他の一覧画面との一貫性を優先した。 */}
      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  rowHighlighted: { backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
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
