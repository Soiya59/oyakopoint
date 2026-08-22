import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import type { ChoreCompletion, StampKey } from "@/types/domain";

/**
 * S2 完了報告一覧・リアクション（みまもりメンバービュー）
 * 参照: 画面一覧・遷移図.md 2.5節S2・3.12節、P8（app/parent/approvals.tsx）と同一構成
 *
 * P8「見る」「（任意で）スタンプ／コメントを贈る」の2操作をそのまま踏襲する。
 * 対象は家族全員の完了報告（自分専用choreも含め、`chore_completions_select_scoped`
 * RLSにより`family_id`が一致する全ての完了報告がこのクエリ結果に含まれるため、
 * クライアント側で追加のフィルタは不要）。
 *
 * [2026-08-23改訂] 要件定義書07-7章4回目のスコープ変更により、みまもりメンバーは
 * 家族共有choreへの参加機能自体を持たなくなった。これに伴い🤝／🎯バッジ
 * （旧デザイントークン.md 1.7節）も廃止したため、本画面のバッジ表示コードを削除した
 * （5回目のスコープ変更で自分専用choreの完了報告が家族全員に公開されるようになった
 * 後も、🤝／🎯バッジは復活させない。可視性・リアクションの変更にとどめる）。
 */
type LoadState = "loading" | "error" | "ready";

export default function SupporterActivityScreen() {
  const { state, dispatch, reactionsForCompletion, hasReactedWithStamp, loading, loadError } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [detailTarget, setDetailTarget] = useState<ChoreCompletion | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);

  const myId = state.activeParentMemberId;

  useEffect(() => {
    if (!loading) setLoadState(loadError ? "error" : "ready");
  }, [loading, loadError]);

  const completions = [...state.completions].sort(
    (a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()
  );

  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  const sendStamp = async (completionId: string, stampKey: StampKey) => {
    if (hasReactedWithStamp(completionId, myId, stampKey)) return;
    setReactionError(null);
    const result = await dispatch({ type: "ADD_REACTION", completionId, reactedBy: myId, kind: "stamp", stampKey });
    if (!result.ok) setReactionError("スタンプを送信できませんでした。もう一度お試しください");
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
      <Text style={theme.typography.supporterTitle}>かぞくのようす</Text>

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
                <View style={styles.cardMeta}>
                  <Text style={theme.typography.supporterCaption}>
                    {c.photo_url ? "📷 写真あり ・ " : ""}
                    {new Date(c.reported_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
                {!isOwnCard && (
                  <View style={styles.stampRow}>
                    {theme.stampDefinitions.map((s) => {
                      const sent = hasReactedWithStamp(c.id, myId, s.key as StampKey);
                      return (
                        <Pressable
                          key={s.key}
                          disabled={sent}
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

      <AppButton tone="supporter" label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />

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
                      {new Date(detailTarget.reported_at).toLocaleString("ja-JP")}
                    </Text>
                    <View style={styles.photoPlaceholder}>
                      <Text style={{ color: theme.colors.neutralTextSecondary }}>
                        {detailTarget.photo_url ? "📷 写真プレビュー" : "写真の添付はありません"}
                      </Text>
                    </View>
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
                                disabled={sent}
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
  card: { marginTop: theme.spacing.s3 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  cardMeta: { marginTop: theme.spacing.s2 },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  modalCard: { width: "100%", maxWidth: 420 },
  photoPlaceholder: {
    marginTop: theme.spacing.s3,
    height: 140,
    borderRadius: theme.radius.parentMd,
    backgroundColor: theme.colors.neutralBg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
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
