import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useMarkSeen } from "@/hooks/useLastSeen";
import { formatDateTimeFullJp, formatDateTimeShort, isWithinCancelWindow } from "@/lib/calendarDates";
import { cancelCompletionErrorText, CANCEL_SUCCESS_TEXT } from "@/lib/cancelChoreCompletion";
import type { ChoreCompletion, StampKey } from "@/types/domain";

/**
 * S2 完了報告一覧・リアクション（みまもりメンバービュー、全件）
 * 参照: 画面一覧・遷移図.md 2.5節S2・3.12節、P8（app/parent/approvals.tsx）と同一構成
 *
 * [2026-09-09復活・実装メモ.md 183章] 182章のタブ化で本ファイルは
 * `app/supporter/(tabs)/family.tsx`へ改名・統合され、いったん消滅していた。
 * 統括の実機確認「（かぞくタブの）完了報告は全部記載するとキリがないので5件でよい。
 * ただし保護者と同じやつを」を受け、「かぞく」タブ側は新着5件のプレビューに縮小し、
 * その全件（6件目以降を含む）を見る行き先として本ファイルを復活させた。
 * P8（保護者の完了報告一覧）と`/parent/approvals`の関係にそろえてある
 * （「完了報告（新着◯件）」カード→タップで全件一覧、という構造が保護者と同型になる）。
 *
 * 中身は182章で改名される直前の本ファイルからの復元であり、ロジックは変更していない
 * （タイトルを「かぞくのようす」→「完了報告」に、戻り先を`/supporter/home`→
 * `/supporter/family`に変えた以外は同一）。
 */
type LoadState = "loading" | "error" | "ready";

export default function SupporterActivityScreen() {
  const { state, dispatch, reactionsForCompletion, hasReactedWithStamp, loading, loadError } = useAppData();
  // [2026-09-11追加・実装メモ.md 190章] この画面を開いたことを記録し、
  // ベル／新着件数を未読方式で数えられるようにする。**入口がどこであったかは問わない**
  // （統括の指摘。「新着◯件」カードからでも「最近の報告」の行からでも同じ画面に来る）。
  useMarkSeen("completions", state.activeParentMemberId);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [detailTarget, setDetailTarget] = useState<ChoreCompletion | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);

  // [2026-09-03追加] 要件定義書07-17章「完了報告の直後の取消」・UIUXデザイン部/成果物/
  // 主要画面ワイヤーフレーム.md 28.6節。みまもりメンバーは自分の報告のみ取り消せ、
  // 確認ダイアログは無い（常に本人操作のため。28.0節決定5）。
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

  const completions = [...state.completions].sort(
    (a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()
  );

  // [2026-09-09追加・実装メモ.md 183章] 「かぞく」タブのプレビューカードと同じ
  // 数え方（直近24時間）をここでも見出しに出す（P8 app/parent/approvals.tsxと同型）。
  const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
  const newCount = completions.filter((c) => new Date(c.reported_at).getTime() >= oneDayAgoMs).length;

  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  // [2026-09-10改訂・実装メモ.md 157章] 送信済みのスタンプをもう一度タップすると
  // 取消、違うスタンプをタップすると切替になる（統括指示）。
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
      <ScreenBackLink tone="supporter" onPress={() => router.replace("/supporter/family")} />
      <View style={styles.header}>
        <Text style={theme.typography.supporterTitle}>完了報告</Text>
        <Text style={{ color: theme.colors.neutralTextSecondary }}>新着{newCount}件</Text>
      </View>

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
                  {/* [2026-09-03追加] 28.6節。「じぶん」の行（報告から1分以内のみ）に
                      「取消」リンクを追加する。他者の報告への取消権限は無い（07-7章）ため
                      確認ダイアログは無い（常に本人操作、28.0節決定5）。 */}
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

      {/* [2026-09-03追加] 28.6節「取消成功」のスナックバー相当（1.5秒で自動消滅）。 */}
      {cancelFlashMessage && (
        <Text style={[theme.typography.supporterCaption, styles.cancelFlash]}>{cancelFlashMessage}</Text>
      )}

      <AppButton tone="supporter" label="かぞくタブへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/supporter/family")} />

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
  header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  card: { marginTop: theme.spacing.s3 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  cardMeta: { marginTop: theme.spacing.s2 },
  // [2026-09-03追加] 28.6節。
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
