import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ListRenderItemInfo, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import ListScreen from "@/components/ListScreen";
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
import { STAMP_SEND_ERROR_MESSAGE, COMMENT_SEND_ERROR_MESSAGE } from "@/lib/errorMessages";
import type { ChoreCompletion, FamilyDrawingLineData, FamilyMember, StampKey } from "@/types/domain";
import { useNgWordGuard } from "@/hooks/useNgWordGuard";
import NgWordWarningText from "@/components/NgWordWarningText";

/**
 * S2 完了報告一覧・リアクション（みまもりメンバービュー、全件）
 * 参照: 画面一覧・遷移図.md 2.5節S2・3.12節、P8（app/parent/approvals.tsx）と同一構成
 *
 * ⚠️ **この画面はP8（`app/parent/approvals.tsx`）と写しの関係にある。片方だけ直さないこと。**
 * 見た目のトーン（supporter/parent）と取消の権限だけが違い、画面の骨組み・状態の持ち方・
 * 一覧の描き方は同じに保つ。実際に2026-09-19、P8だけが`FlatList`化され（255章・やること4-47）、
 * S2が全件描画のまま取り残されて遅いままだった（やること4-66・実装メモ266章で解消）。
 * 速さに効く骨組みは`@/components/ListScreen`に集約してあるので、**一覧の描き方を変えるときは
 * その部品を直す**こと（3画面に同時に効く）。
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
 *
 * [2026-09-20改訂・実装メモ.md 266章、やること.md 4-66] `Screen`（ScrollView）＋
 * `completions.map()`（家族の全履歴を毎回すべてDOMへマウントする実装）を
 * `FlatList`（仮想化）へ置き換えた。P8で実測した症状（1,000件で約1.3秒のDOMコミット＋
 * ペイント、255章）と同じものが、同じ件数を描く本画面にもそのまま残っていたための変更。
 * **見た目・文言・操作・データの取得範囲は1つも変えていない**（表示件数を絞る・
 * ページ分けする等の変更は含まない）。
 */
type LoadState = "loading" | "error" | "ready";

/**
 * [2026-09-20新設・266章] 1行分のカード。`React.memo`で分離し、他の行の状態変化
 * （スタンプ送信中・コメント入力など）で無関係な行まで再レンダーされないようにする。
 * P8の`CompletionRow`（255章）と同じ役割・同じprops構成だが、**別の部品として持つ**。
 * トーン（`supporterBodyMedium`等）・カードの`tone="supporter"`・取消リンクの出し方
 * （P8は「みまもりメンバーの報告には出さない」、S2は「自分の報告にだけ出す」）が
 * 恒久的に違い、共通化すると出し分けフラグだらけになって見た目が崩れやすくなるため
 * （266章の判断）。
 *
 * [既知の制約・P8と同じ] `hasReactedWithStamp`はコンテキスト（`src/data/store.tsx`）から
 * 渡された関数で、そのモジュールの`value`の`useMemo`依存が`state`全体であるため、
 * リアクション以外の家族データが変わったときも関数の参照が変わり得る。その場合この行の
 * メモ化は素通りして再レンダーされるが、仮想化により影響は画面に見えている行数だけに
 * 閉じるため実害は小さい（store.tsx側のメモ化見直しは本修正の対象外・255章参照）。
 */
type SupporterCompletionRowProps = {
  completion: ChoreCompletion;
  member?: FamilyMember;
  memberAvatarLineData?: FamilyDrawingLineData | null;
  myId: string;
  isCanceling: boolean;
  cancelErrorMessage?: string;
  onOpenDetail: (c: ChoreCompletion) => void;
  onCancelTap: (completionId: string) => void;
  onSendStamp: (completionId: string, stampKey: StampKey) => void;
  hasReactedWithStamp: (completionId: string, reactedBy: string, stampKey: StampKey) => boolean;
};

