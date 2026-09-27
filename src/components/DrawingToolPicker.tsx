/**
 * お絵かきの道具切り替え（ペン／〇／△／□）。実装メモ.md 309章、本部長依頼
 * （2026-09-26・軽微変更ルート、統括決定「本部長のおすすめ通りで」）。
 *
 * 子ども向け画面は文字よりアイコン・色・アニメーションを優先する方針
 * （UIUXデザイン部/CLAUDE.md）のため、ボタンには記号のみを表示し、文字ラベルは
 * 一切出さない（依頼文3.）。保護者・みまもりメンバー向けも同じ記号でよい
 * （依頼文「大人向けも同じ記号でよい」）ため、toneによる見た目分岐は持たない。
 * `accessibilityLabel`（画面には表示されない、スクリーンリーダー専用）のみ
 * ロールごとの言葉遣いを揃える。
 *
 * 10色パレット（DrawingPalette.tsx）・線の太さ選択（DrawingStrokeWidthPicker.tsx）と
 * 同じタップ領域（56dp、theme.drawingLimits.swatchSize）・同じ選択状態の見た目
 * （color-brand-primaryの2pt枠）を踏襲し、新しい視覚言語を増やさない（依頼文3.
 * 「選択中の見た目をつける（色・太さの選択と同じ見た目）」）。
 *
 * 記号は依頼文の指定どおり「〇 △ □」に相当する輪郭グリフ（○ U+25CB・
 * △ U+25B3・□ U+25A1、いずれも中を塗らない「線だけ」の見た目）を使う。
 * ペンは編集操作でよく使われる鉛筆記号（✏ U+270F）。このプロジェクトには
 * アイコンライブラリが無く（node_modules確認済み）、`✓`・`→`（ChildCompletionCard.tsx・
 * GachaHomeWidget.tsx）と同じくTextコンポーネントにUnicode記号をそのまま
 * 描画する既存の書き方を踏襲する。
 *
 * [2026-09-27追加・実装メモ.md 313章、本部長依頼・軽微変更ルート「塗った形」]
 * 形（○／△／□）の中を塗れるようにする依頼。
 *
 * [2026-09-27・実装メモ.md 314章、本部長依頼・軽微変更ルート「道具の並びを分かり
 * やすく」で313章の並びを変更した]
 * 313章では塗り切り替え専用の5個目のボタンを足したが、統括決定により**この
 * ボタンは廃止し、選んでいる形のボタンをもう一度押すと線／塗りが切り替わる**
 * 方式に変える（行を増やさないという依頼文の制約に、5個目のボタンより素直に
 * 合う）。`onSelect`は「別の形を選ぶ」ときのみ呼び、「今すでに選んでいる形
 * （ペン以外）をもう一度押す」ときだけ`onToggleFilled`を呼ぶ、という条件分岐は
 * このコンポーネント内の`handlePress`に閉じ込め、呼び出し側（`DrawingBoard.tsx`・
 * `AvatarDrawingPanel.tsx`）の呼び出し方は変えない。
 *
 * [別の形に移ったときの線／塗りの引き継ぎ・314章決定] 何もリセットしない
 * （＝`filled`はそのまま次の形にも引き継ぐ）。理由: `tool`・`color`・`strokeWidth`は
 * いずれも道具を切り替えても保持される既存の設計（309章・313章コメント参照）で
 * あり、`filled`だけ切り替え時にリセットすると「さっきまで塗れていたのに
 * 急に線に戻る」という一貫性のない挙動になる。「今塗っている最中に別の形も
 * 塗りたい」という使い方（例: ●を描いた後に▲も塗りたい）のほうが「形を変えたら
 * 線に戻したい」より頻度が高いと判断した。
 *
 * [色で表示する・314章決定2] ボタンの記号は`color`（今選んでいる描画色）で
 * 表示する。ペン（✏）も同じ`color`を適用するが、これは「色で表示できるなら
 * 合わせてよい（無理なら今のまま）」という依頼文への対応: 絵文字フォントとして
 * 描画される端末では`color`指定が無視され、これまでと同じ見た目のまま残る
 * （実害が無いため分岐を増やさず一律に適用する）。
 *
 * [白のときの縁取り・314章決定3] 白（#FFFFFF）を選んでいるときは、記号の背景
 * （`DrawingBoard.tsx`ではCard内の`neutralSurface`＝`#FFFFFF`固定、
 * `AvatarDrawingPanel.tsx`ではCard外＝画面の`neutralBg`＝`#FBF9F4`、いずれも
 * 白に極めて近い）と同化しないよう、実際の背景色を場合分けせず一律に
 * `DrawingCanvas.tsx`の`needsWhiteOutline`と同じ考え方で縁取りを付ける。ただし
 * Textコンポーネントには実際のストローク（線画の二重描画）を描く手段が無いため、
 * `textShadow`で暗い縁のにじみを作る近似的な実装にした（SVGの二重Polyline描画
 * そのものは再現できない）。
 *
 * [2026-09-27追加・実装メモ.md 315章、本部長依頼・軽微変更ルート「うごかす」]
 * 形の行（○／△／□）に✋（うごかす）を1つ足す。**行は増やさない**という統括決定
 * のとおり、新しい行・新しいセクションは作らず、既存の`TOOL_ORDER`の末尾に
 * `"move"`を足すだけにした（`styles.row`はそのまま、5個目のボタンが自然に並ぶ）。
 * ✋には「塗る」概念が無いため、312〜314章で入れた「もう一度押すと塗り切替」
 * ロジック（`handlePress`の`isDrawingShapeTool`判定）・`FILLED_SYMBOLS`・
 * `ShapeIcon`（SVG図形）のいずれにも"move"を含めない。ペンと同じくTextへ
 * Unicode記号（✋ U+270B）をそのまま描画する（314章冒頭のコメントどおり、
 * このプロジェクトにアイコンライブラリが無いため）。314章でペン以外をSVG化した
 * 理由は「□／■のような文字が塗り有無で大きさの作りが違って見える」ことへの
 * 対処だったが、✋はもともと塗り切替が無く同一の絵文字を出し続けるだけなので、
 * 大きさが揺れる問題自体が起きない。ペン（✏）も同じ理由でText描画のまま
 * 残っている前例に揃えた。
 */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polygon, Rect } from "react-native-svg";
