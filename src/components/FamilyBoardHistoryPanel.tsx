/**
 * 家族の書き込みボード：投稿履歴一覧（P32／C27／S20）本体の3ロール共通コンポーネント。
 * 参照: 主要画面ワイヤーフレーム.md 22.0節決定3・22.2節・22.2.1節・22.3節・22.4節。
 *
 * [2026-08-28新設・第1段階「見る側」のみ] 新しい順の投稿一覧＋「もっと見る」の表示のみ。
 * [2026-08-29追加・第2段階] 以下を追加した（「書く側」）。
 *   - 「投稿する」ボタン（P33/C28/S21への入口）と、今日あと何件投稿できるかの残数表示・
 *     上限到達時のブロック文言（22.3.3節）
 *   - 「取消」（本人・5分以内・確認ダイアログなし）／「削除」（保護者の是正削除・
 *     確認ダイアログあり、P32/S20のみ）の各リンク（22.4節）
 * [2026-09-01追加・第3段階・実装メモ.md 103章] 投稿へのスタンプリアクション
 * （要件定義書07-14章「リアクション（スタンプ）の追加」、22.0節決定8・22.2.1節）。
 *   - アクション行（取消/削除の行）に、自分以外の投稿にのみスタンプ4つを追加する。
 *     描画条件を`canCancel || canDelete`から`canCancel || canDelete || canReact`へ
 *     変更した（22.2.1節「アクション行の描画条件の見直し」）。
 *   - 一覧に表示するのは閲覧者自身が送ったかどうかだけ（`post.my_reaction`）。他者の
 *     反応の有無・件数・反応者は取得すらされない（RLS側で保証。src/data/api.ts参照）。
 * プッシュ通知は実装しない（本部長指示、要件定義書08章参照）。
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import Card from "./Card";
import MemberAvatar from "./MemberAvatar";
import { EmptyState, ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";
import type { FamilyBoardPostWithAuthor, StampKey } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";

const FIVE_MIN_MS = 5 * 60 * 1000;

export interface FamilyBoardHistoryPanelProps {
  tone: Tone;
  loadState: LoadState;
  posts: FamilyBoardPostWithAuthor[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;

  /** [2026-08-29追加・第2段階] ここから下は「書く側」用のprops。 */
  /** 自分のmember_id（`post.author_member_id`との比較に使う）。 */
  myMemberId: string;
  /** 今日まだ投稿できる残り件数（0〜5）。取得前・取得失敗時はnull（この場合はボタンを
   *  ブロックしない＝実装メモ.md「D」の教訓、フォールバックを安全側＝操作可能側に倒す）。 */
  remaining: number | null;
  /** 「投稿する」ボタン押下時（P33/C28/S21への遷移は呼び出し側=画面が担当）。 */
  onCompose: () => void;
  /** 現在削除/取消のRPCが処理中の投稿ID（1件ずつのみ処理を許可する）。 */
  removingPostId: string | null;
  /** 直近の削除/取消アクションでエラーになった場合の{postId, message}。 */
  actionError: { postId: string; message: string } | null;
  /** 削除/取消の実処理（RPC呼び出し）。「取消」「削除」いずれもこの1つを呼ぶ
   *  （権限判定はサーバー側のみが行うため、UI側は確認ダイアログの有無だけを分ける）。 */
  onRemovePost: (postId: string) => Promise<boolean>;

  /** [2026-09-01追加・第3段階] ここから下はリアクション（スタンプ）用のprops。 */
  /** 現在送信中のリアクション（1件のみ許可。連打・二重送信のUI側防止）。 */
  reactingReaction: { postId: string; stampKey: StampKey } | null;
  /** 直近のリアクション送信でエラーになった場合の{postId, message}。 */
  reactionError: { postId: string; message: string } | null;
  /** リアクション送信の実処理（INSERT呼び出し）。タップ即送信（確認ダイアログなし）。 */
  onReact: (postId: string, stampKey: StampKey) => Promise<boolean>;
}

