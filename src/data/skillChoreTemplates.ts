/**
 * スキルの型付きクエストひな形（要件定義書.md 07-28章決定13、
 * 主要画面ワイヤーフレーム.md 49.7章決定19〜21、2026-09-17新設）の静的データ。
 *
 * 07-16章「クエストのおすすめ集」（src/data/choreSuggestions.ts）と同じ方式
 * （アプリ内静的データ・年齢入力を求めずラベルで分類・選ぶとP11/S6に
 * プレフィルされるのみでDB書き込みは発生しない）で、生活の土台／自己管理・
 * 責任感／やさしさ・社会性の3つの「型」を提供する。DBには一切保存しない。
 *
 * [台紙型ひな形のデフォルト種類について・実装判断] ワイヤーフレーム49.3章決定7・
 * 49.13章(e)は「6件の台紙型ひな形それぞれのデフォルト種類は企画部確定待ち」と
 * している。企画部確定が本タスク時点でまだ無いため、開発部の判断として
 * kind_key='dragon'/'rabbit'（スキーマ設計.sql 55.2章で確定済みの2種類）を
 * 交互に割り当てた。企画部の確定が出た時点でこの割り当てのみを差し替えれば
 * よい（画面・DBへの影響は無い）。開発部/成果物/実装メモ.md 237章参照。
 */

export type SkillChoreCategory = "せいかつのどだい" | "じぶんでできること" | "やさしさ・なかよく";

export interface SkillChoreTemplate {
  id: string;
  category: SkillChoreCategory;
  emoji: string;
  title: string;
  rewardMode: "points" | "habit_card";
  /** rewardMode==='points'のときのみ使う既定ポイント。 */
  points?: number;
  /** rewardMode==='habit_card'のときのみ使う既定の台紙の種類（habit_figure_catalog.kind_key）。 */
  habitKindKey?: string;
}

export const SKILL_CHORE_TEMPLATES: SkillChoreTemplate[] = [
  // ① せいかつのどだい（生活の土台。市場調査部の結論E-1優先順位1位）
  { id: "skill-01", category: "せいかつのどだい", emoji: "🌙", title: "はやね（21じまでにねる）", rewardMode: "habit_card", habitKindKey: "dragon" },
  { id: "skill-02", category: "せいかつのどだい", emoji: "🏃", title: "そとであそんだ（30ぷんいじょう）", rewardMode: "points", points: 1 },
  { id: "skill-03", category: "せいかつのどだい", emoji: "📖", title: "よみきかせをした／きいた", rewardMode: "habit_card", habitKindKey: "rabbit" },
  { id: "skill-04", category: "せいかつのどだい", emoji: "🍚", title: "あさごはんをたべた", rewardMode: "points", points: 1 },
  // ② じぶんでできること（自己管理・責任感。市場調査部の結論E-1優先順位2位）
  { id: "skill-05", category: "じぶんでできること", emoji: "👕", title: "じぶんでふくをきがえた", rewardMode: "points", points: 1 },
  { id: "skill-06", category: "じぶんでできること", emoji: "🎒", title: "あしたのじゅんびをした", rewardMode: "points", points: 1 },
  { id: "skill-07", category: "じぶんでできること", emoji: "🍪", title: "おかしはごはんのあと", rewardMode: "habit_card", habitKindKey: "dragon" },
  // ③ やさしさ・なかよく（やさしさ・社会性。市場調査部の結論E-1優先順位3位）
  { id: "skill-08", category: "やさしさ・なかよく", emoji: "💛", title: "だれかにやさしくした", rewardMode: "habit_card", habitKindKey: "rabbit" },
  { id: "skill-09", category: "やさしさ・なかよく", emoji: "🔁", title: "じゅんばんをまもった", rewardMode: "habit_card", habitKindKey: "dragon" },
  { id: "skill-10", category: "やさしさ・なかよく", emoji: "🗣️", title: "「ありがとう」をいえた", rewardMode: "habit_card", habitKindKey: "rabbit" },
];

export const SKILL_CHORE_CATEGORIES: SkillChoreCategory[] = ["せいかつのどだい", "じぶんでできること", "やさしさ・なかよく"];

export function findSkillChoreTemplateById(id: string): SkillChoreTemplate | undefined {
  return SKILL_CHORE_TEMPLATES.find((t) => t.id === id);
}
