import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from "react-native";
import theme from "@/theme/theme";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Tone = "parent" | "child" | "supporter";

interface AppButtonProps {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  tone?: Tone;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  /**
   * [2026-09-29追加・実装メモ.md 328章、本部長依頼・軽微変更ルート]
   * ラベルの折り返し・縮小を制御する。3つとも省略時は今までどおり
   * （制限なし・縮小なし）で、既存の呼び出し元の見た目は一切変わらない。
   * 横に並べて縮む可能性がある行（例: `DrawingBoard.tsx`の「ひとつ もどす／
   * ぜんぶけす／保存する」）でのみ明示的に指定する。
   */
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
}

/**
 * 汎用ボタン。tone="child" の場合はタップ領域56dp以上・radius-xl・太字を適用
 * （デザイントークン.md 3章「タップターゲット」「角丸」）。
 * variant="danger" は家族削除等の真に不可逆な操作に使う赤系（statusBlocking）。
 * [変更] 2026-08-15改訂: 旧variant="retry"（差し戻し用オレンジ系）は、承認フロー廃止に
 * 伴いstatusRetryトークン自体が削除されたため廃止した（デザイントークン.md 1.4節参照）。
 * 保護者のリアクション（スタンプ／コメント）はbrandPrimary系の達成色で表現するため、
 * 専用variantを設けず既存のprimary/secondaryをそのまま使う。
 */
export function AppButton({
  label,
  onPress,
  variant = "primary",
  tone = "parent",
  disabled,
  loading,
  fullWidth,
  style,
  numberOfLines,
  adjustsFontSizeToFit,
  minimumFontScale,
}: AppButtonProps) {
  const isChild = tone === "child";
  // [2026-08-22追加] tone="supporter"（デザイントークン.md 1.7節）。primaryボタンは
  // 差し色のsupporterAccentを使い、タップ領域も48dp以上を推奨値どおり確保する。
  const isSupporter = tone === "supporter";
  const bg =
    variant === "primary"
      ? isSupporter
        ? theme.colors.supporterAccent
        : theme.colors.brandPrimary
      : variant === "danger"
      ? theme.colors.statusBlocking
      : variant === "secondary"
      ? theme.colors.neutralSurface
      : "transparent";
  const borderColor =
    variant === "secondary" ? theme.colors.neutralBorder : "transparent";
  const textColor =
    variant === "secondary" || variant === "ghost"
      ? theme.colors.neutralTextPrimary
      : "#FFFFFF";

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: bg,
          borderWidth: variant === "secondary" ? 1 : 0,
          borderColor,
          minHeight: isChild
            ? theme.tapTarget.child
            : isSupporter
            ? theme.tapTarget.supporterPrimary
            : theme.tapTarget.parent,
          borderRadius: isChild ? theme.radius.childXl : theme.radius.parentMd,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          width: fullWidth ? "100%" : undefined,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text
          style={[
            isChild
              ? theme.typography.childButton
              : isSupporter
              ? theme.typography.supporterBodyMedium
              : theme.typography.parentBodyMedium,
            { color: textColor, textAlign: "center" },
          ]}
          numberOfLines={numberOfLines}
          adjustsFontSizeToFit={adjustsFontSizeToFit}
          minimumFontScale={minimumFontScale}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: theme.spacing.s4,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default AppButton;
