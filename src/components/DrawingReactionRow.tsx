/**
 * 家族の絵へのスタンプ＋「＋コメント」の1行（3ロール共通）。
 *
 * [2026-10-21移設・統括判断、開発部/成果物/実装メモ.md 367章] もとはガチャ結果画面
 * （`GachaResultView.tsx`）の「木に飾る」ボタンの下にあった（320章）。そこで反応すると
 * 飾るのを忘れたり戻りにくく、飾ったあとに反応するにはコレクション棚まで行く必要が
 * あったため、飾った直後の木の画面（P26/C20/S14の`justDecorated*`パラメータ）へ移した。
 * 反応する先は飾った「絵」そのもの（描いた人に届く）で、飾ったことへの反応ではない。
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Card from "./Card";
import FailureRefText from "./FailureRefText";
import { useFailureNotice } from "@/hooks/useFailureNotice";
import theme from "@/theme/theme";
import { useSession } from "@/lib/session";
import { useAppData } from "@/data/store";
import { fetchFamilyDrawingReactionsForDrawing, toggleFamilyDrawingReactionStamp } from "@/data/api";
import type { FamilyDrawingReactionWithReactor, StampKey } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

/** 65.2.2節「完了報告の既存表記に一字一句揃える」。子ども「＋ひとこと」、大人「＋コメント」。 */
const ADD_COMMENT_LABEL: Record<Tone, string> = {
  parent: "＋コメント",
  supporter: "＋コメント",
  child: "＋ひとこと",
};

/**
 * [2026-09-28新設・統括依頼（本部長経由）「ガチャで家族の絵が出たときの結果画面に、
 * その絵へのスタンプと『＋コメント』を置いてほしい」、開発部/成果物/実装メモ.md 320章]
 *
 * 家族の絵が当たったときだけ、「木に飾る」ボタンの下に小さく置くスタンプ＋コメント導線。
 * スタンプは`DrawingEngagementSection.tsx`（実装メモ293章）と全く同じ仕組み
 * （`family_drawing_reactions`・`toggle_family_drawing_reaction_stamp`）をそのまま使い、
 * その場でトグルする。コメントはその場に入力欄を出さず、コレクションでこの絵を開いて
 * すぐ書ける状態に遷移させる（統括「リアクションくらいはしてもいい」「完了報告の
 * カードと同じ並びにする」）。促す文言（「押してね」等）は付けない。
 *
 * 引いた人は自分の絵を引かない（ガチャの決まり）ため、実運用では
 * `myMemberId !== artistMemberId`が常に成り立つ。ただし`DrawingEngagementSection`と
 * 同じ「自分の絵は読み取り専用」の分岐は保険として残す。
 */
