/**
 * 「メッセージ」（社内呼称: 定時アナウンス、要件定義書07-37章4章）関連の定数。
 *
 * [★2026-09-23・本部長依頼] 統括の指示「メッセージ　朝と夜とは限らない
 * から」を受け、画面に出す名前をUIUXデザイン部/成果物/主要画面ワイヤー
 * フレーム.md 64章の「あさ・よるの メッセージ」から「メッセージ」に変更
 * した。**名前は必ずこの1か所（`SCHEDULED_ANNOUNCEMENT_FEATURE_NAME`）から
 * 参照すること。**後から名前を変えるときはこの定数だけを直せばよい
 * （supabase/functions/notify-family-scheduled-announcement/index.tsは
 * Denoランタイムのため別ファイルに同じ値を持つ。そちらを変えるときは
 * 手動で揃えること。開発部/成果物/実装メモ.md 292章参照）。
 *
 * [★2026-09-23・本部長依頼] 2つの枠は「朝」「夜」ではなく、時刻を自由に
 * 決められる2つの枠（DBの識別子もslot=1/2で朝夜の意味を持たない、
 * 実装メモ292.1章）。画面上のラベルも「あさ／よる」を固定で出さず、
 * 「1つ目／2つ目」という中立的な言い方にする。
 */
import type { ScheduledAnnouncementSlot } from "@/types/domain";

/** 画面に出す機能名。ここを直せば全画面に反映される。 */
export const SCHEDULED_ANNOUNCEMENT_FEATURE_NAME = "メッセージ";

/** 文字数上限（ワイヤーフレーム64.3.2節の決定。64.12節1番で本部長承認済み）。 */
export const SCHEDULED_ANNOUNCEMENT_MESSAGE_MAX_LENGTH = 30;

/**
 * 枠の一覧。朝夜の意味を持たない中立的なラベル（実装メモ292.2章）。
 * [2026-09-25改訂・やること.md 4-81] 設定画面は保護者だけが使うので漢字表記にした。
 * 名前はワイヤーフレーム64.1.3節の「1つ目のメッセージ」に揃えた。
 */
export const SCHEDULED_ANNOUNCEMENT_SLOTS: readonly { slot: ScheduledAnnouncementSlot; label: string }[] = [
  { slot: 1, label: "1つ目のメッセージ" },
  { slot: 2, label: "2つ目のメッセージ" },
];

/**
 * 参考例（要件定義書07-37章4-4節、8本）。
 * [★2026-09-23・本部長依頼] 「どちらの枠でも全部選べるように出す」ため、
 * slotに紐づけない1本の配列とし、見出し（朝向け／夜向け）だけを添える
 * （4-4節の朝夜の見出し自体は残してよいという指示のとおり）。
 *
 * [2026-09-25改訂・統括決定・やること.md 4-81] 例文を漢字表記にした。統括
 * 「例文を漢字にし、子供が読めない場合はひらがなにしてくださいと記載」。
 * 選んだ例文はそのまま子どもにも届くため、設定画面にその一言を添えている
 * （app/parent/scheduled-announcements.tsx）。当初の例文は、統括が
 * 2026-09-22に出した例に合わせたひらがな表記だった。
 */
export interface ScheduledAnnouncementExample {
  id: string;
  heading: "朝向け" | "夜向け";
  text: string;
}

export const SCHEDULED_ANNOUNCEMENT_EXAMPLES: readonly ScheduledAnnouncementExample[] = [
  { id: "morning-1", heading: "朝向け", text: "おはよう！今日も元気にいってらっしゃい！" },
  { id: "morning-2", heading: "朝向け", text: "おはよう！今日はどんな楽しいことがあるかな？" },
  { id: "morning-3", heading: "朝向け", text: "朝のあいさつ。今日もよろしくね" },
  { id: "morning-4", heading: "朝向け", text: "おはよう！今日もいい一日になりますように" },
  { id: "evening-1", heading: "夜向け", text: "今日も一日おつかれさまでした！" },
  { id: "evening-2", heading: "夜向け", text: "今日も一日、無事に終わりました" },
  { id: "evening-3", heading: "夜向け", text: "今日も一日、ありがとう" },
  { id: "evening-4", heading: "夜向け", text: "おやすみなさい。また明日" },
];

/** 時刻の初期表示位置（ワイヤーフレーム64.4節3番。保存された値ではない）。 */
export const SCHEDULED_ANNOUNCEMENT_DEFAULT_HOUR: Record<ScheduledAnnouncementSlot, number> = {
  1: 7,
  2: 20,
};

/** 時刻は5分刻み（ワイヤーフレーム64.4節の決定）。 */
export const SCHEDULED_ANNOUNCEMENT_MINUTE_STEP = 5;
