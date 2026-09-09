import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import GachaHomeWidget from "@/components/GachaHomeWidget";
import MemberAvatar from "@/components/MemberAvatar";
import MyPointsCard from "@/components/MyPointsCard";
import { countRecentInbox } from "@/components/InboxPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useGachaProgress } from "@/hooks/useGacha";

/** メニュータイル1枚。labelSizeは、4列の幅(75px)に収まらないラベルだけ個別に縮めるために使う。 */
type ShortcutItem = { emoji: string; label: string; path: string; labelSize?: number };

/**
 * じぶん区画の入口（保護者）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 35章（35.1節・35.2節・35.6.2節）、
 * 実装メモ.md 187章
 *
 * [2026-09-10新規追加・実装メモ.md 187章] 保護者のタブ化（P7ホーム廃止）に伴う新設画面。
 * 旧`app/parent/home.tsx`の「じぶんのポイント」カード・ガチャウィジェット・
 * 「じぶんのこと」タイル4項目（クエスト・ごほうび・感謝ポイント・お絵かき）・
 * 「家族のこと」タイルのうちコレクション・きろくをそのまま移設した。新しいAPIコールは
 * 発生しない（既存の`useAppData()`・`useGachaProgress()`をそのまま使い回す）。
 *
 * タイルの並びは本部長依頼文の区画表の記載順（「ポイント通帳、ガチャ、自分のクエスト、
 * 自分のごほうび、お絵かき、コレクション、きろく、感謝ポイント」）のとおり、
 * クエスト→ごほうび→お絵かき→コレクション→きろく→感謝ポイントにした。旧P7ホームでは
 * クエスト・ごほうび・感謝ポイント・お絵かきが「じぶんのこと」列、コレクション・きろくが
 * 「家族のこと」列に分かれていたが、両者を1列にまとめて統合した（35章の保護者「じぶん」
 * 区画は元々1列のタイル構成のため、列を分ける理由が無くなった）。
 */
export default function ParentSelfTabScreen() {
  const { state, memberPoints } = useAppData();
  const { loadState: gachaLoadState, remaining: gachaRemaining, canDrawNow: gachaCanDrawNow } =
    useGachaProgress(state.activeParentMemberId);

  const myMember = state.members.find((m) => m.id === state.activeParentMemberId);
  const inboxCount = countRecentInbox(state, state.activeParentMemberId, Date.now() - 24 * 60 * 60 * 1000);
  const myPoints =
    memberPoints.find((m) => m.member_id === state.activeParentMemberId)?.current_points ?? 0;

  const shortcuts: ShortcutItem[] = [
    { emoji: "🧹", label: "クエスト", path: "/parent/my-chores" },
    { emoji: "🎁", label: "ごほうび", path: "/parent/my-rewards" },
    { emoji: "🎨", label: "お絵かき", path: "/parent/drawing" },
    // 「コレクション」は6文字で、4列（タイル幅75px）だと15pxのままでは折り返す
    // （旧`app/parent/home.tsx`と同じ理由でこのタイルだけ12pxに縮める）。
    { emoji: "🗄️", label: "コレクション", path: "/parent/collector-shelf", labelSize: 12 },
    { emoji: "📅", label: "きろく", path: "/parent/history" },
    // 4列（タイル幅75px）だと6文字は収まらず「感謝ポイン／ト」と割れるため明示的に改行する
    // （旧`app/parent/home.tsx`と同じ理由）。
    { emoji: "💌", label: "感謝\nポイント", path: "/parent/gratitude" },
  ];

  return (
    <Screen tone="parent">
      <View style={styles.headerRow}>
        {myMember && (
          <View style={styles.headerMe}>
            <MemberAvatar name={myMember.display_name} color={myMember.avatar_color} size={36} />
            <Text style={theme.typography.parentTitle}>{myMember.display_name}</Text>
          </View>
        )}
        <Text style={[theme.typography.parentTitle, styles.headerFamilyName]}>{state.family.name}</Text>
        <Pressable onPress={() => router.push("/parent/inbox")} hitSlop={8} style={styles.bellHit}>
          <Text style={styles.notifBadge}>🔔{inboxCount}</Text>
        </Pressable>
      </View>

      <MyPointsCard tone="parent" points={myPoints} onPress={() => router.push("/parent/points")} />

      <GachaHomeWidget
        tone="parent"
        loadState={gachaLoadState}
        remaining={gachaRemaining}
        canDrawNow={gachaCanDrawNow}
        onPress={() => router.push("/parent/gacha")}
      />

      <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>じぶんのこと</Text>
      <View style={styles.grid}>
        {shortcuts.map((s) => (
          <Pressable key={s.path} onPress={() => router.push(s.path as never)} style={styles.gridItem}>
            <View style={styles.tileEmojiCircle}>
              <Text style={{ fontSize: 26 }}>{s.emoji}</Text>
            </View>
            <Text style={[theme.typography.parentBody, styles.tileLabel, s.labelSize ? { fontSize: s.labelSize } : null]}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerMe: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  headerFamilyName: { flex: 1, marginLeft: theme.spacing.s3 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  bellHit: { minHeight: theme.tapTarget.parent, justifyContent: "center", paddingLeft: theme.spacing.s2 },
  notifBadge: { fontSize: 16, fontWeight: "700" },
  sectionHeading: {
    marginTop: theme.spacing.s6,
    marginBottom: theme.spacing.s2,
    color: theme.colors.brandPrimaryStrong,
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
    backgroundColor: theme.colors.brandPrimarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  gridItem: {
    width: "22%",
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
