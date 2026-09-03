import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * P12 ごほうび管理一覧（スタブ／簡易実装）
 * 参照: 画面一覧・遷移図.md P12、API仕様.md 7章
 */
export default function RewardsListScreen() {
  const { state } = useAppData();

  // [2026-09-03追加] 保護者代理でのごほうび交換（P36）成功後の完了スナックバー
  // （主要画面ワイヤーフレーム.md 5.5.0節決定5・5.5.4節）。app/parent/my-rewards.tsx
  // （P15）のjustRewardId/justName/justCostと同じ仕組みに、交換対象の子の表示名
  // （justChildName）を足しただけ。完了演出画面（C11相当）は新設しない。
  const params = useLocalSearchParams<{ justRewardId?: string; justChildName?: string; justCost?: string }>();
  const [snackbarText, setSnackbarText] = useState<string | null>(null);

  useEffect(() => {
    if (params.justRewardId && params.justChildName && params.justCost) {
      setSnackbarText(`${params.justChildName}さんの代わりに交換しました -${params.justCost}pt`);
      const t = setTimeout(() => setSnackbarText(null), 1500);
      return () => clearTimeout(t);
    }
  }, [params.justRewardId, params.justChildName, params.justCost]);

  // [2026-08-29修正・本部長] 家族共有（scope='family'）のみ。理由は
  // app/parent/chores.tsx の同じ修正のコメントを参照（みまもりメンバーの自分専用の
  // ごほうびは保護者が編集・削除できないのに一覧へ出ていた）。
  const managed = state.rewards.filter((r) => r.scope === "family");
  // [2026-09-02追加・統括指示] みまもりメンバーのごほうびへの導線。統括の指摘
  // 「クエストは見守りのクエストに飛べるけど、ご褒美は飛べない」。P25画面は
  // クエストとごほうびの両方を出すのに、入口がクエスト管理（P10）にしか
  // なかった（2026-09-02、本部長がP10側だけに導線を付けたため）。
  // 表示条件はP10側と同じ（みまもりメンバーがいる家庭のみ）。
  const hasAnySupporter = state.members.some((m) => m.role === "supporter" && m.is_active);

  // [2026-08-30追加] 要件定義書07-15章・主要画面ワイヤーフレーム.md 24章（決定1・
  // 決定2）。「わたしが登録」「かぞくが登録」の2グループに分ける。判定は
  // created_by === 自分のfamily_member_id のみ（役割・人数に依存しない、07-15章前提5）。
  // 登録者不明・他の保護者の行は「かぞくが登録」側に混ぜる（07-15章4章）。
  // 一覧の各行には登録者を示す表示を一切追加しない（決定1）。P12には
  // 「終わった単発」相当の折りたたみが存在しないため決定5は適用されない。
  const myMemberId = state.activeParentMemberId;
  const mine = managed.filter((r) => r.created_by === myMemberId);
  const others = managed.filter((r) => r.created_by !== myMemberId);

  const renderRow = (r: (typeof managed)[number]) => (
    <Pressable key={r.id} onPress={() => router.push({ pathname: "/parent/reward-edit", params: { id: r.id } })}>
      <Card style={{ marginTop: theme.spacing.s3, flexDirection: "row", justifyContent: "space-between" }}>
        <Text>
          {r.emoji} {r.name}
        </Text>
        <Text style={{ color: theme.colors.neutralTextSecondary }}>{r.cost}pt</Text>
      </Card>
    </Pressable>
  );

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/home")} />
      <View style={styles.header}>
        <Text style={theme.typography.parentTitle}>ごほうび管理</Text>
        <AppButton label="＋ 新規追加" variant="secondary" onPress={() => router.push("/parent/reward-edit")} />
      </View>

      {snackbarText && (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText}>{snackbarText}</Text>
        </View>
      )}

      {mine.length > 0 && (
        <View>
          <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>わたしが登録</Text>
          {mine.map(renderRow)}
        </View>
      )}

      {others.length > 0 && (
        <View>
          <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>かぞくが登録</Text>
          {others.map(renderRow)}
        </View>
      )}

      {hasAnySupporter && (
        <Pressable
          onPress={() => router.push("/parent/supporter-chores")}
          style={{ marginTop: theme.spacing.s6 }}
          hitSlop={8}
        >
          <Card>
            <Text style={theme.typography.parentBodyMedium}>🎁 みまもりのごほうび →</Text>
            <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1 }]}>
              みまもりメンバーが登録しているごほうびを見られます。
            </Text>
          </Card>
        </Pressable>
      )}

      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/parent/home")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  // [2026-08-30追加] app/parent/chores.tsxと同じスタイル（主要画面ワイヤーフレーム.md
  // 24.0節決定3、app/parent/home.tsxのsectionHeading流用）。
  sectionHeading: {
    marginTop: theme.spacing.s6,
    marginBottom: theme.spacing.s2,
    color: theme.colors.brandPrimaryStrong,
  },
  // [2026-09-03追加] app/parent/my-rewards.tsxのスナックバーと同型。
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
