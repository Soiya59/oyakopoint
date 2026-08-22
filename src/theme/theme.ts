/**
 * デザイントークン実装。
 * 参照: UIUXデザイン部/成果物/デザイントークン.md
 *
 * このファイルのトークン名・値はデザイントークン.mdの見出し番号にできる限り
 * 対応させている（コメントで章番号を明記）。
 */

// ---- 1.2 基本トークン ----
export const colors = {
  brandPrimary: "#10B981",
  brandPrimaryStrong: "#059669",
  brandPrimarySoft: "#ECFDF5",

  neutralBg: "#FAFAFA",
  neutralSurface: "#FFFFFF",
  neutralBorder: "#E5E5E5",
  neutralTextPrimary: "#171717",
  neutralTextSecondary: "#737373",

  // 1.4 ステータスカラー
  statusSuccess: "#10B981",
  // pending: 「承認待ち」の意味は2026-08-15改訂で削除。送信中・処理中などの
  // 一時的な処理中状態のみに用途を限定する（デザイントークン.md 1.4節）。
  statusPending: "#F59E0B",
  statusPendingSoft: "#FFFBEB",
  // [削除] statusRetry / statusRetrySoft（2026-08-15削除）。
  // 要件定義書.md v0.5で承認フローが全面廃止され、「差し戻し」というアクション・
  // ボタン自体が仕様から消えたため（07章）。保護者のリアクション（スタンプ／コメント）は
  // brandPrimary系の達成色域で表現し、専用の「もう一度」色は不要になった
  // （デザイントークン.md 1.4節、主要画面ワイヤーフレーム.md 3章参照）。
  statusBlocking: "#EF4444", // 保護者向け画面限定。子ども向けでは使用しない。

  // 1.7 みまもりメンバー向けの第三のトーン（2026-08-22追加、要件定義書07-7章対応）
  // 参照: デザイントークン.md 1.7節。中彩度、neutralを基調に差し色として使う。
  supporterAccent: "#F2A65A",
  supporterAccentSoft: "#FFF3E6",
} as const;

// ---- 1.3 メンバーカラーパレット（avatar_color） ----
export const memberColorPalette = [
  { name: "ミントグリーン", value: "#A8D5BA" },
  { name: "ピーチ", value: "#FFE5B4" },
  { name: "スカイブルー", value: "#B4D4FF" },
  { name: "ピンク", value: "#FFC1CC" },
  { name: "ラベンダー", value: "#D9C2FF" },
  { name: "レモン", value: "#FFF3B0" },
  { name: "コーラル", value: "#FFAFA3" },
  { name: "アクアミント", value: "#C2F0E8" },
] as const;

// ---- 4. アイコン・イラスト方針: 保護者リアクション（スタンプ4種） ----
// 主要画面ワイヤーフレーム.md 3.0節で決定した初期セット。stamp_keyはDB側TEXT列
// （enumではない）のため、この一覧はあくまでクライアント側の表示用マッピング。
export const stampDefinitions = [
  { key: "ganbatta", emoji: "💪", label: "がんばったね" },
  { key: "arigato", emoji: "🙏", label: "ありがとう" },
  { key: "sugoi", emoji: "👏", label: "すごい！" },
  { key: "tasukatta", emoji: "😊", label: "たすかったよ" },
] as const;

// ---- 2. タイポグラフィ ----
// sp/dpはRN上ではおおよそptに対応するものとして扱う。
export const typography = {
  parentTitle: { fontSize: 20, fontWeight: "700" as const },
  parentBody: { fontSize: 15, fontWeight: "400" as const },
  parentBodyMedium: { fontSize: 15, fontWeight: "500" as const },
  parentCaption: { fontSize: 12, fontWeight: "400" as const },

  childHeadline: { fontSize: 30, fontWeight: "700" as const },
  childBody: { fontSize: 17, fontWeight: "700" as const },
  childButton: { fontSize: 19, fontWeight: "700" as const },

  // みまもりメンバー向け（デザイントークン.md 1.7節）。保護者よりわずかに大きく、
  // 老眼等の視認性にも配慮した文字サイズ。
  supporterTitle: { fontSize: 21, fontWeight: "700" as const },
  supporterBody: { fontSize: 16, fontWeight: "400" as const },
  supporterBodyMedium: { fontSize: 16, fontWeight: "600" as const },
  supporterCaption: { fontSize: 13, fontWeight: "400" as const },
} as const;

// 07-7章「自分専用choreの可視性・双方向リアクションとの関係」・デザイントークン.md
// 1.7節「みまもりメンバーの2種類の完了報告バッジ」対応。全画面（P8/P18/C15、S2/S12、
// S1〜S11）で共通に使う唯一の定義（開発部が独自の絵文字を選んでしまわないよう
// ここに集約する）。
export const supporterCompletionBadge = {
  family: { emoji: "🤝", label: "いっしょに" },
  personal: { emoji: "🎯", label: "じぶんの目標" },
} as const;

// ---- 3. 間隔・レイアウト ----
export const spacing = {
  s1: 4,
  s2: 8,
  s3: 12,
  s4: 16,
  s6: 24,
  s8: 32,
} as const;

export const radius = {
  parentMd: 8,
  parentLg: 12,
  childXl: 16,
} as const;

// タップターゲット最小サイズ
export const tapTarget = {
  parent: 44,
  child: 56,
  childPrimary: 72,
  // デザイントークン.md 1.7節: みまもりメンバー向けは最小44×44dpを基本としつつ、
  // 主要ボタンは48×48dp以上を推奨（祖父母等、保護者より年齢層が高い利用者を想定）。
  supporterPrimary: 48,
} as const;

// ---- 8章 実施履歴カレンダー: 日別セルの濃淡（GitHubヒートマップ的表現） ----
// 主要画面ワイヤーフレーム.md 8.5節「セル背景の濃淡はcolor-brand-primary-softを基準とした
// 3段階程度に留め、GitHubのような多段階グラデーションは採用しない」に対応。
// ストリーク数値は表示しない（8.0決定2）。brandPrimary(#10B981 = rgb(16,185,129))の
// アルファ値だけを変えた3段階＋「活動なし」の計4値。
export function pointsTierBackground(totalPoints: number): string {
  if (totalPoints <= 0) return "transparent";
  if (totalPoints <= 5) return "rgba(16,185,129,0.14)";
  if (totalPoints <= 12) return "rgba(16,185,129,0.30)";
  return "rgba(16,185,129,0.48)";
}

// ---- 5. モーション ----
export const motion = {
  successDurationMs: 260,
  fadeDurationMs: 220,
} as const;

export const theme = {
  colors,
  memberColorPalette,
  stampDefinitions,
  supporterCompletionBadge,
  typography,
  spacing,
  radius,
  tapTarget,
  motion,
} as const;

export type Theme = typeof theme;
export default theme;
