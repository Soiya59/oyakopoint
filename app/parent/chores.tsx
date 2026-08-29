import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import type { Chore } from "@/types/domain";

/**
 * P10 お手伝い管理一覧（スタブ／簡易実装）
 * 参照: 画面一覧・遷移図.md P10、API仕様.md 3章
 *
 * [2026-08-27追加・本部長] 実施済みの「単発」を通常一覧から折りたたみセクションへ移した。
 * ユーザーの指摘「単発が同じ感じで残り続けるので見にくい」への対応。
 * 単発のchoreには「終わり」という状態が無く、実施後も is_active=true のまま繰り返し系と
 * 同じ見た目で並び続けていた（本番でも単発4件すべてが完了済みのまま、最長12日間残っていた）。
 * 判定は src/data/store.tsx の isOneOffFinished に集約し、子どもホームと同じ基準を使う。
 * DBは変更していないので、記録を消さない限りこの状態が勝手に戻ることはない。
 */
export default function ChoresListScreen() {
  const { state, isOneOffFinished } = useAppData();
  const [finishedOpen, setFinishedOpen] = useState(false);

  const active = state.chores.filter((c) => !isOneOffFinished(c));
  const finished = state.chores.filter((c) => isOneOffFinished(c));

  const renderRow = (c: Chore, dimmed: boolean) => (
    <Pressable key={c.id} onPress={() => router.push({ pathname: "/parent/chore-edit", params: { id: c.id } })}>
      <Card
        style={{
          marginTop: theme.spacing.s3,
          flexDirection: "row",
          justifyContent: "space-between",
          ...(dimmed ? { opacity: 0.6 } : null),
        }}
      >
        <Text>
          {c.emoji} {c.title}
        </Text>
        <Text style={{ color: theme.colors.neutralTextSecondary }}>
          {c.points}pt {c.is_repeatable ? `・1日${c.daily_limit ?? "∞"}回` : dimmed ? "・単発（済）" : "・単発"}
        </Text>
      </Card>
    </Pressable>
  );

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/home")} />
      <View style={styles.header}>
        <Text style={theme.typography.parentTitle}>クエスト管理</Text>
        <AppButton label="＋ 新規追加" variant="secondary" onPress={() => router.push("/parent/chore-edit")} />
      </View>

      {active.map((c) => renderRow(c, false))}

      {finished.length > 0 && (
        <View style={{ marginTop: theme.spacing.s6 }}>
          {/* 折りたたみ。既定は閉じておき、必要なときだけ開いて内容を確認・編集できるようにする。 */}
          <Pressable onPress={() => setFinishedOpen((v) => !v)} style={styles.finishedToggle} hitSlop={8}>
            <Text style={theme.typography.parentBodyMedium}>
              {finishedOpen ? "▾" : "▸"} 終わった単発のクエスト（{finished.length}）
            </Text>
          </Pressable>
          {!finishedOpen && (
            <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1 }]}>
              一度実施されたので、子どもの画面にも表示されなくなっています。
            </Text>
          )}
          {finishedOpen && finished.map((c) => renderRow(c, true))}
        </View>
      )}

      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/parent/home")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  finishedToggle: { paddingVertical: theme.spacing.s2 },
});
