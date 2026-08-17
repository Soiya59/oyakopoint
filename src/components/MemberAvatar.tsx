import React from "react";
import { StyleSheet, Text, View } from "react-native";
import theme from "@/theme/theme";

interface MemberAvatarProps {
  name: string;
  color?: string | null;
  size?: number;
  emoji?: string;
}

/**
 * 色付き丸アイコン＋イニシャル/絵文字でメンバーを識別する表現
 * （デザイントークン.md 1.3。family-todoの表現を継承）。
 */
export function MemberAvatar({ name, color, size = 40, emoji }: MemberAvatarProps) {
  const initial = name.trim().slice(0, 1) || "?";
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color ?? theme.colors.neutralBorder,
        },
      ]}
    >
      <Text style={{ fontSize: size * 0.45, fontWeight: "700", color: theme.colors.neutralTextPrimary }}>
        {emoji ?? initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: "center",
    justifyContent: "center",
  },
});

export default MemberAvatar;