export function DrawingReactionRow({
  tone,
  drawingId,
  artistMemberId,
  myMemberId,
  commentsEnabled,
  onCommentPress,
}: {
  tone: Tone;
  drawingId: string;
  artistMemberId: string;
  myMemberId: string;
  commentsEnabled: boolean;
  onCommentPress: () => void;
}) {
  const { client } = useSession();
  const [reactions, setReactions] = useState<FamilyDrawingReactionWithReactor[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [reactingKey, setReactingKey] = useState<StampKey | null>(null);
  // [2026-09-29変更・実装メモ331章] 失敗は原因に応じた文言＋目印（useFailureNotice）で出す。
  const { errorMessage: reactionError, errorRef: reactionErrorRef, setErrorMessage: setReactionError, showFailure: showReactionFailure } =
    useFailureNotice(tone);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void (async () => {
      const res = await fetchFamilyDrawingReactionsForDrawing(client, drawingId);
      if (cancelled) return;
      if (res.ok) setReactions(res.data);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [client, drawingId]);

  const isOwnDrawing = !!myMemberId && myMemberId === artistMemberId;
  const countFor = (key: StampKey) => reactions.filter((r) => r.stamp_key === key).length;
  const mineFor = (key: StampKey) => reactions.some((r) => r.stamp_key === key && r.reactor_member_id === myMemberId);

  const handleReact = async (stampKey: StampKey) => {
    setReactingKey(stampKey);
    setReactionError(null);
    const res = await toggleFamilyDrawingReactionStamp(client, { drawing_id: drawingId, stamp_key: stampKey });
    setReactingKey(null);
    if (!res.ok) {
      showReactionFailure(res.error);
      return;
    }
    if (res.data.removed) {
      setReactions((prev) => prev.filter((r) => !(r.reactor_member_id === myMemberId && r.stamp_key === stampKey)));
    } else {
      setReactions((prev) => [
        {
          id: res.data.reaction_id ?? `local-${Date.now()}`,
          stamp_key: stampKey,
          reactor_member_id: myMemberId,
          created_at: new Date().toISOString(),
          family_members: null,
        },
        ...prev,
      ]);
    }
  };

  if (!loaded) return null;

  return (
    <View style={styles.reactionRow}>
      <View style={styles.stampRow}>
        {theme.stampDefinitions.map((s) => {
          const key = s.key as StampKey;
          const count = countFor(key);
          const mine = mineFor(key);
          if (isOwnDrawing) {
            if (count === 0) return null;
            return (
              <Text key={s.key} style={styles.readonlyStamp}>
                {s.emoji}
                {count > 9 ? "9+" : count}
              </Text>
            );
          }
          return (
            <Pressable
              key={s.key}
              disabled={reactingKey === key}
              onPress={() => void handleReact(key)}
              style={[styles.stampBox, mine && styles.stampBoxSent]}
              accessibilityLabel={`${s.label}${count > 0 ? `・${count}` : ""}`}
            >
              <Text style={styles.stampEmoji}>{s.emoji}</Text>
              {count > 0 && <Text style={styles.stampCount}>{count > 9 ? "9+" : count}</Text>}
            </Pressable>
          );
        })}
      </View>
      {/* [2026-09-28・実装メモ320章] `<Text style={{ flex: 1 }} />`で右端に押し出す。
          `ChildCompletionCard.tsx`のstampRow（スタンプ＋「＋ひとこと」）と同じ
          既存パターン（margin:"auto"は使わない、実装の揺れを増やさないため）。 */}
      {commentsEnabled && <Text style={{ flex: 1 }} />}
      {commentsEnabled && (
        <Pressable onPress={onCommentPress} hitSlop={8}>
          <Text style={styles.commentLink}>{ADD_COMMENT_LABEL[tone]}</Text>
        </Pressable>
      )}
      {reactionError && <Text style={styles.reactionErrorText}>{reactionError}</Text>}
      {reactionError && <FailureRefText value={reactionErrorRef} tone={tone} />}
    </View>
  );
}

const SHELF_PATH: Record<Tone, "/child/collector-shelf" | "/parent/collector-shelf" | "/supporter/collector-shelf"> = {
  child: "/child/collector-shelf",
  parent: "/parent/collector-shelf",
  supporter: "/supporter/collector-shelf",
};

/**
 * 木の画面（P26/C20/S14）の上に出す「いま飾った絵」へのスタンプ＋コメントのカード。
 * 飾る画面（tree-decorate.tsx）からガチャの絵を飾って来たときだけ、`justDecorated*`
 * パラメータがあるので出す。タブから木を開いたときは何も出さない。
 * コメントは、これまでどおりコレクションでこの絵を開いた状態に遷移する（320章と同じ）。
 */
export function JustDecoratedDrawingCard({ tone }: { tone: Tone }) {
  const { justDecoratedDrawingId, justDecoratedArtistId, justDecoratedArtistName, justDecoratedTitle } = useLocalSearchParams<{
    justDecoratedDrawingId?: string;
    justDecoratedArtistId?: string;
    justDecoratedArtistName?: string;
    justDecoratedTitle?: string;
  }>();
  const { state } = useAppData();
  if (!justDecoratedDrawingId) return null;
  const isChild = tone === "child";
  // 3ロールとも「保護者・みまもりはactiveParentMemberId」、子どものみactiveChildMemberId（320章と同じ）。
  const myMemberId = isChild ? state.activeChildMemberId : state.activeParentMemberId;
  const artist = justDecoratedArtistName || "だれか";
  const titlePart = justDecoratedTitle ? `『${justDecoratedTitle}』` : isChild ? "え" : "絵";
  const caption = isChild ? `いま かざった「${artist}」の ${titlePart}` : `いま飾った「${artist}」の${titlePart}`;
  const bodyStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  return (
    <Card tone={tone} style={{ marginTop: theme.spacing.s4 }}>
      <Text style={bodyStyle}>{caption}</Text>
      <DrawingReactionRow
        tone={tone}
        drawingId={justDecoratedDrawingId}
        artistMemberId={justDecoratedArtistId ?? ""}
        myMemberId={myMemberId}
        commentsEnabled={state.family.social_interactions_enabled}
        onCommentPress={() =>
          router.push({ pathname: SHELF_PATH[tone], params: { openDrawingId: justDecoratedDrawingId, openComment: "1" } })
        }
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  // 完了報告カード（ChildCompletionCard.tsxのstampRow）と同じ「スタンプ行＋右端にコメント導線」の並び。
  reactionRow: { width: "100%", marginTop: theme.spacing.s3, flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  stampRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
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
  stampBoxSent: { backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  stampEmoji: { fontSize: 20 },
  stampCount: { marginLeft: 2, fontSize: 12, fontWeight: "600", color: theme.colors.neutralTextPrimary },
  readonlyStamp: { marginRight: theme.spacing.s2, fontSize: 16 },
  commentLink: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  reactionErrorText: { width: "100%", marginTop: theme.spacing.s1, fontSize: 12, color: theme.colors.statusBlocking },
});

export default DrawingReactionRow;
