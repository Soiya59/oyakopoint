/**
 * お絵かき10色パレット（デザイントークン.md 1.9節）。
 * 5×2の格子・56dp四方以上のタップ領域（全ロール共通）。
 * [2026-09-07変更・実装メモ136章] 8色4×2→10色5×2（しろ・ちゃいろの追加、
 * 主要画面ワイヤーフレーム.md 21.5d節 決定36）。既存8色の位置（列1〜4）は
 * 変えず、各行の5列目に新色を追加しただけなので、並び順は
 * `theme.drawingPalette`の配列順のまま変えていない。
 * スワッチ56dp×5列＋列間8dp×4＝312dpとなる（決定36「画面幅への影響」）。
 */
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import theme from "@/theme/theme";

interface DrawingPaletteProps {
  selected: string;
  onSelect: (color: string) => void;
  disabled?: boolean;
}

const COLUMNS = 5;

export function DrawingPalette({ selected, onSelect, disabled = false }: DrawingPaletteProps) {
  const swatch = theme.drawingLimits.swatchSize;
  return (
    <View
      style={[
        styles.grid,
        { width: swatch * COLUMNS + theme.spacing.s2 * (COLUMNS - 1) },
      ]}
    >
      {theme.drawingPalette.map((c) => {
        // [2026-09-07追加・21.5d節 決定34] しろのスワッチは、未選択時も
        // `color-neutral-border`の輪郭線を常時表示する。背景（子ども向け
        // brandPrimarySoft、保護者・みまもりメンバー向けneutralBg）がいずれも
        // 白に極めて近く、他の9色と同じ`borderColor: "transparent"`のままだと
        // 未選択時に背景と同化し、10色中どこにしろがあるか一目で分からなくなる
        // ため。枠の太さ自体は他の9色と同じ3ptのまま、色のみ変える。選択時は
        // 他の9色と全く同じ規則で`color-brand-primary`の3pt枠に切り替わる。
        const isWhiteSwatch = c.value === "#FFFFFF";
        return (
          <Pressable
            key={c.value}
            disabled={disabled}
            onPress={() => onSelect(c.value)}
            accessibilityRole="button"
            accessibilityLabel={c.name}
            style={[
              styles.swatch,
              { width: swatch, height: swatch, backgroundColor: c.value },
              isWhiteSwatch && styles.swatchWhiteBorder,
              selected === c.value && styles.swatchSelected,
              disabled && styles.swatchDisabled,
            ]}
          />
        );
      })}
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
  // [2026-09-07追加・決定34] しろのみ、未選択時も薄い輪郭線を常時表示する。
  swatchWhiteBorder: {
    borderColor: theme.colors.neutralBorder,
  },
  swatchSelected: {
    borderColor: theme.colors.brandPrimary,
  },
  swatchDisabled: {
    opacity: 0.4,
  },
});

export default DrawingPalette;
