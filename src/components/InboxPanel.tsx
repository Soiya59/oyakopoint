/**
 * 「とどいたよ」＝自分がもらったもの（リアクション・感謝ポイント）だけを新しい順に並べる、
 * 3ロール共通コンポーネント。
 *
 * [2026-08-29新設・本部長／軽微変更ルート] ユーザーの指摘
 * 「感謝ポイントかリアクションをもらった時の通知のほうがよい」
 * 「リアクションと感謝のみを示すものがあればと思った。感謝とリアクションが見逃される懸念ある」
 * → まず子ども向けに作り、続けて「保護者や見守りも同じようにしてほしい」との要望で共通化した。
 *
 * 本番データで3ロールとも実際に受け取っていることを確認済み
 * （保護者はリアクション6件＋感謝4件、みまもりメンバーも受領実績あり）。
 * chore_reactions_insert_scoped が子→親・子→みまもりの送信を許しているため、
 * 大人も受け取る側になる。
 *
 * 新しい通信もテーブルも要らない。すでに読み込み済みの `state.reactions` と
 * `state.gratitude` を混ぜて並べているだけである。
 *
 * 01章3原則に従い、累計・ランキング・「今月◯個もらった」等の集計は置かない。
 * 届いたものを、届いた順に見せるだけにする。
 *
 * [2026-09-01追加・実装メモ.md 104章] 家族の書き込みボードへのスタンプリアクション
 * （`family_board_reactions`）を合流させる（主要画面ワイヤーフレーム.md 22.2.2節
 * 「『とどいたもの』への掲示板リアクション受信表示」）。統括の指摘「押しても相手に
 * 伝わっていない」への一次対応は一覧側のLINE風個数表示で行うが、一覧はカードを
 * タップしないと開かないため、アプリを開いた瞬間に気づけるという通知としての
 * 即時性は本パネルにしか無い価値として残る（企画部推奨・UIUXデザイン部実装）。
 * `state.familyBoardReactions`（家族全体ログ）から、対象投稿の`author_member_id`が
 * 自分と一致する行だけを抜き出す（既存のfromReactions/fromGratitudeと同じ
 * client側フィルタのパターン）。
 *
 * [2026-09-23追加・要件定義書07-30章決定5・07-38章4-3節/5-4節/6-5節、
 * 開発部/成果物/実装メモ.md 293章] 掲示板コメント（自分の投稿宛）・お絵かき
 * リアクション（自分の絵宛）・お絵かきコメント（自分の絵宛）・お絵かきの
 * 公開通知（自分が描いた絵が公開された）の4種を合流させる。既存の
 * fromBoardReactionsと同じ「家族全体ログをclient側でフィルタする」パターン。
 * 公開通知は「誰が引いたか」を出さない設計（07-38章4-4節、きょうだい間の
 * 比較誘発を避ける）ため、`fromMemberId`をnullにしてアバター・「〜から」の
 * 行自体を出さない特別扱いにする。
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import MemberAvatar from "./MemberAvatar";
import { EmptyState } from "./StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { formatDateTimeShort } from "@/lib/calendarDates";

type Tone = "parent" | "child" | "supporter";

interface InboxItem {
  id: string;
  /** [2026-09-23改訂] nullは「特定の誰かからではない」システム由来の通知
   *  （お絵かきの公開通知）。アバター・「〜から」の行を描かない。 */
  fromMemberId: string | null;
  at: string;
  /** リアクションなら「👏 すごい！」、感謝なら「💌 ありがとう +1pt」 */
  headline: string;
  /** コメント本文・感謝のメモ。無いこともある。 */
  body: string | null;
  /** リアクションのとき、どのクエストへのものか。感謝ではnull。 */
  choreLabel: string | null;
}

export interface InboxPanelProps {
  tone: Tone;
  /** 「もらった人」＝いま見ている本人のmember_id。 */
  memberId: string;
}

/**
 * ホームのベル（🔔）に出す「直近に自分へ届いた件数」。
 *
 * [2026-08-29] 3ロールのホームが同じ数え方をするため、ここに1本化した。
 * 以前は子どもホームだけがこの計算を持っており、しかも感謝ポイントが抜けていた（87章）。
 * 未読ではなく「直近◯時間に届いた件数」である（既読の概念はアプリ全体に存在しない）。
 *
 * [2026-09-01追加・実装メモ.md 104章] 家族の書き込みボードへのリアクションも
 * 合算対象に加える（主要画面ワイヤーフレーム.md 22.2.2節「並び順・件数上限」
 * 「ホームのベル（🔔）バッジの件数〈countRecentInbox〉にも同様に掲示板リアクションを
 * 合算する対象として加える」）。
 */
