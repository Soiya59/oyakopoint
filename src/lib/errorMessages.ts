/**
 * 通信エラー・失敗時の文言を1か所にまとめる（やること.md 4-40、
 * 開発部/成果物/実装メモ.md 244章）。
 *
 * これまで画面ごと・lib関数ごとに同じ意味の文言が別々に書かれており、
 * 「原因不明の通信・サーバーエラー」という同じ状況でも
 * 「通信エラーが発生しました」（呼びかけ無し）と
 * 「通信エラーが発生しました。もう一度お試しください。」（呼びかけ付き）の
 * 2種類の書き方が混在していた。ここに集約し、各画面・各lib関数はこれを
 * 参照する（実装メモ.md 244章に変更前後の一覧表あり）。
 *
 * [今回の対象外・意図的] `describeChoreReportFailure()`（src/data/api.ts、
 * 実装メモ.md 230.3章）が持つ「通信状態／権限拒否42501／ログイン切れ401／
 * その他」の4種類の出し分けは、`reportCompletion()`がPostgRESTのHTTP
 * ステータスを呼び出し元へ渡しているために成立している（同ファイルの
 * `fromPostgrestError`のコメント参照）。
 * [2026-09-27訂正・ワイヤーフレーム67章決定7、実装メモ.md 317章]
 * `cancelChoreCompletion()`・`sendGratitudePoints()`も、上記のことわりを書いた
 * 当時（244章）はステータスを渡していなかったが、67章の対応でreportCompletion
 * と同じくstatusを渡すようになった。`src/lib/cancelChoreCompletion.ts`の
 * `cancelCompletionErrorText`・`src/lib/gratitudeSendError.ts`の
 * `gratitudeSendErrorText`は、それぞれ「通信断（status===0）」「サーバー混雑
 * （status>=500）」の2種類だけ本ファイルのGENERIC_ERROR_MESSAGEから分けている
 * （「権限拒否」「ログイン切れ」相当の出し分けはまだ広げていない）。
 *
 * [2026-09-29追記・実装メモ.md 331章] 残りの画面（ごほうび交換・ガチャ・クエスト/ごほうびの
 * 登録編集・スタンプ・コメント・掲示板・お絵かき・シール・木に飾る・設定など）にも、
 * 原因に応じた書き分けと「目印」を入れた。判断は`src/lib/apiFailure.ts`（純粋関数）、
 * 文言と目印をつなぐのは`src/lib/apiFailureDisplay.ts`、画面の状態は`src/hooks/useFailureNotice.ts`、
 * 目印の表示は`src/components/FailureRefText.tsx`。ここにある総称の文言
 * （GENERIC_ERROR_MESSAGE等）は、それらが「原因を特定できない」ときに出す一文として使う。
 *
 * 3ロールの書き分け（子ども＝ひらがな多め、保護者・みまもり＝通常）は
 * 既存パターンを踏襲する。
 */

/** 原因を特定できない通信・サーバーエラーの一般的な文言（保護者・みまもり向け）。 */
export const GENERIC_ERROR_MESSAGE = "通信エラーが発生しました。もう一度お試しください。";

/** 同上・こども向け（ひらがな多め）。 */
export const GENERIC_ERROR_MESSAGE_CHILD = "とどきませんでした…";

/** スタンプ送信に失敗したときの文言（保護者・みまもり共通）。 */
export const STAMP_SEND_ERROR_MESSAGE = "スタンプを送信できませんでした。もう一度お試しください";

/** コメント送信に失敗したときの文言（保護者・みまもり共通）。 */
export const COMMENT_SEND_ERROR_MESSAGE = "コメントを送信できませんでした。もう一度お試しください";

/** 家族の掲示板投稿の送信に失敗したときの文言（上限超過以外、保護者・みまもり共通）。 */
export const BOARD_POST_SEND_ERROR_MESSAGE = "送信できませんでした。もう一度お試しください";

/** 家族データの読み込みが完了する前に保存しようとしたときの案内（保護者・みまもり共通、クエスト/ごほうび編集画面）。 */
export const FAMILY_DATA_NOT_READY_MESSAGE = "家族データの読み込みが完了していません。もう一度お試しください";

/** NFCタグの解除に失敗したときの文言（保護者・みまもり共通）。 */
export const NFC_UNLINK_ERROR_MESSAGE = "解除できませんでした。もう一度お試しください";

/** NFCタグへの書き込みに失敗したときの文言（保護者・みまもり共通）。 */
export const NFC_WRITE_ERROR_MESSAGE = "うまく書き込めませんでした。もう一度近づけてください";

/** NFC書き込み失敗画面の再試行ボタンの文言（保護者・みまもり共通）。 */
export const NFC_WRITE_RETRY_LABEL = "もう一度試す";
