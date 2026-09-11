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
// [2026-09-01拡張] 8色→10色。[2026-09-11拡張] 10色→15色（「選ぶ楽しさ」を
// 増やす目的。人数不足への対応ではない）。[2026-09-11再改訂] 15色→12色に縮小。
// 統括が実機で「似ている色が多い」と判断し、新規5色のうち既存10色との最小ΔE
// （CIE76、本部長算出）が小さい3色（ローズ・アイスブルー・オーキッド）を取り下げ、
// 最も独立している2色（セルリアン・ペリウィンクル）のみ残した。あわせて並び順を
// 追加順（末尾追加）から色相（Hue）昇順に組み替えた（似た色同士を隣接させ、
// 「似た色は隣同士に」という統括指示を満たす）。既存10色の値・お絵かきパレットは
// いずれも変更していない。
// デザイントークン.md 1.3節（2026-09-11改訂v1.19、決定9〜14）・
// 開発部/成果物/実装メモ.md 199章（15色化）・200章（12色化）参照。
// この配列の値・順序は、DB側 next_member_avatar_color()（supabase/migrations/
// 20260922010000_narrow_member_avatar_color_palette_12colors.sql、
// 20260920010000（15色）版を打ち消す新規マイグレーション）の色配列と必ず一致させること
// （どちらか片方だけを直す失敗が実装メモ88・89・93・94章で繰り返されているため）。
export const memberColorPalette = [
  { name: "コーラル", value: "#FFAFA3" },
  { name: "ピーチ", value: "#FFE5B4" },
  { name: "レモン", value: "#FFF3B0" },
  { name: "ライム", value: "#C8E8A8" },
  { name: "ミントグリーン", value: "#A8D5BA" },
  { name: "アクアミント", value: "#C2F0E8" },
  { name: "セルリアン", value: "#ADD3EB" }, // [2026-09-11追加、決定9で維持]
  { name: "スカイブルー", value: "#B4D4FF" },
  { name: "ペリウィンクル", value: "#B7B6ED" }, // [2026-09-11追加、決定9で維持]
  { name: "ラベンダー", value: "#D9C2FF" },
  { name: "モーブ", value: "#F0C2EC" },
  { name: "ピンク", value: "#FFC1CC" },
] as const;

// ---- 4. アイコン・イラスト方針: 保護者リアクション（スタンプ4種） ----
// 主要画面ワイヤーフレーム.md 3.0節で決定した初期セット。stamp_keyはDB側TEXT列
// （enumではない）のため、この一覧はあくまでクライアント側の表示用マッピング。
export const stampDefinitions = [
  { key: "ganbatta", emoji: "💪", label: "がんばったね" },
  { key: "arigato", emoji: "🙏", label: "ありがとう" },
  { key: "sugoi", emoji: "👏", label: "すごい！" },
  // [2026-09-06] 掲示板だけは「たすかったよ」ではなく「いいね」と呼ぶ（統括指示。
  // 掲示板の書き込みは「手伝ってもらったこと」とは限らないため）。絵文字は同じ。
  // boardLabelが無いスタンプは、掲示板でもlabelをそのまま使う。
  { key: "tasukatta", emoji: "😊", label: "たすかったよ", boardLabel: "いいね" },
] as const;

/** 掲示板で表示する呼び名。boardLabelがあればそれを、無ければlabelを返す。 */
export function boardStampLabel(def: { label: string; boardLabel?: string }): string {
  return def.boardLabel ?? def.label;
}

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

