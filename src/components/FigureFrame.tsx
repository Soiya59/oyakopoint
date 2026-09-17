/**
 * フィギュア専用の五角形（旗型）の枠（主要画面ワイヤーフレーム.md 49.2章決定3）。
 *
 * 「メダルは円形の枠（07-19-9a章）・フィギュアは五角形の枠」という統括決定への
 * 対応。メダル側の`StickerIcon.tsx`・木の`FreeStickerView`（src/components/
 * FamilyTree.tsx）・`PrizeDotView`は一切変更せず（メダルのコード改変を避ける、
 * ワイヤーフレーム49.14章開発部への申し送り(3)）、新しい独立したコンポーネントとして
 * 実装する。
 *
 * 実装方法: React Nativeの`borderRadius`は円・角丸四角形しか表現できないため、
 * `react-native-svg`の`Polygon`で正五角形の輪郭を描き、その中央に絵柄
 * （`FigureIcon`等の子要素）を重ねる。既存の色トークンは1つも追加しない
 * （枠線の色は呼び出し元が渡す`ringColor`＝本人のavatar_colorをそのまま使う、
 * メダルの識別リングと同じ考え方）。
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Polygon } from "react-native-svg";
import theme from "@/theme/theme";

/** 正五角形（点が真上）の頂点座標をSVG Polygon用の文字列にする。 */
function pentagonPoints(size: number, strokeWidth: number): string {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - strokeWidth;
  const points: string[] = [];
  for (let i = 0; i < 5; i++) {
    const angleDeg = -90 + i * 72;
    const angleRad = (angleDeg * Math.PI) / 180;
    const x = cx + r * Math.cos(angleRad);
    const y = cy + r * Math.sin(angleRad);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

export interface FigureFrameProps {
  size: number;
  /** 枠線の色（本人のavatar_color。メダルの識別リングと同じ役割）。 */
  ringColor?: string | null;
  strokeWidth?: number;
  children: React.ReactNode;
}

export function FigureFrame({ size, ringColor, strokeWidth = 2, children }: FigureFrameProps) {
  const color = ringColor ?? theme.colors.neutralBorder;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={StyleSheet.absoluteFill}>
        <Svg width={size} height={size}>
          <Polygon
            points={pentagonPoints(size, strokeWidth)}
            fill={theme.colors.neutralSurface}
            stroke={color}
            strokeWidth={strokeWidth}
          />
        </Svg>
      </View>
      <View style={{ width: size * 0.62, height: size * 0.62, alignItems: "center", justifyContent: "center" }}>
        {children}
      </View>
    </View>
  );
}

export default FigureFrame;
