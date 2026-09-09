import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import { StageDot } from "@/components/FamilyTree";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import { countRecentInbox } from "@/components/InboxPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { formatDateTimeFullJp, formatDateTimeShort, isWithinCancelWindow } from "@/lib/calendarDates";
import { cancelCompletionErrorText, CANCEL_SUCCESS_TEXT } from "@/lib/cancelChoreCompletion";
import { useFamilyTreeSummary } from "@/hooks/useFamilyTree";
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
  const inboxCount = countRecentInbox(state, myId, Date.now() - 24 * 60 * 60 * 1000);

  // [2026-09-09追加・35.6.1節] 「入口の上部ウィジェットから常時アクセス」。
  // useFamilyTreeSummaryは元々「P7/C5/S1ホームウィジェット用の軽量版」として
  // 設計されていたが、旧S1では未使用だった（src/hooks/useFamilyTree.ts冒頭コメント）。
  // 新しい通信は発生しない（P7が既に使っているのと同じ1回のGET）。
  const { season: treeSeason } = useFamilyTreeSummary();

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

      {/* [2026-09-09追加・35.6.1節「アイコン横1列のショートカット（21.1節・22.1節と同型）」] */}
      <View style={styles.widgetRow}>
        <Pressable onPress={() => router.push("/supporter/family-tree")} style={styles.widgetItem}>
          <Card tone="supporter" style={styles.widgetCard}>
            <StageDot color={theme.treeColors.foliageBase} size={32} stage={treeSeason?.current_stage ?? 0} />
            <View style={{ flex: 1, marginLeft: theme.spacing.s2 }}>
              <Text style={theme.typography.supporterBodyMedium}>🌳 家族の木</Text>
              <Text style={[theme.typography.supporterCaption, { color: theme.colors.neutralTextSecondary }]}>
                いま「{theme.treeStages[treeSeason?.current_stage ?? 0].name}」
              </Text>
            </View>
          </Card>
        </Pressable>
        <Pressable onPress={() => router.push("/supporter/collector-shelf")} style={styles.widgetItem}>
          <Card tone="supporter" style={styles.widgetCard}>
            <Text style={{ fontSize: 28 }}>🗄️</Text>
            <Text style={[theme.typography.supporterBodyMedium, { marginLeft: theme.spacing.s2 }]}>コレクション</Text>
          </Card>
        </Pressable>
      </View>

      {cardLoadState === "error" ? (
        <Card tone="supporter" style={{ marginTop: theme.spacing.s4 }}>
          <Text style={theme.typography.supporterBodyMedium}>かぞくのけいじばん</Text>
          <ErrorState title="読み込みに失敗しました" onRetry={reloadCard} />
        </Card>
      ) : (
        <Pressable onPress={() => router.push("/supporter/family-board")}>
          <Card tone="supporter" style={{ marginTop: theme.spacing.s4 }}>
            <View style={styles.cardHeaderRow}>
              <Text style={theme.typography.supporterBodyMedium}>📮 かぞくのけいじばん</Text>
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

      {/* ここから下は既存S2本体（変更なし）。 */}
      <Text style={[theme.typography.supporterBodyMedium, styles.sectionHeading]}>完了報告一覧</Text>

      {loadState === "loading" && <SkeletonList count={3} />}

      {loadState === "error" && (
        <ErrorState title="読み込みに失敗しました" onRetry={() => setLoadState("ready")} />
      )}

      {loadState === "ready" && completions.length === 0 && (
        <EmptyState emoji="📮" title="まだ完了報告がありません" />
      )}

      {loadState === "ready" &&
        completions.map((c) => {
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
  widgetRow: { flexDirection: "row", gap: theme.spacing.s3, marginTop: theme.spacing.s4 },
  widgetItem: { flex: 1 },
  widgetCard: { flexDirection: "row", alignItems: "center" },
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
