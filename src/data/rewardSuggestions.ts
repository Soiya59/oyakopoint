/**
 * ごほうびのおすすめ集（主要画面ワイヤーフレーム.md 31章、2026-09-06追加）の静的データ。
 * クエストのおすすめ集（src/data/choreSuggestions.ts、07-16章）のごほうび版。
 * アプリ内定数としてのみ保持し、DBには一切保存しない（31.6節「対象外」・要件定義書に
 * 相当する章はまだ無く、31章が一次情報）。
 *
 * 【2026-09-07全面差し替え】10件は`市場調査部/成果物/クエスト・ごほうびのおすすめ集の調査
 * （2026-09-07）.md`3章の表（調査に基づく13件案）から、本部長・統括が除外を判断した3件を
 * 除いたもの（除外の内訳・理由は同レポート末尾「【本部長・統括の最終判断（2026-09-07）】
 * 採用と除外」節を参照。除外した項目名は本ファイルには載せない）。従来の11件も破棄した。
 *
 * 層（権利／体験／もの）は変更なし。掲載順は本部長の依頼メッセージが示した順（pt昇順・
 * 層混在）のまま。
 *
 * クエスト版と異なり、頻度（frequency）・対象（target）に相当する属性は持たない
 * （31.0節決定5。rewardsテーブルには頻度・繰り返しに相当する属性が無く、ごほうびは
 * 1回の交換で完結するイベントのため）。そのため頻度→繰り返し設定のような変換ロジック
 * （choreSuggestions.tsのコメント参照）も存在しない（31.0節決定8）。この方針は
 * 2026-09-07の差し替えでも変更していない。
 */

/** 層ラベル（保護者向け画面にのみ登場。子ども向け画面には出さない、31.5節）。 */
export type RewardSuggestionLayer = "権利" | "体験" | "もの";

export interface RewardSuggestion {
  id: string;
  emoji: string;
  title: string;
  points: number;
  layer: RewardSuggestionLayer;
}

/** 主要画面ワイヤーフレーム.md 31.0節決定4のフィルタ選択肢（単一選択）。 */
export const REWARD_SUGGESTION_FILTERS: ("すべて" | RewardSuggestionLayer)[] = [
  "すべて",
  "権利",
  "体験",
  "もの",
];

export const REWARD_SUGGESTIONS: RewardSuggestion[] = [
  { id: "reward-01", emoji: "🚀", title: "たかいたかいを5かい", points: 1, layer: "体験" },
  { id: "reward-02", emoji: "🐛", title: "くすぐりっこタイム", points: 1, layer: "体験" },
  { id: "reward-03", emoji: "🐴", title: "かたぐるまでおうちのなかをたんけん", points: 2, layer: "体験" },
  { id: "reward-04", emoji: "🍽️", title: "夕食メニュー決定権", points: 2, layer: "権利" },
  { id: "reward-05", emoji: "📺", title: "テレビ・動画をえらぶ権", points: 2, layer: "権利" },
  { id: "reward-06", emoji: "🍪", title: "おやつをえらぶ権", points: 2, layer: "権利" },
  { id: "reward-07", emoji: "🛁", title: "お風呂の順番をえらべる権", points: 2, layer: "権利" },
  { id: "reward-08", emoji: "🗺️", title: "週末のおでかけさき決定権", points: 5, layer: "体験" },
  { id: "reward-09", emoji: "🧸", title: "上限額を決めた小さいおもちゃ1つ", points: 30, layer: "もの" },
  { id: "reward-10", emoji: "🛍️", title: "上限額を決めた月1回のおかいもの", points: 50, layer: "もの" },
];

export function findRewardSuggestionById(id: string): RewardSuggestion | undefined {
  return REWARD_SUGGESTIONS.find((s) => s.id === id);
}
