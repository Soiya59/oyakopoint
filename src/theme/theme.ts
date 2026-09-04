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

  // [2026-08-29変更・本部長／軽微変更ルート] #FAFAFA（完全な無彩色グレー）→ 温色寄りの
  // オフホワイト。ユーザーの実機所感「少し色合いが無機質な感じ」への対応。
  // 保護者向け画面は07-4章「淡々とした記録」の方針どおり彩度を抑えた結果、
  // 背景・カード・枠線・文字がすべて無彩色になり、色が付いているのは絵文字だけという
  // 状態になっていた。方針そのものは変えず、背景の1トークンだけを紙のような温かみのある
  // 白へ寄せる（R251 G249 B244）。白いカード（neutralSurface #FFFFFF）との差も
  // わずかに大きくなるため、カードの輪郭も掴みやすくなる。
  neutralBg: "#FBF9F4",
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
// [2026-09-01拡張] 8色→10色。開発部/成果物/実装メモ.md 100章・
// デザイントークン.md 1.3節（2026-09-01改訂）参照。統括判断
// 「お絵かきパレットは増やさないが、メンバーカラーは増やしたい」を受けた拡張。
// この配列の値・順序は、DB側 next_member_avatar_color()（supabase/migrations/
// 20260901140000_expand_member_avatar_color_palette.sql）の色配列と必ず一致させること
// （どちらか片方だけを直す失敗が実装メモ88・89・93・94章で繰り返されているため）。
export const memberColorPalette = [
  { name: "ミントグリーン", value: "#A8D5BA" },
  { name: "ピーチ", value: "#FFE5B4" },
  { name: "スカイブルー", value: "#B4D4FF" },
  { name: "ピンク", value: "#FFC1CC" },
  { name: "ラベンダー", value: "#D9C2FF" },
  { name: "レモン", value: "#FFF3B0" },
  { name: "コーラル", value: "#FFAFA3" },
  { name: "アクアミント", value: "#C2F0E8" },
  { name: "ライム", value: "#C8E8A8" }, // [2026-09-01追加]
  { name: "モーブ", value: "#F0C2EC" }, // [2026-09-01追加]
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

// [2026-08-23削除] supporterCompletionBadge（🤝/🎯バッジ）は要件定義書07-7章
// 4回目のスコープ変更（家族共有choreへの参加機能・自分専用choreの可視性トグルの撤回）
// に伴い廃止した。デザイントークン.md旧1.7節に対応していた定義。

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

// ---- 1.8 家族の木・色分け表示のトークン（2026-08-23追加、07-9章・07-10章対応） ----
// 参照: UIUXデザイン部/成果物/デザイントークン.md 1.8節。
// 木の共有部分（土・幹・枝）は固定色とし、family_members.avatar_colorを絶対に使わない。
// 色が付くのは完了報告1件ごとの視覚要素（色丸）のみ。
export const treeStages = [
  { stage: 0, name: "種", emoji: "🌰", threshold: 0 },
  { stage: 1, name: "芽", emoji: "🌱", threshold: 10 },
  { stage: 2, name: "若木", emoji: "🌿", threshold: 30 },
  { stage: 3, name: "花", emoji: "🌸", threshold: 60 },
  { stage: 4, name: "実", emoji: "🍎", threshold: 100 },
] as const;

/** family_tree_stage_for_count()（DB側）と完全に一致させる閾値表（API仕様.md 9.1章）。 */
export function treeStageForCount(count: number): number {
  if (count >= 100) return 4;
  if (count >= 60) return 3;
  if (count >= 30) return 2;
  if (count >= 10) return 1;
  return 0;
}

export function treeStageName(stage: number): string {
  return treeStages[stage]?.name ?? treeStages[0].name;
}

export function treeStageEmoji(stage: number): string {
  return treeStages[stage]?.emoji ?? treeStages[0].emoji;
}

/** 次の段階までの閾値（最終段階=実の場合はnull。締切表現にしないため件数ベースのみ）。 */
export function treeNextStageInfo(count: number): { name: string; remaining: number } | null {
  const stage = treeStageForCount(count);
  const next = treeStages[stage + 1];
  if (!next) return null;
  return { name: next.name, remaining: next.threshold - count };
}

export const treeColors = {
  soil: "#B98A5A",
  trunk: "#8B5E3C",
  foliageBase: "#BFE3C6",
  // [2026-08-24追加] 「もっと背景をよくして（天気が良い感じ）」との要望に対応。
  // 木の共有部分と同じく固定色であり、個人色（avatar_color）には絶対に染めない。
  sky: "#DCF0FB",
  sun: "#FFE3A3",
  cloud: "#FFFFFF",
  // [2026-09-01追加] color-tree-flower-center（デザイントークン.md 1.8節）。
  // 旧固定値#FFF3B0はメンバーカラー「レモン」と完全一致しており、花（stage3）の
  // 花芯とレモン色メンバーの色丸が混同していた（実装メモ99.5章・100章）。
  // FamilyTree.tsxはこの値を参照する形にし、ハードコードを持たない。
  flowerCenter: "#E0A83E",
  // [2026-09-03追加] 実（stage4）再設計で新設した固定色。りんごの葉の緑。
  // デザイントークン.md 1.8節「実（stage4）の形の再設計（2026-09-03・統括判断）」。
  // 花芯・軸と同じく「木の共有部分」の扱いのため、下位3段階と違い固定色を追加する
  // （下位3段階＝種・芽・若木は既存のavatar_colorのみで塗り、固定色は追加していない）。
  fruitLeaf: "#6AA074",
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

// ---- 1.9 お絵かきの8色パレット（`color-drawing-*`、2026-08-26追加、07-13-2章対応） ----
// 本部長決定済みの固定8色。DB側 is_valid_drawing_line_data() の許可リストと
// 完全に一致させること（順序は不問、値の集合のみ一致していればよい）。
export const drawingPalette = [
  { name: "くろ", value: "#2E2E2E" },
  // [2026-08-29変更・本部長] #E4572E は色相13°でほぼ朱色。隣の「オレンジ」（28°）と
  // 14°しか離れておらず、パレットの丸で見分けが付かないとユーザーが実機で指摘した。
  // 色相0°の素直な赤にして、オレンジとの差を28°に広げる。
  { name: "あか", value: "#DC2626" },
  { name: "オレンジ", value: "#F2913D" },
  { name: "きいろ", value: "#F5C518" },
  { name: "みどり", value: "#3FA34D" },
  { name: "あお", value: "#2F80ED" },
  // 色相は元から330°でピンク寄りだったが、暗く濃いマゼンタのため赤の隣では
  // 「濃い赤」に見えていた。色相はほぼ保ったまま明るくして、ピンクとして読ませる。
  { name: "ピンク", value: "#FF6FB5" },
  { name: "むらさき", value: "#8B5CD6" },
] as const;

// お絵かき（07-13-2章）のキャンバス・上限値。デザイントークン.md 1.9節・
// スキーマ設計.sql 33b章（is_valid_drawing_line_data / max_unpublished_drawings_per_member）
// と値を一致させること。DB側のCHECK制約が最終防衛線であり、ここでの値は
// あくまでUX目的の事前ガード（DBエラーをユーザーに見せないため）にすぎない。
// [2026-09-05追加・本部長] ログイン用コードの桁数。**Supabase側の設定と一致させる**
// 単一の定義箇所。2026-09-04に6桁で実装したが、統括が実機で試したところ本番から
// 届いたのは8桁だった（本番のSupabaseがEmail OTP Lengthを8で設定しており、
// ダッシュボードに該当の設定項目が見当たらなかったためアプリ側を合わせる判断。
// 実装メモ130章）。**Supabase側の桁数を変えたときは必ずここも変えること。**
export const emailOtpLength = 8;

export const drawingLimits = {
  canvasDiameter: 280,
  swatchSize: 56, // 1.9節「役割を問わず56dpにする理由」: 全ロール共通で56dp
  maxUnpublished: 3, // max_unpublished_drawings_per_member()と一致させる単一の定義箇所
  maxLines: 150,
  maxPointsPerLine: 300, // p配列は[x,y]の組なので要素数は最大600
  maxTotalPoints: 3000,
  maxBytes: 20480,
  // [2026-09-02追加] お絵かきの題名（07-13-2a章）。chk_family_drawings_title
  // （スキーマ設計.sql 42.1章）と一致させる単一の定義箇所。
  maxTitleLength: 20,
  // 主要画面ワイヤーフレーム.md 21.0節決定14: 保護者・みまもりメンバー向けの
  // 「◯/20」カウンターは残り5字（15字入力時点）でcolor-status-pendingに切り替える。
  titleWarningThreshold: 5,
} as const;

// ---- 1.10 ガチャのアクセントカラー・景品カタログ（`color-gacha-*`、2026-08-26追加、07-13-1章対応） ----
// 参照: デザイントークン.md 1.10節。「あと◯回でガチャ」の進捗表示・まわすボタン・
// 景品公開演出専用の差し色（お祭り・くじ引きを連想させる金色）。
export const gachaColors = {
  accent: "#FFC94D",
  accentSoft: "#FFF6DE",
} as const;

// 5コマ表示（プレート）の直径。子ども向けのみやや大きくする（デザイントークン.md 1.10節）。
export const gachaPlateSize = {
  parent: 14,
  child: 20,
  supporter: 14,
} as const;

// ---- 5. モーション ----
export const motion = {
  successDurationMs: 260,
  fadeDurationMs: 220,
} as const;

export const theme = {
  colors,
  memberColorPalette,
  stampDefinitions,
  typography,
  spacing,
  radius,
  tapTarget,
  motion,
  treeStages,
  treeColors,
  drawingPalette,
  emailOtpLength,
  drawingLimits,
  gachaColors,
  gachaPlateSize,
} as const;

export type Theme = typeof theme;
export default theme;
