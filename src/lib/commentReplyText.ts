/**
 * 完了報告のコメントへの「返信」の文言（3ロールの書き分け）。
 *
 * [2026-10-13新設・UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 74.2・74.3・74.5・74.7・74.10節、
 * 要件定義書07-48章、開発部/成果物/実装メモ.md 364章]
 * **文言はワイヤーフレーム74章から一字一句転記**している。直すときは74章を先に直すこと。
 * 保護者とみまもりは同じ文言（漢字まじり）、子どもだけひらがな中心。
 *
 * 「返さなければ」と感じさせない（74.9節）：入口は「＋返信」「＋へんじ」だけ（命令形・催促・案内を置かない）。
 * 送信後に「送りました」の文字は出さない（読み上げの利用者にだけ `announceForAccessibility`）。
 */
import type { FailureTone } from "./apiFailure";

type Tone = FailureTone;

const isChild = (tone: Tone): boolean => tone === "child";

/** 入口（小さな下線リンク）。 */
export const REPLY_ENTRY_LABEL: Record<Tone, string> = {
  parent: "＋返信",
  supporter: "＋返信",
  child: "＋へんじ",
};

/** 入口の読み上げ（ラベル／ヒント）。 */
export function replyEntryAccessibility(tone: Tone, commenterName: string): { label: string; hint: string } {
  return isChild(tone)
    ? { label: `${commenterName}の コメントに へんじを かく`, hint: "おすと、かく ところが でるよ" }
    : { label: `${commenterName}のコメントに返信を書く`, hint: "押すと、入力欄が開きます" };
}

/** 入力欄のラベル（「（にんい）」は必ず付ける）。 */
export const REPLY_INPUT_LABEL: Record<Tone, string> = {
  parent: "返信を書く（にんい・200文字まで）",
  supporter: "返信を書く（にんい・200文字まで）",
  child: "へんじを かく（にんい）",
};

export const REPLY_INPUT_PLACEHOLDER: Record<Tone, string> = {
  parent: "例: うれしかったよ",
  supporter: "例: うれしかったよ",
  child: "たとえば「うれしかったよ！」",
};

/** 文字数のカウンター（右下）。 */
export function replyCounterText(tone: Tone, length: number): string {
  return isChild(tone) ? `${length}/200もじ` : `${length}/200字`;
}

export const REPLY_CANCEL_BUTTON = "やめる";
export const REPLY_SEND_BUTTON = "おくる";
export const REPLY_SENDING_LABEL: Record<Tone, string> = {
  parent: "送信中…",
  supporter: "送信中…",
  child: "おくっています…",
};

/** 失敗の一文（電波・混み合い・ログイン切れ・権限のときは `describeApiFailure` が入れ替える）。 */
export const REPLY_SEND_ERROR_MESSAGE: Record<Tone, string> = {
  parent: "返信を送信できませんでした。もう一度お試しください",
  supporter: "返信を送信できませんでした。もう一度お試しください",
  child: "おくれなかったよ。もういちどためしてね",
};

/** 送る前に、元のコメントが削除されていた（一度だけ出す一文）。 */
export const REPLY_PARENT_GONE_MESSAGE: Record<Tone, string> = {
  parent: "元のコメントが削除されたため、返信できませんでした",
  supporter: "元のコメントが削除されたため、返信できませんでした",
  child: "もとの コメントが なくなっちゃったみたい",
};

/** 送ったあと、読み上げの利用者にだけ伝える（画面には何も出さない）。 */
export const REPLY_SENT_ANNOUNCEMENT: Record<Tone, string> = {
  parent: "返信を送りました",
  supporter: "返信を送りました",
  child: "おくったよ",
};

/** 返信の行（コメントの直下）：「{名前}の返信「…」」。絵文字は付けない。 */
export function replyLineText(tone: Tone, authorName: string, body: string): string {
  return isChild(tone) ? `${authorName}の へんじ「${body}」` : `${authorName}の返信「${body}」`;
}

/** 返信の行の読み上げ（1まとまりで読む。左の線は読ませない）。 */
export function replyLineAccessibility(
  tone: Tone,
  p: { authorName: string; body: string; time: string; commenterName: string }
): string {
  return isChild(tone)
    ? `${p.authorName}の へんじ。${p.body}。${p.time}`
    : `${p.authorName}の返信。${p.body}。${p.time}。${p.commenterName}のコメントへの返信`;
}

/** 返信の取消（本人5分以内・確認なし）。 */
export const REPLY_CANCEL_LABEL: Record<Tone, string> = { parent: "取消", supporter: "取消", child: "とりけす" };
/** 保護者が他人の返信を削除するときの確認。子どもに削除は出ない。 */
export const REPLY_DELETE_CONFIRM_TEXT = "この返信を削除しますか？";
/** 削除ずみの競合。 */
export const REPLY_ALREADY_DELETED_TEXT: Record<Tone, string> = {
  parent: "この返信はすでに削除されています",
  supporter: "この返信はすでに削除されています",
  child: "この へんじは もう なくなっちゃったみたい",
};

/** ベルの「返信が来た」行の見出し。 */
export const BELL_HEADLINE_REPLY: Record<Tone, string> = {
  parent: "💬 返信",
  supporter: "💬 返信",
  child: "💬 へんじ",
};

/**
 * ベルの「返信が来た」行の対象の一言：
 * 大人「{絵}{クエスト名}　あなたのコメント「…」への返信」／子ども「{絵}{クエスト名}　あなたの コメント「…」に」。
 * `choreLabel`は「{絵} {クエスト名}」（既存のベルの項目と同じ組み立て）。
 */
export function bellReplySubject(tone: Tone, choreLabel: string, parentExcerpt: string): string {
  return isChild(tone)
    ? `${choreLabel}　あなたの コメント「${parentExcerpt}」に`
    : `${choreLabel}　あなたのコメント「${parentExcerpt}」への返信`;
}

/** ベルのコメントのカードの中に添える、自分の返信の1行。 */
export function ownReplyLineText(tone: Tone, body: string): string {
  return isChild(tone) ? `あなたの へんじ「${body}」` : `あなたの返信「${body}」`;
}
