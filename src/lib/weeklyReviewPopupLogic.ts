/**
 * 「先週のふりかえり」の週の初めの自動ポップアップ（クエストタブ、
 * `app/child/(tabs)/home.tsx`）を、いま出してよいかどうかの判定。
 * 本部長依頼2026-09-29（差し戻し）、開発部/成果物/実装メモ.md 321章。
 *
 * [差し戻しの経緯] 当初「かぞくタブにあった、押すと開くカード」をクエストタブに
 * そのまま移設したが、本部長・統括が実際に合意していたのは「週の初めに、最初の
 * 画面で自動でポップアップが出る」ことだった（旧かぞくタブは押して開くカードしか
 * 持っていなかったため、依頼文の前提が誤っていた）。クエストタブの最上部にカードを
 * 増やすと最初の画面が詰まるため、カードは置かず、条件がそろえば
 * `ChildWeeklyReviewModal`を自動で1回だけ開く方式に作り直した。
 *
 * [他の純粋関数群（`weeklyReviewDisplay.ts`）と同じ流儀] 他ファイルを一切
 * importしない・RN非依存（`node`で直接検証できる）。AsyncStorageへの実際の
 * 読み書きは`src/lib/weeklyReviewPopupSeen.ts`（`introSeen.ts`・`lastSeen.ts`と
 * 同じ「メモリキャッシュ＋端末保存＋購読」構成のI/Oラッパー）が担う。
 */

/** 端末保存キー（memberIdごとに分ける＝きょうだいで同じ端末を使っても別々に記録される）。 */
export function buildWeeklyReviewPopupSeenKey(memberId: string): string {
  return `oyakopoint.weeklyReviewPopupSeen.${memberId}`;
}

export interface WeeklyReviewPopupDecisionInput {
  /** `useWeeklyReviewCardVisible()`。false なら家族作成直後などで対象外（条件1）。 */
  cardVisible: boolean;
  /**
   * `useWeeklyReview()`の`data?.yourWeeklyTotal`（先週の自分の完了報告回数）。
   * 読み込み中・未取得はnull（条件3、読み込み中は出さない）。
   */
  yourWeeklyTotal: number | null;
  /** `getCurrentJstWeekStart()`（今週の開始日、JST月曜0:00、"YYYY-MM-DD"）。 */
  currentWeekStart: string;
  /** 端末に保存された「最後に自動で出した週」の開始日。まだ無ければnull（条件2）。 */
  lastShownWeekStart: string | null;
  /**
   * 同じタブの「はじめての案内」（`TabIntroBubble`）がまだ表示中（未読）かどうか。
   * trueの間は自動で出さない（他に自動で出るものと重ねない。重なった回は
   * `lastShownWeekStart`を更新しないため、次にこのタブを開いたときにもう一度
   * 判定される＝「次の機会に回す」）。
   */
  introBubbleShowing: boolean;
}

/**
 * 3条件（依頼文どおり）がすべて揃ったときだけ`true`。
 * 1. `cardVisible`（家族が作成されてから最初の暦週が終わっている）
 * 2. その週にまだ出していない（`lastShownWeekStart !== currentWeekStart`）
 * 3. 先週の自分の回数が1回以上（`yourWeeklyTotal`が`null`〈読み込み中〉・`0`のときは出さない。
 *    0回の週はほめる材料が無いため自動では出さない。0回の週はじぶんタブのカードから見られる）
 * さらに、同じタブで他に自動で出るもの（はじめての案内）と重ねない。
 */
export function shouldAutoOpenWeeklyReviewPopup(input: WeeklyReviewPopupDecisionInput): boolean {
  if (!input.cardVisible) return false;
  if (input.introBubbleShowing) return false;
  if (input.yourWeeklyTotal === null) return false;
  if (input.yourWeeklyTotal <= 0) return false;
  if (input.lastShownWeekStart === input.currentWeekStart) return false;
  return true;
}
