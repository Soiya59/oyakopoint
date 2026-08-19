import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * P7 ホーム（保護者ダッシュボード）
 * 参照: 画面一覧・遷移図.md P7、3.4章「保護者の日常利用」
 *
 * [2026-08-15改訂] 承認フロー廃止に伴い、「承認待ち件数バッジ」を廃止した。保護者が
 * 行う操作は「見る」「（任意で）スタンプ／コメントを贈る」の2つのみで、対応漏れを
 * 想起させる未処理バッジは表示しない（画面一覧・遷移図.md 3.4章）。代わりに
 * 直近24時間の「新着」件数（催促ではなくお知らせという位置づけ）を表示する。
 * あわせて実施履歴カレンダー（P18、要件定義書07-3章）への「きろく」ショートカットを追加した。
 */
export default function ParentHomeScreen() {
  const { state } = useAppData();
  const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
  const newCount = state.completions.filter(
    (c) => new Date(c.reported_at).getTime() >= oneDayAgoMs
  ).length;
  const recent = [...state.completions]
    .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime())
    .slice(0, 3);
  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  const shortcuts: { emoji: string; label: string; path: string }[] = [
    { emoji: "📋", label: "完了報告", path: "/parent/approvals" },
    { emoji: "📅", label: "きろく", path: "/parent/history" },
    { emoji: "🧺", label: "お手伝い", path: "/parent/chores" },
    { emoji: "🎁", label: "ごほうび", path: "/parent/rewards" },
    { emoji: "📔", label: "通帳", path: "/parent/points" },
    // [2026-08-16追加] 画面一覧・遷移図.md P7行「『じぶんのお手伝い』（→P19）・
    // 『感謝ポイント』（→P21）のショートカットを追加」に対応。
    { emoji: "🧹", label: "じぶんのお手伝い", path: "/parent/my-chores" },
    // [2026-08-18追加] ユーザーの指摘「親のコマンドでもご褒美ができるようにしたい」
    // 対応。app/parent/rewards.tsx（P12）はごほうびの管理のみのため、じぶんの
    // ポイントで交換するための別画面（app/parent/my-rewards.tsx）への導線を追加した。
    { emoji: "🎁", label: "じぶんのごほうび", path: "/parent/my-rewards" },
    { emoji: "💌", label: "感謝ポイント", path: "/parent/gratitude" },
    { emoji: "👨‍👩‍👧‍👦", label: "家族", path: "/parent/family" },
    { emoji: "⚙️", label: "設定", path: "/parent/settings" },
  ];

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>{state.family.name} の ホーム</Text>

      <Pressable onPress={() => router.push("/parent/approvals")}>
        <Card style={styles.pendingCard}>
          <Text style={theme.typography.parentBodyMedium}>完了報告</Text>
          <Text style={styles.pendingCount}>新着{newCount}件</Text>
        </Card>
      </Pressable>

      <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>
        最近の報告
      </Text>
      <View style={{ gap: theme.spacing.s2, marginTop: theme.spacing.s2 }}>
        {recent.map((c) => {
          // [2026-08-16修正・本部長] ユーザーの実操作で、P7「最近の報告」プレビューに
          // 誰の報告かが表示されておらず、P8（完了報告一覧）と体験が食い違っていることが
          // 判明した。P8と同じmemberOf() + MemberAvatarのパターンをそのまま踏襲した。
          const member = memberOf(c.reported_by);
          return (
            <Card key={c.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={24} />
                <Text style={{ marginLeft: theme.spacing.s2 }}>
                  {member?.display_name} {c.chore_emoji} {c.chore_title}
                </Text>
              </View>
              <Text style={{ color: theme.colors.neutralTextSecondary }}>
                +{c.points}pt
              </Text>
            </Card>
          );
        })}
      </View>

      <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>
        メニュー
      </Text>
      <View style={styles.grid}>
        {shortcuts.map((s) => (
          <Pressable key={s.path} onPress={() => router.push(s.path as never)} style={styles.gridItem}>
            <Text style={{ fontSize: 28 }}>{s.emoji}</Text>
            <Text style={theme.typography.parentBody}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pendingCard: {
    marginTop: theme.spacing.s4,
    backgroundColor: theme.colors.statusPendingSoft,
    borderColor: theme.colors.statusPending,
  },
  pendingCount: { fontSize: 28, fontWeight: "700", color: theme.colors.statusPending, marginTop: theme.spacing.s1 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.s3,
    marginTop: theme.spacing.s2,
  },
  gridItem: {
    width: "30%",
    minHeight: theme.tapTarget.parent + 20,
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