export function countRecentInbox(
  state: {
    completions: { id: string; reported_by: string }[];
    reactions: { completion_id: string; created_at: string }[];
    gratitude: { recipient_id: string; revoked_at: string | null; created_at: string }[];
    familyBoardReactions: {
      created_at: string;
      family_board_posts: { author_member_id: string } | null;
    }[];
    familyBoardComments: {
      created_at: string;
      family_board_posts: { author_member_id: string } | null;
    }[];
    familyDrawingReactions: {
      created_at: string;
      family_drawings: { artist_member_id: string } | null;
    }[];
    familyDrawingComments: {
      created_at: string;
      family_drawings: { artist_member_id: string } | null;
    }[];
    publishedDrawings: { artist_member_id: string; published_at: string | null }[];
  },
  memberId: string,
  sinceMs: number
): number {
  if (!memberId) return 0;
  const mine = new Set(state.completions.filter((c) => c.reported_by === memberId).map((c) => c.id));
  const reactions = state.reactions.filter(
    (r) => mine.has(r.completion_id) && new Date(r.created_at).getTime() >= sinceMs
  ).length;
  const gratitude = state.gratitude.filter(
    (g) => g.recipient_id === memberId && g.revoked_at === null && new Date(g.created_at).getTime() >= sinceMs
  ).length;
  const boardReactions = state.familyBoardReactions.filter(
    (r) => r.family_board_posts?.author_member_id === memberId && new Date(r.created_at).getTime() >= sinceMs
  ).length;
  // [2026-09-23追加・要件定義書07-30章決定5・07-38章5-4節/6-5節/4-3節]
  const boardComments = state.familyBoardComments.filter(
    (c) => c.family_board_posts?.author_member_id === memberId && new Date(c.created_at).getTime() >= sinceMs
  ).length;
  const drawingReactions = state.familyDrawingReactions.filter(
    (r) => r.family_drawings?.artist_member_id === memberId && new Date(r.created_at).getTime() >= sinceMs
  ).length;
  const drawingComments = state.familyDrawingComments.filter(
    (c) => c.family_drawings?.artist_member_id === memberId && new Date(c.created_at).getTime() >= sinceMs
  ).length;
  const published = state.publishedDrawings.filter(
    (d) => d.artist_member_id === memberId && !!d.published_at && new Date(d.published_at).getTime() >= sinceMs
  ).length;
  return reactions + gratitude + boardReactions + boardComments + drawingReactions + drawingComments + published;
}

/**
 * 主要画面ワイヤーフレーム.md 22.2.2節「対象が分かる一言」: 先頭20字程度＋超過時は
 * 「…」を付ける（22.1節カード抜粋の40字より短くする。呼び出し側で「」による囲みを
 * 行うため、ここでは中身の文字列のみを返す）。
 */
function boardPostExcerpt(body: string, max = 20): string {
  return body.length > max ? `${body.slice(0, max)}…` : body;
}

