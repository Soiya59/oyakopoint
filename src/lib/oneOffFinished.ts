/**
 * 単発（is_repeatable=false）クエストの「完了済みか」判定の純粋関数
 * （やること.md 4-58、設計部 スキーマ設計.sql 58.5章・決定58-3、API仕様.md 18.1節、
 * 実装メモ.md 330章）。
 *
 * 以前は`state.completions`（`fetchCompletions`が取った完了報告の全件）を
 * `chore_id`で線形探索していたため、家族の完了報告が1,000件を超えて古い記録が
 * 見えなくなると、完了済みの単発クエストが一覧に再び現れ、もう一度実行できて
 * しまった。ここでは、DB側の集計View`chore_completion_totals`（56章。クエスト×
 * メンバーごとの生涯累計。期間の絞り込みも1,000件の上限も受けない）から作った
 * `chore_id`の集合で判定する。
 *
 * node で直接検証できるよう、相対import・パスエイリアス非依存にしてある
 * （`oneOffFinished.verify.ts`）。
 */

export interface CompletionTotalRow {
  chore_id: string | null;
  total_count: number;
}

/** `chore_completion_totals`の行から、1回以上実施されたクエストの`chore_id`の集合を作る。 */
export function buildCompletedChoreIdSet(entries: readonly CompletionTotalRow[]): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) {
    if (!e.chore_id) continue; // choreが物理削除された行は一覧に出ないため無視（56.3章）
    if (e.total_count > 0) ids.add(e.chore_id);
  }
  return ids;
}

/**
 * 単発クエストが実施済みで役目を終えているか。
 *
 * - `totalsChoreIds`: DB側の集計（`chore_completion_totals`）から作った集合。判定の本体。
 * - `localChoreIds`: 端末が今持っている完了報告（`state.completions`）から作った集合。
 *   **補助**であり、判定を広げる方向（「完了済み」と見なす側）にしか働かない。用途は2つ。
 *   ①完了報告の直後、集計を取り直す前でも一覧から即座に消す（従来の見え方を保つ）、
 *   ②集計の取得がまだ終わっていない間・失敗したときに、完了済みの単発が一斉に
 *   一覧へ再登場しないようにする。端末側の全件は1,000件で欠けうるが、
 *   欠けた分はDB側の集合が補うため、判定の正しさはDB側が担保する。
 */
export function isOneOffFinishedFor(
  chore: { id: string; is_repeatable: boolean },
  totalsChoreIds: ReadonlySet<string>,
  localChoreIds?: ReadonlySet<string>
): boolean {
  if (chore.is_repeatable) return false;
  return totalsChoreIds.has(chore.id) || (localChoreIds?.has(chore.id) ?? false);
}
