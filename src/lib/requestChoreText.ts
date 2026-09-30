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
// 【2026-09-30再改訂・70.3節】2文。「あとから変えられません」は、選んだあとではなく選ぶ前に読める場所に置く。
export const REQUEST_TAB_INTRO =
  "お子さんの画面に「おねがい」として届きます。決めたポイントは、やってくれたら自動で入ります（あとから変えられません）。";
export const REQUEST_TITLE_HEADING = "なにを？";
export const REQUEST_TITLE_PLACEHOLDER = "例：おふろのそうじ";
export const REQUEST_SAVING_LABEL_ONE = "おねがいしています…";

/** 「だれに」の見出し。子ども1人：だれに？／2人以上：だれに？（複数選べます）。 */
export function requestWhoHeading(childCount: number): string {
  return childCount >= 2 ? "だれに？（複数選べます）" : "だれに？";
}

/**
 * 選んだ人の案内（2人以上を選んだときだけ）。【2026-09-30再改訂】ポイントを選んだあと（1以上）は
 * 「{名前}・{名前}に、それぞれ {n}pt で届きます」。未選択・0（ポイントなし）は今までどおり
 * 「それぞれ届きます」（「+0pt」「0pt」は出さない。U12）。
 */
export function requestSelectedCaption(selectedNames: readonly string[], points: number | null): string | null {
  if (selectedNames.length < 2) return null;
  const who = selectedNames.join("・");
  return points !== null && points > 0 ? `${who}に、それぞれ ${points}pt で届きます` : `${who}に、それぞれ届きます`;
}

// ---- 「ポイントは？（必須）」の欄（70.3節D20・D21） ----
export const REQUEST_POINTS_HEADING = "ポイントは？（必須）";

/** チップの名前。0は「ポイントなし」（「0pt」と書かない。D20）。 */
export function requestPointChipLabel(points: number): string {
  return points === 0 ? "ポイントなし" : `${points}pt`;
}

/** チップの読み上げ（「1pt」は「1ポイント」）。 */
export function requestPointChipAccessibilityLabel(points: number): string {
  return points === 0 ? "ポイントなし" : `${points}ポイント`;
}

/**
 * ボタンが押せない理由の1行（D21）。題名が1字以上入っているのに、「だれに」「ポイント」のどちらか
 * （または両方）が足りないときだけ出す。それ以外（題名が空・全員がいっぱい・保存中・そろっている）は
 * null（理由は出さない）。赤・アンバー・警告の絵文字は使わない（呼び出し側で`neutralTextSecondary`）。
 */
export function requestSubmitBlockedReason(input: {
  hasTitle: boolean;
  hasChild: boolean;
  hasPoints: boolean;
  allFull?: boolean;
  saving?: boolean;
}): string | null {
  if (!input.hasTitle || input.allFull || input.saving) return null;
  if (input.hasChild && input.hasPoints) return null;
  if (!input.hasChild && !input.hasPoints) return "だれに頼むかとポイントを選ぶと、おねがいできます。";
  if (!input.hasChild) return "だれに頼むか選ぶと、おねがいできます。";
  return "ポイントを選ぶと、おねがいできます。";
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
/**
 * 成功の3行目（【2026-09-30再改訂・D22】約束の額をもう一度見せる）。ポイントが1以上のときだけ。
 * 0のときは行ごと出さない（「ポイントなし」に触れない。U12）。1文にとどめる（1.5秒で読める長さ）。
 */
export function requestSuccessPointsLine(childCount: number, points: number): string | null {
  if (points <= 0) return null;
  return childCount >= 2 ? `やってくれたら、それぞれ ${points}pt 入ります` : `やってくれたら、${points}pt 入ります`;
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

/**
 * P10の行の右側。「おねがい・{担当}」「おねがい（済）・{担当}」。担当が空なら「担当なし」。
 * 【2026-09-30再改訂・D15】ポイントが1以上のときは先頭に「{N}pt・」（「2pt・おねがい・ちひろ」）。0のときは
 * 「pt」を出さない（今までどおり）。`points`を渡さない古い呼び方は0と同じ。
 */
export function requestListRightLabel(
  finished: boolean,
  assigneeName: string | null | undefined,
  points: number | null | undefined = 0
): string {
  const head = finished ? CHORE_LIST_REQUEST_DONE_LABEL : CHORE_LIST_REQUEST_LABEL;
  const who = assigneeName && assigneeName.length > 0 ? assigneeName : CHORE_LIST_REQUEST_NO_ASSIGNEE;
  const pt = points && points > 0 ? `${points}pt・` : "";
  return `${pt}${head}・${who}`;
}

export const REQUEST_EDIT_TITLE = "おねがい";
export const REQUEST_EDIT_TITLE_DONE = "おねがい（済）";
/**
 * P11（おねがい版）のポイントの表示（D15）。**表示のみ**で、変更する欄は出さない（約束は変えられない。決定22）。
 * 未完了：1以上は「ポイント：Npt（変更できません）」、0は「ポイントなし」。
 * 済：1以上は「ポイント：Npt」、0は行ごと出さない（null）。
 */
export function requestEditPointsLine(points: number, finished: boolean): string | null {
  if (finished) return points > 0 ? `ポイント：${points}pt` : null;
  return points > 0 ? `ポイント：${points}pt（変更できません）` : "ポイントなし";
}
/** 未完了のおねがいのときだけ出す1行（済のおねがいは取り下げられないので案内しない）。 */
export const REQUEST_EDIT_CHANGE_HINT = "変えたいときは、取り下げて、もう一度おねがいしてください。";
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

// ---- P22「ありがとうを贈る」タブの案内（D23。P8・P9から開いたときだけ） ----
export const GRATITUDE_FROM_APPROVALS_NOTE = "ここでは、ひとことと、上乗せの贈り物ができます。";
