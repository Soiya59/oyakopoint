/**
 * お絵かきのリアクション・コメント区画（要件定義書07-38章5章・6章、
 * UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 65.4章、やること.md
 * 2-70、開発部/成果物/実装メモ.md 293章）。
 *
 * `CollectorShelfPanel.tsx`の`ExpandedItemModal`（実装メモ.md 225章・
 * 238章・246章・250章・286章）の「家族の絵」詳細カード（`detailDrawingWrap`）
 * の**外**に、兄弟要素として配置すること（65.4.3節）。区画全体を無反応の
 * `<Pressable onPress={() => {}}>`で包み、既存の「絵と×以外はどこを押しても
 * 閉じる」当たり判定を壊さない。
 *
 * [対象は公開済みの絵のみ] 呼び出し側（ShelfItemsGrid）は既に
 * `selectedItem.drawing`が存在する場合にのみ本コンポーネントを描画する
 * （コレクター棚に並ぶのは公開済みの絵のみのため、未公開の絵がここに来ることは
 * 構造上ない）。
 *
 * [リアクション] 全ロール対称・自己リアクション禁止（自分の絵には読み取り
 * 専用の個数表示のみ、掲示板の「自分の投稿」と同じパターン）。取消・切替可能。
 * やりとりトグルの対象外（常時ON、5-5節）。
 *
 * [コメント] 全ロール対称・自分自身の絵へのコメントも許可（6-1節）。削除は
 * 65.1節（本人5分以内／保護者は本人以外いつでも）。やりとりトグルの対象
 * （6-6節、falseの間はこの区画の入力欄・一覧を丸ごと隠す。スタンプは残す）。
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import AppButton from "./AppButton";
import NgWordWarningText from "./NgWordWarningText";
import theme from "@/theme/theme";
import { useSession } from "@/lib/session";
import { useAppData } from "@/data/store";
import { useNgWordGuard } from "@/hooks/useNgWordGuard";
import { excludeBlockedByAuthor } from "@/lib/blockFilter";
import { excludeHiddenById } from "@/lib/hiddenContentFilter";
import { formatDateTimeShort } from "@/lib/calendarDates";
import {
  createFamilyDrawingComment,
  deleteFamilyComment,
  fetchFamilyDrawingCommentsForDrawing,
  fetchFamilyDrawingReactionsForDrawing,
  toggleFamilyDrawingReactionStamp,
  PG_ERRCODE,
} from "@/data/api";
import type { FamilyDrawingCommentWithAuthor, FamilyDrawingReactionWithReactor, StampKey } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

const FIVE_MIN_MS = 5 * 60 * 1000;

function bodyStyleFor(tone: Tone) {
  return tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
}
function captionStyleFor(tone: Tone) {
  return tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;
}

/** 65.2.2節「完了報告の既存表記に一字一句揃える」。子ども「＋ひとこと」、大人「＋コメント」。 */
const ADD_COMMENT_LABEL: Record<Tone, string> = {
  parent: "＋コメント",
  supporter: "＋コメント",
  child: "＋ひとこと",
};
const COMMENT_INPUT_LABEL: Record<Tone, string> = {
  parent: "ひとことおくる（にんい・200文字まで）",
  supporter: "ひとことおくる（にんい・200文字まで）",
  child: "ひとことおくる（にんい）",
};
const CANCEL_LABEL: Record<Tone, string> = { parent: "取消", supporter: "取消", child: "とりけす" };
const SEND_FAIL_TEXT: Record<Tone, string> = {
  parent: "コメントを送信できませんでした。もう一度お試しください",
  supporter: "コメントを送信できませんでした。もう一度お試しください",
  child: "おくれなかったよ。もういちど おしてね",
};
const ALREADY_DELETED_TEXT: Record<Tone, string> = {
  parent: "このコメントはすでに削除されています",
  supporter: "このコメントはすでに削除されています",
  child: "このコメントは もう なくなっちゃったみたい",
};

/**
 * [2026-09-25修正・実装メモ.md 302章] 従来は`toLocaleDateString`/`toLocaleTimeString`を
 * 端末のタイムゾーンのまま呼んでいた。JST固定の共通関数に揃えた（見た目の書式は変えない）。
 */
