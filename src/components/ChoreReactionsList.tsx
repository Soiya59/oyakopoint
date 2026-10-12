/**
 * 完了報告に届いたリアクション（スタンプ・コメント）一覧の共通表示（「とどいた
 * リアクション」）。P9（`app/parent/approvals.tsx`）・S2（`app/supporter/
 * (tabs)/family.tsx`・`app/supporter/activity.tsx`）・C
 * （`src/components/ChildCompletionDetailModal.tsx`）の4箇所が、これまで
 * 同じ表示ロジックをほぼ同一のコードで重複させていた。
 *
 * [2026-09-23新設・要件定義書07章「コメントの削除ルール」、UIUXデザイン部/
 * 成果物/主要画面ワイヤーフレーム.md 65.3章、やること.md 5-13、開発部/
 * 成果物/実装メモ.md 293章] コメント（`kind='comment'`）にのみ、65.1節の
 * 削除導線（本人5分以内は「取消」、保護者の是正は「削除」＋確認）を追加する。
 * **スタンプの行は変更しない**（既存の取消・切替のまま、本コンポーネントは
 * スタンプの表示に手を加えない）。
 *
 * 子ども・みまもりメンバーは自分のコメントの5分以内取消のみ（保護者の是正
 * 権限は持たない、要件定義書07章のとおり）。
 *
 * [2026-10-13追加・要件定義書07-48章、主要画面ワイヤーフレーム.md 74章、設計部/成果物/API仕様.md 42章、
 * 実装メモ364章] コメントへの「返信」を足した。
 *  - 返信（`reply_to_reaction_id`を持つ行）は、元のコメントの**直下**に字下げ＋左の細い線で描く
 *    （引用は繰り返さない。絵文字は付けない）。**元のコメントが一覧に無い返信は描かない**（74.3節。
 *    サーバーが先に隠していても二重に守る）。返信の取消・削除は、コメントと同じコード（同じ判定順）を通す。
 *  - 返信の入口（「＋返信」「＋へんじ」）は、**報告者本人の画面にだけ**出る（`reportedBy`が自分のとき）。
 *    条件は`canShowReplyEntry`（src/lib/commentReply.ts）。条件を満たさないときは入口ごと描かない。
 *    `reportedBy`を渡さない呼び出し元は入口が出ない（従来どおり）。
 *  - 「家族のやりとりを使う」がオフの間は、過去の返信は読めるが入口は出ない。
 *  - 返信の数・未返信の数・「返していない」の印は作らない（74.9節）。
 */
import React, { useState } from "react";
import { Pressable, StyleProp, StyleSheet, Text, TextStyle, View } from "react-native";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { deleteFamilyComment, PG_ERRCODE } from "@/data/api";
import { formatTimeShort } from "@/lib/calendarDates";
import { describeApiFailure } from "@/lib/apiFailureDisplay";
import { canShowReplyEntry, groupRepliesByParent, isWithinReplyCancelWindow } from "@/lib/commentReply";
import {
  REPLY_ALREADY_DELETED_TEXT,
  REPLY_CANCEL_LABEL,
  REPLY_DELETE_CONFIRM_TEXT,
  replyLineAccessibility,
  replyLineText,
} from "@/lib/commentReplyText";
import FailureRefText from "./FailureRefText";
import CommentReplyComposer from "./CommentReplyComposer";
import type { ChoreReaction, FamilyMember } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

const CANCEL_LABEL: Record<Tone, string> = { parent: "取消", supporter: "取消", child: "とりけす" };
const DELETE_CONFIRM_TEXT: Record<Tone, string> = {
  parent: "このコメントを削除しますか？",
  supporter: "このコメントを削除しますか？",
  child: "このコメントを けしますか？",
};
const ALREADY_DELETED_TEXT: Record<Tone, string> = {
  parent: "このコメントはすでに削除されています",
  supporter: "このコメントはすでに削除されています",
  child: "このコメントは もう なくなっちゃったみたい",
};

