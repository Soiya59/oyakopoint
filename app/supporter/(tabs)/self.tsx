import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import GachaHomeWidget from "@/components/GachaHomeWidget";
import MemberAvatar from "@/components/MemberAvatar";
import MyPointsCard from "@/components/MyPointsCard";
import { countRecentInbox } from "@/components/InboxPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useGachaProgress } from "@/hooks/useGacha";

/**
 * じぶん区画の入口（みまもりメンバー、新設・軽量）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 35.6.3節
 *
 * [2026-09-09新規追加・実装メモ.md 182章] S1みまもりホーム廃止（35章）に伴う新設画面。
 * 中身は旧`app/supporter/home.tsx`が持っていた要素（自分のポイントカード・ガチャ
 * ウィジェット・メニュータイル9項目のうち「じぶん」系6項目）をそのまま移設したもので、
 * 新しいAPIコールは発生しない（既存の`useAppData()`・`useGachaProgress()`を
 * そのまま使い回す。35.13節3参照）。
 *
 * タイルは35.4節の並び順（実測: クエスト1位→お絵かき2位→ごほうび3位→感謝ポイント
 * →きろく）のとおり。設定（S13）は35.7節決定5により末尾固定。
 */
export default function SupporterSelfScreen() {
  const { state, memberPoints } = useAppData();
  const { loadState: gachaLoadState, remaining: gachaRemaining, canDrawNow: gachaCanDrawNow } =
    useGachaProgress(state.activeParentMemberId);

  const myMember = state.members.find((m) => m.id === state.activeParentMemberId);
  const inboxCount = countRecentInbox(state, state.activeParentMemberId, Date.now() - 24 * 60 * 60 * 1000);
  const myPoints =
    memberPoints.find((m) => m.member_id === state.activeParentMemberId)?.current_points ?? 0;

  const shortcuts: { emoji: string; label: string; path: string }[] = [
    { emoji: "🧹", label: "クエスト", path: "/supporter/my-chores" },
    { emoji: "🎨", label: "お絵かき", path: "/supporter/drawing" },
    { emoji: "🎁", label: "ごほうび", path: "/supporter/rewards" },
    { emoji: "💌", label: "感謝\nポイント", path: "/supporter/gratitude" },
    { emoji: "📅", label: "きろく", path: "/supporter/history" },
    // 35.7節決定5「みまもりメンバーの設定（S13）はじぶん区画の末尾に固定配置する」。
    { emoji: "⚙️", label: "設定", path: "/supporter/settings" },
  ];

  return (
    <Screen tone="supporter">
      <View style={styles.headerRow}>
        {myMember && (
          <View style={styles.headerMe}>
            <MemberAvatar name={myMember.display_name} color={myMember.avatar_color} size={24} />
            <Text style={theme.typography.supporterTitle}>{myMember.display_name}</Text>
          </View>
        )}
        <Text style={[theme.typography.supporterTitle, styles.headerFamilyName]}>{state.family.name}</Text>
        <Pressable onPress={() => router.push("/supporter/inbox")} hitSlop={8} style={styles.bellHit}>
          <Text style={styles.notifBadge}>🔔{inboxCount}</Text>
        </Pressable>
      </View>

      <MyPointsCard tone="supporter" points={myPoints} memberId={state.activeParentMemberId} />

      <GachaHomeWidget
        tone="supporter"
        loadState={gachaLoadState}
        remaining={gachaRemaining}
        canDrawNow={gachaCanDrawNow}
        onPress={() => router.push("/supporter/gacha")}
      />

      <Text style={[theme.typography.supporterBodyMedium, styles.sectionHeading]}>じぶんのこと</Text>
      <View style={styles.grid}>
        {shortcuts.map((s) => (
          <Pressable key={s.path} onPress={() => router.push(s.path as never)} style={styles.gridItem}>
            <View style={styles.tileEmojiCircle}>
              <Text style={{ fontSize: 26 }}>{s.emoji}</Text>
            </View>
            <Text style={[theme.typography.supporterBody, styles.tileLabel]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center" },
  headerMe: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  headerFamilyName: { flex: 1, marginLeft: theme.spacing.s3 },
  bellHit: { minHeight: theme.tapTarget.supporterPrimary, justifyContent: "center", paddingLeft: theme.spacing.s2 },
  notifBadge: { fontSize: 17, fontWeight: "700" },
  sectionHeading: {
    marginTop: theme.spacing.s6,
    marginBottom: theme.spacing.s2,
    color: theme.colors.supporterAccent,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.s3,
    marginTop: theme.spacing.s2,
  },
  tileLabel: { textAlign: "center" },
  tileEmojiCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.supporterAccentSoft,
    alignItems: "center",
    justifyContent: "center",
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
