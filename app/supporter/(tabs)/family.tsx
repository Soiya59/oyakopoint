import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import { countRecentInbox } from "@/components/InboxPanel";
import { useUnreadSince } from "@/hooks/useLastSeen";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { formatDateTimeFullJp, formatDateTimeShort, isWithinCancelWindow } from "@/lib/calendarDates";
import { cancelCompletionErrorText, CANCEL_SUCCESS_TEXT } from "@/lib/cancelChoreCompletion";
import { useFamilyHomeCard } from "@/hooks/useFamilyBoard";
import type { ChoreCompletion, StampKey } from "@/types/domain";

/**
 * S2 かぞく区画の入口（完了報告一覧・リアクション。旧S1みまもりホームの
 * 「まとめ」要素を吸収）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 35.6.1節、
 * 画面一覧・遷移図.md 2.5節S2・3.12節
 *
 * [2026-09-09改訂・実装メモ.md 182章] S1みまもりホーム廃止（35章）に伴い、
 * このファイル（旧`app/supporter/activity.tsx`）を「かぞく」タブの入口画面に
 * 昇格させた。「新しい画面を作らない。既存のS2に、現行S1が持つ『まとめ』要素を
 * ヘッダーとして追加するだけで成立する」（35.6.1節）という設計方針のとおり、
 * S2本体（完了報告一覧・スタンプ・コメント・取消）のロジックは変更していない。
 * 旧S1が持っていた「共通ヘッダー（アバター＋家族名＋ベル）」「家族の木・
 * コレクションへのショートカット」「かぞくのけいじばんカード」の3つを、
 * 完了報告一覧の上に追加した。「最近のようす」プレビュー（旧S1）は、
 * タブ化によって『かぞくタブを開く＝もう完了報告一覧そのものにいる』状態に
 * なるため削除した（35.6.1節「プレビューという概念自体が不要になる」）。
 *
 * URLが `/supporter/activity` → `/supporter/family` に変わる。旧URLへの
 * リンクは家族の掲示板等の外部通知には含まれておらず（実装メモ182章で確認済み）、
 * アプリ内の参照はすべて本改修で書き換えた。
 *
 * [2026-09-09再改訂・実装メモ.md 183章] 統括の実機確認を受け、ヘッダー直下の並びと
 * 完了報告の出し方を変更した。
 * 1. 表記: 「かぞくのけいじばん」（ひらがな・子ども向け表記）→「家族の掲示板」
 *    （漢字）。みまもり向け画面は子ども向けではないため、ひらがなにする理由がない。
 * 2. 並び順: 家族の掲示板 → 家族の木・コレクション → 完了報告（新着◯件、
 *    `app/parent/home.tsx`のpendingCardと同一の見た目・数え方）→ 新着5件、の順に
 *    統括が指定（原文「全部記載するとキリがないので」）。
 * 3. 全件表示の廃止: 完了報告は5件までに絞った。ただし6件目以降が見られなくなる
 *    ことは避けるため、`app/supporter/activity.tsx`（旧S2の全件一覧）を復活させ、
 *    「完了報告（新着◯件）」カードからそこへ飛ばす構成にした。保護者の
 *    「P7ホームの完了報告カード→/parent/approvals」と同型（本部長案A採用）。
 * 表示している5件のスタンプ・コメント・取消の機能はそのまま維持している
 * （completions配列自体は変えず、描画直前にslice(0, 5)しているだけ）。
 *
 * [2026-09-09再々改訂・実装メモ.md 186章] 統括の実機確認「コレクションはどこ？
 * 木はどこ？って少しなった」を受け、上記2番目にあった「家族の木・コレクション」の
 * ショートカット行を削除した。木は常設の第3タブ（`app/supporter/(tabs)/tree.tsx`）、
 * コレクションは「じぶん」タブのタイル（`self.tsx`）にそれぞれ移設済み。「かぞく」
 * タブは「家族の動きを見る場所」（家族の掲示板・完了報告）に絞った。
 */
type LoadState = "loading" | "error" | "ready";

