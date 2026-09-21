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
 *
 * [2026-09-22改訂] 統括判断により、項目1「家族全体の完了報告数」は廃止し
 * （07-9章「週ごとの記録」と数字が二重だったため）、代わりに「あなたは先週
 * ◯回」（自分自身の週間完了報告数）を新設した。項目「よく行われたクエスト」
 * も家族全体から自分自身に変わった。いずれも呼び出し元
 * （src/data/api.ts fetchChoreWeeklyCompletionCounts）が`member_id`で
 * 自分の行だけに絞って取得する前提に変わったため、本ファイルの関数群は
 * 「渡された行の集合を集計する」という中身自体は変えず、コメント・型名の
 * 位置づけを「自分の行に絞られたもの」へ書き直した（実装メモ278章）。
 */

// ---- 項目「あなたは先週◯回」・「あなたがよく行ったクエスト」（決定7: 上位5件＋ほか◯件） ----

/**
 * chore_weekly_completion_counts View（スキーマ設計.sql 72章、2026-09-22
 * 改訂でmember_id列を追加）の1行が最低限持つ形。呼び出し元
 * （src/data/api.ts fetchChoreWeeklyCompletionCounts）が`.eq('member_id',
 * 自分のmemberId)`で絞って取得する前提のため、本ファイルの関数はいずれも
 * 「自分の先週分」の行を受け取る想定で書く（家族全体を混在させないこと）。
 */
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
 * 持たない、72章コメント）。**2026-09-22改訂**: 呼び出し元が渡す`rows`は
 * 自分（member_id=自分）の先週分に絞り済みのため、本関数は「あなたがよく
 * 行ったクエスト」（60.4a節決定12）を返す。呼び出し元が家族全体の行を渡す
 * 使い方は現在は無い（72.7章「家族全体の合計を本Viewから引き続き取れる
 * ようにするかの判断」→しない、と対応）。
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

/**
 * [2026-09-22新設] 項目「あなたは先週◯回」（60.4a節決定11）。自分（member_id
 * =自分）の先週分`chore_weekly_completion_counts`の行（summarizeWeeklyChoreCounts
 * に渡すのと同じ`rows`）から、クエストを問わない合計を求めるだけの単純な
 * 集計。72.4章のサンプルコード`data.reduce((sum, row) => sum +
 * row.completion_count, 0)`をそのまま純粋関数に切り出したもの。0件（先週
 * まったく完了報告が無かった）の場合は0を返す——呼び出し側はこの値が0のとき
 * 項目自体を出さない（決定11、既存の「シール帳が完成しなかった週は本項目
 * 自体を出さない」と同じ扱い）。
 */
export function sumWeeklyChoreCounts(rows: WeeklyChoreCountRow[]): number {
  return rows.reduce((sum, r) => sum + r.completion_count, 0);
}

// ---- 項目「家族の木の段階」（60.4a節決定13により並び順は最後の項目に変更、中身は無改訂） ----

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
 * 「先週時点の家族の木の段階」（07-35章4節・2026-09-22改訂後は項目4、スキーマ設計.sql 72.1章
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
