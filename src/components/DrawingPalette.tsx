/**
 * お絵かき8色パレット（デザイントークン.md 1.9節）。
 * 4×2の格子・56dp四方以上のタップ領域（全ロール共通、1行に8色を詰めると
 * タップ領域が確保できないため必ず2行×4列で配置する。1.9節「開発部への実装上の必須事項」）。
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import theme from "@/theme/theme";

interface DrawingPaletteProps {
  selected: string;
  onSelect: (color: string) => void;
  disabled?: boolean;
}

const COLUMNS = 4;

export function DrawingPalette({ selected, onSelect, disabled = false }: DrawingPaletteProps) {
  const swatch = theme.drawingLimits.swatchSize;
  return (
    <View
      style={[
        styles.grid,
        { width: swatch * COLUMNS + theme.spacing.s2 * (COLUMNS - 1) },
      ]}
    >
      {theme.drawingPalette.map((c) => (
        <Pressable
          key={c.value}
          disabled={disabled}
          onPress={() => onSelect(c.value)}
          accessibilityRole="button"
          accessibilityLabel={c.name}
          style={[
            styles.swatch,
            { width: swatch, height: swatch, backgroundColor: c.value },
            selected === c.value && styles.swatchSelected,
            disabled && styles.swatchDisabled,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignSelf: "center",
    rowGap: theme.spacing.s2,
  },
  swatch: {
    borderRadius: theme.radius.parentMd,
    borderWidth: 3,
    borderColor: "transparent",
  },
  swatchSelected: {
    borderColor: theme.colors.brandPrimary,
  },
  swatchDisabled: {
    opacity: 0.4,
  },
});

export default DrawingPalette;