const bodyStyleFor = (tone: Tone) =>
  tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
const bodyMediumStyleFor = (tone: Tone) =>
  tone === "child"
    ? theme.typography.childBody
    : tone === "supporter"
    ? theme.typography.supporterBodyMedium
    : theme.typography.parentBodyMedium;
const captionStyleFor = (tone: Tone) =>
  tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;

/** ワイヤーフレーム.md 22.2節P32/S20の表示形式（"8/27 19:40"）に合わせる。 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  const time = d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

/** ワイヤーフレーム.md 22.2節C27の表示形式（時刻なし、"8/27"）に合わせる。 */
function formatDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

/** 削除確認モーダル（22.4節）に載せる本文の抜粋。 */
function excerpt(body: string, max = 20): string {
  return body.length > max ? `${body.slice(0, max)}…` : body;
}

/** 22.3.3節「投稿数上限（1日5件）到達時の案内」の文言（ロールごと）。 */
const LIMIT_MESSAGE: Record<Tone, string> = {
  parent: "今日はもう5件書き込みました。また明日、書き込めます",
  child: "きょうは もう 5かい とどけたよ。また あした とどけてね",
  supporter: "今日はもう5件書き込みました。また明日、書き込んでくださいね",
};

const COMPOSE_LABEL: Record<Tone, string> = {
  parent: "書き込む",
  child: "かきこむ",
  supporter: "書き込む",
};

const CANCEL_LABEL: Record<Tone, string> = {
  parent: "取消",
  child: "とりけす",
  supporter: "取消",
};

/**
 * 削除/取消アクションのエラーメッセージ表示用。DBのRAISE EXCEPTIONメッセージ
 * （設計部/成果物/スキーマ設計.sql 35c章）はそのまま日本語の文として表示できる
 * ものだが、子ども向けだけはトーン（ひらがな中心・煽らない）に合わせて言い換える
 * （唯一子ども側で実際に起こり得るのは「自分の投稿・5分超過」のケースのみ。
 * 22.4節「子ども向けには削除導線自体が存在しない」ため保護者/権限系のエラーは
 * 子ども向け画面には到達しない）。
 */
function actionErrorText(tone: Tone, message: string): string {
  if (tone !== "child") return message;
  if (message.includes("5分")) return "5ふん すぎちゃったから、とりけせないよ";
  return "うまく できなかったよ。もういちど ためしてね";
}

/**
 * 22.2.1節「3ロールのトーン・文言」。スタンプの視覚的な絵文字・アイコンは3ロール
 * 共通（theme.stampDefinitions）で、文言・アクセシビリティラベルのみ書き分ける。
 */
function reactAccessibilityLabel(tone: Tone, stampLabel: string): string {
  return tone === "child" ? `${stampLabel} を おくる` : `${stampLabel} を送る`;
}

function sentAccessibilityLabel(tone: Tone, stampLabel: string): string {
  return tone === "child" ? `${stampLabel} を おくったよ` : `${stampLabel} を送信済み`;
}

/** 22.2.1節「送信失敗の文言」。 */
const REACT_FAIL_TEXT: Record<Tone, string> = {
  parent: "送れませんでした。もう一度お試しください",
  child: "おくれなかったよ。もういちど おしてね",
  supporter: "送れませんでした。もう一度お試しください",
};

/** 22.2.1節「削除済み投稿への反応失敗」。 */
const REACT_POST_DELETED_TEXT: Record<Tone, string> = {
  parent: "この書き込みはすでに削除されています",
  child: "このかきこみは もう なくなっちゃったみたい",
  supporter: "この書き込みはすでに削除されています",
};

/**
 * リアクション送信エラーの表示文言を決める。「対象投稿が削除済み」（trigger内の
 * SELECTがRLSにより空振りして`foreign_key_violation`になったケース、22.2.1節参照）
 * だけは専用文言に差し替え、それ以外は通信エラー等の一般的な失敗として扱う。
 */
