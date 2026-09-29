/**
 * 「おねがい」の画面文言（UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 70章の表）を1か所に
 * まとめたもの。画面ごとに文言を書くと、言い回しが食い違う（70.10「禁止事項」のチェック対象にもなる）。
 *
 * 参照: 開発部/成果物/実装メモ.md 335章。値のimportを持たない（Node単体で`*.verify.ts`から読める）。
 * 催促・促しの語（「まだ」「はやく」「のこり」）・警告色・額の予告は使わない（70.10 D18）。
 */

// ---- P22の上の切り替え（70.2節・70.3節） ----
export const TAB_LABEL_THANKS = "ありがとうを贈る";
export const TAB_LABEL_REQUEST = "おねがいする";

// ---- 「おねがいする」タブ（70.3節） ----
export const REQUEST_TAB_INTRO =
  "お子さんの画面に「おねがい」として届きます。ポイントは付きません。やってくれたら、完了報告に届きます。";
export const REQUEST_TITLE_HEADING = "なにを？";
export const REQUEST_TITLE_PLACEHOLDER = "例：おふろのそうじ";
export const REQUEST_SAVING_LABEL_ONE = "おねがいしています…";

/** 「だれに」の見出し。子ども1人：だれに？／2人以上：だれに？（複数選べます）。 */
export function requestWhoHeading(childCount: number): string {
  return childCount >= 2 ? "だれに？（複数選べます）" : "だれに？";
}

/** 選んだ人の案内（2人以上を選んだときだけ）。 */
export function requestSelectedCaption(selectedNames: readonly string[]): string | null {
  if (selectedNames.length < 2) return null;
  return `${selectedNames.join("・")}に、それぞれ届きます`;
}

/** 保存ボタン。1人：おねがいする／2人以上：{n}人におねがいする。保存中は文言を差し替える。 */
export function requestSubmitLabel(selectedCount: number, saving: boolean): string {
  if (saving) return selectedCount >= 2 ? `おねがいしています…（${selectedCount}人ぶん送っています…）` : REQUEST_SAVING_LABEL_ONE;
  return selectedCount >= 2 ? `${selectedCount}人におねがいする` : "おねがいする";
}

/** 成功（1.5秒）。「{名前}・{名前}の画面に届きました」。 */
export const REQUEST_SUCCESS_TITLE = "おねがいしました";
export function requestSuccessDetail(names: readonly string[]): string {
  return `${names.join("・")}の画面に届きました`;
}

/** 全員失敗・1人で失敗したときのフォールバックの一文（新しい定数`REQUEST_CREATE_FAILED_MESSAGE`）。 */
export const REQUEST_CREATE_FAILED_MESSAGE = "おねがいを送れませんでした。もう一度お試しください";

// ---- D19 未完了は子ども1人につき3つまで ----
/**
 * 理由の文（保護者向け）。「{名前}さんへのおねがいは3つまでです。やってくれたあとか、取り下げたあとに、
 * また頼めます。」複数の子がいっぱいのときは名前を「・」でつなぐ。**件数（いま何件出ているか）は出さない**
 * （「3つまで」は上限の説明で、未対応の件数の表示ではない。決定17）。
 */
export function requestFullReasonText(names: readonly string[], max: number): string {
  return `${names.join("・")}さんへのおねがいは${max}つまでです。やってくれたあとか、取り下げたあとに、また頼めます。`;
}
export const REQUEST_FULL_OPEN_MANAGE_LABEL = "クエスト管理を開く";

/** 一部失敗の結果カード（39章の型）。 */
export function requestResultOkLine(name: string): string {
  return `✅ ${name} の分はおねがいできました`;
}
export function requestResultFailedLine(name: string): string {
  return `⏳ ${name} の分はまだできていません`;
}
export function requestResultFullLine(name: string, max: number): string {
  return `⏳ ${name} の分は、おねがいが${max}つ出ているため、まだできていません`;
}
export function requestRetryLabel(names: readonly string[]): string {
  return `${names.join("・")} の分だけ、もう一度おねがいする`;
}
export const REQUEST_RESULT_DONE_LABEL = "ここまでの分でよい（もどる）";

