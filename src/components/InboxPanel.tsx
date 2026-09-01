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
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import MemberAvatar from "./MemberAvatar";
import { EmptyState } from "./StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

type Tone = "parent" | "child" | "supporter";

interface InboxItem {
  id: string;
  fromMemberId: string;
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
  return reactions + gratitude + boardReactions;
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
  const { state } = useAppData();
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
          headline: stamp ? `${stamp.emoji} ${stamp.label}` : "💬 コメント",
          body: null,
          choreLabel: `「${boardPostExcerpt(r.family_board_posts?.body ?? "")}」`,
        };
      });

    return [...fromReactions, ...fromGratitude, ...fromBoardReactions].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
    );
  }, [memberId, state.completions, state.reactions, state.gratitude, state.familyBoardReactions]);

  const formatWhen = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;
  };

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
        const from = memberOf(it.fromMemberId);
        return (
          <Card key={it.id} tone={tone} style={styles.card}>
            <View style={styles.row}>
              <MemberAvatar name={from?.display_name ?? "?"} color={from?.avatar_color} size={32} />
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
