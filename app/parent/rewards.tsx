import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
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

  // [2026-08-29修正・本部長] 家族共有（scope='family'）のみ。理由は
  // app/parent/chores.tsx の同じ修正のコメントを参照（みまもりメンバーの自分専用の
  // ごほうびは保護者が編集・削除できないのに一覧へ出ていた）。
  const managed = state.rewards.filter((r) => r.scope === "family");

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
});
