import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import GachaHomeWidget from "@/components/GachaHomeWidget";
import ParentTabHeader from "@/components/ParentTabHeader";
import MemberAvatar from "@/components/MemberAvatar";
import MyPointsCard from "@/components/MyPointsCard";
import { countRecentInbox } from "@/components/InboxPanel";
import { useUnreadSince } from "@/hooks/useLastSeen";
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
  const { state, memberPoints, memberAvatars } = useAppData();
  const { loadState: gachaLoadState, remaining: gachaRemaining, canDrawNow: gachaCanDrawNow } =
    useGachaProgress(state.activeParentMemberId);

  const myMember = state.members.find((m) => m.id === state.activeParentMemberId);
  const inboxSince = useUnreadSince("inbox", state.activeParentMemberId);
  const inboxCount = countRecentInbox(state, state.activeParentMemberId, inboxSince);
  const myPoints =
    memberPoints.find((m) => m.member_id === state.activeParentMemberId)?.current_points ?? 0;

  // [2026-09-11並び替え・統括指示] 並びは統括の指定どおり
  // クエスト→ごほうび→メダル→お絵かき／コレクション→感謝ポイント→きろく→通帳。
  // （4列なので1行目・2行目がそれぞれこの並びになる）
  const shortcuts: ShortcutItem[] = [
    { emoji: "🧹", label: "クエスト", path: "/parent/my-chores" },
    { emoji: "🎁", label: "ごほうび", path: "/parent/my-rewards" },
    // [2026-09-11追加・統括指示「保護者やみまもりでもメダルを追加してほしい」]
    // 画面（/parent/sticker-shop）は2026-09-07から3ロールとも存在するが、タイルが
    // 無く、コレクション画面かごほうび画面の奥からしか行けなかった。通帳（下の行）と
    // 同じ取りこぼし。子どもの「じぶん」タブと同じ🪙・同じ呼び名にそろえる。
    { emoji: "🪙", label: "メダル", path: "/parent/sticker-shop" },
    { emoji: "🎨", label: "お絵かき", path: "/parent/drawing" },
    // 「コレクション」は6文字で、4列（タイル幅75px）だと15pxのままでは折り返す
    // （旧`app/parent/home.tsx`と同じ理由でこのタイルだけ12pxに縮める）。
    { emoji: "🗄️", label: "コレクション", path: "/parent/collector-shelf", labelSize: 12 },
    // 4列（タイル幅75px）だと6文字は収まらず「感謝ポイン／ト」と割れるため明示的に改行する
    // （旧`app/parent/home.tsx`と同じ理由）。
    { emoji: "💌", label: "感謝\nポイント", path: "/parent/gratitude" },
    { emoji: "📅", label: "きろく", path: "/parent/history" },
    // [2026-09-10追加・統括指示「通帳をじぶんにいれてほしい」] 187章のタブ化で
    // 12タイルのうち通帳の1枚だけが落ちていた。上の「じぶんのポイント」カードを
    // 押せば通帳へ行けるが、**タイルとしては消えていた**ため戻す。
    { emoji: "📔", label: "通帳", path: "/parent/points" },
  ];

  return (
    <Screen tone="parent">
      {/* [2026-09-10・本部長／軽微変更ルート] 共通ヘッダーに差し替えた。統括の実機確認
          「じぶんとかんりの左上のアイコンから、子供モードに飛べない」。187章のタブ化で
          「かぞく」タブにだけ子どもモードへの導線が付いていて、ここでは絵が置かれて
          いるだけだった。**同じ見た目なのに押せたり押せなかったりする**のは最も
          紛らわしいので、4タブとも同じ部品を使う。 */}
      <ParentTabHeader inboxCount={inboxCount} />

      {/* [2026-09-11追加・要件定義書07-27章 決定9、主要画面ワイヤーフレーム.md 43.2節
          決定9・11] アバターを自分で描いた絵にできるようにする機能の入口
          （自分の分。`family.tsx`側の代理入口〈決定10〕とは別に、こちらからも
          自分自身のP38〈`member-avatar`〉へ到達できる、決定11）。 */}
      {myMember && (
        <Pressable onPress={() => router.push({ pathname: "/parent/member-avatar", params: { memberId: myMember.id, displayName: myMember.display_name } })}>
          <Card style={styles.avatarCard}>
            <MemberAvatar name={myMember.display_name} color={myMember.avatar_color} size={64} lineData={memberAvatars[myMember.id]} />
            <Text style={theme.typography.parentBody}>{myMember.display_name}</Text>
            <Text style={[theme.typography.parentBody, styles.avatarLink]}>
              {memberAvatars[myMember.id] ? "アバターを描きなおす →" : "アバターを描く →"}
            </Text>
          </Card>
        </Pressable>
      )}

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
  avatarCard: { marginTop: theme.spacing.s3, alignItems: "center", gap: theme.spacing.s1 },
  avatarLink: { color: theme.colors.brandPrimaryStrong },
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
