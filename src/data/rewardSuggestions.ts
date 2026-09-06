/**
 * ごほうびのおすすめ集（主要画面ワイヤーフレーム.md 31章、2026-09-06追加）の静的データ。
 * クエストのおすすめ集（src/data/choreSuggestions.ts、07-16章）のごほうび版。
 * アプリ内定数としてのみ保持し、DBには一切保存しない（31.6節「対象外」・要件定義書に
 * 相当する章はまだ無く、31章が一次情報）。
 *
 * 11件は主要画面ワイヤーフレーム.md 31.2節の表を一字一句そのまま転記したもの
 * （絵文字・名前・層・必要ポイント（めやす））。掲載順も表の掲載順（#1〜#11）のまま
 * 変更していない（31.2節「フィルタ後も行の相対順は変えない」の前提）。
 *
 * クエスト版と異なり、頻度（frequency）・対象（target）に相当する属性は持たない
 * （31.0節決定5。rewardsテーブルには頻度・繰り返しに相当する属性が無く、ごほうびは
 * 1回の交換で完結するイベントのため）。そのため頻度→繰り返し設定のような変換ロジック
 * （choreSuggestions.tsのコメント参照）も存在しない（31.0節決定8）。
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
  { id: "reward-01", emoji: "🍽️", title: "夕食メニュー決定権", points: 3, layer: "権利" },
  { id: "reward-02", emoji: "📺", title: "TV選択権", points: 3, layer: "権利" },
  { id: "reward-03", emoji: "🍪", title: "おやつ選択権", points: 3, layer: "権利" },
  { id: "reward-04", emoji: "🛁", title: "お風呂の順番決定権", points: 3, layer: "権利" },
  { id: "reward-05", emoji: "🌙", title: "就寝15分延長", points: 5, layer: "権利" },
  { id: "reward-06", emoji: "🎮", title: "ゲーム15分延長", points: 5, layer: "権利" },
  { id: "reward-07", emoji: "🤼", title: "親と10分全力で遊ぶ券", points: 8, layer: "体験" },
  { id: "reward-08", emoji: "📖", title: "寝る前の本1冊追加", points: 8, layer: "体験" },
  { id: "reward-09", emoji: "🗺️", title: "週末の行き先決定権", points: 12, layer: "体験" },
  { id: "reward-10", emoji: "🧸", title: "上限額を決めた小さいおもちゃ1つ", points: 20, layer: "もの" },
  { id: "reward-11", emoji: "🛍️", title: "上限額を決めた月1回の買い物", points: 30, layer: "もの" },
];

export function findRewardSuggestionById(id: string): RewardSuggestion | undefined {
  return REWARD_SUGGESTIONS.find((s) => s.id === id);
}