import theme from "@/theme/theme";
import { isDrawingShapeTool, type DrawingShapeTool, type DrawingTool } from "@/lib/drawingShapes";
import { hydrateIntroSeen, isIntroSeen, markIntroSeen } from "@/lib/introSeen";

type Tone = "parent" | "child" | "supporter";

// [2026-09-27追加・315章] "move"（✋）を末尾に足す。行は増やさず、既存の並びの
// 5個目として追加する（依頼文「行は増やしたくない」）。
const TOOL_ORDER: readonly DrawingTool[] = ["pen", "circle", "triangle", "rect", "move"];

const TOOL_SYMBOLS: Record<DrawingTool, string> = {
  pen: "✏",
  circle: "○",
  triangle: "△",
  rect: "□",
  move: "✋",
};

/**
 * [2026-09-27追加・実装メモ.md 313章] 塗った形の記号（依頼文の指定どおり
 * ● U+25CF・▲ U+25B2・■ U+25A0）。`"pen"`・`"move"`には塗りの概念が無いため
 * 含まない（`DrawingShapeTool`＝形の3種類のみをキーに持つ）。
 */
const FILLED_SYMBOLS: Record<DrawingShapeTool, string> = {
  circle: "●",
  triangle: "▲",
  rect: "■",
};

/** accessibilityLabel専用（画面には表示しない）。DrawingZoomPicker.tsxのZOOM_LABELSと同じ考え方。
 *  [2026-09-27追加・315章]「うごかす」（✋）を追加。依頼文「アクセシビリティのラベルは
 *  3ロールで言葉を合わせる（うごかす／動かす）」のとおり、保護者・みまもりメンバーは
 *  同一の「動かす」を共有する（他の道具と同じく、この2ロールは常に同一文言）。 */
const TOOL_ACCESSIBILITY_LABELS: Record<Tone, Record<DrawingTool, string>> = {
  child: { pen: "ふで", circle: "まる", triangle: "さんかく", rect: "しかく", move: "うごかす" },
  parent: { pen: "ペン", circle: "丸", triangle: "三角", rect: "四角", move: "動かす" },
  supporter: { pen: "ペン", circle: "丸", triangle: "三角", rect: "四角", move: "動かす" },
};

/**
 * [2026-09-27追加・実装メモ.md 313章] 塗り状態のaccessibilityLabelの補足。
 * ペン以外の選択中の形にだけ「（ぬりつぶし）」「（せんだけ）」を後ろに足す。
 * [2026-09-27変更・実装メモ.md 314章] 専用ボタンの案内文からラベル補足へ変更。
 */
const FILL_STATE_ACCESSIBILITY_SUFFIX: Record<Tone, { filled: string; outline: string }> = {
  child: { filled: "（ぬりつぶし。もう一度押すとせんだけに戻ります）", outline: "（もう一度押すとぬりつぶせます）" },
  parent: { filled: "（塗りつぶし。もう一度押すと線のみに戻ります）", outline: "（もう一度押すと塗りつぶせます）" },
  supporter: { filled: "（塗りつぶし。もう一度押すと線のみに戻ります）", outline: "（もう一度押すと塗りつぶせます）" },
};