export interface ChoreReactionsListProps {
  tone: Tone;
  reactions: ChoreReaction[];
  memberOf: (id: string) => FamilyMember | undefined;
  myMemberId: string;
  emptyText: string;
  bodyStyle: StyleProp<TextStyle>;
  captionStyle: StyleProp<TextStyle>;
  /**
   * [2026-10-13追加・要件定義書07-48章] この一覧が属する完了報告の報告者のid。自分（`myMemberId`）と
   * 一致するときだけ、他人のコメントの下に返信の入口を出す。省略すると入口は出ない（従来どおり）。
   */
  reportedBy?: string;
  /**
   * [2026-10-13追加・主要画面ワイヤーフレーム.md 74.8節] 0件のとき`emptyText`を出さず、何も描かない
   * （子どもの「きろく」C15が今の`reactions.length > 0`の条件のまま差し替えられるように）。
   */
  hideWhenEmpty?: boolean;
}

export function ChoreReactionsList({
  tone,
  reactions,
  memberOf,
  myMemberId,
  emptyText,
  bodyStyle,
  captionStyle,
  reportedBy,
  hideWhenEmpty,
}: ChoreReactionsListProps) {
  const { client } = useSession();
  const { refresh, state, loading } = useAppData();
  const isParent = tone === "parent";
  const repliesEnabled = state.family.social_interactions_enabled;

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string; ref: string } | null>(null);
  // 送る前に元のコメントが削除されていたとき、一度だけ出す一文（次にこの画面を開き直すと消える。74.7節）。
  const [goneNotice, setGoneNotice] = useState<string | null>(null);

  const runDelete = async (id: string, isReply: boolean) => {
    setDeletingId(id);
    setRowError(null);
    const res = await deleteFamilyComment(client, "chore_reaction_comment", id);
    setDeletingId(null);
    setConfirmDeleteId(null);
    if (!res.ok) {
      if (res.error.code === PG_ERRCODE.checkViolation && res.error.message.includes("削除されています")) {
        void refresh();
        return;
      }
      // [2026-09-29変更・実装メモ331章] これまでは、どの失敗でも「このコメントは もう なくなっちゃった
      // みたい」と出していた（電波が悪いだけでも）。電波・混み合い・ログイン切れ・権限拒否のときは
      // それぞれの文言に分け、それ以外は従来の一文のまま。目印を添える。
      const fallback = isReply ? REPLY_ALREADY_DELETED_TEXT[tone] : ALREADY_DELETED_TEXT[tone];
      const f = describeApiFailure(tone, res.error, { fallback, useDbMessage: false });
      setRowError({ id, message: f.message, ref: f.ref });
      return;
    }
    void refresh();
  };

  const grouped = React.useMemo(() => groupRepliesByParent(reactions), [reactions]);

  const notice = goneNotice ? (
    <Text style={[captionStyle, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>{goneNotice}</Text>
  ) : null;

  if (grouped.rows.length === 0) {
    if (hideWhenEmpty) return notice;
    return (
      <View>
        <Text style={[captionStyle, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>{emptyText}</Text>
        {notice}
      </View>
    );
  }

  /**
   * コメントと返信で共通の「取消／削除」の部分。本人5分以内は「取消」（確認なし）、保護者は本人以外の
   * ものを「削除」（確認つき）。みまもり・子どもは自分の5分以内のみ（保護者の是正権限は持たない）。
   * 返信は確認の文と競合の文だけ切り替える（`isReply`）。
   */
  const deleteControls = (r: ChoreReaction, isReply: boolean) => {
    const isOwn = r.reacted_by === myMemberId;
    const canCancel = isOwn && isWithinReplyCancelWindow(r.created_at, Date.now());
    const canDelete = isParent && !isOwn;
    const isConfirming = confirmDeleteId === r.id;
    const isProcessing = deletingId === r.id;
    const cancelLabel = isReply ? REPLY_CANCEL_LABEL[tone] : CANCEL_LABEL[tone];
    const confirmText = isReply ? REPLY_DELETE_CONFIRM_TEXT : DELETE_CONFIRM_TEXT[tone];
    const links =
      canCancel || canDelete ? (
        <>
          {canCancel && (
            <Pressable onPress={() => void runDelete(r.id, isReply)} disabled={isProcessing}>
              <Text style={styles.link}>{isProcessing ? "…" : cancelLabel}</Text>
            </Pressable>
          )}
          {canDelete && (
            <Pressable onPress={() => setConfirmDeleteId(r.id)} disabled={isProcessing}>
              <Text style={styles.link}>削除</Text>
            </Pressable>
          )}
        </>
      ) : null;
    const confirm = isConfirming ? (
      <View style={styles.confirmRow}>
        <Text style={captionStyle}>{confirmText}</Text>
        <View style={styles.linkRow}>
          <Pressable onPress={() => setConfirmDeleteId(null)} disabled={isProcessing}>
            <Text style={styles.link}>やめる</Text>
          </Pressable>
          <Pressable onPress={() => void runDelete(r.id, isReply)} disabled={isProcessing}>
            <Text style={[styles.link, { color: theme.colors.statusBlocking }]}>{isProcessing ? "…" : "削除する"}</Text>
          </Pressable>
        </View>
      </View>
    ) : null;
    return { links, confirm, isConfirming };
  };

  const errorBlock = (id: string) => {
    const err = rowError?.id === id ? rowError : null;
    if (!err) return null;
    return (
      <>
        <Text style={[captionStyle, { color: theme.colors.statusBlocking }]}>{err.message}</Text>
        <FailureRefText value={err.ref} tone={tone} />
      </>
    );
  };

  return (
    <View style={{ marginTop: theme.spacing.s1, gap: theme.spacing.s1 }}>
      {notice}
      {grouped.rows.map((r) => {
        const reactor = memberOf(r.reacted_by);
        const stampDef = theme.stampDefinitions.find((s) => s.key === r.stamp_key);
        const isComment = r.kind === "comment";
        const replies = grouped.repliesOf.get(r.id) ?? [];
        const { links, confirm, isConfirming } = deleteControls(r, false);
        const showEntry =
          isComment &&
          !isConfirming &&
          canShowReplyEntry({
            reportedBy,
            myMemberId,
            parent: r,
            hasReply: replies.length > 0,
            authorIsActive: reactor?.is_active ?? false,
            repliesEnabled,
            loaded: !loading,
          });
        return (
          <View key={r.id}>
            <Text style={bodyStyle}>
              {r.kind === "stamp" ? stampDef?.emoji : "💬"} {reactor?.display_name}より
              {r.kind === "stamp" ? `「${stampDef?.label}」` : `「${r.comment_body}」`}{" "}
              <Text style={captionStyle}>
                {formatTimeShort(r.created_at)}
              </Text>
            </Text>
            {isComment &&
              (isConfirming ? (
                confirm
              ) : showEntry ? (
                <CommentReplyComposer
                  tone={tone}
                  completionId={r.completion_id}
                  parentId={r.id}
                  commenterName={reactor?.display_name ?? ""}
                  myMemberId={myMemberId}
                  trailing={links}
                  onParentGone={setGoneNotice}
                />
              ) : (
                links && <View style={styles.linkRow}>{links}</View>
              ))}
            {errorBlock(r.id)}
            {replies.map((reply) => {
              const author = memberOf(reply.reacted_by);
              const { links: replyLinks, confirm: replyConfirm, isConfirming: replyConfirming } = deleteControls(reply, true);
              const body = reply.comment_body ?? "";
              const time = formatTimeShort(reply.created_at);
              return (
                <View key={reply.id} style={styles.replyBlock}>
                  <Text
                    style={bodyStyle}
                    accessibilityLabel={replyLineAccessibility(tone, {
                      authorName: author?.display_name ?? "",
                      body,
                      time,
                      commenterName: reactor?.display_name ?? "",
                    })}
                  >
                    {replyLineText(tone, author?.display_name ?? "", body)}{" "}
                    <Text style={captionStyle}>{time}</Text>
                  </Text>
                  {replyConfirming ? replyConfirm : replyLinks && <View style={styles.linkRow}>{replyLinks}</View>}
                  {errorBlock(reply.id)}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  confirmRow: { marginTop: 2 },
  linkRow: { flexDirection: "row", alignItems: "center", marginTop: 2, columnGap: theme.spacing.s3 },
  link: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline", fontSize: 12 },
  // 返信：元のコメントの直下に、左へ spacing.s4 字下げ＋左に細い線（幅2・neutralBorder）。
  // 線の色だけで区別せず、文の頭の「{名前}の返信」でも示す（74.3・74.10節）。
  replyBlock: {
    marginTop: theme.spacing.s1,
    marginLeft: theme.spacing.s4,
    paddingLeft: theme.spacing.s2,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.neutralBorder,
  },
});

export default ChoreReactionsList;
