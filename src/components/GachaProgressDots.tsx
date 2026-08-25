/**
 * ガチャ「あと◯回」の5コマ表示（プレート）。くら寿司「ビッくらポン」の皿を
 * 数える感覚の再現（デザイントークン.md 1.10節、主要画面ワイヤーフレーム.md 21.1節）。
 * ホームウィジェット（GachaHomeWidget）・ガチャ画面（GachaDrawPanel）の両方で使う
 * 共通部品。
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import theme from "@/theme/theme";

interface GachaProgressDotsProps {
  /** あと何回で引けるか（0〜5）。0なら5コマ全て埋まる。 */
  remaining: number;
  /** プレート1コマの直径（pt）。デザイントークン.md 1.10節: 子ども20pt／保護者・みまもり14pt。 */
  size?: number;
}

export function GachaProgressDots({ remaining, size = theme.gachaPlateSize.parent }: GachaProgressDotsProps) {
  const filled = Math.max(0, Math.min(5, 5 - remaining));
  return (
    <View style={styles.row}>
      {Array.from({ length: 5 }).map((_, i) => {
        const isFilled = i < filled;
        return (
          <View
            key={i}
            style={[
              {
                width: size,
                height: size,
                borderRadius: size / 2,
              },
              isFilled
                ? { backgroundColor: theme.gachaColors.accent }
                : { backgroundColor: "transparent", borderWidth: 1.5, borderColor: theme.colors.neutralBorder },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: theme.spacing.s1 },
});

export default GachaProgressDots;
