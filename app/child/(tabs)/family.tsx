import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import { EmptyState } from "@/components/StatusViews";
import ChildTabHeader from "@/components/ChildTabHeader";
import { countRecentInbox } from "@/components/InboxPanel";
import { useUnreadSince } from "@/hooks/useLastSeen";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useFamilyHomeCard } from "@/hooks/useFamilyBoard";
import type { ChoreCompletion, StampKey } from "@/types/domain";
import { formatDateTimeShort } from "@/lib/calendarDates";

/**
 * かぞく区画の入口（子ども。旧C18「かぞくのがんばり」に、旧C5が持っていた
 * かぞくのけいじばんカードを吸収）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 36章（36.5.2節）、
 * 開発部/成果物/実装メモ.md 188章
 *
 * [2026-09-10新規追加・実装メモ.md 188章] 子ども下部タブ4区画化に伴う新設タブ。
 * 「新しい画面は作らない。既存の`app/child/family-activity.tsx`（C18）を
 * `(tabs)/family.tsx`相当へ移設し、C27の既存カードmarkupを上部に追加するだけで
 * 成立する」（36.5.2節・36.11節2）という設計方針のとおり、C18本体（完了報告一覧・
 * スタンプ・コメント）のロジックは変更していない。
 *
 * 旧`app/child/(tabs)/home.tsx`が持っていた「💬 かぞくのけいじばん」カード
 * （`useFamilyHomeCard`フック、C27）を、このタブの入口カードとしてそのまま移設した。
 * ヘッダーは4タブ共通の`ChildTabHeader`（36.4節）。
 *
 * **末尾にあった「もどる」ボタン（`router.replace("/child/home")`）は削除した。**
 * 常設タブになったため、他タブへは下部タブバーで移動でき、ボタンによる「戻る」は
 * 不要になった（保護者・みまもりメンバーの「かぞく」タブ入口にも同種のボタンは無い、
 * `app/parent/(tabs)/index.tsx`・`app/supporter/(tabs)/family.tsx`参照）。
 *
 * URLは`/child/family`（新設）。旧URL`/child/family-activity`は
 * `app/child/family-activity.tsx`に残したリダイレクトスタブで引き続き到達できる
 * （外部・アプリ内の古いリンクを生かすため。実装メモ187章の`/parent/home`と同じ扱い）。
 */