const SupporterCompletionRow = React.memo(function SupporterCompletionRow({
  completion: c,
  member,
  memberAvatarLineData,
  myId,
  isCanceling,
  cancelErrorMessage,
  onOpenDetail,
  onCancelTap,
  onSendStamp,
  hasReactedWithStamp,
}: SupporterCompletionRowProps) {
  const isOwnCard = c.reported_by === myId;
  // [2026-09-20・266章] `setCancelTick`（親、1分以内の報告があるときだけ動く）が
  // 変わるたびにこの行も再評価されるため、ここで毎回`isWithinCancelWindow`を呼んでも
  // 無期限の家族全履歴ではなく画面に見えている行数ぶんで済む（P8と同じ形）。
  const showCancelLink = isOwnCard && isWithinCancelWindow(c.reported_at);

  return (
    <Pressable onPress={() => onOpenDetail(c)}>
      <Card tone="supporter" style={styles.card}>
        <View style={styles.cardTop}>
          <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={32} lineData={memberAvatarLineData} expandOnTap />
          <Text style={theme.typography.supporterBodyMedium}>{member?.display_name}</Text>
          <Text style={{ flex: 1 }} />
          <Text style={theme.typography.supporterBodyMedium}>
            {/* [2026-09-17改訂・要件定義書07-28章決定9] 台紙型はpoints=NULL
                のため何も添えない。 */}
            {c.chore_emoji} {c.chore_title} {c.points != null ? `+${c.points}pt` : ""}
          </Text>
        </View>
        <View style={[styles.cardMeta, styles.cardMetaRow]}>
          <Text style={theme.typography.supporterCaption}>
            {formatDateTimeShort(c.reported_at)}
          </Text>
          {/* [2026-09-03追加] 28.6節。「じぶん」の行（報告から1分以内のみ）に
              「取消」リンクを追加する。他者の報告への取消権限は無い（07-7章）ため
              確認ダイアログは無い（常に本人操作、28.0節決定5）。 */}
          {showCancelLink && (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onCancelTap(c.id);
              }}
              disabled={isCanceling}
              hitSlop={8}
            >
              <Text style={styles.cancelLink}>{isCanceling ? "処理中…" : "取消"}</Text>
            </Pressable>
          )}
        </View>
        {cancelErrorMessage && (
          <Text style={[theme.typography.supporterCaption, styles.cancelRowError]}>{cancelErrorMessage}</Text>
        )}
        {!isOwnCard && (
          <View style={styles.stampRow}>
            {theme.stampDefinitions.map((s) => {
              const sent = hasReactedWithStamp(c.id, myId, s.key as StampKey);
              return (
                <Pressable
                  key={s.key}
                  onPress={() => onSendStamp(c.id, s.key as StampKey)}
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
            <Pressable onPress={() => onOpenDetail(c)}>
              <Text style={styles.commentLink}>＋コメント</Text>
            </Pressable>
          </View>
        )}
      </Card>
    </Pressable>
  );
});

export default function SupporterActivityScreen() {
  const { state, dispatch, reactionsForCompletion, hasReactedWithStamp, loading, loadError, memberAvatars } = useAppData();
  // [2026-09-11追加・実装メモ.md 190章] この画面を開いたことを記録し、
  // ベル／新着件数を未読方式で数えられるようにする。**入口がどこであったかは問わない**
  // （統括の指摘。「新着◯件」カードからでも「最近の報告」の行からでも同じ画面に来る）。
  useMarkSeen("completions", state.activeParentMemberId);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [detailTarget, setDetailTarget] = useState<ChoreCompletion | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const ngGuard = useNgWordGuard();

  // [2026-09-03追加] 要件定義書07-17章「完了報告の直後の取消」・UIUXデザイン部/成果物/
  // 主要画面ワイヤーフレーム.md 28.6節。みまもりメンバーは自分の報告のみ取り消せ、
  // 確認ダイアログは無い（常に本人操作のため。28.0節決定5）。
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelRowError, setCancelRowError] = useState<{ id: string; message: string } | null>(null);
  const [cancelFlashMessage, setCancelFlashMessage] = useState<string | null>(null);

  const myId = state.activeParentMemberId;

  useEffect(() => {
    if (!loading) setLoadState(loadError ? "error" : "ready");
  }, [loading, loadError]);

  // [2026-09-20改訂・266章／P8 255章と同じ] 家族の全履歴を毎レンダー並べ替え直していた
  // （`state.completions`が変わらない限り同じ結果なのに、スタンプ送信・コメント入力・
  // 取消チックなど無関係な再レンダーのたびにsort+filterをやり直していた）のをuseMemoに揃える。
  const completions = useMemo(
    () => [...state.completions].sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()),
    [state.completions]
  );

  // [2026-09-09追加・実装メモ.md 183章] 「かぞく」タブのプレビューカードと同じ
  // 数え方（直近24時間）をここでも見出しに出す（P8 app/parent/approvals.tsxと同型）。
  const newCount = useMemo(() => {
    const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
    return completions.filter((c) => new Date(c.reported_at).getTime() >= oneDayAgoMs).length;
  }, [completions]);

  // [2026-09-20改訂・266章／P8 255章と同じ] 1分の経過で取消リンクごと消すため10秒間隔で
  // 再評価する（28.0節決定4）点は変えないが、**直近の報告が1分以内のときだけ動かす**。
  // 以前は画面を開いている間ずっと無条件で動き続け、そのたびに全行再レンダーの引き金に
  // なっていた。`completions`は`reported_at`降順のため先頭（最新）だけ見れば足りる。
  // intervalは「まだ必要か」をtickのたびに自分で確認し、不要になれば自分で止める。
  const [, setCancelTick] = useState(0);
  useEffect(() => {
    const newest = completions[0];
    if (!newest || !isWithinCancelWindow(newest.reported_at)) return;
    const id = setInterval(() => {
      const stillNewest = completions[0];
      if (!stillNewest || !isWithinCancelWindow(stillNewest.reported_at)) {
        clearInterval(id);
        return;
      }
      setCancelTick((n) => n + 1);
    }, 10_000);
    return () => clearInterval(id);
  }, [completions]);

  const memberOf = useCallback((id: string) => state.members.find((m) => m.id === id), [state.members]);

  // [2026-09-10改訂・実装メモ.md 157章] 送信済みのスタンプをもう一度タップすると
  // 取消、違うスタンプをタップすると切替になる（統括指示）。
  // [2026-09-20・266章] 行コンポーネントへ安定した関数参照として渡すためuseCallback化
  // （React.memoが効くようにするため）。
  const sendStamp = useCallback(
    async (completionId: string, stampKey: StampKey) => {
      setReactionError(null);
      const result = await dispatch({ type: "TOGGLE_REACTION_STAMP", completionId, reactedBy: myId, stampKey });
      if (!result.ok) setReactionError(STAMP_SEND_ERROR_MESSAGE);
    },
    [dispatch, myId]
  );

  const openDetail = useCallback((c: ChoreCompletion) => {
    setCommentDraft("");
    setReactionError(null);
    ngGuard.clear();
    setDetailTarget(c);
    // ngGuard.clear自体はuseCallback（空配列）で安定している（app/parent/approvals.tsxと同じ理由）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ngGuard.clear]);

  const runCancel = useCallback(
    async (completionId: string) => {
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
    },
    [dispatch]
  );

  // 取消は自分の報告にしか出ないため、確認ダイアログを挟まず即実行する（28.0節決定5）。
  const handleCancelTap = useCallback((completionId: string) => void runCancel(completionId), [runCancel]);

  const sendComment = async () => {
    if (!detailTarget) return;
    const body = commentDraft.trim();
    if (!body) return;
    if (ngGuard.guard(body)) return;
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
      setReactionError(COMMENT_SEND_ERROR_MESSAGE);
      return;
    }
    setCommentDraft("");
    setDetailTarget(null);
  };

  const listHeader = (
    <>
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
    </>
  );

  const listFooter = (
    <>
      {/* [2026-09-03追加] 28.6節「取消成功」のスナックバー相当（1.5秒で自動消滅）。 */}
      {cancelFlashMessage && (
        <Text style={[theme.typography.supporterCaption, styles.cancelFlash]}>{cancelFlashMessage}</Text>
      )}

      <AppButton tone="supporter" label="かぞくタブへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/supporter/family")} />
    </>
  );

  const renderItem = ({ item: c }: ListRenderItemInfo<ChoreCompletion>) => {
    const member = memberOf(c.reported_by);
    return (
      <SupporterCompletionRow
        completion={c}
        member={member}
        memberAvatarLineData={member ? memberAvatars[member.id] : undefined}
        myId={myId}
        isCanceling={cancelingId === c.id}
        cancelErrorMessage={cancelRowError?.id === c.id ? cancelRowError.message : undefined}
        onOpenDetail={openDetail}
        onCancelTap={handleCancelTap}
        onSendStamp={sendStamp}
        hasReactedWithStamp={hasReactedWithStamp}
      />
    );
  };

  return (
    // [2026-09-20・266章] 一覧の骨組み（`Screen`を`scroll={false}`にして`FlatList`自身を
    // 唯一のスクロールコンテナにする・`Screen`と同じpaddingを`contentContainerStyle`へ
    // 移す・仮想化の設定）は`@/components/ListScreen`に集約した。P8・C18も同じ部品を使う。
    <ListScreen
      tone="supporter"
      data={loadState === "ready" ? completions : []}
      keyExtractor={(c) => c.id}
      renderItem={renderItem}
      ListHeaderComponent={listHeader}
      ListFooterComponent={listFooter}
    >
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
                      {member?.display_name} さんから
                      {detailTarget.points != null ? ` ・ +${detailTarget.points}pt` : ""}
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

                        {/* [2026-09-21追加・要件定義書07-32章 決定20〜24] 保護者
                            トグルがオフの間はこの欄・送信ボタンごと描かない
                            （app/parent/approvals.tsxと同じ扱い）。 */}
                        {state.family.social_interactions_enabled && (
                          <>
                            <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s4 }]}>
                              ひとことおくる（にんい・200文字まで）
                            </Text>
                            <TextInput
                              value={commentDraft}
                              onChangeText={(t) => {
                                setCommentDraft(t);
                                ngGuard.clear();
                              }}
                              placeholder="よくがんばったね"
                              multiline
                              maxLength={200}
                              style={styles.textArea}
                            />
                            {ngGuard.blocked && <NgWordWarningText tone="supporter" />}
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
    </ListScreen>
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