export default function SupporterFamilyScreen() {
  const { state, dispatch, reactionsForCompletion, hasReactedWithStamp, loading, loadError } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [detailTarget, setDetailTarget] = useState<ChoreCompletion | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);

  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelRowError, setCancelRowError] = useState<{ id: string; message: string } | null>(null);
  const [cancelFlashMessage, setCancelFlashMessage] = useState<string | null>(null);
  const [, setCancelTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setCancelTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  const myId = state.activeParentMemberId;

  useEffect(() => {
    if (!loading) setLoadState(loadError ? "error" : "ready");
  }, [loading, loadError]);

  // [2026-09-09追加・35.5節] 共通ヘッダー（左: アバター＋自分の名前・非タップ。
  // みまもりメンバーには子ども選択機能を拡張しない。中央: 家族名。右: ベル→S22）。
  const myMember = state.members.find((m) => m.id === myId);
  // [2026-09-11変更・実装メモ.md 190章] 保護者ホームと同じ2本立て（inbox／completions）。
  const inboxSince = useUnreadSince("inbox", myId);
  const inboxCount = countRecentInbox(state, myId, inboxSince);

  const { loadState: cardLoadState, card, reload: reloadCard } = useFamilyHomeCard(state.family.id);
  const hasBoardPost = card?.source === "board_post";
  const cardAuthorName = hasBoardPost
    ? state.members.find((m) => m.id === card.board_post_author_member_id)?.display_name ?? null
    : null;
  const cardTime =
    hasBoardPost && card.board_post_created_at
      ? new Date(card.board_post_created_at).toLocaleString("ja-JP", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  const completions = [...state.completions].sort(
    (a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()
  );

  // [2026-09-09追加・実装メモ.md 183章] 「完了報告（新着◯件）」カード。
  // `app/parent/home.tsx`のpendingCardと同一の数え方（直近24時間）。
  const completionsSince = useUnreadSince("completions", myId);
  const newCount = completions.filter((c) => new Date(c.reported_at).getTime() >= completionsSince).length;
  // [2026-09-09追加・実装メモ.md 183章] 統括指示「全部記載するとキリがないので5件でよい」。
  // 6件目以降は`/supporter/activity`（復活させた全件一覧）で見られる。
  const recentCompletions = completions.slice(0, 5);

  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  const sendStamp = async (completionId: string, stampKey: StampKey) => {
    setReactionError(null);
    const result = await dispatch({ type: "TOGGLE_REACTION_STAMP", completionId, reactedBy: myId, stampKey });
    if (!result.ok) setReactionError("スタンプを送信できませんでした。もう一度お試しください");
  };

  const openDetail = (c: ChoreCompletion) => {
    setCommentDraft("");
    setReactionError(null);
    setDetailTarget(c);
  };

  const runCancel = async (completionId: string) => {
    setCancelingId(completionId);
    setCancelRowError(null);
    const result = await dispatch({ type: "CANCEL_COMPLETION", completionId });
    setCancelingId(null);
    if (!result.ok) {
      setCancelRowError({ id: completionId, message: cancelCompletionErrorText("supporter", result.error) });
      return;
    }
    setCancelFlashMessage(CANCEL_SUCCESS_TEXT.supporter);
    setTimeout(() => setCancelFlashMessage(null), 1500);
  };

  const sendComment = async () => {
    if (!detailTarget) return;
    const body = commentDraft.trim();
    if (!body) return;
    setReactionError(null);
    setSendingComment(true);
    const result = await dispatch({
      type: "ADD_REACTION",
      completionId: detailTarget.id,
      reactedBy: myId,
      kind: "comment",
      commentBody: body,
    });
    setSendingComment(false);
    if (!result.ok) {
      setReactionError("コメントを送信できませんでした。もう一度お試しください");
      return;
    }
    setCommentDraft("");
    setDetailTarget(null);
  };

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

      {/* [2026-09-09並べ替え・実装メモ.md 183章] 統括指示の並び順1番目「家族の掲示板を
          いちばん上へ」。表記も「かぞくのけいじばん」（ひらがな）→「家族の掲示板」
          （漢字、`app/parent/home.tsx`と同じ表記）に統一した。みまもり向け画面は
          子ども向けではないため、ひらがなにする理由がない。 */}
      {cardLoadState === "error" ? (
        <Card tone="supporter" style={{ marginTop: theme.spacing.s4 }}>
          <Text style={theme.typography.supporterBodyMedium}>家族の掲示板</Text>
          <ErrorState title="読み込みに失敗しました" onRetry={reloadCard} />
        </Card>
      ) : (
        <Pressable onPress={() => router.push("/supporter/family-board")}>
          <Card tone="supporter" style={{ marginTop: theme.spacing.s4 }}>
            <View style={styles.cardHeaderRow}>
              <Text style={theme.typography.supporterBodyMedium}>📮 家族の掲示板</Text>
              <Text style={theme.typography.supporterBodyMedium}>›</Text>
            </View>
            {cardLoadState === "loading" ? (
              <View style={styles.digestSkeleton} />
            ) : hasBoardPost ? (
              <>
                {cardAuthorName !== null && (
                  <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s2 }]}>{cardAuthorName}</Text>
                )}
                <Text style={{ marginTop: theme.spacing.s1 }}>{card.message}</Text>
                {cardTime !== null && (
                  <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
                    {cardTime}
                  </Text>
                )}
              </>
            ) : (
              <Text style={{ marginTop: theme.spacing.s2 }}>
                まだ書き込みはありません。家族のようすを、ひとことシェアしてみませんか
              </Text>
            )}
          </Card>
        </Pressable>
      )}

      {/* [2026-09-09削除・実装メモ.md 186章] 旧「家族の木・コレクション」ショートカット行
          （並び順2番目）は削除した。木は常設タブへ、コレクションは「じぶん」タブへ移設済み
          （経緯はファイル冒頭のコメント参照）。 */}

      {/* [2026-09-09追加・実装メモ.md 183章] 並び順3番目「完了報告（新着◯件）」。
          `app/parent/home.tsx`のpendingCardと同一の見た目・数え方（直近24時間）。
          タップで全件一覧（復活させた`app/supporter/activity.tsx`）へ。保護者の
          「P7ホームの完了報告カード→/parent/approvals」と同型（本部長案A）。 */}
      <Pressable onPress={() => router.push("/supporter/activity")}>
        <Card tone="supporter" style={styles.pendingCard}>
          <Text style={theme.typography.supporterBodyMedium}>完了報告</Text>
          <Text style={styles.pendingCount}>新着{newCount}件</Text>
        </Card>
      </Pressable>

      {/* [2026-09-09改訂・実装メモ.md 183章] 並び順4番目「新着5件」。統括指示
          「全部記載するとキリがないので」5件までに絞った（`recentCompletions`。
          `completions`配列自体は変えず、描画直前にslice(0, 5)しているだけ）。
          6件目以降は上の「完了報告」カードから全件一覧で見られる。表示している
          5件のスタンプ・コメント・取消は従来どおり動く（ロジックは変更していない）。 */}
      <Text style={[theme.typography.supporterBodyMedium, styles.sectionHeading]}>最近の完了報告</Text>

      {loadState === "loading" && <SkeletonList count={3} />}

      {loadState === "error" && (
        <ErrorState title="読み込みに失敗しました" onRetry={() => setLoadState("ready")} />
      )}

      {loadState === "ready" && completions.length === 0 && (
        <EmptyState emoji="📮" title="まだ完了報告がありません" />
      )}

      {loadState === "ready" &&
        recentCompletions.map((c) => {
          const member = memberOf(c.reported_by);
          const isOwnCard = c.reported_by === myId;
          return (
            <Pressable key={c.id} onPress={() => openDetail(c)}>
              <Card tone="supporter" style={styles.card}>
                <View style={styles.cardTop}>
                  <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={32} />
                  <Text style={theme.typography.supporterBodyMedium}>{member?.display_name}</Text>
                  <Text style={{ flex: 1 }} />
                  <Text style={theme.typography.supporterBodyMedium}>
                    {c.chore_emoji} {c.chore_title} +{c.points}pt
                  </Text>
                </View>
                <View style={[styles.cardMeta, styles.cardMetaRow]}>
                  <Text style={theme.typography.supporterCaption}>
                    {formatDateTimeShort(c.reported_at)}
                  </Text>
                  {isOwnCard && isWithinCancelWindow(c.reported_at) && (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        void runCancel(c.id);
                      }}
                      disabled={cancelingId === c.id}
                      hitSlop={8}
                    >
                      <Text style={styles.cancelLink}>{cancelingId === c.id ? "処理中…" : "取消"}</Text>
                    </Pressable>
                  )}
                </View>
                {cancelRowError?.id === c.id && (
                  <Text style={[theme.typography.supporterCaption, styles.cancelRowError]}>
                    {cancelRowError.message}
                  </Text>
                )}
                {!isOwnCard && (
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
                    <Pressable onPress={() => openDetail(c)}>
                      <Text style={styles.commentLink}>＋コメント</Text>
                    </Pressable>
                  </View>
                )}
              </Card>
            </Pressable>
          );
        })}

      {cancelFlashMessage && (
        <Text style={[theme.typography.supporterCaption, styles.cancelFlash]}>{cancelFlashMessage}</Text>
      )}

      <Modal visible={!!detailTarget} transparent animationType="fade" onRequestClose={() => setDetailTarget(null)}>
        <View style={styles.modalBackdrop}>
          <Card tone="supporter" style={styles.modalCard}>
            {detailTarget &&
              (() => {
                const member = memberOf(detailTarget.reported_by);
                const reactions = reactionsForCompletion(detailTarget.id);
                const isOwnCard = detailTarget.reported_by === myId;
                return (
                  <>
                    <Text style={theme.typography.supporterTitle}>
                      {detailTarget.chore_emoji} {detailTarget.chore_title}
                    </Text>
                    <Text style={{ marginTop: theme.spacing.s2 }}>
                      {member?.display_name} さんから ・ +{detailTarget.points}pt
                    </Text>
                    <Text style={{ marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }}>
                      {formatDateTimeFullJp(detailTarget.reported_at)}
                    </Text>
                    {detailTarget.note ? (
                      <Text style={{ marginTop: theme.spacing.s2 }}>ひとことメモ: {detailTarget.note}</Text>
                    ) : null}

                    <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s4 }]}>
                      とどいたリアクション
                    </Text>
                    {reactions.length === 0 ? (
                      <Text
                        style={[
                          theme.typography.supporterCaption,
                          { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary },
                        ]}
                      >
                        まだ誰も反応していないよ
                      </Text>
                    ) : (
                      <View style={{ marginTop: theme.spacing.s1, gap: theme.spacing.s1 }}>
                        {reactions.map((r) => {
                          const reactor = memberOf(r.reacted_by);
                          const stampDef = theme.stampDefinitions.find((s) => s.key === r.stamp_key);
                          return (
                            <Text key={r.id} style={theme.typography.supporterBody}>
                              {r.kind === "stamp" ? stampDef?.emoji : "💬"} {reactor?.display_name}より
                              {r.kind === "stamp" ? `「${stampDef?.label}」` : `「${r.comment_body}」`}
                            </Text>
                          );
                        })}
                      </View>
                    )}

                    {!isOwnCard && (
                      <>
                        <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s4 }]}>
                          スタンプを贈る
                        </Text>
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

                        <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s4 }]}>
                          ひとことおくる（にんい・200文字まで）
                        </Text>
                        <TextInput
                          value={commentDraft}
                          onChangeText={setCommentDraft}
                          placeholder="よくがんばったね"
                          multiline
                          maxLength={200}
                          style={styles.textArea}
                        />
                        <AppButton
                          tone="supporter"
                          label={sendingComment ? "送信中…" : "おくる"}
                          loading={sendingComment}
                          style={{ marginTop: theme.spacing.s2 }}
                          onPress={sendComment}
                          disabled={!commentDraft.trim() || sendingComment}
                        />
                      </>
                    )}

                    {reactionError && (
                      <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>
                        {reactionError}
                      </Text>
                    )}

                    <AppButton
                      tone="supporter"
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
  headerRow: { flexDirection: "row", alignItems: "center" },
  headerMe: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  headerFamilyName: { flex: 1, marginLeft: theme.spacing.s3 },
  bellHit: { minHeight: theme.tapTarget.supporterPrimary, justifyContent: "center", paddingLeft: theme.spacing.s2 },
  notifBadge: { fontSize: 17, fontWeight: "700" },
  // [2026-09-09追加・実装メモ.md 183章] `app/parent/home.tsx`のpendingCard/pendingCountと
  // 同一のスタイル（統括指示「保護者と同じやつ」）。
  pendingCard: {
    marginTop: theme.spacing.s4,
    backgroundColor: theme.colors.statusPendingSoft,
    borderColor: theme.colors.statusPending,
  },
  pendingCount: { fontSize: 28, fontWeight: "700", color: theme.colors.statusPending, marginTop: theme.spacing.s1 },
  card: { marginTop: theme.spacing.s3 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  cardMeta: { marginTop: theme.spacing.s2 },
  cardMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cancelLink: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  cancelRowError: { marginTop: 2, color: theme.colors.statusBlocking },
  cancelFlash: { marginTop: theme.spacing.s3, textAlign: "center", color: theme.colors.neutralTextSecondary },
  stampRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2, marginTop: theme.spacing.s3 },
  stampBtn: {
    width: theme.tapTarget.supporterPrimary,
    height: theme.tapTarget.supporterPrimary,
    borderRadius: theme.radius.parentMd,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  stampBtnSent: {
    backgroundColor: theme.colors.supporterAccentSoft,
    borderColor: theme.colors.supporterAccent,
  },
  stampEmoji: { fontSize: 18 },
  commentLink: { color: theme.colors.supporterAccent, fontWeight: "700" },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  digestSkeleton: {
    marginTop: theme.spacing.s2,
    height: 18,
    borderRadius: theme.radius.parentMd,
    backgroundColor: theme.colors.neutralBorder,
    opacity: 0.6,
  },
  sectionHeading: {
    marginTop: theme.spacing.s6,
    marginBottom: theme.spacing.s2,
    color: theme.colors.supporterAccent,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  modalCard: { width: "100%", maxWidth: 420 },
  stampGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.s2,
    marginTop: theme.spacing.s2,
  },
  stampChip: {
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  stampChipSent: {
    backgroundColor: theme.colors.supporterAccentSoft,
    borderColor: theme.colors.supporterAccent,
  },
  textArea: {
    marginTop: theme.spacing.s2,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    padding: theme.spacing.s3,
    minHeight: 72,
    textAlignVertical: "top",
    backgroundColor: theme.colors.neutralBg,
  },
});
