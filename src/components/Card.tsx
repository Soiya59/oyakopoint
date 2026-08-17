import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import theme from "@/theme/theme";

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  tone?: "parent" | "child";
}

export function Card({ children, style, tone = "parent" }: CardProps) {
  return (
    <View
      style={[
        styles.base,
        {
          borderRadius: tone === "child" ? theme.radius.childXl : theme.radius.parentLg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: theme.colors.neutralSurface,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    padding: theme.spacing.s4,
  },
});

export default Card;