/** [2026-09-27追加・実装メモ.md 314章] 初めて形を選んだときだけ出す案内。 */
const FIRST_SHAPE_HINT_TEXT: Record<Tone, string> = {
  child: "もういちど おすと ぬれるよ",
  parent: "もう一度押すと塗りつぶせます",
  supporter: "もう一度押すと塗りつぶせます",
};

/** [2026-09-27追加・実装メモ.md 314章] 一時表示を消すまでの時間（ミリ秒）。 */
const FIRST_SHAPE_HINT_DURATION_MS = 4000;

/**
 * [2026-09-27追加・統括の実機報告「しかくだけ、色ありにしたら小さくなる」]
 * 形の記号を、文字（○△□●▲■）ではなく図形（SVG）で描く。□と■は別の文字で、
 * フォントによって大きさの作りが違うため、塗りに切り替えると■だけ小さく見えて
 * いた（○も△□より小さく見えていた）。図形で描けば、線と塗り、3つの形の大きさが
 * そろう。白を選んでいるときは、背景と同化しないよう暗い縁を付ける（DrawingCanvas.tsxの
 * needsWhiteOutlineと同じ考え方。314章ではtextShadowで近似していたが、図形なら本当の縁が描ける）。
 */
function ShapeIcon({ shape, filled, color }: { shape: DrawingShapeTool; filled: boolean; color: string }) {
  const S = 28;
  const sw = 2.2;
  const isWhite = color === "#FFFFFF";
  const edge = isWhite ? theme.colors.neutralTextPrimary : color;
  const fill = filled ? color : "none";
  // 線でも塗りでも同じ太さの縁を付け、外側の大きさを完全にそろえる。
  const common = { stroke: edge, strokeWidth: sw, fill };
  return (
    <Svg width={S} height={S} viewBox={`0 0 ${S} ${S}`}>
      {shape === "circle" && <Circle cx={S / 2} cy={S / 2} r={S / 2 - sw} {...common} />}
      {shape === "triangle" && <Polygon points={`${S / 2},${sw} ${S - sw},${S - sw} ${sw},${S - sw}`} strokeLinejoin="round" {...common} />}
      {shape === "rect" && <Rect x={sw} y={sw} width={S - sw * 2} height={S - sw * 2} {...common} />}
    </Svg>
  );
}

interface DrawingToolPickerProps {
  tone: Tone;
  selected: DrawingTool;
  onSelect: (tool: DrawingTool) => void;
  /**
   * [2026-09-27追加・実装メモ.md 313章] 現在選んでいる形の中を塗るかどうか。
   * `selected==="pen"`のときは意味を持たない。
   */
  filled: boolean;
  onToggleFilled: () => void;
  /** [2026-09-27追加・実装メモ.md 314章] 記号の表示色（今選んでいる描画色）。 */
  color: string;
  /**
   * [2026-09-27追加・実装メモ.md 314章]「もう一度押すと塗れる」の初回案内を
   * 端末に記録するためのmemberId（`src/lib/introSeen.ts`と同じ考え方）。
   */
  memberId: string;
  disabled?: boolean;
}

