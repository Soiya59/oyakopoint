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
 */
import React, { useState } from "react";
import { Pressable, StyleProp, StyleSheet, Text, TextStyle, View } from "react-native";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { deleteFamilyComment, PG_ERRCODE } from "@/data/api";
import type { ChoreReaction, FamilyMember } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

const FIVE_MIN_MS = 5 * 60 * 1000;

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
}

export function ChoreReactionsList({
  tone,
  reactions,
  memberOf,
  myMemberId,
  emptyText,
  bodyStyle,
  captionStyle,
}: ChoreReactionsListProps) {
  const { client } = useSession();
  const { refresh } = useAppData();
  const isParent = tone === "parent";

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const runDelete = async (id: string) => {
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
      setRowError({ id, message: res.error.message });
      return;
    }
    void refresh();
  };

  if (reactions.length === 0) {
    return <Text style={[captionStyle, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>{emptyText}</Text>;
  }

  return (
    <View style={{ marginTop: theme.spacing.s1, gap: theme.spacing.s1 }}>
      {reactions.map((r) => {
        const reactor = memberOf(r.reacted_by);
        const stampDef = theme.stampDefinitions.find((s) => s.key === r.stamp_key);
        const isComment = r.kind === "comment";
        const isOwnComment = isComment && r.reacted_by === myMemberId;
        const withinFiveMin = Date.now() - new Date(r.created_at).getTime() <= FIVE_MIN_MS;
        const canCancel = isOwnComment && withinFiveMin;
        const canDelete = isComment && isParent && !isOwnComment;
        const isConfirming = confirmDeleteId === r.id;
        const isProcessing = deletingId === r.id;
        const err = rowError?.id === r.id ? rowError.message : null;
        return (
          <View key={r.id}>
            <Text style={bodyStyle}>
              {r.kind === "stamp" ? stampDef?.emoji : "💬"} {reactor?.display_name}より
              {r.kind === "stamp" ? `「${stampDef?.label}」` : `「${r.comment_body}」`}{" "}
              <Text style={captionStyle}>
                {new Date(r.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
              </Text>
            </Text>
            {isComment &&
              (isConfirming ? (
                <View style={styles.confirmRow}>
                  <Text style={captionStyle}>{DELETE_CONFIRM_TEXT[tone]}</Text>
                  <View style={styles.linkRow}>
                    <Pressable onPress={() => setConfirmDeleteId(null)} disabled={isProcessing}>
                      <Text style={styles.link}>やめる</Text>
                    </Pressable>
                    <Pressable onPress={() => void runDelete(r.id)} disabled={isProcessing} style={{ marginLeft: theme.spacing.s3 }}>
                      <Text style={[styles.link, { color: theme.colors.statusBlocking }]}>{isProcessing ? "…" : "削除する"}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                (canCancel || canDelete) && (
                  <View style={styles.linkRow}>
                    {canCancel && (
                      <Pressable onPress={() => void runDelete(r.id)} disabled={isProcessing}>
                        <Text style={styles.link}>{isProcessing ? "…" : CANCEL_LABEL[tone]}</Text>
                      </Pressable>
                    )}
                    {canDelete && (
                      <Pressable onPress={() => setConfirmDeleteId(r.id)} disabled={isProcessing} style={{ marginLeft: canCancel ? theme.spacing.s3 : 0 }}>
                        <Text style={styles.link}>削除</Text>
                      </Pressable>
                    )}
                  </View>
                )
              ))}
            {err && <Text style={[captionStyle, { color: theme.colors.statusBlocking }]}>{ALREADY_DELETED_TEXT[tone]}</Text>}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  confirmRow: { marginTop: 2 },
  linkRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  link: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline", fontSize: 12 },
});

export default ChoreReactionsList;
