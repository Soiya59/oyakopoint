/**
 * 家族の書き込みボード：投稿履歴一覧（P32／C27／S20）本体の3ロール共通コンポーネント。
 * 参照: 主要画面ワイヤーフレーム.md 22.0節決定3・22.2節。
 *
 * [2026-08-28新設・第1段階「見る側」のみ] 新しい順の投稿一覧＋「もっと見る」の
 * 表示のみを行う。以下は本部長指示によりこの段階では実装しない
 * （22.2節ワイヤーフレームには描かれているが、対応する画面・処理自体が
 * 第2段階まで存在しないため、導線を出すと行き止まりのリンクになってしまう）。
 *   - 「書き込む」ボタン（投稿画面P33/C28/S21は第2段階）
 *   - 「取消」（本人5分以内）・「削除」（保護者の是正削除）の各リンク（削除処理は
 *     DB〈RLS・トリガー〉は今回作成済みだが、呼び出しUIは第2段階）
 *   - 投稿数上限到達時の案内文言（投稿できないこと自体、第2段階まで無関係）
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import Card from "./Card";
import MemberAvatar from "./MemberAvatar";
import { EmptyState, ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";
import type { FamilyBoardPostWithAuthor } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";

export interface FamilyBoardHistoryPanelProps {
  tone: Tone;
  loadState: LoadState;
  posts: FamilyBoardPostWithAuthor[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
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

/** ワイヤーフレーム.md 22.2節の表示形式（"8/27 19:40"）に合わせる。 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
  const time = d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

export function FamilyBoardHistoryPanel({
  tone,
  loadState,
  posts,
  hasMore,
  loadingMore,
  onLoadMore,
  onRetry,
}: FamilyBoardHistoryPanelProps) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  // CollectorShelfPanelと同じ判断: EmptyState/ErrorStateは"parent"/"child"の2toneしか
  // 持たないため、supporterはparent側のトーン（控えめな表現）を流用する
  // （app/supporter/history.tsxの既存の呼び出しと同じ扱い）。
  const stateTone: "parent" | "child" = isChild ? "child" : "parent";

  return (
    <View style={{ marginTop: theme.spacing.s4 }}>
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
        <View style={{ gap: theme.spacing.s2 }}>
          {posts.map((post) => (
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
                <Text style={captionStyle}>{formatDateTime(post.created_at)}</Text>
              </View>
              <Text style={[bodyStyle, { marginTop: theme.spacing.s2 }]}>{post.body}</Text>
            </Card>
          ))}

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
});

export default FamilyBoardHistoryPanel;
