/**
 * 「きろく」の「クエストごとの回数」（要件定義書07-46章、設計部/成果物/スキーマ設計.sql 84章・
 * API仕様.md 40章、UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 72章、開発部/成果物/
 * 実装メモ.md 353章）の判定・文言を1か所にまとめた純粋関数。
 *
 * 3ロール（保護者P18・子どもC15・みまもりS12）の画面と`QuestCountList`が同じ関数を呼ぶ。
 * 「いつ枠を出すか」「どんな文言か」を画面ごとに書き分けると食い違うため、ここに集めた。
 *
 * 守ること（07-46章 決定5・7。72.7節）:
 *  - **並べ替えない。**`toQuestCountRows`は取得した順のまま、名前・絵文字・回数だけを取り出す
 *    （最後にやった時刻・順位の材料は部品に渡さない）。並びはDBの取り方（`fetchMemberChoreNameCounts`の
 *    `.order()`）が決める。回数の多い順にする関数は作らない。
 *  - 合計・割合・順位・「いちばん」を作る関数を置かない。
 *
 * [制約] `*.verify.ts`からNode単体で読み込めるよう、値のimport・型のimportを一切持たない
 * （src/lib/gratitudeStamp.tsと同じ）。
 */

export type QuestCountTone = "parent" | "child" | "supporter";

/** 部品に渡す1行。時刻・順位の列は持たない（72.10節 開発部への申し送り2）。 */
export interface QuestCountRow {
  name: string;
  emoji: string;
  count: number;
}

/** `fetchMemberChoreNameCounts`が返す行のうち、ここで使う列だけ。 */
interface QuestCountSourceRow {
  chore_name: string;
  chore_emoji: string | null;
  completion_count: number;
}

/** 絵文字が無いときの代替（ベルの`c.chore_emoji ?? "📝"`と同じ。72.0節）。 */
export const QUEST_COUNT_FALLBACK_EMOJI = "📝";

/** 絵文字が無い（NULL・空文字列・空白だけ）ときは「📝」で補う。 */
export function questCountEmoji(emoji: string | null | undefined): string {
  if (emoji === null || emoji === undefined) return QUEST_COUNT_FALLBACK_EMOJI;
  return emoji.trim() === "" ? QUEST_COUNT_FALLBACK_EMOJI : emoji;
}

/**
 * 取得した行を、取得した順のまま部品用の行にする（並べ替えない・合計しない）。
 * 名前が空文字列の行も落とさない（84.2 判断B(5)。数えているのに見えない、を作らない）。
 */
export function toQuestCountRows(rows: readonly QuestCountSourceRow[]): QuestCountRow[] {
  return rows.map((r) => ({
    name: r.chore_name,
    emoji: questCountEmoji(r.chore_emoji),
    count: r.completion_count,
  }));
}

// ============================================================
// 文言（72.5節。子どもはひらがな、大人は漢字まじり）
// ============================================================

/** 枠の見出し。「ここまでの かず」と並べて、子どもも同じ「かず」の語。 */
export function questCountHeading(tone: QuestCountTone): string {
  return tone === "child" ? "クエストごとの かず" : "クエストごとの回数";
}

/** 行の単位。 */
export function questCountUnit(tone: QuestCountTone): string {
  return tone === "child" ? "かい" : "回";
}

/** 見出しの行の読み上げのヒント（開閉）。 */
export function questCountToggleHint(tone: QuestCountTone, expanded: boolean): string {
  if (tone === "child") return expanded ? "おすと とじるよ" : "おすと ひらくよ";
  return expanded ? "押すと、閉じます" : "押すと、開きます";
}

/** 1行の読み上げ（絵文字は読ませない）。「{名前}、{N}回」。 */
export function questCountRowLabel(tone: QuestCountTone, name: string, count: number): string {
  return `${name}、${count}${questCountUnit(tone)}`;
}

/** 読み込みに失敗したときの文（`ErrorState`のタイトル。72.4節）。 */
export function questCountErrorTitle(tone: QuestCountTone): string {
  return tone === "child" ? "つうしんがおやすみ中みたい" : "クエストごとの回数を読み込めませんでした";
}

// ============================================================
// 枠を出すかどうか（72.2節・72.4節）
// ============================================================

/** 「これまでの回数」の行のうち、クエストの総回数（`lifetime_completions`）の現在値。無ければnull。 */
export function lifetimeCompletionsOf(rows: readonly { key: string; currentValue: number }[]): number | null {
  const row = rows.find((r) => r.key === "lifetime_completions");
  return row ? row.currentValue : null;
}

/**
 * 「クエストごとの回数」の枠を出すか。
 * 「これまでの回数」が読み込めて（ready）、クエストの回数が1以上のときだけ。
 * 0回なら枠ごと出さない（不在を強調しない。決定6）。読み込み中・失敗のときも出さない
 * （出すかどうかの判断材料が無いため。72.4節）。新しく数えない（`useMemberBadgeRows`の結果をそのまま使う）。
 */
export function shouldShowQuestCountSection(
  badgeLoadState: "loading" | "error" | "ready",
  lifetimeCompletions: number | null
): boolean {
  return badgeLoadState === "ready" && lifetimeCompletions !== null && lifetimeCompletions > 0;
}

/**
 * みまもりS12で「自分のタブ」か。他の人のタブ・「＋家族全体」では「これまでの回数」も枠も出さない
 * （07-46章 決定8。みまもりが、子どもや保護者の通算の回数を新しく見られるようにしない）。
 */
export function isOwnTab(selectedMemberId: string | null, ownMemberId: string | null | undefined): boolean {
  return selectedMemberId !== null && !!ownMemberId && selectedMemberId === ownMemberId;
}
