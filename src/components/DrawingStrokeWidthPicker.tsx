/**
 * お絵かきの線の太さ選択（デザイントークン.md「線の太さ（3段階）」、
 * 主要画面ワイヤーフレーム.md 21.5b節 決定22）。
 *
 * 10色パレット（DrawingPalette.tsx）と全く同じ考え方: 見出し・説明文は付けず
 * （決定22・決定31）、3ロール共通の単一コンポーネントとし、56dp四方のタップ領域を
 * 3つ横に並べる。見本の塗り色は選択中の描画色に連動させず常に固定のニュートラル色
 * （`color-neutral-text-primary`）にする（決定22）。選択状態はパレットと同じ
 * `color-brand-primary`の2pt枠で表現する。
 *
 * [2026-09-27変更・実装メモ.md 314章、本部長依頼・軽微変更ルート] 見本を塗りつぶし円
 * （●、旧`dotSize`）から横線バー（`theme.drawingStrokeWidths`の`barWidth`固定・
 * `barHeight`のみ太さで変える）に変更した。塗った形（313章、`DrawingToolPicker`の
 * ●▲■）が増えたことで、丸い見本のままだと「塗った丸」と混同しやすくなったため。
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import theme from "@/theme/theme";

interface DrawingStrokeWidthPickerProps {
  selected: number;
  onSelect: (width: number) => void;
  disabled?: boolean;
}

export function DrawingStrokeWidthPicker({ selected, onSelect, disabled = false }: DrawingStrokeWidthPickerProps) {
  const tap = theme.drawingLimits.swatchSize; // 1.9節と同じ56dp（役割を問わず統一）
  return (
    <View style={styles.row}>
      {theme.drawingStrokeWidths.map((w) => (
        <Pressable
          key={w.value}
          disabled={disabled}
          onPress={() => onSelect(w.value)}
          accessibilityRole="button"
          accessibilityLabel={w.label}
          style={[
            styles.tap,
            { width: tap, height: tap },
            selected === w.value && styles.tapSelected,
            disabled && styles.tapDisabled,
          ]}
        >
          <View
            style={[
              styles.bar,
              { width: w.barWidth, height: w.barHeight, borderRadius: w.barHeight / 2 },
            ]}
          />
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
  bar: {
    backgroundColor: theme.colors.neutralTextPrimary,
  },
});

export default DrawingStrokeWidthPicker;
