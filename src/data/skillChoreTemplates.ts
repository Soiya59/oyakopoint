/**
 * スキルの型付きクエストひな形（要件定義書.md 07-28章決定13、
 * 主要画面ワイヤーフレーム.md 49.7章決定19〜21、2026-09-17新設）の静的データ。
 *
 * 07-16章「クエストのおすすめ集」（src/data/choreSuggestions.ts）と同じ方式
 * （アプリ内静的データ・年齢入力を求めずラベルで分類・選ぶとP11/S6に
 * プレフィルされるのみでDB書き込みは発生しない）で、生活の土台／自己管理・
 * 責任感／やさしさ・社会性の3つの「型」を提供する。DBには一切保存しない。
 *
 * [2026-09-19改訂・要件定義書07-28章2026-09-19全面改訂決定25] シール帳の
 * 全面作り替えにより`reward_mode`（ポイント／台紙）という区別が撤去された。
 * クエストは1種類のみになり、どのクエストの完了報告でもポイントが付き
 * 同時にシール帳が1マス埋まるため、ひな形ごとの「たまり方」「台紙の種類」
 * （`rewardMode`・`habitKindKey`）は不要になった（主要画面ワイヤーフレーム.md
 * 49-B.1章、旧49.3節決定7の判定）。全件を既存の「ポイント」ひな形と同じ形に
 * 揃え、既定ポイントは1にした（既存のポイント型ひな形と同じ目安値）。
 */

export type SkillChoreCategory = "せいかつのどだい" | "じぶんでできること" | "やさしさ・なかよく";

export interface SkillChoreTemplate {
  id: string;
  category: SkillChoreCategory;
  emoji: string;
  title: string;
  /** 既定ポイント（目安）。フォームへのプレフィル値で、保存前に自由に変えられる。 */
  points: number;
}

export const SKILL_CHORE_TEMPLATES: SkillChoreTemplate[] = [
  // ① せいかつのどだい（生活の土台。市場調査部の結論E-1優先順位1位）
  { id: "skill-01", category: "せいかつのどだい", emoji: "🌙", title: "はやね（21じまでにねる）", points: 1 },
  { id: "skill-02", category: "せいかつのどだい", emoji: "🏃", title: "そとであそんだ（30ぷんいじょう）", points: 1 },
  { id: "skill-03", category: "せいかつのどだい", emoji: "📖", title: "よみきかせをした／きいた", points: 1 },
  { id: "skill-04", category: "せいかつのどだい", emoji: "🍚", title: "あさごはんをたべた", points: 1 },
  // ② じぶんでできること（自己管理・責任感。市場調査部の結論E-1優先順位2位）
  { id: "skill-05", category: "じぶんでできること", emoji: "👕", title: "じぶんでふくをきがえた", points: 1 },
  { id: "skill-06", category: "じぶんでできること", emoji: "🎒", title: "あしたのじゅんびをした", points: 1 },
  { id: "skill-07", category: "じぶんでできること", emoji: "🍪", title: "おかしはごはんのあと", points: 1 },
  // ③ やさしさ・なかよく（やさしさ・社会性。市場調査部の結論E-1優先順位3位）
  { id: "skill-08", category: "やさしさ・なかよく", emoji: "💛", title: "だれかにやさしくした", points: 1 },
  { id: "skill-09", category: "やさしさ・なかよく", emoji: "🔁", title: "じゅんばんをまもった", points: 1 },
  { id: "skill-10", category: "やさしさ・なかよく", emoji: "🗣️", title: "「ありがとう」をいえた", points: 1 },
];

export const SKILL_CHORE_CATEGORIES: SkillChoreCategory[] = ["せいかつのどだい", "じぶんでできること", "やさしさ・なかよく"];

export function findSkillChoreTemplateById(id: string): SkillChoreTemplate | undefined {
  return SKILL_CHORE_TEMPLATES.find((t) => t.id === id);
}
