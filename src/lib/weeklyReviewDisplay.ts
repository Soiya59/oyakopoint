/**
 * 「先週のふりかえり」（要件定義書07-35章「振り返る機会」、主要画面ワイヤーフレーム.md
 * 60章）の純粋な表示ロジック。
 *
 * 画面・フック（src/hooks/useWeeklyReview.ts）に依存しない純粋関数として
 * 切り出してある。理由と検証方法は src/lib/groupDuplicateRows.ts /
 * groupDuplicateRows.verify.ts の前例を参照。このファイル自体は他ファイルを
 * 一切importしない（Node で直接 `node src/lib/weeklyReviewDisplay.verify.ts`
 * を実行できるようにするため）。日付文字列はすべて呼び出し側
 * （src/lib/calendarDates.ts）が計算したJST基準の "YYYY-MM-DD" を渡す。
 */

// ---- 項目3「その週によく行われたクエストの上位」（決定7: 上位5件＋ほか◯件） ----

/** chore_weekly_completion_counts View（スキーマ設計.sql 72章）の1行が最低限持つ形。 */
export interface WeeklyChoreCountRow {
  chore_id: string;
  completion_count: number;
}

export interface WeeklyChoreSummaryEntry {
  choreId: string;
  count: number;
}

/**
 * 決定7「上位5件＋『ほか◯件』」。49-B.5節決定46
 * （src/lib/habitCardDisplay.ts summarizeHabitCardBreakdown）と同じ考え方。
 * 並び替え・件数制限はクライアント側の仕事（Viewは意図的にORDER BYを
 * 持たない、72章コメント）。
 */
export function summarizeWeeklyChoreCounts(
  rows: WeeklyChoreCountRow[],
  limit = 5
): { top: WeeklyChoreSummaryEntry[]; otherCount: number; otherTotal: number } {
  const entries: WeeklyChoreSummaryEntry[] = rows
    .map((r) => ({ choreId: r.chore_id, count: r.completion_count }))
    .sort((a, b) => b.count - a.count);
  const top = entries.slice(0, limit);
  const rest = entries.slice(limit);
  return {
    top,
    otherCount: rest.length,
    otherTotal: rest.reduce((sum, e) => sum + e.count, 0),
  };
}

// ---- 項目2「先週時点の家族の木の段階」 ----

/**
 * `family_tree_stage_for_count()`（DB側）・`src/theme/theme.ts`の
 * `treeStageForCount()`と同じ閾値表（API仕様.md 9.1章）。このファイルは
 * 他ファイルをimportしない方針（冒頭コメント）のため値をここに複製して
 * いる。閾値を変える場合はこの3箇所を同時に直すこと。
 */
export function stageIndexForCount(count: number): number {
  if (count >= 100) return 4;
  if (count >= 60) return 3;
  if (count >= 30) return 2;
  if (count >= 10) return 1;
  return 0;
}

/** family_tree_weekly_completion_counts Viewの1行が最低限持つ形。 */
export interface WeeklyCountRow {
  week_start: string; // "YYYY-MM-DD"
  completion_count: number;
}

/**
 * 「先週時点の家族の木の段階」（07-35章4節項目2、スキーマ設計.sql 72.1章
 * 「completion_countからfamily_tree_seasonsの閾値ロジックへ渡す」への
 * 実装上の回答）。72.1章の文言は「completion_count」とのみ書かれており
 * 週次delta・シーズン累積のどちらを指すか一読して確定できなかったため、
 * 開発部の判断で「シーズン開始週から対象の週まで（含む）の週次件数を
 * 累積した値」を採用した（週次delta〈例: 先週だけ12件〉をそのまま閾値へ
 * 通すと、過去に100件積み上げていても先週1件しか無ければ「種」に
 * 逆行して見えてしまい、07-9章「家族の木は後退しない」と矛盾するため）。
 * 本部長に報告済み（実装メモ参照）。
 */
export function sumCompletionCountsThroughWeek(rows: WeeklyCountRow[], throughWeekStartInclusive: string): number {
  return rows
    .filter((r) => r.week_start <= throughWeekStartInclusive)
    .reduce((sum, r) => sum + r.completion_count, 0);
}

// ---- 「先週」がどのシーズンに属するかの判定 ----

/** family_tree_seasons の1行が最低限持つ形。season_endは排他的上限（41章のViewと同じ境界）。 */
export interface SeasonRangeRow {
  id: string;
  season_start: string; // "YYYY-MM-DD"
  season_end: string | null; // "YYYY-MM-DD" | null（null=進行中）
}

/**
 * 指定した週（weekStart）が属するシーズンを`season_start <= weekStart <
 * season_end`（season_end IS NULLなら上限なし）で判定する。見つからなければ
 * null（家族作成直後でまだどのシーズンにも属さない場合等）。
 */
export function findSeasonForWeek<T extends SeasonRangeRow>(seasons: T[], weekStart: string): T | null {
  return (
    seasons.find((s) => s.season_start <= weekStart && (s.season_end === null || weekStart < s.season_end)) ?? null
  );
}

// ---- 家族作成から最初の暦週がまだ終わっていない間はカード自体を出さない（決定5） ----

/**
 * 決定5「家族が作成されてから最初の暦週がまだ終わっていない間は表示しない」。
 * `familyCreationWeekStart`（家族作成日を含む週の開始日）が`lastWeekStart`
 * （直近に確定した先週の開始日）以前であれば、少なくとも1つの「確定した
 * 先週」が存在する。
 */
export function hasAtLeastOneConfirmedPastWeek(familyCreationWeekStart: string, lastWeekStart: string): boolean {
  return familyCreationWeekStart <= lastWeekStart;
}
