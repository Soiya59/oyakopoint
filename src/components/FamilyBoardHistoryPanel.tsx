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
 *   一覧に表示するのは閲覧者自身が送ったかどうかだけで、他者の反応の有無・件数は
 *   取得すらしなかった（RLS側で保証）。
 * [2026-09-01再改訂・第4段階・実装メモ.md 104章] 統括フィードバック「押しても相手に
 * 伝わっていない。完了報告みたいに複数クリックできる感じでも良い。一覧に他人の反応を
 * 出してよい。LINEみたいに個数もわかる感じで」を受け、第3段階の設計を作り直した
 * （22.0節決定9・決定10、22.2.1節「一覧での表示（LINE風・個数）」）。
 *   - スタンプの種類ごとに1個まで押せる（4種類すべて押せる）。押した後も4つ並んだまま
 *     残す（縮小表示は撤回）。送信済みのスタンプは枠線・背景の強調のみで示す（✓は
 *     付けない、22.2.1節「一覧での表示」参照）。
 *   - 一覧には投稿ごとにスタンプの種類別の個数を表示する（LINE風）。0件は正方形の
 *     箱（絵文字のみ）、1件以上はピル型（絵文字＋個数、2桁超は「9+」）。
 *   - 自分の投稿には送信ボタンは出さないが、届いた反応（個数のみ）は読み取り専用の
 *     テキストで表示する（枠のある箱ではなく、タップしても何も起きないプレーンな
 *     テキスト。22.2.1節「自分の投稿での見え方」）。
 *   - 反応が1件以上ある投稿には「だれが送ったか見る」リンクを出し、タップで軽量な
 *     インライン展開（新規の詳細画面は作らない、22.0節決定8を維持）を開く。中身は
 *     `onViewReactors`経由で遅延取得する（22.2.1節「内訳の見せ方」）。
 * プッシュ通知は実装しない（本部長指示、要件定義書08章参照）。
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import Card from "./Card";
import MemberAvatar from "./MemberAvatar";
import { EmptyState, ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";
import type { FamilyBoardPostWithAuthor, FamilyBoardReactionWithReactor, StampKey } from "@/types/domain";

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

  /** [2026-09-01追加・第3段階、104章で複数種類対応] ここから下はリアクション
   *  （スタンプ）用のprops。 */
  /** 現在送信中のリアクション（1件のみ許可。同じ投稿の他のスタンプは送信可能）。 */
  reactingReaction: { postId: string; stampKey: StampKey } | null;
  /** 直近のリアクション送信でエラーになった場合の{postId, message}。 */
  reactionError: { postId: string; message: string } | null;
  /** リアクション送信の実処理（INSERT呼び出し）。タップ即送信（確認ダイアログなし）。 */
  onReact: (postId: string, stampKey: StampKey) => Promise<boolean>;
  /** [2026-09-01追加・104章] 「だれが送ったか見る」を開いたときの遅延取得。 */
  onViewReactors: (
    postId: string
  ) => Promise<{ ok: true; data: FamilyBoardReactionWithReactor[] } | { ok: false; message: string }>;
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

/** 22.2.1節「内訳の見せ方」＝3.2節P9「とどいたリアクション」の時刻表示（"8:10"）を流用。 */
function formatTimeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

/** 削除確認モーダル（22.4節）に載せる本文の抜粋。 */
function excerpt(body: string, max = 20): string {
  return body.length > max ? `${body.slice(0, max)}…` : body;
}

/** 22.2.1節「一覧での表示（LINE風・個数）」: 2桁超は「9+」に丸める。 */
function countLabel(count: number): string {
  return count > 9 ? "9+" : String(count);
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

/** 22.2.1節「3ロールのトーン・文言」内訳リンクの文言。 */
const VIEW_REACTORS_LABEL: Record<Tone, string> = {
  parent: "だれが送ったか見る",
  child: "だれが おくったか みる",
  supporter: "だれが送ったか見る",
};

const REACTORS_CLOSE_LABEL: Record<Tone, string> = {
  parent: "とじる",
  child: "とじる",
  supporter: "とじる",
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
 * 未反応（count===0）のときのラベル。
 */
function reactAccessibilityLabel(tone: Tone, stampLabel: string): string {
  return tone === "child" ? `${stampLabel} を おくる` : `${stampLabel} を送る`;
}

/**
 * [2026-09-01追加・104章] 個数付きスタンプのアクセシビリティラベル
 * （22.2.1節「3ロールのトーン・文言」表）。count>0のときに使う（自分が送信済みか
 * どうかに関わらず、人数を含めたラベルにする）。
 */
function countAccessibilityLabel(tone: Tone, stampLabel: string, count: number): string {
  return tone === "child" ? `${stampLabel}・${count}にんが おくったよ` : `${stampLabel}・${count}人が送信済み`;
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

/**
 * [2026-09-01改訂・104章] 22.2.1節「一覧での表示（LINE風・個数）」: 個数0件のスタンプは
 * `stampBtn`と同じ正方形（幅＝高さ＝ロールごとのタップターゲット基準）。
 * 保護者44dp／みまもりメンバー48dp／子ども56dp。
 */
const STAMP_BOX_SIZE: Record<Tone, number> = {
  parent: theme.tapTarget.parent,
  supporter: theme.tapTarget.supporterPrimary,
  child: theme.tapTarget.child,
};
/** 子ども向けはタップターゲット基準に合わせて絵文字自体もやや大きく表示する。 */
const STAMP_FONT_SIZE: Record<Tone, number> = { parent: 22, child: 27, supporter: 22 };

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
  onViewReactors,
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

  // [2026-09-01追加・104章] 22.2.1節「内訳の見せ方」。1件のみ展開できる
  // （confirmDeleteIdと同じ「1件ずつ」パターン）。
  const [viewingReactorsId, setViewingReactorsId] = useState<string | null>(null);
  const [reactorsLoading, setReactorsLoading] = useState(false);
  const [reactorsError, setReactorsError] = useState<string | null>(null);
  const [reactorsData, setReactorsData] = useState<FamilyBoardReactionWithReactor[]>([]);

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

  const handleToggleReactors = async (postId: string) => {
    if (viewingReactorsId === postId) {
      setViewingReactorsId(null);
      return;
    }
    setViewingReactorsId(postId);
    setReactorsData([]);
    setReactorsError(null);
    setReactorsLoading(true);
    const res = await onViewReactors(postId);
    setReactorsLoading(false);
    if (!res.ok) {
      setReactorsError(res.message);
      return;
    }
    setReactorsData(res.data);
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

            // [2026-09-01改訂・104章] `reactions`は家族全員分の反応
            // （stamp_key・reactor_member_idのみ）。ここでスタンプ種別ごとに集計する。
            const reactions = post.reactions ?? [];
            const countFor = (key: StampKey) => reactions.filter((r) => r.stamp_key === key).length;
            const mineFor = (key: StampKey) => reactions.some((r) => r.stamp_key === key && r.reactor_member_id === myMemberId);
            const hasAnyReaction = reactions.length > 0;
            const isReactingThisPost = reactingReaction?.postId === post.id;
            const reactRowError = reactionError?.postId === post.id ? reactionError.message : null;
            const isViewingReactors = viewingReactorsId === post.id;

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
                  <>
                    {(canCancel || canDelete || canReact || (isOwn && hasAnyReaction)) && (
                      <View style={[styles.actionRow, styles.actionRowSpread]}>
                        {canReact ? (
                          // 他者の投稿: スタンプ4つ（個数付き、22.2.1節「一覧での表示」）。
                          <View style={styles.stampRow}>
                            {theme.stampDefinitions.map((s) => {
                              const key = s.key as StampKey;
                              const count = countFor(key);
                              const mine = mineFor(key);
                              const isThisStampSending = isReactingThisPost && reactingReaction?.stampKey === key;
                              const boxSizeStyle =
                                count > 0
                                  ? {
                                      height: STAMP_BOX_SIZE[tone],
                                      minWidth: STAMP_BOX_SIZE[tone],
                                      paddingHorizontal: theme.spacing.s2,
                                    }
                                  : { width: STAMP_BOX_SIZE[tone], height: STAMP_BOX_SIZE[tone] };
                              return (
                                <Pressable
                                  key={s.key}
                                  disabled={mine || isThisStampSending}
                                  onPress={() => void handleReact(post.id, key)}
                                  accessibilityLabel={
                                    count > 0 ? countAccessibilityLabel(tone, s.label, count) : reactAccessibilityLabel(tone, s.label)
                                  }
                                  style={[styles.stampBox, boxSizeStyle, mine && styles.stampBoxSent]}
                                >
                                  <Text
                                    style={[
                                      styles.stampEmoji,
                                      { fontSize: STAMP_FONT_SIZE[tone] },
                                      isThisStampSending && styles.stampEmojiSending,
                                    ]}
                                  >
                                    {s.emoji}
                                  </Text>
                                  {count > 0 && <Text style={styles.stampCount}>{countLabel(count)}</Text>}
                                </Pressable>
                              );
                            })}
                          </View>
                        ) : isOwn && hasAnyReaction ? (
                          // 自分の投稿: 読み取り専用の個数表示（枠なし、送信ボタンではない）。
                          // 22.2.1節「自分の投稿での見え方」。
                          <Text style={bodyStyle}>
                            {theme.stampDefinitions
                              .filter((s) => countFor(s.key as StampKey) > 0)
                              .map((s) => `${s.emoji}${countLabel(countFor(s.key as StampKey))}`)
                              .join(" ")}
                          </Text>
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
                    )}

                    {/* [2026-09-01追加・104章] 22.2.1節「内訳の見せ方」。合計反応数が
                        1件以上のときだけリンクを出す（0件の投稿には表示しない）。 */}
                    {hasAnyReaction && (
                      <Pressable onPress={() => void handleToggleReactors(post.id)} style={{ marginTop: theme.spacing.s1 }}>
                        <Text style={styles.viewReactorsLink}>{VIEW_REACTORS_LABEL[tone]}</Text>
                      </Pressable>
                    )}

                    {isViewingReactors && (
                      <View style={styles.reactorsBlock}>
                        {reactorsLoading ? (
                          <Text style={captionStyle}>{isChild ? "よみこみちゅう…" : "読み込み中…"}</Text>
                        ) : reactorsError ? (
                          <Text style={[captionStyle, { color: isChild ? theme.colors.brandPrimaryStrong : theme.colors.statusBlocking }]}>
                            {isChild ? "うまく よみこめなかったよ" : "読み込みに失敗しました"}
                          </Text>
                        ) : (
                          <View style={{ gap: theme.spacing.s1 }}>
                            {reactorsData.map((r) => {
                              const stampDef = theme.stampDefinitions.find((s) => s.key === r.stamp_key);
                              return (
                                <Text key={r.id} style={bodyStyle}>
                                  {stampDef?.emoji} {r.family_members?.display_name ?? "?"}より「{stampDef?.label}」{" "}
                                  <Text style={captionStyle}>{formatTimeOnly(r.created_at)}</Text>
                                </Text>
                              );
                            })}
                          </View>
                        )}
                        <Pressable onPress={() => setViewingReactorsId(null)} style={{ marginTop: theme.spacing.s2 }}>
                          <Text style={styles.actionLink}>{REACTORS_CLOSE_LABEL[tone]}</Text>
                        </Pressable>
                      </View>
                    )}
                  </>
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
  stampRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2, flexWrap: "wrap" },
  // [2026-09-01改訂・104章] 完了報告（app/parent/approvals.tsx）のstampBtnと同じ
  // 枠線つき・角丸の箱を踏襲する。個数0件は正方形（width/heightで指定）、
  // 1件以上はピル型（height固定＋minWidthで内容に合わせて横に伸びる）。
  stampBox: {
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralBg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  // 送信済み（自分がこのスタンプを送った）: stampBtnSentと同じ強調配色。✓は付けない
  // （22.2.1節「個数の右に追加で✓は付けない」）。
  stampBoxSent: {
    backgroundColor: theme.colors.brandPrimarySoft,
    borderColor: theme.colors.brandPrimary,
  },
  stampEmoji: {},
  // 送信中: タップしたスタンプを淡色表示にする（22.2.1節「押したあとの見え方」）。
  stampEmojiSending: { opacity: 0.4 },
  stampCount: { marginLeft: 2, fontSize: 12, fontWeight: "600", color: theme.colors.neutralTextPrimary },
  viewReactorsLink: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline", fontSize: 12 },
  reactorsBlock: {
    marginTop: theme.spacing.s2,
    paddingTop: theme.spacing.s2,
    borderTopWidth: 1,
    borderTopColor: theme.colors.neutralBorder,
  },
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
