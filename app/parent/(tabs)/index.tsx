import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import MemberAvatar from "@/components/MemberAvatar";
import { countRecentInbox } from "@/components/InboxPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { formatDateTimeShort } from "@/lib/calendarDates";
import { useFamilyHomeCard } from "@/hooks/useFamilyBoard";

/**
 * かぞく区画の入口（保護者。旧P7ホームの「まとめ」要素のうち家族向けの部分を吸収）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 35章（35.1節・35.6.1節）、
 * 実装メモ.md 187章
 *
 * [2026-09-10新規追加・実装メモ.md 187章] 保護者のタブ化（P7ホーム廃止）に伴う新設画面。
 * みまもりメンバー（`app/supporter/(tabs)/family.tsx`、実装メモ182・183・186章）と
 * 同じ作り方で、旧`app/parent/home.tsx`から「かぞく」区画に属する要素だけを移設した。
 * - ヘッダー（アバター＋自分の名前・タップで子ども選択画面へ／家族名／🔔）
 * - 家族の掲示板カード
 * - 完了報告（新着◯件）カード → `/parent/approvals`
 * - 最近の報告（5件）
 * ポイント通帳・家族の木ミニウィジェット・ガチャは、それぞれ「じぶん」「木」タブへ
 * 移設したためここには置かない（本部長指示の区画表どおり）。
 *
 * **最近の報告は3件→5件に変更した。** 旧P7ホームは`slice(0, 3)`だったが、本部長の
 * 依頼文にある区画表が「最近の報告5件」と明記しており、みまもりの「かぞく」タブ
 * （実装メモ183章、`completions.slice(0, 5)`）に揃える指示と判断した。表示件数を
 * 増やす以外の変更（並び順・スタンプ等の付与）はしていない。5件を超える分は
 * 従来どおり「完了報告」カードから`/parent/approvals`（全件・リアクション可）で見られる。
 *
 * **ファイル名を`index.tsx`にした理由（`family.tsx`にしなかった理由）。**
 * みまもりでは「かぞく」タブのファイル名は`family.tsx`（→`/supporter/family`）だが、
 * 保護者では`app/parent/family.tsx`が既にP14「家族の管理」（旧「設定」統合先、
 * `/parent/family`）として存在しており、同名にすると同一URLの二重定義になる
 * （expo-routerの`(tabs)`はURLセグメントを追加しないグループのため、
 * `app/parent/(tabs)/family.tsx`と`app/parent/family.tsx`はどちらも`/parent/family`に
 * 解決してしまう）。既存のP14（家族の管理、多数の画面から参照済み）を動かすより、
 * 新設側のファイル名を変える方が影響範囲が小さいと判断し、`index.tsx`
 * （`(tabs)`グループの既定ルート、`app/index.tsx`が`/`に解決するのと同じ仕組みで
 * `/parent`に解決する）を採用した。かんりタブも同様の理由で`manage.tsx`
 * （→`/parent/manage`）にした（`app/parent/(tabs)/manage.tsx`参照）。
 *
 * 旧`app/parent/home.tsx`（`/parent/home`）は`<Redirect href="/parent" />`の
 * スタブとして残し、外部からの古いリンクを生かした。アプリ内の遷移コードは
 * 本改修ですべて`/parent`へ直接書き換えている（`grep -rn '"/parent/home"' app/ src/`が
 * 0件であることを確認済み、実装メモ187章参照）。
 */
