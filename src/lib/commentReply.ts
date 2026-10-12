/**
 * 完了報告のコメントへの「返信」（報告した本人が返せる）の、画面に依存しない判定と組み立て。
 *
 * [2026-10-13新設・要件定義書07-48章 決定1〜10、設計部/成果物/スキーマ設計.sql 86章、
 * 設計部/成果物/API仕様.md 42.4・42.5節、UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 74章、
 * 開発部/成果物/実装メモ.md 364章]
 *
 * 画面（`ChoreReactionsList`・`InboxPanel`・`CommentReplyComposer`）が同じ判定を使えるよう、
 * 純粋関数にして1か所に置いた（`commentReply.verify.ts`で確認）。**守りはDB側**（制約・INSERTポリシー・
 * BEFOREトリガー）で、ここは「入口を出すか／どう並べるか」という親切のための判定。
 *
 * 画面側の約束（74.9節）：返信の数・未返信の数・「返していないコメント」を数える関数は
 * ここに作らない（決定8・9）。
 */

/** 返信の判定・組み立てに要る列だけ（`ChoreReaction`の部分集合）。 */
export interface ReplyReactionLike {
  id: string;
  completion_id: string;
  reacted_by: string;
  kind: string;
  comment_body: string | null;
  created_at: string;
  reply_to_reaction_id: string | null;
}

/** この行が「返信」か（コメントの行で、返信先を持つ）。 */
export function isReplyRow(r: Pick<ReplyReactionLike, "kind" | "reply_to_reaction_id">): boolean {
  return r.kind === "comment" && r.reply_to_reaction_id != null;
}

/**
 * 一覧を「親の行」と「親ごとの返信」にまとめる（API仕様.md 42.5節）。
 *
 * - `rows`: 返信でない行（スタンプ・普通のコメント）を元の順のまま。
 * - `repliesOf`: 親のコメントのid → その返信（元の順）。
 * - **親が一覧に無い返信は出さない**（親が削除・非表示・ブロックで消えていれば返信も出さない。74.3節）。
 *   親がスタンプの行、または親自身が返信の行（返信への返信。DBが作らせないが念のため）の返信も出さない。
 */
export function groupRepliesByParent<T extends ReplyReactionLike>(
  reactions: readonly T[]
): { rows: T[]; repliesOf: Map<string, T[]> } {
  const rows = reactions.filter((r) => !isReplyRow(r));
  const parentIds = new Set(rows.filter((r) => r.kind === "comment").map((r) => r.id));
  const repliesOf = new Map<string, T[]>();
  for (const r of reactions) {
    if (!isReplyRow(r)) continue;
    const parentId = r.reply_to_reaction_id as string;
    if (!parentIds.has(parentId)) continue;
    const list = repliesOf.get(parentId);
    if (list) list.push(r);
    else repliesOf.set(parentId, [r]);
  }
  return { rows, repliesOf };
}

/**
 * 返信の入口（「＋返信」「＋へんじ」）を出す条件（API仕様.md 42.4節・主要画面ワイヤーフレーム.md 74.2節）。
 * **すべて満たすときだけ**出す。押せない状態は見せない（鍵・グレー表示・説明を置かない）。
 *
 *  1. 完了報告の報告者が自分である（`reportedBy === myMemberId`）。
 *  2. そのコメントが、コメントの行で、返信でない行である（削除済み・運営の非表示は一覧に載らない）。
 *  3. そのコメントの書き手が自分でなく、家族に在籍している。
 *  4. そのコメントを親とする返信が、いま一覧に無い（`hasReply`）。
 *  5. 「家族のやりとりを使う」がオン。
 *  6. リアクションの読み込みが済んでいる（返信ずみかどうかが分からないまま出すと二重に送りうる）。
 */
export function canShowReplyEntry(p: {
  reportedBy: string | null | undefined;
  myMemberId: string;
  parent: Pick<ReplyReactionLike, "kind" | "reply_to_reaction_id" | "reacted_by">;
  hasReply: boolean;
  authorIsActive: boolean;
  repliesEnabled: boolean;
  loaded: boolean;
}): boolean {
  if (!p.loaded || !p.repliesEnabled) return false;
  if (!p.myMemberId || p.reportedBy !== p.myMemberId) return false;
  if (p.parent.kind !== "comment" || p.parent.reply_to_reaction_id != null) return false;
  if (p.parent.reacted_by === p.myMemberId) return false;
  if (!p.authorIsActive) return false;
  if (p.hasReply) return false;
  return true;
}

/**
 * 「自分のコメントに付いた返信」（ベルの「返信が来た」行・ホームのバッジ）。
 * 返信の行で、親が一覧にあり、親の書き手が自分で、返信を書いたのが自分でないもの。
 * 親が返信の行・スタンプの行なら含めない。時刻順の並べ替えは呼び出し側（ベルの全項目の並べ替え）。
 */
export function replyArrivalsFor<T extends ReplyReactionLike>(
  reactions: readonly T[],
  memberId: string
): { reply: T; parent: T }[] {
  if (!memberId) return [];
  const byId = new Map<string, T>(reactions.map((r) => [r.id, r]));
  const out: { reply: T; parent: T }[] = [];
  for (const r of reactions) {
    if (!isReplyRow(r) || r.reacted_by === memberId) continue;
    const parent = byId.get(r.reply_to_reaction_id as string);
    if (!parent || parent.kind !== "comment" || parent.reply_to_reaction_id != null) continue;
    if (parent.reacted_by !== memberId) continue;
    out.push({ reply: r, parent });
  }
  return out;
}

/**
 * ベルの「自分の報告に付いた反応」の行（今のベルの `fromReactions`）に載せてよい行か。
 * **自分が書いた行（自分の返信）は載せない**（独立した行にしない・件数に数えない。74.5節 R7）。
 * 返信の行も載せない（返信は`replyArrivalsFor`が別の種類の項目にする）。
 */
export function isReactionForMyReportBell(
  r: Pick<ReplyReactionLike, "reacted_by" | "kind" | "reply_to_reaction_id">,
  memberId: string
): boolean {
  return r.reacted_by !== memberId && !isReplyRow(r);
}

/** 元のコメントの先頭20字＋超過時は「…」（`boardPostExcerpt`と同じ）。 */
export function replyExcerpt(body: string, max = 20): string {
  const chars = Array.from(body);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : body;
}

const FIVE_MIN_MS = 5 * 60 * 1000;

/** 返信を書いてから5分以内か（本人の「取消」を出す条件。コメントと同じ）。 */
export function isWithinReplyCancelWindow(createdAt: string, nowMs: number): boolean {
  return nowMs - new Date(createdAt).getTime() <= FIVE_MIN_MS;
}
