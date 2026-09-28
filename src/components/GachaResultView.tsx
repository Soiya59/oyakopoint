/**
 * ガチャ結果画面（P28／C22／S16）本体の3ロール共通コンポーネント。
 * 参照: 主要画面ワイヤーフレーム.md 21.0節決定2・決定3・21.3節。
 *
 * 決定2「外れ枠を作らない。演出は最小限」・決定3「景品（既製の飾り／家族の絵）は
 * 同一の結果画面レイアウトで表現し、序列を感じさせる演出差を付けない」に対応する。
 * 家族の絵の場合のみ、子ども向け（tone="child"）に限り「だれの秘密が開いたのか」の
 * 一段階の開示演出（0.5秒後に自動で切り替わる）を追加する。保護者・みまもりメンバー
 * 向けは常に単一表示（21.3節「2段階演出にせず単一表示にする」）。
 *
 * [2026-08-26改訂・第4段階] ワイヤーフレームの「[ きに かざる → ]」ボタンを実装した
 * （`onClose` → `onDecorate`に置き換え）。第3段階時点では
 * `decorate_tree_with_gacha_prize()`が前提のため意図的に省略していたが
 * （開発部/成果物/実装メモ.md参照）、本コンポーネントは今回で完成形になる。
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import { DrawingThumbnail } from "./DrawingCanvas";
import theme from "@/theme/theme";
import { useSession } from "@/lib/session";
import { useAppData } from "@/data/store";
import { fetchFamilyDrawingReactionsForDrawing, toggleFamilyDrawingReactionStamp } from "@/data/api";
import type { GachaPrizeDetail } from "@/hooks/useGacha";
import type { FamilyDrawingReactionWithReactor, StampKey } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

export interface GachaResultViewProps {
  tone: Tone;
  result: GachaPrizeDetail;
  /** 「木に飾る」導線（21.4節、木への飾り付け画面）への遷移。家族の絵のときのみ使う。 */
  onDecorate: () => void;
  /** [2026-08-27追加] 既製の飾りが当たったときのコレクター棚への遷移。
      木に飾れるのは家族の絵のみのため、既製の飾りではこちらを出す。 */
  onGoToShelf: () => void;
  /**
   * [2026-09-28追加・統括依頼（本部長経由）、開発部/成果物/実装メモ.md 320章]
   * 家族の絵が当たったときの「＋コメント」導線。押すとコレクションでこの絵を
   * 開き、コメント欄をすぐ使える状態にする（遷移そのものは呼び出し画面が担う。
   * 3ロールともコレクター棚の画面パスが異なるため、ここではdrawingIdだけ渡す）。
   */
  onCommentDrawing: (drawingId: string) => void;
}

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
function GachaDrawingReactionRow({
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
  const [reactionError, setReactionError] = useState<string | null>(null);

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
      setReactionError(res.error.message);
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
    </View>
  );
}

const TWO_STEP_REVEAL_DELAY_MS = 500;