export function DrawingToolPicker({
  tone,
  selected,
  onSelect,
  filled,
  onToggleFilled,
  color,
  memberId,
  disabled = false,
}: DrawingToolPickerProps) {
  const tap = theme.drawingLimits.swatchSize; // 10色パレット・太さ選択と同じ56dp（役割を問わず統一）
  const labels = TOOL_ACCESSIBILITY_LABELS[tone];
  const fillSuffixes = FILL_STATE_ACCESSIBILITY_SUFFIX[tone];
  const needsWhiteOutline = color === "#FFFFFF";

  /**
   * [2026-09-27追加・実装メモ.md 314章] 初めて形（ペン以外）を選んだときだけ、
   * 数秒だけ「もう一度押すと塗れる」を出す。`src/lib/introSeen.ts`の
   * `{kind:"drawingFillToggle"}`にmemberIdごとの記録を1回だけ書く（以後は
   * `DrawingBoard`・`AvatarDrawingPanel`のどちらで開いても出ない）。
   */
  const [hintVisible, setHintVisible] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void hydrateIntroSeen({ kind: "drawingFillToggle" }, memberId);
  }, [memberId]);

  useEffect(
    () => () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    },
    []
  );

  const handlePress = (t: DrawingTool) => {
    // [314章決定1、2026-09-27・315章で"move"を対象外に拡張]
    // 選んでいる形（circle/triangle/rect）をもう一度押したら、線／塗りの切り替え。
    // "move"には塗りの概念が無いため、もう一度押しても選択し直すだけ（何も切り替わらない）。
    if (isDrawingShapeTool(t) && t === selected) {
      onToggleFilled();
      return;
    }
    onSelect(t);
    // [315章] 「もう一度押すと塗れる」の初回案内も、形の3種類にのみ出す（"move"には出さない）。
    if (isDrawingShapeTool(t) && !isIntroSeen({ kind: "drawingFillToggle" }, memberId)) {
      void markIntroSeen({ kind: "drawingFillToggle" }, memberId);
      setHintVisible(true);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => setHintVisible(false), FIRST_SHAPE_HINT_DURATION_MS);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {TOOL_ORDER.map((t) => {
          const isSelectedShape = isDrawingShapeTool(t) && t === selected;
          const symbol = isSelectedShape && filled ? FILLED_SYMBOLS[t] : TOOL_SYMBOLS[t];
          const label = isSelectedShape ? labels[t] + (filled ? fillSuffixes.filled : fillSuffixes.outline) : labels[t];
          return (
            <Pressable
              key={t}
              disabled={disabled}
              onPress={() => handlePress(t)}
              accessibilityRole="button"
              accessibilityLabel={label}
              style={[
                styles.tap,
                { width: tap, height: tap },
                selected === t && styles.tapSelected,
                disabled && styles.tapDisabled,
              ]}
            >
              {/* [315章] "move"（✋）はペンと同じくTextにUnicode記号を描くだけ（SVG化しない、
                  ファイル冒頭コメント参照）。 */}
              {t === "pen" || t === "move" ? (
                <Text
                  style={[
                    styles.symbol,
                    { color },
                    needsWhiteOutline && styles.symbolWhiteOutline,
                  ]}
                >
                  {symbol}
                </Text>
              ) : (
                <ShapeIcon shape={t} filled={isSelectedShape && filled} color={color} />
              )}
            </Pressable>
          );
        })}
      </View>
      {/* [314章決定4] 行を増やさないよう、絶対配置で下に重ねて数秒だけ出す
          （レイアウトの高さには影響しない）。 */}
      {hintVisible && (
        <View style={styles.hintWrap} pointerEvents="none">
          <Text style={styles.hintText}>{FIRST_SHAPE_HINT_TEXT[tone]}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
  },
  row: {
    flexDirection: "row",
    // [2026-09-27追加・315章] 5個目のボタン追加でこの行の必要幅が
    // 56×5+12×4=328dpになった（10色パレット・DrawingPalette.tsxが既に採用している
    // 312dp=56×5+8×4より少し広い）。既存の並び（4個・260dp）は今までどおり
    // 1行に収まるが、念のため`flexWrap`を足し、極端に狭い画面でも折り返しで
    // ボタンが画面外に切れて押せなくなることを防ぐ（新しい行を意図的に増やす
    // ものではなく、収まらない場合だけの保険。DrawingPalette.tsxと同じ考え方）。
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing.s3,
    rowGap: theme.spacing.s2,
  },
  tap: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.parentMd,
    borderWidth: 2,
    borderColor: "transparent",
  },
  tapSelected: {
    borderColor: theme.colors.brandPrimary,
  },
  tapDisabled: {
    opacity: 0.4,
  },
  symbol: {
    fontSize: 26,
    lineHeight: 30,
  },
  // [314章決定3] Textにはストローク（縁取り線）を描く手段が無いため、textShadowで
  // 暗い縁のにじみを作る近似実装（DrawingCanvas.tsxのneedsWhiteOutlineと同じ狙い）。
  symbolWhiteOutline: {
    textShadowColor: theme.colors.neutralTextPrimary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  // [2026-09-27修正・統括の実機報告「色のボタンの裏に出ていた」] 行の下に出すと、
  // 後から並ぶ色のボタンが上に重なって隠れていた（あとの要素ほど上に描かれるため）。
  // 行の上（キャンバスの下端側）に出す。キャンバスはこの部品より前に並ぶので隠れない。
  // 念のため zIndex・elevation も付ける。
  hintWrap: {
    position: "absolute",
    bottom: theme.drawingLimits.swatchSize + theme.spacing.s2,
    zIndex: 10,
    elevation: 10,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  hintText: {
    backgroundColor: theme.colors.neutralSurface,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    color: theme.colors.neutralTextSecondary,
    textAlign: "center",
  },
});

export default DrawingToolPicker;
