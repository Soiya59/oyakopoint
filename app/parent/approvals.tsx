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
import { formatDateTimeFullJp, formatDateTimeShort, isWithinCancelWindow } from "@/lib/calendarDates";
import { cancelCompletionErrorText, CANCEL_SUCCESS_TEXT } from "@/lib/cancelChoreCompletion";
import type { ChoreCompletion, StampKey } from "@/types/domain";

/**
 * P8 完了報告一覧・リアクション ＋ P9 完了報告詳細・リアクション（モーダルに統合）
 * 参照: 主要画面ワイヤーフレーム.md 3章、画面一覧・遷移図.md P8/P9・3.4章
 *
 * [2026-08-15全面書き換え] 要件定義書.md v0.5 07章・スキーマ設計.sql v2.0
 * （chore_reactions新設、chore_completionsのUPDATEポリシー全廃）を受け、旧
 * 「承認待ち一覧」（承認/差し戻しボタン）を全面的に置き換えた。保護者ができる操作は
 * 「見る」と「（任意で）スタンプ／コメントを贈る」の2つのみで、承認・却下・差し戻しに
 * 相当するボタン・状態はこの画面のどこにも存在しない。
 *
 * カードは「処理待ちのタスクを片付ける」画面ではなく「家族のがんばりを眺めて、
 * 気が向いたら反応する」フィード画面であるため、リアクション付与後も一覧から
 * 消えない・未読/既読の概念も持たない（画面一覧・遷移図.md 3.4章）。
 *
 * 状態: 読み込み中 / 空状態 / 通常 / 通信エラー をワイヤーフレームどおりに実装。
 */
type LoadState = "loading" | "error" | "ready";

