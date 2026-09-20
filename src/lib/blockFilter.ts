/**
 * ブロック（要件定義書07-32章 決定11〜14、設計部/成果物/スキーマ設計.sql 69章、
 * API仕様.md 26章、2026-09-20新設）の「表示から外す」判定ロジック。
 *
 * [この機能の形]
 * - 「人を消す」のではなく「その人が書いた言葉を自分の画面に出さない」だけ
 *   （決定11）。画面に「ブロック」という語は出さない。
 * - 効果はすべてクライアント側の取得後フィルタで作る。既存の各テーブルの
 *   RLSは一切変更しない（決定14）。本ファイルの関数群がその「取得後
 *   フィルタ」の実体である（設計部69.4章・API仕様.md 26.2章の対応表どおり）。
 * - 隠れる5種: 掲示板の投稿／掲示板のコメント（07-30章・未実装のため本章
 *   では関数を用意しない）／完了報告へのコメント（スタンプは対象外）／
 *   感謝メッセージのひとこと（noteだけを空にする。ポイントは動かさない）／
 *   公開済みのお絵かきと題名。
 * - 隠れないもの: 完了報告そのもの／表示名／アバター／家族の木の色丸・
 *   内訳／ポイント・通帳／実施履歴カレンダー／クエスト・ごほうび。
 *
 * [呼び出し側への注意] 「自分がブロックしている相手のmember_id集合
 * （blockedMemberIds）」を渡すのは呼び出し側の責務。この集合は
 * `member_blocks`から`blocker_member_id = 自分`の行を取得して作る
 * （`src/data/api.ts` の `fetchMyMemberBlocks`、`src/data/store.tsx` の
 * `blockedMemberIdsSet`）。
 *
 * [2026-09-20時点でこのファイルが呼ばれていない箇所について] 家族の書き込み
 * ボードの投稿一覧・公開済みお絵かきの一覧は、いずれもグローバルな
 * state（src/data/store.tsx の State）を経由せず、各画面（未実装。UIUX
 * デザイン部の設計待ち）が `src/data/api.ts` の取得関数を直接呼ぶ構造に
 * なっている。したがって `excludeBlockedByAuthor` はこの回では実際の
 * 呼び出し元を持たない（=デッドコードではなく「次回、画面実装時にそのまま
 * 使う関数」として用意してある）。一方、`chore_reactions`（完了報告への
 * コメント）と `gratitude_points`（感謝のひとこと）は既に
 * `src/data/store.tsx` のグローバルstateに載っているため、この回で
 * `load()` に組み込み済み（開発部/成果物/実装メモ.md参照）。
 */

/**
 * 著者IDを持つ配列から、ブロック対象の著者による行を除く（カードごと隠す。
 * 掲示板の投稿・公開済みのお絵かき、07-30章実装後の掲示板コメントに使う）。
 */
export function excludeBlockedByAuthor<T>(
  items: readonly T[],
  authorIdOf: (item: T) => string,
  blockedMemberIds: ReadonlySet<string>
): T[] {
  if (blockedMemberIds.size === 0) return [...items];
  return items.filter((item) => !blockedMemberIds.has(authorIdOf(item)));
}

/**
 * 完了報告へのコメント（chore_reactions）用。スタンプ（kind='stamp'）は
 * ブロックの対象外のため、常にそのまま残す。コメント（kind='comment'）のみ、
 * 送信者がブロック対象ならその1行を除く（API仕様.md 26.2章の対応表）。
 */
export function excludeBlockedChoreReactionComments<
  T extends { kind: string; reacted_by: string }
>(reactions: readonly T[], blockedMemberIds: ReadonlySet<string>): T[] {
  if (blockedMemberIds.size === 0) return [...reactions];
  return reactions.filter((r) => r.kind !== "comment" || !blockedMemberIds.has(r.reacted_by));
}

/**
 * 感謝メッセージのひとこと（gratitude_points）用。行そのものは残し
 * （ポイントは動かさない、決定11「相手の側は影響を受けない」）、noteだけを
 * nullにする（受け取った側の画面から。API仕様.md 26.2章）。
 */
export function blankBlockedGratitudeNotes<T extends { sender_id: string; note: string | null }>(
  gratitude: readonly T[],
  blockedMemberIds: ReadonlySet<string>
): T[] {
  if (blockedMemberIds.size === 0) return [...gratitude];
  return gratitude.map((g) => (blockedMemberIds.has(g.sender_id) ? { ...g, note: null } : g));
}