export default function ChildFamilyTabScreen() {
  const { state, dispatch, reactionsForCompletion, hasReactedWithStamp, memberAvatars } = useAppData();
  const [detailTarget, setDetailTarget] = useState<ChoreCompletion | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);

  const myId = state.activeChildMemberId;
  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  const inboxSince = useUnreadSince("inbox", myId);
  const inboxCount = countRecentInbox(state, myId, inboxSince);

  // [2026-09-10移設・実装メモ.md 188章] 旧`app/child/(tabs)/home.tsx`の
  // 「かぞくのけいじばん」カード（C27、22.1.2節）。P7/S2と同じ`family_home_card`
  // Viewを同一クエリで使う（API仕様.md 13.3章）。36.5.2節の表記どおり、
  // 子ども向けはひらがな表記（「かぞくのけいじばん」）を維持する
  // （183章の漢字表記統一は保護者・みまもり向けのみで子ども向けは対象外）。
  const { loadState: cardLoadState, card } = useFamilyHomeCard(state.family.id);
  const cardMessage =
    cardLoadState === "error"
      ? "かぞくのけいじばんは、またあとでみてね"
      : cardLoadState === "loading"
      ? null
      : card?.message ?? "かぞくのけいじばんは、またあとでみてね";
  const cardAuthorName =
    card?.source === "board_post"
      ? state.members.find((m) => m.id === card.board_post_author_member_id)?.display_name ?? null
      : null;

  // [2026-09-09改訂・要件定義書07-23章決定1] 家族内の全員（保護者・みまもり
  // メンバー・他の子ども）の完了報告を対象にする。[決定2・自己リアクション禁止]
  // 自分自身の完了報告は`c.reported_by !== myId`で一覧から除外する。
  const reactableCompletions = [...state.completions]
    .filter((c) => c.reported_by !== myId)
    .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime());

  // [2026-09-10改訂・実装メモ.md 157章] おくったスタンプをもういちど押すと取消、
  // ちがうスタンプを押すと切替になる（統括指示）。
  const sendStamp = async (completionId: string, stampKey: StampKey) => {
    setReactionError(null);
    const result = await dispatch({ type: "TOGGLE_REACTION_STAMP", completionId, reactedBy: myId, stampKey });
    if (!result.ok) setReactionError("おくれなかったよ。もういちどためしてね");
  };

  const openDetail = (c: ChoreCompletion) => {
    setCommentDraft("");
    setReactionError(null);
    setDetailTarget(c);
  };

  const sendComment = async () => {
    if (!detailTarget) return;
    const body = commentDraft.trim();
    if (!body) return;
    setReactionError(null);
    setSendingComment(true);
    const result = await dispatch({ type: "ADD_REACTION", completionId: detailTarget.id, reactedBy: myId, kind: "comment", commentBody: body });
    setSendingComment(false);
    if (!result.ok) {
      setReactionError("おくれなかったよ。もういちどためしてね");
      return;
    }
    setCommentDraft("");
    setDetailTarget(null);
  };

  return (
    <Screen tone="child">
      <ChildTabHeader inboxCount={inboxCount} />

      {/* [2026-09-10移設・実装メモ.md 188章] 旧C5「かぞくのけいじばん」カード。 */}
      <Pressable disabled={cardLoadState === "error"} onPress={() => router.push("/child/family-board")}>
        <Card tone="child" style={styles.familyBoardCard}>
          <View style={styles.cardHeaderRow}>
            <Text style={theme.typography.childBody}>💬 かぞくのけいじばん</Text>
            {cardLoadState !== "error" && <Text style={theme.typography.childBody}>›</Text>}
          </View>
          {cardMessage === null ? (
            <View style={styles.digestSkeleton} />
          ) : (
            <>
              {cardAuthorName !== null && (
                <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s2 }]}>{cardAuthorName}</Text>
              )}
              <Text style={{ marginTop: theme.spacing.s1 }}>{cardMessage}</Text>
            </>
          )}
        </Card>
      </Pressable>

      <View style={[styles.titleRow, { marginTop: theme.spacing.s6 }]}>
        <Text style={theme.typography.childHeadline}>👨‍👩‍👧‍👦 かぞくのがんばり</Text>
        <Pressable onPress={() => router.push("/child/gratitude")} hitSlop={8}>
          <Text style={styles.gratitudeLink}>💌 ありがとうをおくる →</Text>
        </Pressable>
      </View>
      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        おうちのひとにも「がんばったね」をおくってみよう
      </Text>

      {reactableCompletions.length === 0 && (
        <EmptyState tone="child" emoji="🌱" title="まだきろくがないよ" />
      )}

      {reactableCompletions.map((c) => {
        const member = memberOf(c.reported_by);
        const isSupporterCard = member?.role === "supporter";
        return (
          <Pressable key={c.id} onPress={() => openDetail(c)}>
            <Card tone="child" style={isSupporterCard ? { ...styles.card, ...styles.cardSupporterTint } : styles.card}>
              <View style={styles.cardTop}>
                <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={32} lineData={member ? memberAvatars[member.id] : undefined} />
                <Text style={theme.typography.childBody}>{member?.display_name}</Text>
                <Text style={{ flex: 1 }} />
                <Text style={theme.typography.childBody}>
                  {c.chore_emoji} {c.chore_title}
                </Text>
              </View>
              <Text style={styles.dateLabel}>
                {formatDateTimeShort(c.reported_at)}
              </Text>
              <View style={styles.stampRow}>
                {theme.stampDefinitions.map((s) => {
                  const sent = hasReactedWithStamp(c.id, myId, s.key as StampKey);
                  return (
                    <Pressable
                      key={s.key}
                      onPress={() => sendStamp(c.id, s.key as StampKey)}
                      style={[styles.stampBtn, sent && styles.stampBtnSent]}
                    >
                      <Text style={styles.stampEmoji}>
                        {s.emoji}
                        {sent ? "✓" : ""}
                      </Text>
                    </Pressable>
                  );
                })}
                <Text style={{ flex: 1 }} />
                <Pressable onPress={() => openDetail(c)} hitSlop={8}>
                  <Text style={styles.commentLink}>＋ひとこと</Text>
                </Pressable>
              </View>
            </Card>
          </Pressable>
        );
      })}

      <Modal visible={!!detailTarget} transparent animationType="fade" onRequestClose={() => setDetailTarget(null)}>
        <View style={styles.modalBackdrop}>
          <Card tone="child" style={styles.modalCard}>
            {detailTarget &&
              (() => {
                const member = memberOf(detailTarget.reported_by);
                const reactions = reactionsForCompletion(detailTarget.id);
                return (
                  <>
                    <Text style={theme.typography.childHeadline}>
                      {detailTarget.chore_emoji} {detailTarget.chore_title}
                    </Text>
                    <Text style={{ marginTop: theme.spacing.s2 }}>{member?.display_name}が きろくしたよ</Text>
                    <Text style={{ marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }}>
                      {formatDateTimeShort(detailTarget.reported_at)}
                    </Text>

                    <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4 }]}>とどいたリアクション</Text>
                    {reactions.length === 0 ? (
                      <Text style={{ marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }}>
                        まだだれもリアクションしてないよ
                      </Text>
                    ) : (
                      <View style={{ marginTop: theme.spacing.s1, gap: theme.spacing.s1 }}>
                        {reactions.map((r) => {
                          const reactor = memberOf(r.reacted_by);
                          const stampDef = theme.stampDefinitions.find((s) => s.key === r.stamp_key);
                          return (
                            <Text key={r.id} style={theme.typography.childBody}>
                              {r.kind === "stamp" ? stampDef?.emoji : "💬"} {reactor?.display_name}より
                              {r.kind === "stamp" ? `「${stampDef?.label}」` : `「${r.comment_body}」`}
                            </Text>
                          );
                        })}
                      </View>
                    )}

                    <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4 }]}>スタンプをおくる</Text>
                    <View style={styles.stampGrid}>
                      {theme.stampDefinitions.map((s) => {
                        const sent = hasReactedWithStamp(detailTarget.id, myId, s.key as StampKey);
                        return (
                          <Pressable
                            key={s.key}
                            onPress={() => sendStamp(detailTarget.id, s.key as StampKey)}
                            style={[styles.stampChip, sent && styles.stampChipSent]}
                          >
                            <Text>
                              {s.emoji} {s.label}
                              {sent ? " ✓" : ""}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4 }]}>ひとことおくる（にんい）</Text>
                    <TextInput
                      value={commentDraft}
                      onChangeText={setCommentDraft}
                      placeholder="がんばったね！"
                      multiline
                      maxLength={200}
                      style={styles.textArea}
                    />
                    <AppButton
                      label={sendingComment ? "おくっています…" : "おくる"}
                      tone="child"
                      loading={sendingComment}
                      style={{ marginTop: theme.spacing.s2 }}
                      onPress={sendComment}
                      disabled={!commentDraft.trim() || sendingComment}
                    />

                    {reactionError && (
                      <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>
                        {reactionError}
                      </Text>
                    )}

                    <AppButton
                      label="もどる"
                      variant="ghost"
                      style={{ marginTop: theme.spacing.s3 }}
                      onPress={() => setDetailTarget(null)}
                    />
                  </>
                );
              })()}
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  familyBoardCard: { marginTop: theme.spacing.s3 },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  digestSkeleton: {
    marginTop: theme.spacing.s2,
    height: 18,
    borderRadius: theme.radius.childXl,
    backgroundColor: theme.colors.neutralBorder,
    opacity: 0.6,
  },
  card: { marginTop: theme.spacing.s3 },
  cardSupporterTint: { backgroundColor: theme.colors.supporterAccentSoft, borderColor: theme.colors.supporterAccent },
  cardTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: theme.spacing.s2 },
  gratitudeLink: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  commentLink: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  dateLabel: { marginTop: theme.spacing.s1, fontSize: 12, color: theme.colors.neutralTextSecondary },
  stampRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2, marginTop: theme.spacing.s3 },
  stampBtn: {
    width: theme.tapTarget.child,
    height: theme.tapTarget.child,
    borderRadius: theme.radius.childXl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  stampBtnSent: { backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  stampEmoji: { fontSize: 18 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  modalCard: { width: "100%", maxWidth: 420 },
  stampGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s2 },
  stampChip: {
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.childXl,
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  stampChipSent: { backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  textArea: {
    marginTop: theme.spacing.s2,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.childXl,
    padding: theme.spacing.s3,
    minHeight: 72,
    textAlignVertical: "top",
    backgroundColor: theme.colors.neutralBg,
  },
});