export function InboxPanel({ tone, memberId }: InboxPanelProps) {
  const { state, memberAvatars } = useAppData();
  const isChild = tone === "child";

  const bodyStyle =
    tone === "child"
      ? theme.typography.childBody
      : tone === "supporter"
      ? theme.typography.supporterBody
      : theme.typography.parentBody;

  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  const items: InboxItem[] = React.useMemo(() => {
    if (!memberId) return [];

    const myCompletions = new Map(
      state.completions.filter((c) => c.reported_by === memberId).map((c) => [c.id, c])
    );

    const fromReactions: InboxItem[] = state.reactions
      .filter((r) => myCompletions.has(r.completion_id))
      .map((r) => {
        const c = myCompletions.get(r.completion_id)!;
        const stamp = r.stamp_key ? theme.stampDefinitions.find((s) => s.key === r.stamp_key) : undefined;
        return {
          id: `reaction:${r.id}`,
          fromMemberId: r.reacted_by,
          at: r.created_at,
          headline: stamp ? `${stamp.emoji} ${stamp.label}` : "💬 コメント",
          body: r.comment_body,
          choreLabel: `${c.chore_emoji ?? "📝"} ${c.chore_title}`,
        };
      });

    const fromGratitude: InboxItem[] = state.gratitude
      .filter((g) => g.recipient_id === memberId && g.revoked_at === null)
      .map((g) => ({
        id: `gratitude:${g.id}`,
        fromMemberId: g.sender_id,
        at: g.created_at,
        headline: `💌 ありがとう +${g.points}pt`,
        body: g.note,
        choreLabel: null,
      }));

    // [2026-09-01追加・実装メモ.md 104章] 家族の書き込みボードへのリアクション
    // （主要画面ワイヤーフレーム.md 22.2.2節）。対象投稿が自分の投稿である行だけを
    // 抜き出す。「対象が分かる一言」の位置（choreLabel）に投稿本文の先頭20字抜粋を
    // 「」で囲んで入れる（同節「対象が分かる一言」）。コメント欄（body）は常に空
    // （掲示板のリアクションはスタンプのみ、コメントを伴わない）。
    const fromBoardReactions: InboxItem[] = state.familyBoardReactions
      .filter((r) => r.family_board_posts?.author_member_id === memberId)
      .map((r) => {
        const stamp = theme.stampDefinitions.find((s) => s.key === r.stamp_key);
        return {
          id: `board_reaction:${r.id}`,
          fromMemberId: r.reactor_member_id,
          at: r.created_at,
          // [2026-09-12修正→2026-09-23撤去] 以前は、同じスタンプを完了報告では
          // 「たすかったよ」、掲示板では「いいね」と呼び分けており（2026-09-06）、
          // ここで`theme.boardStampLabel(stamp)`を呼び忘れて「掲示板では『いいね』
          // なのに、とどいたもので開くと『たすかったよ』に変わる」食い違いを
          // 統括が実機で見つけた（2026-09-12）。2026-09-23に4つ目が👍「いいね！」に
          // なり、すべての場所で同じ名前になったので、呼び分けの仕組みごと外した。
          // 以後は完了報告・掲示板とも`stamp.label`で同じになる。
          headline: stamp ? `${stamp.emoji} ${stamp.label}` : "💬 コメント",
          body: null,
          choreLabel: `「${boardPostExcerpt(r.family_board_posts?.body ?? "")}」`,
        };
      });

    // [2026-09-23追加・要件定義書07-30章決定5] 掲示板のコメント。対象投稿が
    // 自分の投稿である行だけを抜き出す。
    const fromBoardComments: InboxItem[] = state.familyBoardComments
      .filter((c) => c.family_board_posts?.author_member_id === memberId)
      .map((c) => ({
        id: `board_comment:${c.id}`,
        fromMemberId: c.commenter_member_id,
        at: c.created_at,
        headline: "💬 コメント",
        body: c.body,
        choreLabel: `「${boardPostExcerpt(c.family_board_posts?.body ?? "")}」`,
      }));

    // [2026-09-23追加・要件定義書07-38章5-4節] お絵かきへのリアクション。
    // 対象の絵が自分が描いた絵である行だけを抜き出す。
    const fromDrawingReactions: InboxItem[] = state.familyDrawingReactions
      .filter((r) => r.family_drawings?.artist_member_id === memberId)
      .map((r) => {
        const stamp = theme.stampDefinitions.find((s) => s.key === r.stamp_key);
        return {
          id: `drawing_reaction:${r.id}`,
          fromMemberId: r.reactor_member_id,
          at: r.created_at,
          headline: stamp ? `${stamp.emoji} ${stamp.label}` : "💬 コメント",
          body: null,
          choreLabel: r.family_drawings?.title ? `「${r.family_drawings.title}」の絵` : "えの さくひん",
        };
      });

    // [2026-09-23追加・要件定義書07-38章6-5節] お絵かきへのコメント。
    const fromDrawingComments: InboxItem[] = state.familyDrawingComments
      .filter((c) => c.family_drawings?.artist_member_id === memberId)
      .map((c) => ({
        id: `drawing_comment:${c.id}`,
        fromMemberId: c.commenter_member_id,
        at: c.created_at,
        headline: "💬 コメント",
        body: c.body,
        choreLabel: c.family_drawings?.title ? `「${c.family_drawings.title}」の絵` : "えの さくひん",
      }));

    // [2026-09-23追加・要件定義書07-38章4章「公開通知」（3つの中で最優先）]
    // 自分が描いた絵が公開された（家族の誰かがガチャで引いた）というイベント。
    // 発見者の名前は出さない（4-4節、きょうだい間の比較誘発を避ける）ため
    // fromMemberIdはnull——アバター・「〜から」の行自体を出さない。
    const fromPublishedDrawings: InboxItem[] = state.publishedDrawings
      .filter((d) => d.artist_member_id === memberId && !!d.published_at)
      .map((d) => ({
        id: `drawing_published:${d.id}`,
        fromMemberId: null,
        at: d.published_at as string,
        headline: isChild ? "🎨 あなたの絵が、かぞくに とどきました！" : "🎨 あなたの絵が、かぞくに届きました",
        body: null,
        choreLabel: d.title ? `「${d.title}」` : null,
      }));

    return [
      ...fromReactions,
      ...fromGratitude,
      ...fromBoardReactions,
      ...fromBoardComments,
      ...fromDrawingReactions,
      ...fromDrawingComments,
      ...fromPublishedDrawings,
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [
    memberId,
    isChild,
    state.completions,
    state.reactions,
    state.gratitude,
    state.familyBoardReactions,
    state.familyBoardComments,
    state.familyDrawingReactions,
    state.familyDrawingComments,
    state.publishedDrawings,
  ]);

  // [2026-09-08改訂・やること.md 4-3] `src/lib/calendarDates.ts`の`formatDateTimeShort`
  // （M/D HH:MM、JST固定）に寄せた。従来は独自実装（端末TZ依存）だったが、共通関数と
  // 重複していた。JST固定になる点のみ従来と異なるが、実利用端末はほぼ常にJSTのため
  // 表示結果は変わらない（開発部/成果物/実装メモ.md 165章で検証）。
  const formatWhen = formatDateTimeShort;

  if (items.length === 0) {
    return (
      <View style={{ marginTop: theme.spacing.s6 }}>
        <EmptyState
          tone={isChild ? "child" : undefined}
          emoji="📭"
          title={
            isChild
              ? "まだ なにも とどいていないよ。クエストを ほうこくしたり、かきこみを すると、かぞくから とどくかも！"
              : "まだ届いたものはありません。クエストを報告したり、家族の書き込みをすると、家族から届くことがあります"
          }
        />
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {items.map((it) => {
        // [2026-09-23追加] fromMemberId===nullはお絵かきの公開通知
        // （システム由来。発見者の名前を出さない設計、07-38章4-4節）。
        // アバター・「〜から」の行を出さず、見出し・対象・時刻だけを表示する。
        if (it.fromMemberId === null) {
          return (
            <Card key={it.id} tone={tone} style={styles.card}>
              <View style={styles.main}>
                <Text style={[bodyStyle, styles.headline]}>{it.headline}</Text>
                {it.choreLabel && <Text style={styles.meta}>{it.choreLabel}</Text>}
                <Text style={styles.meta}>{formatWhen(it.at)}</Text>
              </View>
            </Card>
          );
        }
        const from = memberOf(it.fromMemberId);
        return (
          <Card key={it.id} tone={tone} style={styles.card}>
            <View style={styles.row}>
              <MemberAvatar name={from?.display_name ?? "?"} color={from?.avatar_color} size={32} lineData={from ? memberAvatars[from.id] : undefined} expandOnTap />
              <View style={styles.main}>
                <Text style={bodyStyle}>{from?.display_name ?? "だれか"}から</Text>
                <Text style={[bodyStyle, styles.headline]}>{it.headline}</Text>
                {it.choreLabel && <Text style={styles.meta}>{it.choreLabel}</Text>}
                {it.body && <Text style={bodyStyle}>「{it.body}」</Text>}
                <Text style={styles.meta}>{formatWhen(it.at)}</Text>
              </View>
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: theme.spacing.s4, gap: theme.spacing.s2 },
  card: { padding: theme.spacing.s3 },
  row: { flexDirection: "row", alignItems: "flex-start" },
  main: { flex: 1, marginLeft: theme.spacing.s2 },
  headline: { marginTop: 2, color: theme.colors.brandPrimaryStrong },
  meta: { marginTop: theme.spacing.s1, fontSize: 12, color: theme.colors.neutralTextSecondary },
});

export default InboxPanel;