function reactionErrorText(tone: Tone, message: string): string {
  if (message.includes("見つからない")) return REACT_POST_DELETED_TEXT[tone];
  return REACT_FAIL_TEXT[tone];
}

/** 22.2.1節「アクション行のレイアウト」: 子ども向けはタップターゲット基準（56dp相当）に
 *  合わせてやや大きく表示する。 */
const STAMP_FONT_SIZE: Record<Tone, number> = { parent: 22, child: 27, supporter: 22 };
/** hitSlopで実際のタップ可能領域を役割ごとのタップターゲット基準まで広げる
 *  （デザイントークン.md 3章: 保護者44dp／みまもりメンバー48dp推奨／子ども56dp）。
 *  見た目のフォントサイズより広い分をhitSlopで補う。 */
const STAMP_HIT_SLOP: Record<Tone, number> = { parent: 11, child: 14, supporter: 13 };

export function FamilyBoardHistoryPanel({
  tone,
  loadState,
  posts,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
  myMemberId,
  remaining,
  onCompose,
  removingPostId,
  actionError,
  onRemovePost,
  reactingReaction,
  reactionError,
  onReact,
}: FamilyBoardHistoryPanelProps) {
  const isChild = tone === "child";
  const isParent = tone === "parent";
  const bodyStyle = bodyStyleFor(tone);
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  // CollectorShelfPanelと同じ判断: EmptyState/ErrorStateは"parent"/"child"の2toneしか
  // 持たないため、supporterはparent側のトーン（控えめな表現）を流用する
  // （app/supporter/history.tsxの既存の呼び出しと同じ扱い）。
  const stateTone: "parent" | "child" = isChild ? "child" : "parent";

  // 22.4節: 保護者の是正削除のみ確認モーダルを挟む（本人の取消は挟まない）。
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const isBlocked = remaining === 0;

  const handleCancel = async (postId: string) => {
    await onRemovePost(postId);
  };

  const handleConfirmDelete = async (postId: string) => {
    await onRemovePost(postId);
    setConfirmDeleteId(null);
  };

  // 22.2.1節「押し間違いの扱い」: 確認ダイアログを挟まずタップ即送信する。
  const handleReact = async (postId: string, stampKey: StampKey) => {
    await onReact(postId, stampKey);
  };

  return (
    <View style={{ marginTop: theme.spacing.s4 }}>
      {loadState === "ready" && (
        <View>
          <AppButton
            tone={tone}
            label={COMPOSE_LABEL[tone]}
            fullWidth
            disabled={isBlocked}
            onPress={onCompose}
          />
          {isBlocked ? (
            <Text style={[captionStyle, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
              {LIMIT_MESSAGE[tone]}
            </Text>
          ) : remaining !== null ? (
            <Text style={[captionStyle, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
              {isChild ? `きょう あと ${remaining}かい とどけられるよ` : `今日あと${remaining}件書き込めます`}
            </Text>
          ) : null}
        </View>
      )}

      {loadState === "loading" && <SkeletonList count={3} />}

      {loadState === "error" && (
        <ErrorState
          tone={stateTone}
          title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"}
          onRetry={onRetry}
        />
      )}

      {loadState === "ready" && posts.length === 0 && (
        <EmptyState
          tone={stateTone}
          emoji="📝"
          title={
            isChild
              ? "まだ だれも かいてないよ。かぞくに つたえたいことが あったら かいてみよう！"
              : "まだ書き込みはありません。気づいたことがあれば、書いてみましょう"
          }
        />
      )}

      {loadState === "ready" && posts.length > 0 && (
        <View style={{ gap: theme.spacing.s2, marginTop: theme.spacing.s4 }}>
          {posts.map((post) => {
            const isOwn = !!myMemberId && post.author_member_id === myMemberId;
            const withinFiveMinutes = Date.now() - new Date(post.created_at).getTime() <= FIVE_MIN_MS;
            const canCancel = isOwn && withinFiveMinutes;
            // 決定5: 削除（保護者の是正）は保護者のみ、対象・時間の制限なく常に表示する。
            const canDelete = isParent;
            // 22.2.1節「アクション行の描画条件の見直し」: 自分の投稿でなければ、
            // 3ロールいずれでも常にtrue（ロールによる非対称制限は無い）。
            const canReact = !isOwn;
            const isProcessing = removingPostId === post.id;
            const rowError = actionError?.postId === post.id ? actionError.message : null;
            const isConfirming = confirmDeleteId === post.id;

            // 22.2.1節「押したあとの見え方（状態定義）」。
            const myStamp = post.my_reaction?.[0]?.stamp_key ?? null;
            const isReactingThisPost = reactingReaction?.postId === post.id;
            const reactRowError = reactionError?.postId === post.id ? reactionError.message : null;

            return (
              <Card key={post.id} tone={tone}>
                <View style={styles.headerRow}>
                  <MemberAvatar
                    name={post.family_members?.display_name ?? "?"}
                    color={post.family_members?.avatar_color}
                    size={24}
                  />
                  <Text style={[bodyMediumStyle, { marginLeft: theme.spacing.s2, flex: 1 }]}>
                    {post.family_members?.display_name ?? "?"}
                  </Text>
                  <Text style={captionStyle}>{isChild ? formatDateOnly(post.created_at) : formatDateTime(post.created_at)}</Text>
                </View>
                <Text style={[bodyStyle, { marginTop: theme.spacing.s2 }]}>{post.body}</Text>

                {isConfirming ? (
                  <View style={styles.confirmBlock}>
                    <Text style={[bodyMediumStyle]}>この書き込みを削除しますか？</Text>
                    <Text style={[captionStyle, { marginTop: theme.spacing.s2 }]}>
                      {post.family_members?.display_name ?? "?"} {formatDateTime(post.created_at)}
                    </Text>
                    <Text style={[bodyStyle, { marginTop: theme.spacing.s1 }]}>「{excerpt(post.body)}」</Text>
                    <Text style={[captionStyle, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
                      削除すると元に戻せません。
                    </Text>
                    <View style={styles.confirmButtonRow}>
                      <AppButton
                        tone={tone}
                        variant="secondary"
                        label="やめる"
                        onPress={() => setConfirmDeleteId(null)}
                        disabled={isProcessing}
                        style={{ flex: 1, marginRight: theme.spacing.s2 }}
                      />
                      <AppButton
                        tone={tone}
                        variant="danger"
                        label={isProcessing ? "削除中…" : "削除する"}
                        onPress={() => void handleConfirmDelete(post.id)}
                        disabled={isProcessing}
                        style={{ flex: 1 }}
                      />
                    </View>
                  </View>
                ) : (
                  (canCancel || canDelete || canReact) && (
                    <View style={[styles.actionRow, styles.actionRowSpread]}>
                      {canReact ? (
                        myStamp ? (
                          // 送信成功/既送: 選んだ1つのみ「✓」付きで残す（22.2.1節）。
                          <View style={styles.stampRow}>
                            <Text
                              accessibilityLabel={sentAccessibilityLabel(
                                tone,
                                theme.stampDefinitions.find((s) => s.key === myStamp)?.label ?? ""
                              )}
                              style={[styles.stampEmoji, { fontSize: STAMP_FONT_SIZE[tone] }]}
                            >
                              {theme.stampDefinitions.find((s) => s.key === myStamp)?.emoji}✓
                            </Text>
                          </View>
                        ) : (
                          <View style={styles.stampRow}>
                            {theme.stampDefinitions.map((s) => {
                              const isThisStampSending = isReactingThisPost && reactingReaction?.stampKey === s.key;
                              return (
                                <Pressable
                                  key={s.key}
                                  disabled={isReactingThisPost}
                                  onPress={() => void handleReact(post.id, s.key as StampKey)}
                                  hitSlop={STAMP_HIT_SLOP[tone]}
                                  accessibilityLabel={reactAccessibilityLabel(tone, s.label)}
                                  style={styles.stampButton}
                                >
                                  <Text
                                    style={[
                                      styles.stampEmoji,
                                      { fontSize: STAMP_FONT_SIZE[tone] },
                                      isReactingThisPost && styles.stampEmojiSending,
                                      isThisStampSending && styles.stampEmojiActive,
                                    ]}
                                  >
                                    {s.emoji}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        )
                      ) : (
                        <View />
                      )}

                      {(canCancel || canDelete) && (
                        <View style={styles.actionLinksRow}>
                          {canCancel && (
                            <Pressable onPress={() => void handleCancel(post.id)} disabled={isProcessing}>
                              <Text style={styles.actionLink}>
                                {isProcessing ? "…" : CANCEL_LABEL[tone]}
                              </Text>
                            </Pressable>
                          )}
                          {canDelete && (
                            <Pressable
                              onPress={() => setConfirmDeleteId(post.id)}
                              disabled={isProcessing}
                              style={{ marginLeft: canCancel ? theme.spacing.s4 : 0 }}
                            >
                              <Text style={styles.actionLink}>削除</Text>
                            </Pressable>
                          )}
                        </View>
                      )}
                    </View>
                  )
                )}

                {rowError && !isConfirming && (
                  <Text
                    style={[
                      captionStyle,
                      styles.rowError,
                      // statusBlocking（赤）は保護者向け画面限定（theme.ts注記）。子ども向けは
                      // brandPrimaryStrongで代替する（ChildGratitudeSendScreenのlimitMessageと同じ扱い）。
                      { color: isChild ? theme.colors.brandPrimaryStrong : theme.colors.statusBlocking },
                    ]}
                  >
                    {actionErrorText(tone, rowError)}
                  </Text>
                )}

                {reactRowError && !isConfirming && (
                  <Text
                    style={[
                      captionStyle,
                      styles.rowError,
                      { color: isChild ? theme.colors.brandPrimaryStrong : theme.colors.statusBlocking },
                    ]}
                  >
                    {reactionErrorText(tone, reactRowError)}
                  </Text>
                )}
              </Card>
            );
          })}

          {hasMore && (
            <AppButton
              tone={tone}
              variant="secondary"
              label={isChild ? "もっと みる" : "もっと見る"}
              loading={loadingMore}
              onPress={onLoadMore}
              style={{ marginTop: theme.spacing.s2 }}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center" },
  actionRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: theme.spacing.s2, flexWrap: "wrap" },
  // 22.2.1節「アクション行のレイアウト」: 左側にスタンプ、右側に取消/削除を置き、
  // space-betweenにする（自分の投稿等でスタンプ側が空の場合は右寄せのみになる、
  // 従来どおりのactionRowと見た目が変わらない）。
  actionRowSpread: { justifyContent: "space-between", alignItems: "center" },
  // canCancel/canDelete側の内側の行。外側のactionRowSpreadで既にmarginTopを
  // 持たせているため、二重にmarginTopを付けないよう分けている。
  actionLinksRow: { flexDirection: "row", alignItems: "center" },
  actionLink: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  // 22.2.1節「アクション行のレイアウト」: スタンプ間の間隔はspace-2（8dp）以上。
  stampRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  stampButton: { alignItems: "center", justifyContent: "center" },
  stampEmoji: {},
  // 送信中: タップしたスタンプを淡色表示にする（22.2.1節「押したあとの見え方」）。
  stampEmojiSending: { opacity: 0.4 },
  stampEmojiActive: { opacity: 0.7 },
  confirmBlock: {
    marginTop: theme.spacing.s3,
    paddingTop: theme.spacing.s3,
    borderTopWidth: 1,
    borderTopColor: theme.colors.neutralBorder,
  },
  confirmButtonRow: { flexDirection: "row", marginTop: theme.spacing.s3 },
  rowError: { marginTop: theme.spacing.s2 },
});

export default FamilyBoardHistoryPanel;
