import React from "react";
import { ScrollView, StyleSheet, View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import theme from "@/theme/theme";

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  tone?: "parent" | "child";
  style?: ViewStyle;
  contentStyle?: ViewStyle;
}

/**
 * 全画面共通のコンテナ。
 * tone="child" のときは背景をbrand-primary-soft寄りにして「賑やかさ」を出す
 * （デザイントークン.md 1.5「保護者向け/子ども向けのトーン分け方針」）。
 */
export function Screen({ children, scroll = true, tone = "parent", style, contentStyle }: ScreenProps) {
  const bg = tone === "child" ? theme.colors.brandPrimarySoft : theme.colors.neutralBg;
  const Container = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }, style]} edges={["top", "left", "right"]}>
      <Container
        style={scroll ? styles.scroll : styles.flex}
        contentContainerStyle={scroll ? [styles.content, contentStyle] : undefined}
      >
        {!scroll ? <View style={[styles.content, styles.flex, contentStyle]}>{children}</View> : children}
      </Container>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    padding: theme.spacing.s4,
    paddingBottom: theme.spacing.s8,
  },
});

export default Screen;
