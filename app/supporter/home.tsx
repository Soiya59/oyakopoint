import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * S1 みまもりホーム
 * 参照: 画面一覧・遷移図.md 2.5節S1・3.12節
 *
 * 家族の様子を一目で把握し、主要導線に飛ぶ。お手伝い管理・ポイント直接操作・
 * ごほうび管理（家族共有分）・家族管理の導線は一切表示しない（07-7章「できないこと」）。
 *
 * [2026-08-23改訂] 要件定義書07-7章4回目のスコープ変更（ユーザーの要望「いっしょに
 * やるというのはいらない」）により、家族共有choreへの参加機能（「いっしょにやる」
 * 導線）を撤去した。あわせて🤝／🎯バッジ（デザイントークン.md旧1.7節）も廃止した
 * ため、最近のようすの表示からバッジを外した。
 */
export default function SupporterHomeScreen() {
  const { state } = useAppData();
  const recent = [...state.completions]
    .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime())
    .slice(0, 3);
  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  const shortcuts: { emoji: string; label: string; path: string }[] = [
    { emoji: "👀", label: "かぞくのようす", path: "/supporter/activity" },
    { emoji: "🎯", label: "じぶんのお手伝い", path: "/supporter/my-chores" },
    { emoji: "🎁", label: "じぶんのごほうび", path: "/supporter/rewards" },
    { emoji: "📅", label: "きろく", path: "/supporter/history" },
    // [2026-08-23追加] 家族の木（07-9章、主要画面ワイヤーフレーム.md 20.6章
    // 「S1みまもりホーム内（既存のショートカットグリッドに1枠追加）」）。→S14。
    { emoji: "🌿", label: "家族の木", path: "/supporter/family-tree" },
    // [2026-08-26追加] お絵かき（07-13-2章、第2段階）。画面一覧・遷移図.md 3.15節
    // 「みまもりメンバー: [S1 みまもりホーム]のショートカット『お絵かき』 ──▶ [S18 お絵かき]」。
    { emoji: "🎨", label: "お絵かき", path: "/supporter/drawing" },
    { emoji: "⚙️", label: "設定", path: "/supporter/settings" },
  ];

  return (
    <Screen tone="supporter">
      <Text style={theme.typography.supporterTitle}>{state.family.name} の みまもり</Text>

      <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s6 }]}>最近のようす</Text>
      <View style={{ gap: theme.spacing.s2, marginTop: theme.spacing.s2 }}>
        {recent.length === 0 && (
          <Text style={[theme.typography.supporterBody, { color: theme.colors.neutralTextSecondary }]}>
            まだ完了報告がありません
          </Text>
        )}
        {recent.map((c) => {
          const member = memberOf(c.reported_by);
          return (
            <Pressable key={c.id} onPress={() => router.push("/supporter/activity")}>
              <Card tone="supporter" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                  <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={24} />
                  <Text style={{ marginLeft: theme.spacing.s2 }}>
                    {member?.display_name} {c.chore_emoji} {c.chore_title}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.neutralTextSecondary }}>+{c.points}pt</Text>
              </Card>
            </Pressable>
          );
        })}
      </View>

      <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s6 }]}>メニュー</Text>
      <View style={styles.grid}>
        {shortcuts.map((s) => (
          <Pressable key={s.path} onPress={() => router.push(s.path as never)} style={styles.gridItem}>
            <Text style={{ fontSize: 28 }}>{s.emoji}</Text>
            <Text style={theme.typography.supporterBody}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.s3,
    marginTop: theme.spacing.s2,
  },
  gridItem: {
    width: "30%",
    minHeight: theme.tapTarget.supporterPrimary + 20,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.s1,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentLg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    paddingVertical: theme.spacing.s3,
  },
});
