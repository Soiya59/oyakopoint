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
 * 形（○／△／□）の中を塗れるようにする依頼。ボタンの並べ方は依頼文が挙げた
 * 二択（(a)塗った形専用のボタン「●▲■」を3つ足して7ボタンにする／(b)形のボタンに
 * 「線／塗り」の切り替えを1つ足す）のうち、**(b)を選んだ**。理由：56dpのタップ領域
 * ×7個は横幅を圧迫する（現状4個でも中央寄せいっぱいのため）一方、塗りは「今選んで
 * いる形の中身をどう見せるか」という直交した1つの状態にすぎず、5個目のボタン1つに
 * 閉じ込めるほうがシンプル。このトグルボタンは、今選んでいる形（`selected`）に応じて
 * 見た目の記号（○/●・△/▲・□/■）を動的に切り替える。`selected==="pen"`のときは
 * 塗りの概念が無いため無効化し、色・太さピッカーの`disabled`表示と同じ見た目
 * （`tapDisabled`、不透明度を落とす）にする。
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import theme from "@/theme/theme";
import type { DrawingTool } from "@/lib/drawingShapes";

type Tone = "parent" | "child" | "supporter";

const TOOL_ORDER: readonly DrawingTool[] = ["pen", "circle", "triangle", "rect"];

const TOOL_SYMBOLS: Record<DrawingTool, string> = {
  pen: "✏",
  circle: "○",
  triangle: "△",
  rect: "□",
};

/**
 * [2026-09-27追加・実装メモ.md 313章] 塗った形の記号（依頼文の指定どおり
 * ● U+25CF・▲ U+25B2・■ U+25A0）。`"pen"`には塗りの概念が無いため含まない。
 */
const FILLED_SYMBOLS: Record<Exclude<DrawingTool, "pen">, string> = {
  circle: "●",
  triangle: "▲",
  rect: "■",
};

/** accessibilityLabel専用（画面には表示しない）。DrawingZoomPicker.tsxのZOOM_LABELSと同じ考え方。 */
const TOOL_ACCESSIBILITY_LABELS: Record<Tone, Record<DrawingTool, string>> = {
  child: { pen: "ふで", circle: "まる", triangle: "さんかく", rect: "しかく" },
  parent: { pen: "ペン", circle: "丸", triangle: "三角", rect: "四角" },
  supporter: { pen: "ペン", circle: "丸", triangle: "三角", rect: "四角" },
};

/**
 * [2026-09-27追加・実装メモ.md 313章] 塗り切り替えボタンのaccessibilityLabel。
 * `unavailable`は`selected==="pen"`（塗りの概念が無い）ときに使う。
 */
const FILL_TOGGLE_ACCESSIBILITY_LABELS: Record<Tone, { filled: string; outline: string; unavailable: string }> = {
  child: { filled: "ぬりつぶし", outline: "せんだけ", unavailable: "かたちを えらぶと つかえるよ" },
  parent: { filled: "塗りつぶし", outline: "線のみ", unavailable: "形を選ぶと使えます" },
  supporter: { filled: "塗りつぶし", outline: "線のみ", unavailable: "形を選ぶと使えます" },
};

interface DrawingToolPickerProps {
  tone: Tone;
  selected: DrawingTool;
  onSelect: (tool: DrawingTool) => void;
  /**
   * [2026-09-27追加・実装メモ.md 313章] 現在選んでいる形の中を塗るかどうか。
   * `selected==="pen"`のときは意味を持たない（トグルボタンを無効化する）。
   */
  filled: boolean;
  onToggleFilled: () => void;
  disabled?: boolean;
}

export function DrawingToolPicker({
  tone,
  selected,
  onSelect,
  filled,
  onToggleFilled,
  disabled = false,
}: DrawingToolPickerProps) {
  const tap = theme.drawingLimits.swatchSize; // 10色パレット・太さ選択と同じ56dp（役割を問わず統一）
  const labels = TOOL_ACCESSIBILITY_LABELS[tone];
  const fillLabels = FILL_TOGGLE_ACCESSIBILITY_LABELS[tone];
  // [313章決定] ペンには塗りの概念が無いため、選んでいる道具が形（ペン以外）の
  // ときだけ塗り切り替えボタンを有効にする。
  const isShapeSelected = selected !== "pen";
  const fillToggleSymbol = isShapeSelected
    ? filled
      ? FILLED_SYMBOLS[selected]
      : TOOL_SYMBOLS[selected]
    : TOOL_SYMBOLS.circle; // ペン選択中は無効化された状態の輪郭○をプレースホルダとして出す
  const fillToggleDisabled = disabled || !isShapeSelected;
  const fillToggleLabel = !isShapeSelected
    ? fillLabels.unavailable
    : filled
    ? fillLabels.filled
    : fillLabels.outline;
  return (
    <View style={styles.row}>
      {TOOL_ORDER.map((t) => (
        <Pressable
          key={t}
          disabled={disabled}
          onPress={() => onSelect(t)}
          accessibilityRole="button"
          accessibilityLabel={labels[t]}
          style={[
            styles.tap,
            { width: tap, height: tap },
            selected === t && styles.tapSelected,
            disabled && styles.tapDisabled,
          ]}
        >
          <Text style={styles.symbol}>{TOOL_SYMBOLS[t]}</Text>
        </Pressable>
      ))}
      <Pressable
        disabled={fillToggleDisabled}
        onPress={onToggleFilled}
        accessibilityRole="button"
        accessibilityLabel={fillToggleLabel}
        style={[
          styles.tap,
          { width: tap, height: tap },
          isShapeSelected && filled && styles.tapSelected,
          fillToggleDisabled && styles.tapDisabled,
        ]}
      >
        <Text style={styles.symbol}>{fillToggleSymbol}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing.s3,
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
    color: theme.colors.neutralTextPrimary,
  },
});

export default DrawingToolPicker;
