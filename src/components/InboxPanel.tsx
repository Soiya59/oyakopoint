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
 *
 * [2026-09-30追加・要件定義書07-43章決定12、主要画面ワイヤーフレーム.md 70.5節D9、実装メモ.md 335章]
 * 「おねがい」の2種類を合流させる。新しい表は要らず、端末が持つ`chores`・`chore_completions`から
 * 組み立てる（判定は`src/lib/requestChore.ts`の純粋関数）。
 *  - 子ども（担当の本人）: 「{依頼者}から　💌 おねがいが とどいたよ」。**題名は載せない**（子どもは一覧で
 *    題名を見られる。ベルにも並べると命令の響きが出やすい）。時刻はおねがいを作った時刻。やったあと・
 *    取り下げたあとは消える。
 *  - 依頼者の保護者（`created_by`の1人だけ）: 「{やってくれた子}から　✅ おねがいを やってくれました　
 *    💌 {題名}」。他の保護者・みまもりには出ない。1分以内の取消（完了報告の削除）で消える。
 * ベルの件数（`countRecentInbox`）にも数える。ベルの項目をタップして対象を開く導線は次フェーズ。
 *
 * [2026-10-03追加・要件定義書07-45章 決定1〜13、主要画面ワイヤーフレーム.md 71章、設計部/成果物/
 * API仕様.md 39章、開発部/成果物/実装メモ.md 347章] 感謝ポイントへのスタンプの返しを2か所に足した。
 *  - **受け取った人**: 感謝カードの下（カードの横幅いっぱい）に、4種のスタンプの行（`GratitudeStampRow`）を
 *    常時出す。出す条件は`canShowGratitudeStampRow`（贈った人が在籍中・スタンプのデータが取得済み・
 *    取り消されていない・自分が受け取った）。「家族のやりとりを使う」がオフでも出す。
 *  - **贈った人**: 自分が贈った感謝にスタンプが押されたら、新しい種類の項目
 *    「{受け取った人}から　{絵文字} {スタンプ名}　💌 {ひとこと先頭20字／贈った日・◯pt}」を並べる
 *    （id＝`gratitude_stamp:${感謝のid}`。入れ替えても項目は1つのまま。時刻はスタンプを押した時刻）。
 *    ベルの件数（`countRecentInbox`）にも、直近に押された分を数える（受け取った人が自分で押した分は数えない）。
 * 押していない状態・未返信の件数・赤い点はどこにも出さない（71.5節）。通帳・贈る画面・ホームには足さない（71.6節）。
 *
 * [2026-10-13追加・要件定義書07-48章 決定1〜10、主要画面ワイヤーフレーム.md 74.2・74.5節、設計部/成果物/
 * API仕様.md 42.5節、開発部/成果物/実装メモ.md 364章] 完了報告のコメントへの「返信」を足した。
 *  - **自分の報告に付いた反応**（`fromReactions`）から、**自分が書いた行（自分の返信）と返信の行を除く**
 *    （独立した行にしない・件数に数えない。除かないと自分の返信が「自分から」として自分のベルに載る）。
 *  - コメントの行に、**返信の入口**（「＋返信」／子ども「＋へんじ」）を足す。条件は`canShowReplyEntry`
 *    （まだ返信が無い／元の書き手が在籍中／「家族のやりとりを使う」がオン／読み込み済み）。押すと
 *    カードの中に入力欄が開く（モーダルにしない）。返信ずみのカードの中には、自分の返信を1行だけ添える
 *    （返信した直後の取消のため。独立した行ではない）。
 *  - **新しい種類の項目「返信が来た」**（id＝`reply:${返信のid}`）：自分のコメントに報告者が返信したとき、
 *    「{報告者}から　💬 返信（子ども＝へんじ）」＋どのコメントへの返信か＋返信の本文。入口は付けない。
 *    元のコメントや返信が消えれば消える。ホームのベルの件数（`countRecentInbox`）にも直近の分を数える。
 *  - 未返信の印・数・点・催促はどこにも出さない（74.9節）。ベルの行を強調（ハイライト）もしない。
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import MemberAvatar from "./MemberAvatar";
import GratitudeStampRow from "./GratitudeStampRow";
import { EmptyState } from "./StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { formatDateTimeShort, toJstDateString } from "@/lib/calendarDates";
import {
  canShowGratitudeStampRow,
  countGratitudeStampArrivals,
  gratitudeStampArrivals,
  gratitudeStampSubject,
  stampKeyOf,
  type GratitudeLike,
  type GratitudeReactionLike,
} from "@/lib/gratitudeStamp";
import type { ChoreReaction, StampKey } from "@/types/domain";
import {
  requestArrivedForChild,
  requestDoneForRequester,
  type RequestInboxChore,
} from "@/lib/requestChore";
import { BELL_HEADLINE_REQUEST_ARRIVED, BELL_HEADLINE_REQUEST_DONE } from "@/lib/requestChoreText";
import CommentReplyComposer, { OwnReplyLine } from "./CommentReplyComposer";
import {
  canShowReplyEntry,
  groupRepliesByParent,
  isReactionForMyReportBell,
  replyArrivalsFor,
  replyExcerpt,
  type ReplyReactionLike,
} from "@/lib/commentReply";
import { BELL_HEADLINE_REPLY, bellReplySubject } from "@/lib/commentReplyText";

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
  /**
   * [2026-10-03追加] 受け取った人の感謝カードだけが持つ。あれば、カードの下にスタンプの行を出す
   * （出す条件を満たしたカードだけに付ける）。`selectedKey`は今付いているスタンプ（なければnull）。
   */
  stampRow?: { gratitudeId: string; selectedKey: string | null };
  /**
   * [2026-10-13追加・要件定義書07-48章] 自分の報告に付いた他人のコメントの行だけが持つ。あれば、カードの中に
   * 返信の入口（「＋返信」「＋へんじ」）を出す（出す条件を満たした行だけに付ける）。
   */
  replyEntry?: { completionId: string; parentId: string; commenterName: string };
  /**
   * [2026-10-13追加] 自分がすでに返信しているコメントの行だけが持つ。あれば、カードの中に自分の返信を
   * 1行だけ添える（返信した直後の取消のため。独立した行ではない）。
   */
  ownReply?: ChoreReaction;
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
    completions: { id: string; reported_by: string; chore_id: string | null; reported_at: string }[];
    // [2026-09-30追加・D9] おねがいのベル（子ども＝届いた／依頼者＝やってくれた）の数え上げに使う。
    chores: RequestInboxChore[];
    // [2026-10-13変更・要件定義書07-48章] 自分の返信を除き、自分のコメントへの返信を数えるため、
    // 返信の判定に要る列（書いた人・返信先・種類）も要る（`ReplyReactionLike`）。
    reactions: ReplyReactionLike[];
    // [2026-10-03変更・要件定義書07-45章] 贈った人のベルに届くスタンプを数えるため、感謝の行の
    // 贈った人・id・ひとこと・ポイントも要る（`gratitudeStampArrivals`が使う）。
    gratitude: GratitudeLike[];
    // [2026-10-03追加] 自分が当事者の感謝へのスタンプ。nullは未取得・取得失敗（数えない）。
    gratitudeReactions: GratitudeReactionLike[] | null;
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
  // [2026-10-13変更・要件定義書07-48章] **自分が書いた行（自分の返信）は数えない**（受け取ったものではない）。
  const reactions = state.reactions.filter(
    (r) => mine.has(r.completion_id) && isReactionForMyReportBell(r, memberId) && new Date(r.created_at).getTime() >= sinceMs
  ).length;
  // [2026-10-13追加・要件定義書07-48章] 自分のコメントに付いた返信（直近）。累計・順位は作らない。
  const replyArrivals = replyArrivalsFor(state.reactions, memberId).filter(
    (a) => new Date(a.reply.created_at).getTime() >= sinceMs
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
  // [2026-10-03追加・要件定義書07-45章 決定4] 自分が贈った感謝に、直近に押されたスタンプ。
  // 受け取った人が自分で押したスタンプは数えない（届いたものではない）。累計・順位は作らない。
  const gratitudeStamps = countGratitudeStampArrivals(
    state.gratitude,
    state.gratitudeReactions,
    memberId,
    sinceMs,
    theme.stampDefinitions.map((s) => s.key)
  );
  const published = state.publishedDrawings.filter(
    (d) => d.artist_member_id === memberId && !!d.published_at && new Date(d.published_at).getTime() >= sinceMs
  ).length;
  // [2026-09-30追加・D9] おねがい。子どもは「自分が担当で、まだやっていないおねがいが作られた」、
  // 依頼者は「自分が作ったおねがいが完了された」を数える（どちらも自分に該当しなければ0）。
  const requestArrived = requestArrivedForChild(state.chores, state.completions, memberId).filter(
    (x) => new Date(x.at).getTime() >= sinceMs
  ).length;
  const requestDone = requestDoneForRequester(state.chores, state.completions, memberId).filter(
    (x) => new Date(x.at).getTime() >= sinceMs
  ).length;
  return (
    reactions +
    replyArrivals +
    gratitude +
    gratitudeStamps +
    boardReactions +
    boardComments +
    drawingReactions +
    drawingComments +
    published +
    requestArrived +
    requestDone
  );
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
  const { state, memberAvatars, dispatch, loading } = useAppData();
  const isChild = tone === "child";
  // 送る前に元のコメントが削除されていたとき、一度だけ出す一文（次にこの画面を開き直すと消える。74.7節）。
  const [goneNotice, setGoneNotice] = React.useState<string | null>(null);

  // [2026-10-03追加] 感謝カードのスタンプの行から呼ぶ。`dispatch`の結果（成功・失敗）をそのまま返し、
  // 失敗の一文と目印は行の部品がカードごとに出す。見た目は取り直しの結果に従う（楽観更新はしない）。
  const toggleGratitudeStamp = React.useCallback(
    (gratitudeId: string, stampKey: StampKey) =>
      dispatch({ type: "TOGGLE_GRATITUDE_STAMP", gratitudeId, reactedBy: memberId, stampKey }),
    [dispatch, memberId]
  );

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

    // [2026-10-13変更・要件定義書07-48章] 自分の返信（書いた人＝自分）と返信の行は、この種類に載せない
    // （`isReactionForMyReportBell`）。コメントの行には返信の入口と、自分の返信の1行を付ける。
    const repliesEnabled = state.family.social_interactions_enabled;
    const { repliesOf } = groupRepliesByParent(state.reactions);
    const fromReactions: InboxItem[] = state.reactions
      .filter((r) => myCompletions.has(r.completion_id) && isReactionForMyReportBell(r, memberId))
      .map((r) => {
        const c = myCompletions.get(r.completion_id)!;
        const stamp = r.stamp_key ? theme.stampDefinitions.find((s) => s.key === r.stamp_key) : undefined;
        const commenter = state.members.find((m) => m.id === r.reacted_by);
        const replies = r.kind === "comment" ? repliesOf.get(r.id) ?? [] : [];
        const showEntry =
          r.kind === "comment" &&
          canShowReplyEntry({
            reportedBy: c.reported_by,
            myMemberId: memberId,
            parent: r,
            hasReply: replies.length > 0,
            authorIsActive: commenter?.is_active ?? false,
            repliesEnabled,
            loaded: !loading,
          });
        return {
          id: `reaction:${r.id}`,
          fromMemberId: r.reacted_by,
          at: r.created_at,
          headline: stamp ? `${stamp.emoji} ${stamp.label}` : "💬 コメント",
          body: r.comment_body,
          choreLabel: `${c.chore_emoji ?? "📝"} ${c.chore_title}`,
          replyEntry: showEntry
            ? { completionId: r.completion_id, parentId: r.id, commenterName: commenter?.display_name ?? "" }
            : undefined,
          ownReply: replies.find((x) => x.reacted_by === memberId),
        };
      });

    // [2026-10-13追加・要件定義書07-48章 決定4・6、主要画面ワイヤーフレーム.md 74.5節] 新しい項目「返信が来た」。
    // 自分のコメントに、その完了報告の報告者が返信したとき。「{報告者}から」＋見出し（💬 返信／💬 へんじ）
    // ＋どのコメントへの返信か（元のコメントの先頭20字）＋返信の本文。入口は付けない（返信への返信はできない）。
    // 元のコメントや返信が消えれば（削除・非表示）一覧に出てこないので、この項目も消える。
    const fromReplies: InboxItem[] = replyArrivalsFor(state.reactions, memberId).map(({ reply, parent }) => {
      const c = state.completions.find((x) => x.id === reply.completion_id);
      return {
        id: `reply:${reply.id}`,
        fromMemberId: reply.reacted_by,
        at: reply.created_at,
        headline: BELL_HEADLINE_REPLY[tone],
        body: reply.comment_body,
        choreLabel: bellReplySubject(
          tone,
          `${c?.chore_emoji ?? "📝"} ${c?.chore_title ?? ""}`,
          replyExcerpt(parent.comment_body ?? "")
        ),
      };
    });

    // [2026-10-03変更・要件定義書07-45章] スタンプの行（入口）を出す条件を満たす感謝カードには、
    // `stampRow`を付ける（出す条件は`canShowGratitudeStampRow`。贈った人が在籍中・取得済みなど）。
    // 昔の感謝のカードも同じ見た目（新旧で変えない。71.2節）。
    const reactionsLoaded = state.gratitudeReactions !== null;
    const fromGratitude: InboxItem[] = state.gratitude
      .filter((g) => g.recipient_id === memberId && g.revoked_at === null)
      .map((g) => ({
        id: `gratitude:${g.id}`,
        fromMemberId: g.sender_id,
        at: g.created_at,
        headline: `💌 ありがとう +${g.points}pt`,
        body: g.note,
        choreLabel: null,
        stampRow: canShowGratitudeStampRow({
          gratitude: g,
          memberId,
          senderIsActive: state.members.some((m) => m.id === g.sender_id && m.is_active),
          reactionsLoaded,
        })
          ? { gratitudeId: g.id, selectedKey: stampKeyOf(state.gratitudeReactions, g.id) }
          : undefined,
      }));

    // [2026-10-03追加・要件定義書07-45章 決定4、主要画面ワイヤーフレーム.md 71.3節] 贈った人のベルの
    // 新しい項目。自分が贈った感謝にスタンプが押されたら並べる。「{受け取った人}から」＋
    // 「{絵文字} {スタンプ名}」＋どの感謝への一言（ひとこと先頭20字／無ければ贈った日・◯pt）＋押した時刻。
    // ひとこと欄（body）は出さない。押せない（返事への返事はできない）。
    const todayJst = toJstDateString(new Date());
    const fromGratitudeStamps: InboxItem[] = gratitudeStampArrivals(
      state.gratitude,
      state.gratitudeReactions,
      memberId,
      theme.stampDefinitions.map((s) => s.key)
    ).map((a) => {
      const stamp = theme.stampDefinitions.find((s) => s.key === a.stampKey);
      return {
        id: `gratitude_stamp:${a.gratitudeId}`,
        fromMemberId: a.recipientId,
        at: a.at,
        headline: stamp ? `${stamp.emoji} ${stamp.label}` : "",
        body: null,
        choreLabel: gratitudeStampSubject({
          note: a.note,
          points: a.points,
          sentJstDate: toJstDateString(a.sentAt),
          todayJstDate: todayJst,
          child: isChild,
        }),
      };
    });

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

    // [2026-09-30追加・D9] おねがい（子ども向け「とどいたよ」・依頼者向け「やってくれました」）。
    const fromRequestArrived: InboxItem[] = requestArrivedForChild(state.chores, state.completions, memberId).map(
      ({ chore, at }) => ({
        id: `request:${chore.id}`,
        fromMemberId: chore.created_by,
        at,
        headline: BELL_HEADLINE_REQUEST_ARRIVED,
        body: null,
        choreLabel: null, // 題名は載せない
      })
    );
    const fromRequestDone: InboxItem[] = requestDoneForRequester(state.chores, state.completions, memberId).map(
      ({ completion, at }) => ({
        id: `request_done:${completion.id}`,
        fromMemberId: completion.reported_by,
        at,
        headline: BELL_HEADLINE_REQUEST_DONE,
        body: null,
        // 保護者は複数のおねがいを出していることがあるので、どれをやってくれたかを題名で示す。
        // 題名は完了報告に保存されているchore_titleの複写（クエスト側を引き直さない）。
        choreLabel: `💌 ${state.completions.find((c) => c.id === completion.id)?.chore_title ?? ""}`,
      })
    );

    return [
      ...fromRequestArrived,
      ...fromRequestDone,
      ...fromReactions,
      ...fromReplies,
      ...fromGratitude,
      ...fromGratitudeStamps,
      ...fromBoardReactions,
      ...fromBoardComments,
      ...fromDrawingReactions,
      ...fromDrawingComments,
      ...fromPublishedDrawings,
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [
    memberId,
    isChild,
    tone,
    loading,
    state.family.social_interactions_enabled,
    state.completions,
    state.chores,
    state.reactions,
    state.gratitude,
    state.gratitudeReactions,
    state.members,
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

  const goneNoticeEl = goneNotice ? <Text style={styles.meta}>{goneNotice}</Text> : null;

  if (items.length === 0) {
    return (
      <View style={{ marginTop: theme.spacing.s6 }}>
        {goneNoticeEl}
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
      {goneNoticeEl}
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
                {/* [2026-10-13追加・要件定義書07-48章] 返信ずみなら自分の返信を1行だけ添える（入口は出ない）。
                    まだなら入口（条件を満たした行だけ）。どちらも無ければ何も描かない。 */}
                {it.ownReply && <OwnReplyLine tone={tone} reply={it.ownReply} />}
                {it.replyEntry && (
                  <CommentReplyComposer
                    tone={tone}
                    completionId={it.replyEntry.completionId}
                    parentId={it.replyEntry.parentId}
                    commenterName={it.replyEntry.commenterName}
                    myMemberId={memberId}
                    onParentGone={setGoneNotice}
                  />
                )}
              </View>
            </View>
            {/* [2026-10-03追加] 受け取った人のカードの下に、4種のスタンプの行。アバターの右の本文の幅では
                なく、カードの横幅いっぱい（左端から）に置く（子どもの56dp×4が本文の幅に入らない端末があるため。
                主要画面ワイヤーフレーム.md 71.2節）。 */}
            {it.stampRow && (
              <GratitudeStampRow
                tone={tone}
                gratitudeId={it.stampRow.gratitudeId}
                selectedKey={it.stampRow.selectedKey}
                onToggle={toggleGratitudeStamp}
              />
            )}
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