export default function ApprovalsScreen() {
  const { state, dispatch, reactionsForCompletion, hasReactedWithStamp, loading, loadError, refresh } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [detailTarget, setDetailTarget] = useState<ChoreCompletion | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  // [2026-08-20修正・本部長] sendStamp/sendCommentがdispatch()の戻り値を確認せず、
  // 失敗時に何もフィードバックが無いままだった（ユーザーが「文字を入力しないと
  // リアクションおくれない？？」と誤解した一因と考えられる。実際はAPI直接検証で
  // スタンプ送信自体は正常に動くことを確認済みのため、たまたま失敗した際に
  // 気づけない設計だったことが問題）。また送信成功後もモーダルが閉じず
  // 「そのUIが消えない」との指摘もあったため、送信失敗時のエラー表示と、
  // コメント送信成功時にモーダルを閉じる処理を追加した。
  const [reactionError, setReactionError] = useState<string | null>(null);

  // [2026-09-03追加] 要件定義書07-17章「完了報告の直後の取消」・UIUXデザイン部/成果物/
  // 主要画面ワイヤーフレーム.md 28.4節。
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelRowError, setCancelRowError] = useState<{ id: string; message: string } | null>(null);
  const [cancelConfirmTarget, setCancelConfirmTarget] = useState<ChoreCompletion | null>(null);
  const [cancelFlashMessage, setCancelFlashMessage] = useState<string | null>(null);
  // 1分の経過でリンクごと消すため、表示中は10秒間隔で再評価する（28.0節決定4）。
  const [, setCancelTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setCancelTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  // 自分（いま操作している保護者）のfamily_member_id。実接続時は
  // current_family_member_id()相当（session.parentMember.id）がstate.activeParentMemberIdに
  // すでに反映されている（src/data/store.tsx RealDataProviderImpl参照）。
  const myParentId = state.activeParentMemberId;

  useEffect(() => {
    if (!loading) setLoadState(loadError ? "error" : "ready");
  }, [loading, loadError]);

  const completions = [...state.completions].sort(
    (a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()
  );

  // 「新着◯件」は消化すべきタスク数ではなく、直近24時間に届いた報告のお知らせという
  // 位置づけ（主要画面ワイヤーフレーム.md 3.1章）。未処理バッジの概念は持たない。
  const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
  const newCount = completions.filter((c) => new Date(c.reported_at).getTime() >= oneDayAgoMs).length;

  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  const sendStamp = async (completionId: string, stampKey: StampKey) => {
    // uq_chore_reactions_stamp_dedup（スキーマ設計.sql 5b章）をボタン無効化で未然に防ぐ
    // （主要画面ワイヤーフレーム.md 6章「送信済みのstamp_keyのボタンをあらかじめ無効化」）。
    if (hasReactedWithStamp(completionId, myParentId, stampKey)) return;
    setReactionError(null);
    const result = await dispatch({ type: "ADD_REACTION", completionId, reactedBy: myParentId, kind: "stamp", stampKey });
    if (!result.ok) setReactionError("スタンプを送信できませんでした。もう一度お試しください");
  };

  const openDetail = (c: ChoreCompletion) => {
    setCommentDraft("");
    setReactionError(null);
    setDetailTarget(c);
  };

  // [2026-09-03追加] 28.4節「決定5」：自分の報告は確認なしで即取消、自分以外
  // （子ども・配偶者）の報告は確認ダイアログを挟む。
  const runCancel = async (completionId: string) => {
    setCancelingId(completionId);
    setCancelRowError(null);
    const result = await dispatch({ type: "CANCEL_COMPLETION", completionId });
    setCancelingId(null);
    if (!result.ok) {
      setCancelRowError({ id: completionId, message: cancelCompletionErrorText("parent", result.error) });
      return;
    }
    setCancelConfirmTarget(null);
    setCancelFlashMessage(CANCEL_SUCCESS_TEXT.parent);
    setTimeout(() => setCancelFlashMessage(null), 1500);
  };

  const handleCancelTap = (c: ChoreCompletion) => {
    if (c.reported_by === myParentId) {
      void runCancel(c.id);
    } else {
      setCancelConfirmTarget(c);
    }
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
      reactedBy: myParentId,
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
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/home")} />
      <View style={styles.header}>
        <Text style={theme.typography.parentTitle}>完了報告</Text>
        <Text style={{ color: theme.colors.neutralTextSecondary }}>新着{newCount}件</Text>
      </View>

      {loadState === "loading" && <SkeletonList count={3} />}

      {loadState === "error" && (
        <ErrorState title="読み込みに失敗しました" onRetry={() => setLoadState("ready")} />
      )}

      {loadState === "ready" && completions.length === 0 && (
        <EmptyState emoji="📮" title="まだ完了報告がありません。クエストがはじまると、ここに届きます" />
      )}

      {loadState === "ready" &&
        completions.map((c) => {
          const member = memberOf(c.reported_by);
          // [2026-08-16追加] 主要画面ワイヤーフレーム.md 3.1章「保護者自身の完了報告（07-4章）
          // もこのフィードに時系列で混在表示する」。トーンの書き分けはAPI仕様.md 4b章・
          // 主要画面ワイヤーフレーム.md 9.3章のとおり、reported_by先family_members.roleで
          // 判定する（chore側に区分列は無い。スキーマ設計.sql 12章確認5）。
          const isChildCard = member?.role === "child";
          // [2026-08-23改訂] 🤝/🎯バッジ（旧デザイントークン.md 1.7節）は要件定義書
          // 07-7章4回目のスコープ変更（家族共有choreへの参加機能の撤回）に伴い廃止した。
          // [2026-08-23再改訂・5回目のスコープ変更] 自分専用choreの公開方針の撤回により、
          // みまもりメンバーの完了報告も再びこのフィードに表示されるようになった
          // （chore_completions_select_scoped RLSがfamily_id一致のみに単純化されたため）。
          // バッジは復活させないが、`color-supporter-accent-soft`の控えめな配色で
          // 区別する（画面一覧・遷移図.md P8行参照）。
          const isSupporterCard = member?.role === "supporter";
          // 自分自身の完了報告カードにはリアクションボタン自体を表示しない
          // （3.1章「自己リアクションは要件定義書に無い操作のため、UI側で選択肢自体を出さない」）。
          const isOwnCard = c.reported_by === myParentId;
          return (
            <Pressable key={c.id} onPress={() => openDetail(c)}>
              <Card
                style={
                  isChildCard
                    ? { ...styles.card, ...styles.cardChildTint }
                    : isSupporterCard
                    ? { ...styles.card, ...styles.cardSupporterTint }
                    : styles.card
                }
              >
                <View style={styles.cardTop}>
                  <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={32} />
                  <Text style={theme.typography.parentBodyMedium}>{member?.display_name}</Text>
                  <Text style={{ flex: 1 }} />
                  <Text style={theme.typography.parentBodyMedium}>
                    {c.chore_emoji} {c.chore_title} +{c.points}pt
                  </Text>
                </View>
                <View style={[styles.cardMeta, styles.cardMetaRow]}>
                  <Text style={theme.typography.parentCaption}>
                    {formatDateTimeShort(c.reported_at)}{" "}
                    {isChildCard ? "とどいた" : "きろくした"}
                  </Text>
                  {/* [2026-09-03追加] 28.4節。みまもりメンバーの自分専用chore完了報告
                      （scope='personal'）には取消権限が無いためリンク自体を出さない。
                      supporterの報告は常にpersonal-scopeのため（07-7章）role判定のみで足りる。 */}
                  {!isSupporterCard && isWithinCancelWindow(c.reported_at) && (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        handleCancelTap(c);
                      }}
                      disabled={cancelingId === c.id}
                      hitSlop={8}
                    >
                      <Text style={styles.cancelLink}>{cancelingId === c.id ? "処理中…" : "取消"}</Text>
                    </Pressable>
                  )}
                </View>
                {cancelRowError?.id === c.id && (
                  <Text style={[theme.typography.parentCaption, styles.cancelRowError]}>
                    {cancelRowError.message}
                  </Text>
                )}
                {/* カード上のクイックスタンプ。タップで即座にchore_reactions insert（3.1章）。
                    自分自身の完了報告カードには表示しない。 */}
                {!isOwnCard && (
                  <View style={styles.stampRow}>
                    {theme.stampDefinitions.map((s) => {
                      const sent = hasReactedWithStamp(c.id, myParentId, s.key as StampKey);
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

      {/* [2026-09-03追加] 28.4節「取消成功」のスナックバー相当（1.5秒で自動消滅）。 */}
      {cancelFlashMessage && (
        <Text style={[theme.typography.parentCaption, styles.cancelFlash]}>{cancelFlashMessage}</Text>
      )}

      {/* [2026-08-16修正・本部長] P16・P18と同じ理由でホームへ戻るボタンを追加した。 */}
      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/parent/home")} />

      {/* [2026-09-03追加] 28.4節「確認モーダル（自分以外の報告を取り消す場合）」。
          22.4節の削除確認モーダルと同じ構成・トーン。 */}
      <Modal
        visible={!!cancelConfirmTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelConfirmTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard}>
            {cancelConfirmTarget &&
              (() => {
                const member = memberOf(cancelConfirmTarget.reported_by);
                return (
                  <>
                    <Text style={theme.typography.parentTitle}>
                      {member?.display_name ?? "?"}さんの「{cancelConfirmTarget.chore_title}」の報告を取り消しますか？
                    </Text>
                    <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }}>
                      {formatDateTimeFullJp(cancelConfirmTarget.reported_at)} ・ +{cancelConfirmTarget.points}pt
                    </Text>
                    <Text style={{ marginTop: theme.spacing.s2 }}>
                      取り消すと、たまったポイントや家族の木・ガチャの回数も1つ戻ります。元に戻せません。
                    </Text>
                    {cancelRowError?.id === cancelConfirmTarget.id && (
                      <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.statusBlocking }}>
                        {cancelRowError.message}
                      </Text>
                    )}
                    <View style={styles.confirmButtonRow}>
                      <AppButton
                        variant="secondary"
                        label="やめる"
                        onPress={() => setCancelConfirmTarget(null)}
                        disabled={cancelingId === cancelConfirmTarget.id}
                        style={{ flex: 1, marginRight: theme.spacing.s2 }}
                      />
                      <AppButton
                        variant="danger"
                        label={cancelingId === cancelConfirmTarget.id ? "取り消しています…" : "取り消す"}
                        onPress={() => void runCancel(cancelConfirmTarget.id)}
                        disabled={cancelingId === cancelConfirmTarget.id}
                        style={{ flex: 1 }}
                      />
                    </View>
                  </>
                );
              })()}
          </Card>
        </View>
      </Modal>

      {/* P9 完了報告詳細・リアクション */}
      <Modal visible={!!detailTarget} transparent animationType="fade" onRequestClose={() => setDetailTarget(null)}>
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard}>
            {detailTarget &&
              (() => {
                const member = memberOf(detailTarget.reported_by);
                const reactions = reactionsForCompletion(detailTarget.id);
                // [2026-08-16追加] P8カードと同じ役割判定（9.3章「トーンの書き分けルール」）。
                const isChildCard = member?.role === "child";
                const isOwnCard = detailTarget.reported_by === myParentId;
                return (
                  <>
                    <Text style={theme.typography.parentTitle}>
                      {detailTarget.chore_emoji} {detailTarget.chore_title}
                    </Text>
                    <Text style={{ marginTop: theme.spacing.s2 }}>
                      {member?.display_name} さんから ・ +{detailTarget.points}pt
                    </Text>
                    <Text style={{ marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }}>
                      {formatDateTimeFullJp(detailTarget.reported_at)}{" "}
                      {isChildCard ? "とどいた" : "きろくした"}
                    </Text>
                    {detailTarget.note ? (
                      <Text style={{ marginTop: theme.spacing.s2 }}>ひとことメモ: {detailTarget.note}</Text>
                    ) : null}

                    <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s4 }]}>
                      とどいたリアクション
                    </Text>
                    {reactions.length === 0 ? (
                      <Text
                        style={[
                          theme.typography.parentCaption,
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
                            <Text key={r.id} style={theme.typography.parentBody}>
                              {r.kind === "stamp" ? stampDef?.emoji : "💬"} {reactor?.display_name}より
                              {r.kind === "stamp" ? `「${stampDef?.label}」` : `「${r.comment_body}」`}{" "}
                              <Text style={theme.typography.parentCaption}>
                                {new Date(r.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                              </Text>
                            </Text>
                          );
                        })}
                      </View>
                    )}

                    {/* [2026-08-16追加] 3.1章「自分自身の完了報告カードにはリアクション
                        ボタン自体を表示しない」。受け取ったリアクション一覧（上のブロック）は
                        自分の完了報告でも表示したままにする。 */}
                    {!isOwnCard && (
                      <>
                        <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s4 }]}>
                          スタンプを贈る
                        </Text>
                        <View style={styles.stampGrid}>
                          {theme.stampDefinitions.map((s) => {
                            const sent = hasReactedWithStamp(detailTarget.id, myParentId, s.key as StampKey);
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

                        <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s4 }]}>
                          ひとことおくる（にんい・200文字まで）
                        </Text>
                        <TextInput
                          value={commentDraft}
                          onChangeText={setCommentDraft}
                          placeholder="あわ、上手にできてたよ"
                          multiline
                          maxLength={200}
                          style={styles.textArea}
                        />
                        <AppButton
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
  // [2026-08-16追加] 3.1章「子どものカード：…背景色は淡い彩色／保護者自身のカード：
  // 背景色はcolor-neutral-surfaceのまま（淡い彩色を加えない）」。子どものカードにのみ
  // 淡い彩色を追加し、保護者のカード（自分・配偶者いずれも）はCardデフォルトのまま。
  cardChildTint: { backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  // [2026-08-23追加・5回目のスコープ変更] みまもりメンバーの完了報告カードの控えめな配色。
  cardSupporterTint: { backgroundColor: theme.colors.supporterAccentSoft, borderColor: theme.colors.supporterAccent },
  cardTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  cardMeta: { marginTop: theme.spacing.s2 },
  // [2026-09-03追加] 28.4節。報告日時の右に取消リンクを置く。
  cardMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cancelLink: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  cancelRowError: { marginTop: 2, color: theme.colors.statusBlocking },
  cancelFlash: { marginTop: theme.spacing.s3, textAlign: "center", color: theme.colors.neutralTextSecondary },
  confirmButtonRow: { flexDirection: "row", marginTop: theme.spacing.s3 },
  stampRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2, marginTop: theme.spacing.s3 },
  stampBtn: {
    width: theme.tapTarget.parent,
    height: theme.tapTarget.parent,
    borderRadius: theme.radius.parentMd,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  stampBtnSent: {
    backgroundColor: theme.colors.brandPrimarySoft,
    borderColor: theme.colors.brandPrimary,
  },
  stampEmoji: { fontSize: 18 },
  commentLink: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
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
    backgroundColor: theme.colors.brandPrimarySoft,
    borderColor: theme.colors.brandPrimary,
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
