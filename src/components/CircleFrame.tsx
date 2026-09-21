/**
 * [2026-09-21新設・要件定義書07-34章「メダルとフィギュアの入れ替え」、主要画面
 * ワイヤーフレーム.md 62.5節「結線の入れ替え」対応]
 * 円形の枠（識別リング付き、`FamilyTree.tsx`の`styles.prizeDot`と同じ考え方）を、
 * `FigureFrame.tsx`と対になる独立コンポーネントとして切り出したもの。
 *
 * 入れ替え前は「円形＝メダル（sticker_catalog）・五角形＝フィギュア
 * （habit_figure_catalog）」だったが、入れ替え後は「円形＝メダル
 * （habit_figure_catalog）・五角形＝フィギュア（sticker_catalog）」に据え置き
 * つつ、円形の枠に渡すデータだけが変わる（`FigureFrame.tsx`4行目のコメント、
 * 主要画面ワイヤーフレーム.md 62.5節）。`FamilyTree.tsx`の`styles.prizeDot`は
 * 既存の景品・自由配置ステッカー表示専用のまま変更せず、コレクション棚・
 * シール帳の絵柄選び直し画面など複数箇所で円形の枠を再利用できるよう、
 * `FigureFrame`と同じ`size`/`ringColor`/`children`のAPIで独立コンポーネント化した。
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import theme from "@/theme/theme";

export interface CircleFrameProps {
  size: number;
  /** 枠線の色（本人のavatar_color。`FigureFrame`のringColorと同じ役割）。 */
  ringColor?: string | null;
  strokeWidth?: number;
  children: React.ReactNode;
}

export function CircleFrame({ size, ringColor, strokeWidth = 2, children }: CircleFrameProps) {
  const color = ringColor ?? theme.colors.neutralBorder;
  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: strokeWidth,
          borderColor: color,
        },
      ]}
    >
      <View style={{ width: size * 0.62, height: size * 0.62, alignItems: "center", justifyContent: "center" }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.neutralSurface,
    overflow: "hidden",
  },
});

export default CircleFrame;
