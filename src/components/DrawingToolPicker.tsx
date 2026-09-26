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

/** accessibilityLabel専用（画面には表示しない）。DrawingZoomPicker.tsxのZOOM_LABELSと同じ考え方。 */
const TOOL_ACCESSIBILITY_LABELS: Record<Tone, Record<DrawingTool, string>> = {
  child: { pen: "ふで", circle: "まる", triangle: "さんかく", rect: "しかく" },
  parent: { pen: "ペン", circle: "丸", triangle: "三角", rect: "四角" },
  supporter: { pen: "ペン", circle: "丸", triangle: "三角", rect: "四角" },
};

interface DrawingToolPickerProps {
  tone: Tone;
  selected: DrawingTool;
  onSelect: (tool: DrawingTool) => void;
  disabled?: boolean;
}

export function DrawingToolPicker({ tone, selected, onSelect, disabled = false }: DrawingToolPickerProps) {
  const tap = theme.drawingLimits.swatchSize; // 10色パレット・太さ選択と同じ56dp（役割を問わず統一）
  const labels = TOOL_ACCESSIBILITY_LABELS[tone];
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
