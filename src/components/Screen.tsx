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
 *
 * [2026-08-20修正・本部長] PCの広いブラウザ幅（LAN内Web版・GitHub Pages版とも）で
 * 開くと、上限幅が無いためカード等が画面いっぱいに間延びして見にくいとユーザーが
 * 実機（PCブラウザ）で発見した。スマホ幅で収まるmaxWidthの内側コンテナを設け、
 * それより広い画面では中央寄せする。中央寄せはouter側のalignItems: "center"で
 * 行う必要があり、内側のcontentにalignSelf: "center"を置くだけでは
 * （左上に寄ったまま幅だけ制限される形になり）効かないため、two-layer構成にした。
 * スマホ実機での見え方はwidth:100%のため変化しない。
 */
export function Screen({ children, scroll = true, tone = "parent", style, contentStyle }: ScreenProps) {
  const bg = tone === "child" ? theme.colors.brandPrimarySoft : theme.colors.neutralBg;
  const Container = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }, style]} edges={["top", "left", "right"]}>
      <Container
        style={scroll ? styles.scroll : [styles.flex, styles.outer]}
        contentContainerStyle={scroll ? styles.scrollOuter : undefined}
      >
        <View style={[styles.content, !scroll && styles.flex, contentStyle]}>{children}</View>
      </Container>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flex: 1 },
  outer: { alignItems: "center" },
  scrollOuter: { flexGrow: 1, alignItems: "center" },
  content: {
    width: "100%",
    maxWidth: 480,
    padding: theme.spacing.s4,
    paddingBottom: theme.spacing.s8,
  },
});

export default Screen;