export default function ParentFamilyTabScreen() {
  const { state } = useAppData();

  const { loadState: cardLoadState, card } = useFamilyHomeCard(state.family.id);
  const cardMessage =
    cardLoadState === "error"
      ? "家族の掲示板は、また後で見てみてね"
      : cardLoadState === "loading"
      ? null
      : card?.message ?? "家族の掲示板は、また後で見てみてね";
  const cardAuthorName =
    card?.source === "board_post"
      ? state.members.find((m) => m.id === card.board_post_author_member_id)?.display_name ?? null
      : null;
  const cardExcerpt =
    cardMessage !== null && cardMessage.length > 40 ? `${cardMessage.slice(0, 40)}…` : cardMessage;
  const cardTime =
    card?.source === "board_post" && card.board_post_created_at
      ? new Date(card.board_post_created_at).toLocaleString("ja-JP", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
  const inboxCount = countRecentInbox(state, state.activeParentMemberId, oneDayAgoMs);
  const newCount = state.completions.filter(
    (c) => new Date(c.reported_at).getTime() >= oneDayAgoMs
  ).length;
  // [2026-09-10・実装メモ187章] 「最近の報告5件」（本部長指示の区画表どおり。旧P7は3件だった）。
  const recent = [...state.completions]
    .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime())
    .slice(0, 5);
  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  // [旧app/parent/home.tsxからそのまま移設・実装メモ92.2章/108章/167章] 左上の
  // 「いま誰として使っているか」。タップで子ども選択画面へ（子どもが0人なら非タップ）。
  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const childProfiles = state.members
    .filter((m) => m.is_active && m.role === "child")
    .map((m) => ({ member_id: m.id, display_name: m.display_name, avatar_color: m.avatar_color }));
  const goToChildSwitch = () =>
    router.push({
      pathname: "/child-auth/profile-select",
      params: {
        inviteCode: state.family.invite_code,
        childrenJson: JSON.stringify(childProfiles),
      },
    });

  return (
    <Screen tone="parent">
      <View style={styles.headerRow}>
        {me &&
          (childProfiles.length > 0 ? (
            <Pressable style={styles.headerMe} onPress={goToChildSwitch} hitSlop={8}>
              <MemberAvatar name={me.display_name} color={me.avatar_color} size={36} />
              <Text style={theme.typography.parentTitle}>{me.display_name}</Text>
            </Pressable>
          ) : (
            <View style={styles.headerMe}>
              <MemberAvatar name={me.display_name} color={me.avatar_color} size={36} />
              <Text style={theme.typography.parentTitle}>{me.display_name}</Text>
            </View>
          ))}
        <Text style={[theme.typography.parentTitle, styles.headerFamilyName]}>{state.family.name}</Text>
        <Pressable onPress={() => router.push("/parent/inbox")} hitSlop={8} style={styles.bellHit}>
          <Text style={styles.notifBadge}>🔔{inboxCount}</Text>
        </Pressable>
      </View>

      <Pressable disabled={cardLoadState === "error"} onPress={() => router.push("/parent/family-board")}>
        <Card style={{ marginTop: theme.spacing.s4 }}>
          <View style={styles.cardHeaderRow}>
            <Text style={theme.typography.parentBodyMedium}>家族の掲示板</Text>
            {cardLoadState !== "error" && <Text style={theme.typography.parentBodyMedium}>›</Text>}
          </View>
          {cardMessage === null ? (
            <View style={styles.digestSkeleton} />
          ) : (
            <>
              {cardAuthorName !== null && (
                <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s2 }]}>{cardAuthorName}</Text>
              )}
              <Text style={{ marginTop: theme.spacing.s1 }}>{cardExcerpt}</Text>
              {cardTime !== null && (
                <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
                  {cardTime}
                </Text>
              )}
            </>
          )}
        </Card>
      </Pressable>

      <Pressable onPress={() => router.push("/parent/approvals")}>
        <Card style={styles.pendingCard}>
          <Text style={theme.typography.parentBodyMedium}>完了報告</Text>
          <Text style={styles.pendingCount}>新着{newCount}件</Text>
        </Card>
      </Pressable>

      <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>最近の報告</Text>
      <View style={{ gap: theme.spacing.s2, marginTop: theme.spacing.s2 }}>
        {recent.map((c) => {
          const member = memberOf(c.reported_by);
          return (
            <Pressable key={c.id} onPress={() => router.push("/parent/approvals")}>
              <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                  <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={24} />
                  <Text style={{ marginLeft: theme.spacing.s2 }}>
                    {member?.display_name} {c.chore_emoji} {c.chore_title}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: theme.colors.neutralTextSecondary }}>+{c.points}pt</Text>
                  <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
                    {formatDateTimeShort(c.reported_at)}
                  </Text>
                </View>
              </Card>
            </Pressable>
          );
        })}
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
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  digestSkeleton: {
    marginTop: theme.spacing.s2,
    height: 18,
    borderRadius: theme.radius.parentMd,
    backgroundColor: theme.colors.neutralBorder,
    opacity: 0.6,
  },
  pendingCard: {
    marginTop: theme.spacing.s4,
    backgroundColor: theme.colors.statusPendingSoft,
    borderColor: theme.colors.statusPending,
  },
  pendingCount: { fontSize: 28, fontWeight: "700", color: theme.colors.statusPending, marginTop: theme.spacing.s1 },
});
