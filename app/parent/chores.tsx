import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * P10 お手伝い管理一覧（スタブ／簡易実装）
 * 参照: 画面一覧・遷移図.md P10、API仕様.md 3章
 */
export default function ChoresListScreen() {
  const { state } = useAppData();

  return (
    <Screen tone="parent">
      <View style={styles.header}>
        <Text style={theme.typography.parentTitle}>お手伝い管理</Text>
        <AppButton label="＋ 新規追加" variant="secondary" onPress={() => router.push("/parent/chore-edit")} />
      </View>
      {state.chores.map((c) => (
        <Pressable key={c.id} onPress={() => router.push({ pathname: "/parent/chore-edit", params: { id: c.id } })}>
          <Card style={{ marginTop: theme.spacing.s3, flexDirection: "row", justifyContent: "space-between" }}>
            <Text>
              {c.emoji} {c.title}
            </Text>
            <Text style={{ color: theme.colors.neutralTextSecondary }}>
              {c.points}pt {c.is_repeatable ? `・1日${c.daily_limit ?? "∞"}回` : "・単発"}
            </Text>
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
