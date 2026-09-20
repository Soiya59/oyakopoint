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
 * [2026-09-21追記] `excludeBlockedByAuthor`は、家族の書き込みボードの投稿一覧
 * （`src/hooks/useFamilyBoard.ts` の `useFamilyBoardHistory`）と、公開済みの
 * お絵かき一覧（`src/hooks/useCollectorShelf.ts` の `useCollectedPrizes`。
 * ガチャの景品として表示される絵が対象）に組み込み済み。いずれもグローバルな
 * state（src/data/store.tsx の State）を経由しない一覧のため、各フックが
 * `useAppData().blockedMemberIdsSet` を直接読んでフィルタする形にした。
 * `chore_reactions`（完了報告へのコメント）と `gratitude_points`（感謝の
 * ひとこと）は `src/data/store.tsx` のグローバルstateに載っているため、
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

/**
 * [2026-09-21追加・本部長差し戻し「家族の木の飾り・ガチャ結果画面にも絵が
 * 素通しで出ている」対応] 家族の木の色丸（`FamilyTreeCompletionDot`）が
 * 持つ「景品」（`prize`）のうち、絵（`prize.drawing`）の作者がブロック対象
 * なら、**その飾り（`prize`）ごと**取り除く（`prize: null`にする）。
 *
 * 色丸そのもの（完了報告・表示名・アバター）は消さない——決定11の「隠れる5種」
 * に「公開済みのお絵かきと題名」とあるとおり、隠れるのは絵と題名（＝飾り）だけで、
 * 色丸という記録自体は隠れないもの（決定11「隠れないもの」の「家族の木の色丸」）
 * だから。既製の飾り（`presetOrnament`のみ・`drawing`がnull）は対象外
 * （絵ではないため）。
 *
 * `src/hooks/useFamilyTree.ts`（現在の木）・`src/hooks/useCollectorShelf.ts`
 * （過去の木）の両方から呼ぶ。
 */
export function stripBlockedTreeDotPrizes<
  T extends { prize: { drawing: { artistId: string } | null } | null }
>(dots: readonly T[], blockedMemberIds: ReadonlySet<string>): T[] {
  if (blockedMemberIds.size === 0) return [...dots];
  return dots.map((dot) =>
    dot.prize?.drawing && blockedMemberIds.has(dot.prize.drawing.artistId) ? { ...dot, prize: null } : dot
  );
}