// ---- 子どもがいない ----
export const REQUEST_NO_CHILD_TITLE = "おねがいできるお子さんがまだいません。先にお子さんを登録してください";
export const REQUEST_NO_CHILD_ACTION = "お子さんを登録する";

// ---- P22「ありがとうを贈る」タブ・残り0の案内（D14） ----
export const GRATITUDE_LIMIT_CARD_LINES = [
  "きょうは、もう贈れません。",
  "あした、また贈れます。",
  "スタンプなら、いまでも送れます。",
] as const;
/** 残りの取得に失敗したときの見出し右の文言（「贈る」は無効のまま）。 */
export const GRATITUDE_BALANCE_ERROR_TEXT = "残りを確認できません";
export const GRATITUDE_BALANCE_RETRY_LABEL = "もういちど";

// ---- 子どもの画面（C5・C6・C7、70.4節） ----
/** C6の見出しは`requestBadgeText`（src/lib/requestChore.ts）。C7の題名の見出し「「題名」とどいたよ！」。 */
export function requestReportSentTitle(title: string): string {
  return `「${title}」とどいたよ！`;
}

// ---- ベル（D9） ----
export const BELL_HEADLINE_REQUEST_ARRIVED = "💌 おねがいが とどいたよ";
export const BELL_HEADLINE_REQUEST_DONE = "✅ おねがいを やってくれました";

// ---- P8・P9（D12） ----
export const APPROVAL_REQUEST_MARK = "💌 おねがい";
export const APPROVAL_THANKS_BUTTON_LABEL = "ありがとうを贈る";

// ---- P10・P11（D15） ----
export const CHORE_LIST_REQUEST_LABEL = "おねがい";
export const CHORE_LIST_REQUEST_DONE_LABEL = "おねがい（済）";
export const CHORE_LIST_REQUEST_NO_ASSIGNEE = "担当なし";

/** P10の行の右側。「おねがい・{担当}」「おねがい（済）・{担当}」。担当が空なら「担当なし」。 */
export function requestListRightLabel(finished: boolean, assigneeName: string | null | undefined): string {
  const head = finished ? CHORE_LIST_REQUEST_DONE_LABEL : CHORE_LIST_REQUEST_LABEL;
  const who = assigneeName && assigneeName.length > 0 ? assigneeName : CHORE_LIST_REQUEST_NO_ASSIGNEE;
  return `${head}・${who}`;
}

export const REQUEST_EDIT_TITLE = "おねがい";
export const REQUEST_EDIT_TITLE_DONE = "おねがい（済）";
export const REQUEST_EDIT_NO_POINTS = "ポイントは付きません。";
export function requestEditTarget(name: string): string {
  return `おねがい先：${name}`;
}
export const REQUEST_EDIT_SAVE_LABEL = "保存する";
export const REQUEST_EDIT_WITHDRAW_LABEL = "おねがいを取り下げる";
export function requestWithdrawConfirmTitle(title: string): string {
  return `「${title}」のおねがいを取り下げますか？`;
}
export function requestWithdrawConfirmBody(name: string | null): string {
  return name ? `${name}さんの画面から消えます。お知らせはしません。` : "子どもの画面から消えます。お知らせはしません。";
}
export const REQUEST_WITHDRAW_CONFIRM_LABEL = "本当に取り下げる";
export const REQUEST_WITHDRAW_CANCEL_LABEL = "やめる";
export function requestDoneNote(name: string): string {
  return `${name}さんがやってくれました`;
}

// ---- P40（D11。通知スイッチを広げる） ----
export const NOTIFY_SWITCH_HEADING = "お知らせの通知（家族みんな共通）";
export const NOTIFY_SWITCH_DESCRIPTION =
  "書き込み・おねがい・ありがとうのポイントが届いたときに、スマホでお知らせします。";
