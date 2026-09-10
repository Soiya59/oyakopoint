/**
 * 新規登録モードで担当者を複数選択したときの逐次保存（要件定義書07-26章決定17・20、
 * 主要画面ワイヤーフレーム.md 39.3.3節・39.3.4節）を、画面（app/parent/chore-edit.tsx・
 * app/parent/reward-edit.tsx）に依存しない純粋な形に切り出した関数。
 * 検証方法は同ディレクトリの sequentialSave.verify.ts、および前例の
 * groupDuplicateRows.ts / groupDuplicateRows.verify.ts を参照。
 *
 * [決定20が求める挙動]
 * - 1人ずつ順番に保存する（並列にしない）
 * - 最初に失敗した時点でそれ以降の保存を止める（失敗した本人＋以降の未着手はすべて
 *   「未保存」として扱う）
 * - 既に保存が成功した分は取り消さない
 * - 呼び出し側が「誰が成功し、誰が未保存か」を区別できるようにする
 *
 * [対象外・触らないもの]
 * - まとめて成功・失敗させるトランザクション化（決定20「対象外」、DB変更が必要になる）
 * - 失敗時の自動リトライ（呼び出し側が明示的にもう一度呼ぶ、39.3.4節決定15のボタン）
 */

/** createOne が返す最小限の結果の形（ApiResult<T>のok/errorのみを想定）。 */
export type SequentialCreateResult = { ok: true } | { ok: false; error: { message: string } };

export interface SequentialSaveOutcome {
  /** 保存できたメンバーの表示名（呼び出し前にすでに成功していた分も含む、決定15）。 */
  succeeded: string[];
  /** まだ保存できていないメンバーの表示名（失敗した本人＋以降の未着手、決定20）。 */
  failed: string[];
  /** 最初の失敗時にAPIから返ってきたエラーメッセージ。全員成功した場合はnull。 */
  errorMessage: string | null;
  /** 再試行の対象となるID（failedと対応する順序を保つ）。全員成功した場合は空配列。 */
  remainingIds: string[];
}

/**
 * ids を先頭から1件ずつ createOne() で保存する。最初に失敗した時点で処理を止め、
 * それ以降（失敗した本人を含む）は「未保存」として remainingIds/failed に残す。
 *
 * @param ids 保存対象のID（担当者のfamily_members.id）の配列。順番どおりに処理する。
 * @param labelOf IDから表示名を解決する関数（見つからない場合は呼び出し側の判断で
 *   空文字列等を返してよい。本関数は解決結果をそのまま使うのみで検証しない）。
 * @param createOne 1件分の保存を行う非同期関数（createChore/createRewardをラップして渡す）。
 * @param alreadySucceededLabels 呼び出し前に既に成功している分の表示名（再試行時、
 *   前回成功した分をsucceededの先頭に引き継ぐために使う。省略時は空配列）。
 */
export async function saveSequentially(
  ids: readonly string[],
  labelOf: (id: string) => string,
  createOne: (id: string) => Promise<SequentialCreateResult>,
  alreadySucceededLabels: readonly string[] = []
): Promise<SequentialSaveOutcome> {
  const succeeded: string[] = [...alreadySucceededLabels];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const res = await createOne(id);
    if (res.ok) {
      succeeded.push(labelOf(id));
      continue;
    }
    const remainingIds = ids.slice(i);
    return {
      succeeded,
      failed: remainingIds.map(labelOf),
      errorMessage: res.error.message,
      remainingIds: [...remainingIds],
    };
  }
  return { succeeded, failed: [], errorMessage: null, remainingIds: [] };
}
