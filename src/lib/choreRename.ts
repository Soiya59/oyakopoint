/**
 * [2026-09-30新設・開発部/成果物/実装メモ.md 336章、本部長依頼・軽微変更ルート・統括承認済み]
 * クエストの編集画面で「うっかり既存のクエストを書き換えてしまう」事故を防ぐための、
 * 判定（名前を変えたか）と文言（確認・見出し）を1か所にまとめた純粋関数。
 *
 * 起きたこと：新しく登録するつもりで、既存のクエストの編集画面で名前などを書き換えて保存し、
 * 元のクエストが上書きされた。名前（題名）を変えて保存するときだけ確認を出し、
 * 「新しいクエストとして登録する」も選べるようにする。
 *
 * 使う画面：保護者P11（app/parent/chore-edit.tsx）・みまもりS6（app/supporter/chore-edit.tsx）。
 * 「おねがい」の編集（ChoreRequestEdit）は対象外（おねがいは「新しく登録」の意味が違うため）。
 *
 * 値のimportを持たない（Node単体で`choreRename.verify.ts`から読める）。
 */

/**
 * 名前の比べ方（比較専用。保存する値は変えない）。
 * - 前後の空白（全角空白を含む）を除く。
 * - 全角と半角の違いだけなら「変えていない」扱いにする（NFKC正規化）。
 *   例：「ＡＢＣ掃除」と「ABC掃除」、「ｶﾞﾗｽ」と「ガラス」、「掃除　１」と「掃除 1」。
 * - 大文字と小文字、ひらがなとカタカナの違いは「変えた」扱い（別の名前になりうるため）。
 * 理由：全角半角だけの直しは表記のそろえ直しで、別のクエストにするつもりの操作ではない。
 * 確認を出しすぎると、本当に大事な確認が読まれなくなる。
 */
export function normalizeChoreTitleForCompare(title: string): string {
  return title.normalize("NFKC").trim();
}

/** 名前（題名）を変えたか。全角半角・前後の空白だけの違いは変えていない扱い。 */
export function isChoreTitleChanged(originalTitle: string, currentTitle: string): boolean {
  return normalizeChoreTitleForCompare(originalTitle) !== normalizeChoreTitleForCompare(currentTitle);
}

/**
 * 保存時に確認を出すか。既存のクエストの編集（originalTitleがある）で、名前を変えたときだけtrue。
 * 新規登録（originalTitleがnull/undefined）・名前を変えない修正（ポイント・担当など）は常にfalse。
 * 名前を消して空にした場合も、名前は変わっているのでtrue（ただし画面では空の入力チェックが先に効く）。
 */
export function shouldConfirmChoreRename(originalTitle: string | null | undefined, currentTitle: string): boolean {
  if (originalTitle == null) return false;
  return isChoreTitleChanged(originalTitle, currentTitle);
}

// ---- 文言 ----

export const RENAME_CONFIRM_KEEP_LABEL = "変える";
export const RENAME_CONFIRM_AS_NEW_LABEL = "新しいクエストとして登録する";
export const RENAME_CONFIRM_CANCEL_LABEL = "やめる";
export const RENAME_CONFIRM_KEEP_SAVING_LABEL = "保存中…";
export const RENAME_CONFIRM_AS_NEW_SAVING_LABEL = "登録中…";
export const RENAME_CONFIRM_AS_NEW_HINT = "「新しいクエストとして登録する」を選ぶと、元のクエストはそのまま残ります。";

/** 確認の本文。例：「おふろそうじ」を「げんかんそうじ」に変えます（前後の空白は除いて出す）。 */
export function renameConfirmMessage(originalTitle: string, currentTitle: string): string {
  return `『${originalTitle.trim()}』を『${currentTitle.trim()}』に変えます`;
}

/**
 * 「新しいクエストとして登録する」を選んだときに、元のクエストの編集とは挙動が違う点の注記。
 * 新規登録と同じAPI・同じ規則に乗るため、次の場合だけ結果が変わる。
 * - くり返すで1日の上限が空欄（無制限）：新規登録では空欄のままだとDBが1日1回に補う
 *   （画面の「新規作成時に空欄のまま保存すると、1日1回」の注記と同じ規則）。
 * - みまもりの自分専用（personal）のクエストから：新規登録は常にみまもり共通（supporter_shared）になる。
 */
export function newRegistrationNotes(input: {
  isRepeatable: boolean;
  dailyLimitText: string;
  isPersonalScope?: boolean;
}): string[] {
  const notes: string[] = [];
  if (input.isRepeatable && input.dailyLimitText.trim() === "") {
    notes.push("1日の上限が空欄のため、新しいクエストは1日1回として登録されます。");
  }
  if (input.isPersonalScope) {
    notes.push("新しいクエストは、みまもりメンバーなら誰でも完了報告できるクエストになります。");
  }
  return notes;
}

/** 編集画面の一番上の見出し。新規登録では出さない（呼び出し側で編集モードのときだけ使う）。 */
export function editingBannerText(title: string): string {
  return `「${title.trim()}」を編集中`;
}

/** 見出しの補足。 */
export const EDITING_BANNER_CAPTION = "いま登録されているクエストを書き換えています";