// ---- 1.9 お絵かきの10色パレット（`color-drawing-*`、2026-08-26追加・2026-09-07に10色化、07-13-2章対応） ----
// 本部長決定済みの固定10色。DB側 is_valid_drawing_line_data() の許可リストと
// 完全に一致させること（DB側は既存データ保護のため旧きいろ`#F5C518`等の
// 旧色も残しており13色。パレット〈クライアントの表示・選択肢〉はここに書いた
// 10色のみを見せる。順序は主要画面ワイヤーフレーム.md 21.5d節 決定36の
// 5列2行の並び順のとおり、配列の並び＝画面上の並びになる）。
export const drawingPalette = [
  { name: "くろ", value: "#2E2E2E" },
  // [2026-08-29変更・本部長] #E4572E は色相13°でほぼ朱色。隣の「オレンジ」（28°）と
  // 14°しか離れておらず、パレットの丸で見分けが付かないとユーザーが実機で指摘した。
  // 色相0°の素直な赤にして、オレンジとの差を28°に広げる。
  { name: "あか", value: "#DC2626" },
  { name: "オレンジ", value: "#F2913D" },
  // [2026-09-07変更・統括決定] 旧#F5C518（色相47°）はオレンジ（28°）と19°しか
  // 離れておらず「オレンジと似ている」と統括が指摘。UIUXデザイン部の改訂案
  // `#D5C40B`（決定39）は統括の目視で「からし色」に見えると却下され、
  // 明るい純粋な黄`#FFD400`に確定した（主要画面ワイヤーフレーム.md 21.5d節、
  // 決定39直前の「【統括決定・2026-09-07・本部長注記】」参照）。旧`#F5C518`は
  // DB側の許可リストに既存データ保護のため残置（削除しない）。
  { name: "きいろ", value: "#FFD400" },
  // [2026-09-07追加・統括決定] 「白色か消しゴムがあると嬉しい」を受けて追加。
  // 新しい不透明な白のストロークを1本追加するだけで、既存の線を消す機能では
  // ない（消しゴムは今回追加しない。21.5d節 決定32〜34）。
  { name: "しろ", value: "#FFFFFF" },
  { name: "みどり", value: "#3FA34D" },
  { name: "あお", value: "#2F80ED" },
  // 色相は元から330°でピンク寄りだったが、暗く濃いマゼンタのため赤の隣では
  // 「濃い赤」に見えていた。色相はほぼ保ったまま明るくして、ピンクとして読ませる。
  { name: "ピンク", value: "#FF6FB5" },
  { name: "むらさき", value: "#8B5CD6" },
  // [2026-09-07追加・統括決定] 「もう一色は茶色かな／うんちとか書きたい子供おるやろし」
  // を受けて追加。UIUXデザイン部の当初案`#C66339`は統括の目視で「オレンジの
  // 濃いやつ」に見えると却下され、定番の茶`#8B4513`（saddlebrown）に確定した
  // （21.5d節、決定35'直前の「【統括決定・2026-09-07・本部長注記】」参照）。
  { name: "ちゃいろ", value: "#8B4513" },
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
// [2026-09-05再修正] 統括がSupabaseの設定を8桁から6桁へ変更できたため、6桁に戻す。
// 桁数の正は常に**本番のSupabaseの設定**であり、ローカルの config.toml ではない。
export const emailOtpLength = 6;

export const drawingLimits = {
  canvasDiameter: 280,
  swatchSize: 56, // 1.9節「役割を問わず56dpにする理由」: 全ロール共通で56dp
  maxUnpublished: 3, // max_unpublished_drawings_per_member()と一致させる単一の定義箇所
  // [2026-09-07変更・実装メモ136章] 150→300。統括の実体験（塗り絵で上限到達）を
  // 受けた上限拡張。スキーマ設計.sql 46章・API仕様.md 12.2c節と一致させる
  // 単一の定義箇所。
  maxLines: 300,
  maxPointsPerLine: 300, // p配列は[x,y]の組なので要素数は最大600（変更なし・46.1章）
  // [2026-09-07変更・実装メモ136章] 3000→6000。
  maxTotalPoints: 6000,
  // [2026-09-07変更・実装メモ136章] 21504→65536（21KB→64KB）。統括が実際に
  // 塗り絵をして86本・21,463byte（旧上限の99.8%）で手が止まった実測（線数・
  // 点数の上限には遠く届いていなかった＝バイト数だけが先に効いていた）を受けた
  // 引き上げ。スキーマ設計.sql 46.2章・API仕様.md 12.2c節と一致させる単一の
  // 定義箇所。
  maxBytes: 65536,
  // [2026-09-02追加] お絵かきの題名（07-13-2a章）。chk_family_drawings_title
  // （スキーマ設計.sql 42.1章）と一致させる単一の定義箇所。
  maxTitleLength: 20,
  // 主要画面ワイヤーフレーム.md 21.0節決定14: 保護者・みまもりメンバー向けの
  // 「◯/20」カウンターは残り5字（15字入力時点）でcolor-status-pendingに切り替える。
  titleWarningThreshold: 5,
} as const;

// ---- アバター専用の上限値・パレット（要件定義書07-27章、スキーマ設計.sql 54章、
// 主要画面ワイヤーフレーム.md 43.8節、2026-09-11追加） ----
// drawingLimits/drawingPalette（family_drawings用）とは意図的に分離する
// （理由: スキーマ設計.sql 54.3章「7回改訂された実績による巻き添え変更リスクを
// 避けるため専用関数に分ける」）。値はDB側is_valid_avatar_line_data()の
// CHECK制約（supabase/migrations/20260924010000_member_avatars.sql）と必ず
// 一致させること。
export const avatarDrawingLimits = {
  maxLines: 150,
  maxPointsPerLine: 300, // 家族の絵と同じ値、変更なし（54.3章）
  maxTotalPoints: 3000,
  maxBytes: 20480, // 20KB
} as const;

// 値はdrawingPaletteの現行10色と完全一致（is_valid_avatar_line_data()の許可色と
// 同じ、旧データ保護専用の3色は含めない）。将来どちらか一方だけを拡張する事態に
// 備え、意図的に別名でexportする（43.8節）。
export const avatarDrawingPalette = drawingPalette;

// ---- 線の太さ（3段階、2026-09-05追加、07-13-2章拡張） ----
// 参照: デザイントークン.md「線の太さ（3段階）」・主要画面ワイヤーフレーム.md 21.5b節
// 決定20（値）・決定22（表示用の点の直径）。値（2/4/7）はDB側is_valid_drawing_line_data()
// の許可リスト（スキーマ設計.sql 44.5章 v_allowed_widths）と一致させること。
export const drawingStrokeWidths = [
  { value: 2, label: "ほそい", dotSize: 14 },
  { value: 4, label: "ふつう", dotSize: 24 },
  { value: 7, label: "ふとい", dotSize: 36 },
] as const;

// 決定23: 既定値は「ふつう」＝4pt（現行の固定値をそのまま踏襲）。決定25: `w`が
// 存在しない旧データの表示フォールバック値も同じ4に揃える（単一の基準値にする）。
export const defaultDrawingStrokeWidth = 4;

// ---- お絵かきの線の間引き（Douglas-Peucker、2026-09-07追加、実装メモ137章対応） ----
// 描き終わった瞬間（1本の線が確定したとき）にだけ`src/lib/simplifyPolyline.ts`へ渡す
// 許容値。単位はキャンバス座標系（0〜1000正規化）での距離。統括承認済み（2026-09-07）。
// 本部長が統括の実際の絵（86本・1,862点・21,463byte）で検証し、許容値2で
// 1,190点・14,746byte（-32%）まで減ることを確認した数値（実装メモ137章）。
// 描画中のライブプレビュー・保存済みの絵（DB上の既存データ）には適用しない
// （simplifyPolyline.tsのコメント参照）。
export const drawingSimplifyTolerance = 2;

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

// ---- 1.11 木を飾るステッカー（`sticker-*`、2026-09-07追加、07-19-9a章対応） ----
// 参照: デザイントークン.md 1.11節。形3種（beetle/butterfly/flower）×レアリティ4段
// （bronze/silver/gold/crystal）＝12種類。レアリティは大きさではなく色・質感のみで
// 表現し、12種類とも表示直径は同一。
// [2026-09-08改訂・本部長／実装メモ173章] 最上位レアリティの呼び名を統括判断で
// 「虹（rainbow）」から「クリスタル（crystal）」に改称した（絵を作り直したことで
// クリスタル感が出たため）。4段階の構成自体は変わらない。
// [2026-09-09改訂・本部長／実装メモ177章] やること5-9のうち「ドラゴン」のみを
// 追加し、形4種（beetle/butterfly/flower/dragon）×レアリティ4段＝16種類にした。
// どんぐり（acorn）・とり（bird）・くるま（car）は今回対象外のまま。
export const stickerShapes = ["beetle", "butterfly", "flower", "dragon"] as const;
export type StickerShape = (typeof stickerShapes)[number];

export const stickerRarities = ["bronze", "silver", "gold", "crystal"] as const;
export type StickerRarity = (typeof stickerRarities)[number];

/**
 * 木の上での表示直径。[2026-09-10改訂・実装メモ149章] 統括要望を受け24pt→30ptに
 * 拡大した（実際に使うのは`FamilyTree.tsx`内の`STICKER_DOT_SIZE`で、この定数自体は
 * 149章時点でも未参照。改訂時に値だけ揃えた）。通常の色丸13pt超・家族の絵
 * 〈景品〉36pt未満の中間サイズという原則は変わらず満たす。
 */
export const stickerTreeDotSize = 30;
/** 識別リング太さ（景品〈36pt〉のリングと揃える。1.8節）。 */
export const stickerRingWidth = 2;

// [2026-09-10削除・実装メモ149章] `stickerRarityGradients`（レアリティ別グラデーション
// 定義）・`stickerAccentFixed`（固定線色）は、`StickerIcon`をSVG自前描画から統括
// 提供の画像表示へ切り替えたことで参照元がなくなったため削除した。色・質感の
// 決定内容（統括決定26）自体は`デザイントークン.md`1.11節に記録が残る。

/** 12種のカタログをUI表示用に並べる固定順（32.1節ワイヤーフレーム: 形ごとに1行、レアリティ4段を列に固定）。 */
export const stickerCatalogOrder: readonly { shape: StickerShape; rarity: StickerRarity }[] = stickerShapes.flatMap(
  (shape) => stickerRarities.map((rarity) => ({ shape, rarity }))
);

export function stickerKeyOf(shape: StickerShape, rarity: StickerRarity): string {
  return `${shape}_${rarity}`;
}

// ---- 1.12 累計到達バッジ（`badge-*`、2026-09-07追加、07-19-9b章対応） ----
// バッジは新しい絵を増やさず、既存の絵文字1種＋到達値の数字併記で表現する
// （決定28「絵は増やさない、同じ印に到達値を添える」）。
export type BadgeKey =
  | "lifetime_points_earned"
  | "lifetime_completions"
  | "lifetime_drawings"
  | "lifetime_gacha_draws"
  | "lifetime_sticker_purchases";

/**
 * [2026-09-08改訂・本部長／軽微変更ルート] 統括の実機確認「このバッジについて、
 * 絵文字や記載が合っていない。がんばりはクエスト。絵文字も合わせて」への対応。
 * デザイントークン.md 1.12節の選定理由のうち、前提が変わったものを直した。
 *
 * - `lifetime_completions`: 名前を「がんばり」→「クエスト」に。2026-08-29に
 *   「お手伝い」を「クエスト」へ改称した際（要件定義書40行目）、このバッジ名だけが
 *   取り残されていた。絵文字も、ホームのメニュータイル「🧹 クエスト」に合わせる。
 *   従来の✅は「C5の『✅ がんばったね』と同じ絵文字を再利用」という理由だったが、
 *   名前がクエストになる以上、指すものが一致する絵文字のほうがよい。
 * - `lifetime_drawings`: ✏️→🎨。1.12節は「既製の飾りカタログ例に🎨が含まれるため
 *   混同を避けて鉛筆にした」としていたが、コード全体で🎨を使っているのは
 *   3ロールのホームの「お絵かき」タイルだけになっており（`grep -rl "🎨"`で確認）、
 *   避ける理由が消えていた。
 * - `lifetime_sticker_purchases`: 🏷️→🪙。🏷️は「ステッカー」という呼び名だった頃に
 *   「具体的な形に限定されない収集物」を表すために選ばれたもの。2026-09-07に
 *   「メダル」へ改称し（実装メモ150章）、導線の絵文字も🪙に統一済み（実装メモ166章）。
 * - `unit`: 進捗文言の単位。従来`BadgeList.tsx`が「ポイント以外は一律で回／かい」と
 *   していたため、「えかき10まい（つぎの段階10**回**まで あと3**回**）」
 *   「メダル5こ（つぎの段階5**回**まで あと4**回**）」と、名前と単位が食い違っていた。
 */
export const badgeDefinitions: readonly {
  key: BadgeKey;
  emoji: string;
  nameParent: string;
  nameChild: string;
  /** 進捗文言の単位。[0]=保護者・みまもり向け、[1]=子ども向け（ひらがな） */
  unit: readonly [string, string];
}[] = [
  { key: "lifetime_points_earned", emoji: "🌟", nameParent: "はじめの100pt", nameChild: "はじめの100pt", unit: ["pt", "pt"] },
  { key: "lifetime_completions", emoji: "🧹", nameParent: "クエスト50回", nameChild: "クエスト50かい", unit: ["回", "かい"] },
  { key: "lifetime_drawings", emoji: "🎨", nameParent: "えかき10まい", nameChild: "えかき10まい", unit: ["まい", "まい"] },
  // ガチャだけは保護者向けの名前も「10かい」とひらがなのため、単位も「かい」で揃える
  // （「ひみつはっけん10かい（つぎの段階10回まで…）」と1行の中で食い違うのを避ける）。
  { key: "lifetime_gacha_draws", emoji: "🔍", nameParent: "ひみつはっけん10かい", nameChild: "ひみつはっけん10かい", unit: ["かい", "かい"] },
  { key: "lifetime_sticker_purchases", emoji: "🪙", nameParent: "メダル5こ", nameChild: "メダル5こ", unit: ["こ", "こ"] },
] as const;

/**
 * 閾値の初期値（1段階目、企画部初期案）。実際の全段階（青天井、決定28）は
 * DB側`badge_tier_thresholds()`（スキーマ設計.sql 47.6章）が返す10段階の配列を
 * 正とする（`api.fetchBadgeTierThresholds`参照）。この初期値は「1・3・10・30・100」
 * 倍率列の起点として、DB取得結果と一致することの目安表示にのみ使う。
 */
export const badgeInitialThresholds: Record<BadgeKey, number> = {
  lifetime_points_earned: 100,
  lifetime_completions: 50,
  lifetime_drawings: 10,
  lifetime_gacha_draws: 10,
  lifetime_sticker_purchases: 5,
};

/**
 * 現在値と、DBから取得した昇順の閾値配列（`badge_tier_thresholds()`の戻り値）から、
 * 「達成済みの最大値」「次の段階」「次の段階までの残り」を求める（表示用、決定15）。
 * 全段階を達成済み（青天井の末尾、DB側配列を使い切った状態）の場合はnextTier/remainingは
 * ともにnullになる（決定28の想定運用〈MVP期間内での到達は想定薄〉）。
 */
export function badgeProgressInfo(
  tiers: readonly number[],
  currentValue: number
): { achievedTier: number | null; nextTier: number | null; remaining: number | null } {
  let achievedTier: number | null = null;
  let nextTier: number | null = null;
  for (const t of tiers) {
    if (currentValue >= t) achievedTier = t;
    else if (nextTier === null) nextTier = t;
  }
  return { achievedTier, nextTier, remaining: nextTier !== null ? nextTier - currentValue : null };
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
  boardStampLabel,
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
  avatarDrawingLimits,
  avatarDrawingPalette,
  drawingStrokeWidths,
  defaultDrawingStrokeWidth,
  drawingSimplifyTolerance,
  gachaColors,
  gachaPlateSize,
  stickerShapes,
  stickerRarities,
  stickerTreeDotSize,
  stickerRingWidth,
  stickerCatalogOrder,
  stickerKeyOf,
  badgeDefinitions,
  badgeInitialThresholds,
  badgeProgressInfo,
} as const;

export type Theme = typeof theme;
export default theme;
