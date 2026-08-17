import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * P12 ごほうび管理一覧（スタブ／簡易実装）
 * 参照: 画面一覧・遷移図.md P12、API仕様.md 7章
 */
export default function RewardsListScreen() {
  const { state } = useAppData();

  return (
    <Screen tone="parent">
      <View style={styles.header}>
        <Text style={theme.typography.parentTitle}>ごほうび管理</Text>
        <AppButton label="＋ 新規追加" variant="secondary" onPress={() => router.push("/parent/reward-edit")} />
      </View>
      {state.rewards.map((r) => (
        <Pressable key={r.id} onPress={() => router.push({ pathname: "/parent/reward-edit", params: { id: r.id } })}>
          <Card style={{ marginTop: theme.spacing.s3, flexDirection: "row", justifyContent: "space-between" }}>
            <Text>
              {r.emoji} {r.name}
            </Text>
            <Text style={{ color: theme.colors.neutralTextSecondary }}>{r.cost}pt</Text>
          </Card>
        </Pressable>
      ))}
      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
