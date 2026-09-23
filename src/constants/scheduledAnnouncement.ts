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

/** 枠の一覧。朝夜の意味を持たない中立的なラベル（実装メモ292.2章）。 */
export const SCHEDULED_ANNOUNCEMENT_SLOTS: readonly { slot: ScheduledAnnouncementSlot; label: string }[] = [
  { slot: 1, label: "1つ目のじかん" },
  { slot: 2, label: "2つ目のじかん" },
];

/**
 * 参考例（要件定義書07-37章4-4節、8本）。
 * [★2026-09-23・本部長依頼] 「どちらの枠でも全部選べるように出す」ため、
 * slotに紐づけない1本の配列とし、見出し（あさむけ／よるむけ）だけを添える
 * （4-4節の朝夜の見出し自体は残してよいという指示のとおり）。
 */
export interface ScheduledAnnouncementExample {
  id: string;
  heading: "あさむけ" | "よるむけ";
  text: string;
}

export const SCHEDULED_ANNOUNCEMENT_EXAMPLES: readonly ScheduledAnnouncementExample[] = [
  { id: "morning-1", heading: "あさむけ", text: "おはよう！ きょうも げんきに いってらっしゃい！" },
  { id: "morning-2", heading: "あさむけ", text: "おはよう！ きょうは どんな たのしいことが あるかな？" },
  { id: "morning-3", heading: "あさむけ", text: "あさの あいさつ。きょうも よろしくね" },
  { id: "morning-4", heading: "あさむけ", text: "おはよう！ きょうも いい いちにちに なりますように" },
  { id: "evening-1", heading: "よるむけ", text: "きょうも 1にち おつかれさまでした！" },
  { id: "evening-2", heading: "よるむけ", text: "きょうも 1にち、ぶじに おわりました" },
  { id: "evening-3", heading: "よるむけ", text: "きょうも 1にち、ありがとう" },
  { id: "evening-4", heading: "よるむけ", text: "おやすみなさい。また あした" },
];

/** 時刻の初期表示位置（ワイヤーフレーム64.4節3番。保存された値ではない）。 */
export const SCHEDULED_ANNOUNCEMENT_DEFAULT_HOUR: Record<ScheduledAnnouncementSlot, number> = {
  1: 7,
  2: 20,
};

/** 時刻は5分刻み（ワイヤーフレーム64.4節の決定）。 */
export const SCHEDULED_ANNOUNCEMENT_MINUTE_STEP = 5;
