import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import ChildTabHeader from "@/components/ChildTabHeader";
import { countRecentInbox } from "@/components/InboxPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/** タイル1枚。 */
type ShortcutItem = { emoji: string; label: string; path: string };

/**
 * じぶん区画の入口（子ども、新設・軽量）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 36章（36.5.3節）、
 * 開発部/成果物/実装メモ.md 188章
 *
 * [2026-09-10新規追加・実装メモ.md 188章] 子ども下部タブ4区画化に伴う新設タブ。
 * 保護者・みまもりメンバーの「じぶん」入口（`app/parent/(tabs)/self.tsx`・
 * `app/supporter/(tabs)/self.tsx`）と同じ作り方（残高カード＋タイル一覧）にした。
 * 新しいAPIコールは発生しない（既存の`useAppData()`をそのまま使い回す）。
 *
 * 上部の🌟残高カードは、既存の保護者・みまもり向け`MyPointsCard`とは見た目が異なる
 * （「さいきん: +◯pt「◯◯」」という直近の実績を添える、36.5.3節ワイヤーフレーム）。
 * `MyPointsCard`は`tone: "parent" | "supporter"`のみを受け付け子ども向けの表現を
 * 持たないため、既存部品を無理に流用せず、子ども向けの表現（`childHeadline`・
 * 「いま◯pt」という既存の言い回し、`app/child/(tabs)/points.tsx`と同じ表記）で
 * このファイル内に直接実装した。タップで`/child/points`（じぶんの通帳本体）へ。
 *
 * タイルの並びは本部長依頼文の区画表のとおり「ごほうび→メダル→おえかき→
 * コレクション→きろく」。**メダル**は、`app/child/rewards.tsx`（旧C9）にあった
 * 「🪙 メダルを かいに いく →」導線（2026-09-07追加・実装メモ144章、2026-09-08に
 * 絵文字を🪙へ統一・実装メモ166章）を、ここへ独立したタイルとして移設したもの
 * （統括指示「メダルもごほうびから出してほしい。ごほうびとメダルの両方がじぶんに
 * 並ぶ感じ」、36.0節本部長訂正・36.2節）。遷移先URL（`/child/sticker-shop`）・
 * 画面自体は変更していない。
 *
 * 感謝ポイント（C16/C17）はタイルとして並べない。C8内の「💌ありがとうをおくる」
 * ボタン経由のまま変更しない（36.5.3節「気が向いたときだけ使う任意機能はタブ相当の
 * 目立つ場所に置かない」という既存原則の維持）。
 */
export default function ChildSelfTabScreen() {
  const { state, memberPoints, fullLedger } = useAppData();
  const me = state.members.find((m) => m.id === state.activeChildMemberId)!;
  const inboxCount = countRecentInbox(state, me.id, Date.now() - 24 * 60 * 60 * 1000);
  const balance = memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0;
  const latestEntry = fullLedger(me.id)[0] ?? null;

  const shortcuts: ShortcutItem[] = [
    { emoji: "🎁", label: "ごほうび", path: "/child/rewards" },
    { emoji: "🪙", label: "メダル", path: "/child/sticker-shop" },
    { emoji: "🎨", label: "おえかき", path: "/child/drawing" },
    { emoji: "🗄️", label: "コレクション", path: "/child/collector-shelf" },
    { emoji: "📅", label: "きろく", path: "/child/history" },
  ];

  return (
    <Screen tone="child">
      <ChildTabHeader inboxCount={inboxCount} />

      <Pressable onPress={() => router.push("/child/points")}>
        <Card tone="child" style={styles.balanceCard}>
          <View style={styles.balanceRow}>
            <Text style={theme.typography.childHeadline}>🌟 いま {balance}pt</Text>
            <Text style={styles.chevron}>›</Text>
          </View>
          {latestEntry && (
            <Text style={[theme.typography.childBody, styles.recentText]}>
              さいきん: {latestEntry.kind === "spend" ? "-" : "+"}
              {latestEntry.points}pt「{latestEntry.label}」
            </Text>
          )}
        </Card>
      </Pressable>

      <Text style={[theme.typography.childBody, styles.sectionHeading]}>じぶんのこと</Text>
      <View style={styles.grid}>
        {shortcuts.map((s) => (
          <Pressable key={s.path} onPress={() => router.push(s.path as never)} style={styles.gridItem}>
            <View style={styles.tileEmojiCircle}>
              <Text style={{ fontSize: 26 }}>{s.emoji}</Text>
            </View>
            <Text style={[theme.typography.childBody, styles.tileLabel]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceCard: { marginTop: theme.spacing.s3 },
  balanceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chevron: { fontSize: 24, color: theme.colors.neutralTextSecondary },
  recentText: { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary },
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
    width: "30%",
    minHeight: theme.tapTarget.child + 20,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.s1,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    paddingVertical: theme.spacing.s3,
  },
});
