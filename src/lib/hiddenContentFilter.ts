/**
 * 運営による非表示（要件定義書07-32章 決定7の「段階3」、設計部/成果物/
 * スキーマ設計.sql 66章）の「表示から外す」判定ロジック。2026-09-21新設。
 *
 * [この機能の形]
 * - 運営がSupabaseのSQL Editorで`hide_content()`を実行すると、`hidden_contents`に
 *   1行入る（種別＋対象id＋日時のみ。誰が・なぜは入っていない）。
 * - アプリに操作UIは持たない（保護者にも「非表示にする」ボタンは無い）。
 *   クライアントは`hidden_contents`を読み、対象の行を一覧・表示から除くだけ
 *   （66.4章の対応表、★クライアント必須要件）。これを実装するのが本ファイル。
 * - キーは`${content_kind}:${content_id}`の文字列（`src/data/store.tsx`の
 *   `hiddenContentKeysSet`が家族分をまとめて持つ）。
 *
 * [対応表（66.4章）]
 * | content_kind             | 何を隠すか |
 * |---------------------------|------------|
 * | family_board_post         | カードごと |
 * | chore_completion_note     | noteだけ。行は出す |
 * | chore_reaction_comment    | その1行（kind='comment'）ごと。スタンプは残す |
 * | gratitude_note            | noteだけ。行は出す |
 * | family_drawing            | 絵と題名ごと |
 */
import type { HiddenContentKind } from "@/types/domain";

/** `hidden_contents`のキー（content_kind:content_id）を作る。store.tsx・各呼び出し元で共通利用。 */
export function hiddenContentKey(kind: HiddenContentKind, id: string): string {
  return `${kind}:${id}`;
}

/** idを持つ配列から、非表示にされた行をまるごと除く（掲示板の投稿・お絵かき）。 */
export function excludeHiddenById<T extends { id: string }>(
  items: readonly T[],
  kind: HiddenContentKind,
  hiddenKeys: ReadonlySet<string>
): T[] {
  if (hiddenKeys.size === 0) return [...items];
  return items.filter((item) => !hiddenKeys.has(hiddenContentKey(kind, item.id)));
}

/** 完了報告へのコメント（chore_reactions）用。kind='comment'の行のみ対象、スタンプは常に残す。 */
export function excludeHiddenChoreReactionComments<T extends { id: string; kind: string }>(
  reactions: readonly T[],
  hiddenKeys: ReadonlySet<string>
): T[] {
  if (hiddenKeys.size === 0) return [...reactions];
  return reactions.filter(
    (r) => r.kind !== "comment" || !hiddenKeys.has(hiddenContentKey("chore_reaction_comment", r.id))
  );
}

/** noteだけを空にする（行・ポイントは変えない）。完了報告のひとこと・感謝のひとこと共通。 */
export function blankHiddenNoteById<T extends { id: string; note: string | null }>(
  items: readonly T[],
  kind: "chore_completion_note" | "gratitude_note",
  hiddenKeys: ReadonlySet<string>
): T[] {
  if (hiddenKeys.size === 0) return [...items];
  return items.map((item) => (hiddenKeys.has(hiddenContentKey(kind, item.id)) ? { ...item, note: null } : item));
}

/**
 * [2026-09-21追加・本部長差し戻し「家族の木の飾り・ガチャ結果画面にも絵が
 * 素通しで出ている」対応] 家族の木の色丸（`FamilyTreeCompletionDot`）が
 * 持つ「景品」（`prize`）のうち、絵（`prize.drawing`）が運営に非表示にされて
 * いれば、**その飾り（`prize`）ごと**取り除く（`prize: null`にする）。
 * `src/lib/blockFilter.ts`の`stripBlockedTreeDotPrizes`と対になる関数。
 * 色丸そのもの（完了報告・アバター等）は消さない（66.4章の対応表
 * 「family_drawing: 絵と題名ごと。木に飾られていればその飾りも描かない」）。
 */
export function stripHiddenTreeDotPrizes<
  T extends { prize: { drawing: { drawingId: string } | null } | null }
>(dots: readonly T[], hiddenKeys: ReadonlySet<string>): T[] {
  if (hiddenKeys.size === 0) return [...dots];
  return dots.map((dot) =>
    dot.prize?.drawing && hiddenKeys.has(hiddenContentKey("family_drawing", dot.prize.drawing.drawingId))
      ? { ...dot, prize: null }
      : dot
  );
}