function formatTimeOnly(iso: string): string {
  return formatDateTimeShort(iso);
}

/** 22.2.1節「LINE風・個数」と同じ丸め方。 */
function countLabel(count: number): string {
  return count > 9 ? "9+" : String(count);
}

export interface DrawingEngagementSectionProps {
  tone: Tone;
  drawingId: string;
  artistMemberId: string;
  myMemberId: string;
  /** [07-38章6-6節] やりとりトグル。falseの間はコメント区画（入力欄・一覧）を丸ごと隠す。スタンプは残す。 */
  socialInteractionsEnabled: boolean;
}

export function DrawingEngagementSection({
  tone,
  drawingId,
  artistMemberId,
  myMemberId,
  socialInteractionsEnabled,
}: DrawingEngagementSectionProps) {
  const { client } = useSession();
  // [2026-09-23追加・要件定義書07-32章 決定7の段階3・決定11〜14、実装メモ.md
  // 293章] ブロック・運営の非表示を取得後にclient側で除く（既存の掲示板
  // コメントと同じパターン。33.9章）。
  const { blockedMemberIdsSet, hiddenContentKeysSet } = useAppData();
  const isParent = tone === "parent";
  const isOwnDrawing = !!myMemberId && myMemberId === artistMemberId;
  const bodyStyle = bodyStyleFor(tone);
  const captionStyle = captionStyleFor(tone);

  const [reactions, setReactions] = useState<FamilyDrawingReactionWithReactor[]>([]);
  const [comments, setComments] = useState<FamilyDrawingCommentWithAuthor[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void (async () => {
      const [reactionsRes, commentsRes] = await Promise.all([
        fetchFamilyDrawingReactionsForDrawing(client, drawingId),
        fetchFamilyDrawingCommentsForDrawing(client, drawingId),
      ]);
      if (cancelled) return;
      if (reactionsRes.ok) setReactions(reactionsRes.data);
      if (commentsRes.ok) {
        const withoutBlocked = excludeBlockedByAuthor(commentsRes.data, (c) => c.commenter_member_id, blockedMemberIdsSet);
        setComments(excludeHiddenById(withoutBlocked, "family_drawing_comment", hiddenContentKeysSet));
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // blockedMemberIdsSet/hiddenContentKeysSetは意図的に依存配列から外す
    // （取得のたびに再フィルタさせず、家族データの15秒背景更新のたびに
    // 取り直すと入力中のコメント一覧がちらつくため。モーダルの再オープン
    // 〈drawingId変更〉時には最新のSetで再取得される）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, drawingId]);

  // --- リアクション（スタンプ） ---
  const [reactingKey, setReactingKey] = useState<StampKey | null>(null);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [showReactors, setShowReactors] = useState(false);

  const handleReact = useCallback(
    async (stampKey: StampKey) => {
      setReactingKey(stampKey);
      setReactionError(null);
      const res = await toggleFamilyDrawingReactionStamp(client, { drawing_id: drawingId, stamp_key: stampKey });
      setReactingKey(null);
      if (!res.ok) {
        setReactionError(res.error.message);
        return;
      }
      if (res.data.removed) {
        setReactions((prev) => prev.filter((r) => !(r.reactor_member_id === myMemberId && r.stamp_key === stampKey)));
      } else {
        setReactions((prev) => [
          { id: res.data.reaction_id ?? `local-${Date.now()}`, stamp_key: stampKey, reactor_member_id: myMemberId, created_at: new Date().toISOString(), family_members: null },
          ...prev,
        ]);
      }
    },
    [client, drawingId, myMemberId]
  );

  // --- コメント ---
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const ngGuard = useNgWordGuard();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const handleSend = useCallback(async () => {
    if (ngGuard.guard(draft)) return;
    setSending(true);
    setSendError(null);
    const res = await createFamilyDrawingComment(client, { drawing_id: drawingId, commenter_member_id: myMemberId, body: draft.trim() });
    setSending(false);
    if (!res.ok) {
      setSendError(SEND_FAIL_TEXT[tone]);
      return;
    }
    setComments((prev) => [
      { ...res.data, family_members: null },
      ...prev,
    ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
    setDraft("");
    setComposing(false);
  }, [client, drawingId, myMemberId, draft, ngGuard, tone]);

  const runDelete = useCallback(
    async (commentId: string) => {
      setDeletingId(commentId);
      setRowError(null);
      const res = await deleteFamilyComment(client, "family_drawing_comment", commentId);
      setDeletingId(null);
      setConfirmDeleteId(null);
      if (!res.ok) {
        if (res.error.code === PG_ERRCODE.checkViolation && res.error.message.includes("削除されています")) {
          setComments((prev) => prev.filter((c) => c.id !== commentId));
          return;
        }
        setRowError({ id: commentId, message: res.error.message });
        return;
      }
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    },
    [client]
  );

  if (!loaded) return null;

  const hasAnyReaction = reactions.length > 0;
  const countFor = (key: StampKey) => reactions.filter((r) => r.stamp_key === key).length;
  const mineFor = (key: StampKey) => reactions.some((r) => r.stamp_key === key && r.reactor_member_id === myMemberId);

  return (
    <View style={styles.wrap}>
      {/* リアクション（常時ON、やりとりトグルの対象外） */}
      <View style={styles.stampRow}>
        {theme.stampDefinitions.map((s) => {
          const key = s.key as StampKey;
          const count = countFor(key);
          const mine = mineFor(key);
          if (isOwnDrawing) {
            if (count === 0) return null;
            return (
              <Text key={s.key} style={[bodyStyle, styles.readonlyStamp]}>
                {s.emoji}
                {countLabel(count)}
              </Text>
            );
          }
          return (
            <Pressable
              key={s.key}
              disabled={reactingKey === key}
              onPress={() => void handleReact(key)}
              style={[styles.stampBox, mine && styles.stampBoxSent, count > 0 && styles.stampBoxWithCount]}
              accessibilityLabel={`${s.label}${count > 0 ? `・${count}` : ""}`}
            >
              <Text style={styles.stampEmoji}>{s.emoji}</Text>
              {count > 0 && <Text style={styles.stampCount}>{countLabel(count)}</Text>}
            </Pressable>
          );
        })}
      </View>
      {reactionError && (
        <Text style={[captionStyle, { color: theme.colors.statusBlocking, marginTop: theme.spacing.s1 }]}>{reactionError}</Text>
      )}
      {hasAnyReaction && (
        <Pressable onPress={() => setShowReactors((v) => !v)} style={{ marginTop: theme.spacing.s1 }}>
          <Text style={styles.link}>{tone === "child" ? "だれが おくったか みる" : "だれが送ったか見る"}</Text>
        </Pressable>
      )}
      {showReactors && (
        <View style={{ marginTop: theme.spacing.s1, gap: theme.spacing.s1 }}>
          {reactions.map((r) => {
            const stampDef = theme.stampDefinitions.find((s) => s.key === r.stamp_key);
            return (
              <Text key={r.id} style={bodyStyle}>
                {stampDef?.emoji} {r.family_members?.display_name ?? "?"}より「{stampDef?.label}」
              </Text>
            );
          })}
        </View>
      )}

      {/* コメント（やりとりトグルの対象） */}
      {socialInteractionsEnabled && (
        <View style={styles.commentSection}>
          {comments.map((c) => {
            const isOwnComment = c.commenter_member_id === myMemberId;
            const withinFiveMin = Date.now() - new Date(c.created_at).getTime() <= FIVE_MIN_MS;
            const canCancel = isOwnComment && withinFiveMin;
            const canDelete = isParent && !isOwnComment;
            const isConfirming = confirmDeleteId === c.id;
            const isProcessing = deletingId === c.id;
            const err = rowError?.id === c.id ? rowError.message : null;
            return (
              <View key={c.id} style={styles.commentRow}>
                <Text style={bodyStyle}>
                  💬 {c.family_members?.display_name ?? "?"}より「{c.body}」
                </Text>
                <Text style={captionStyle}>{formatTimeOnly(c.created_at)}</Text>
                {isConfirming ? (
                  <View style={{ marginTop: theme.spacing.s1 }}>
                    <Text style={bodyStyle}>{tone === "child" ? "このコメントをけしますか？" : "このコメントを削除しますか？"}</Text>
                    <View style={styles.confirmRow}>
                      <Pressable onPress={() => setConfirmDeleteId(null)} disabled={isProcessing}>
                        <Text style={styles.link}>やめる</Text>
                      </Pressable>
                      <Pressable onPress={() => void runDelete(c.id)} disabled={isProcessing} style={{ marginLeft: theme.spacing.s3 }}>
                        <Text style={[styles.link, { color: theme.colors.statusBlocking }]}>{isProcessing ? "…" : "削除する"}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  (canCancel || canDelete) && (
                    <View style={styles.confirmRow}>
                      {canCancel && (
                        <Pressable onPress={() => void runDelete(c.id)} disabled={isProcessing}>
                          <Text style={styles.link}>{isProcessing ? "…" : CANCEL_LABEL[tone]}</Text>
                        </Pressable>
                      )}
                      {canDelete && (
                        <Pressable onPress={() => setConfirmDeleteId(c.id)} disabled={isProcessing} style={{ marginLeft: canCancel ? theme.spacing.s3 : 0 }}>
                          <Text style={styles.link}>削除</Text>
                        </Pressable>
                      )}
                    </View>
                  )
                )}
                {err && <Text style={[captionStyle, { color: theme.colors.statusBlocking }]}>{ALREADY_DELETED_TEXT[tone]}</Text>}
              </View>
            );
          })}

          {composing ? (
            <View style={{ marginTop: theme.spacing.s2 }}>
              <Text style={bodyStyle}>{COMMENT_INPUT_LABEL[tone]}</Text>
              <TextInput
                value={draft}
                onChangeText={(t) => {
                  setDraft(t);
                  ngGuard.clear();
                }}
                placeholder={tone === "child" ? "たとえば「たのしみだね！」" : "例: 楽しみだね"}
                multiline
                maxLength={200}
                style={styles.textArea}
              />
              {ngGuard.blocked && <NgWordWarningText tone={tone} />}
              {sendError && <Text style={[captionStyle, { color: theme.colors.statusBlocking }]}>{sendError}</Text>}
              <View style={styles.confirmRow}>
                <Pressable onPress={() => { setComposing(false); setDraft(""); ngGuard.clear(); }} disabled={sending}>
                  <Text style={styles.link}>やめる</Text>
                </Pressable>
                <AppButton
                  tone={tone}
                  label={sending ? "…" : "おくる"}
                  onPress={() => void handleSend()}
                  disabled={!draft.trim() || sending}
                  style={{ marginLeft: theme.spacing.s3 }}
                />
              </View>
            </View>
          ) : (
            <Pressable onPress={() => setComposing(true)} style={{ marginTop: theme.spacing.s2 }}>
              <Text style={styles.link}>{ADD_COMMENT_LABEL[tone]}</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.spacing.s3, paddingTop: theme.spacing.s3, borderTopWidth: 1, borderTopColor: theme.colors.neutralBorder, width: "100%" },
  stampRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2, flexWrap: "wrap", justifyContent: "center" },
  stampBox: {
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralBg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    minWidth: 40,
    height: 40,
    paddingHorizontal: theme.spacing.s2,
  },
  stampBoxWithCount: {},
  stampBoxSent: { backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  stampEmoji: { fontSize: 20 },
  stampCount: { marginLeft: 2, fontSize: 12, fontWeight: "600", color: theme.colors.neutralTextPrimary },
  readonlyStamp: { marginRight: theme.spacing.s2 },
  link: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  commentSection: { marginTop: theme.spacing.s3, gap: theme.spacing.s2, width: "100%" },
  commentRow: { width: "100%" },
  confirmRow: { flexDirection: "row", alignItems: "center", marginTop: theme.spacing.s1 },
  textArea: {
    marginTop: theme.spacing.s1,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    padding: theme.spacing.s2,
    minHeight: 60,
    textAlignVertical: "top",
    backgroundColor: theme.colors.neutralBg,
  },
});

export default DrawingEngagementSection;