export function GachaResultView({ tone, result, onDecorate, onGoToShelf, onCommentDrawing }: GachaResultViewProps) {
  const isChild = tone === "child";
  const headlineStyle = isChild ? theme.typography.childHeadline : tone === "supporter" ? theme.typography.supporterTitle : theme.typography.parentTitle;
  const bodyStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  const { state } = useAppData();
  // [2026-09-28追加・実装メモ320章] 3ロールとも「保護者・みまもりはactiveParentMemberId」
  // （CollectorShelfPanel呼び出し元・実装メモ参照）。子どものみactiveChildMemberIdを使う。
  const myMemberId = isChild ? state.activeChildMemberId : state.activeParentMemberId;
  const socialInteractionsEnabled = state.family.social_interactions_enabled;

  // 決定3: 二段階の開示演出は「子ども向け × 家族の絵」の組み合わせのみ。
  const useTwoStepReveal = isChild && result.kind === "family_drawing";
  const [revealed, setRevealed] = useState(!useTwoStepReveal);

  useEffect(() => {
    if (!useTwoStepReveal) {
      setRevealed(true);
      return;
    }
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), TWO_STEP_REVEAL_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useTwoStepReveal, result]);

  const decorateLabel = isChild ? "きに かざる →" : "木に飾る →";
  const shelfLabel = isChild ? "コレクションだなを みる →" : "コレクションを見る →";

  if (useTwoStepReveal && !revealed) {
    return (
      <View style={styles.container}>
        <Text style={bodyStyle}>だれかの ひみつが...</Text>
        <Text style={styles.bigEmoji}>❓</Text>
      </View>
    );
  }

  if (result.kind === "preset_ornament" && result.ornament) {
    return (
      <View style={styles.container}>
        <Text style={headlineStyle}>{isChild ? "🎉 やったー！" : "景品が届きました"}</Text>
        <Text style={styles.bigEmoji}>{result.ornament.emoji ?? "🎁"}</Text>
        <Text style={[bodyStyle, styles.prizeName]}>
          {isChild ? `「${result.ornament.display_name}」が でてきたよ！` : `「${result.ornament.display_name}」`}
        </Text>
        {/* [2026-08-27] 木に飾れるのは家族の絵のみ（既製の飾りは棚に保管するだけ）。
            ここで「木に飾る」を出すと、押しても飾れない行き止まりになるため出さない。
            ただし07-13-1章「外れ枠を作らない」に配慮し、「はずれ」ではなく
            「棚に加わった」という獲得の事実を前向きに伝える文言にする。 */}
        <Text style={[bodyStyle, styles.shelfNote]}>
          {isChild ? "コレクションだなに はいったよ！" : "コレクションに加わりました"}
        </Text>
        <AppButton label={shelfLabel} tone={tone} fullWidth style={styles.button} onPress={onGoToShelf} />
      </View>
    );
  }

  if (result.kind === "family_drawing" && result.drawing) {
    const drawing = result.drawing;
    const artistName = drawing.family_members?.display_name ?? "だれか";
    // [2026-09-02追加] お絵かきの題名（要件定義書07-13-2a章、主要画面ワイヤーフレーム.md
    // 21.0節決定16）。既存の一文の「ひみつの絵」／「絵」部分だけを題名（『』囲み）に
    // 置き換える。新しい行・新しいUI要素は追加しない。題名が無ければ既存文言のまま。
    const title = drawing.title;
    const prizeText = isChild
      ? title
        ? `「${artistName}」の『${title}』でした！`
        : `「${artistName}」の ひみつの絵 でした！`
      : title
      ? `「${artistName}」が描いた『${title}』です`
      : `「${artistName}」が描いた絵です`;
    return (
      <View style={styles.container}>
        <Text style={headlineStyle}>{isChild ? "🎉 ひみつが あいたよ！" : "景品が届きました"}</Text>
        <DrawingThumbnail lineData={drawing.line_data} size={120} />
        <Text style={[bodyStyle, styles.prizeName]}>{prizeText}</Text>
        <AppButton label={decorateLabel} tone={tone} fullWidth style={styles.button} onPress={onDecorate} />
        {/* [2026-09-28追加・統括依頼（本部長経由）、実装メモ320章] 家族の絵が
            出たときだけ、「木に飾る」ボタンより目立たせず下に置くスタンプ＋
            「＋コメント」導線。既製の飾り（上のpreset_ornament分岐）には出さない。 */}
        <GachaDrawingReactionRow
          tone={tone}
          drawingId={drawing.id}
          artistMemberId={drawing.artist_member_id}
          myMemberId={myMemberId}
          commentsEnabled={socialInteractionsEnabled}
          onCommentPress={() => onCommentDrawing(drawing.id)}
        />
      </View>
    );
  }

  // 通常到達しない（表示に必要なデータが揃わなかった場合の保険。呼び出し側の
  // loadState==="error"分岐で通常はここに到達しない）。
  return (
    <View style={styles.container}>
      <Text style={bodyStyle}>けっかを ひょうじできませんでした</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shelfNote: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  container: { alignItems: "center", marginTop: theme.spacing.s8 },
  bigEmoji: { fontSize: 64, marginTop: theme.spacing.s6 },
  prizeName: { marginTop: theme.spacing.s4, textAlign: "center" },
  button: { marginTop: theme.spacing.s8 },
  // [2026-09-28追加・実装メモ320章] スタンプ＋「＋コメント」導線。「木に飾る」
  // （styles.button、marginTop: s8）より控えめな余白・幅いっぱいの1行に収める
  // （完了報告カード・ChildCompletionCard.tsxのstampRowと同じ「スタンプ行＋
  // 右端にコメント導線」の並びにする）。
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

export default GachaResultView;
