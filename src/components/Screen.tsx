import React from "react";
import { ScrollView, StyleSheet, View, ViewStyle } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import theme from "@/theme/theme";

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  tone?: "parent" | "child" | "supporter";
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
  // tone="supporter"（デザイントークン.md 1.7節「neutralを基調にcolor-supporter-accentを
  // 差し色として使う」）は背景を保護者向けと同じneutralBgのままにし、差し色はボタン・見出し等
  // 個別コンポーネント側でsupporterAccentを使う設計とした（tone="child"のような全画面着色はしない）。
  const bg = tone === "child" ? theme.colors.brandPrimarySoft : theme.colors.neutralBg;
  const Container = scroll ? ScrollView : View;
  // [2026-09-02修正・本部長] 画面下端の余白が足りず、いちばん下の行が
  // 端末のナビゲーションバー（Androidのジェスチャーバー）に接していた。
  // 統括が家族の木の「週ごとのきろく」を実機で見て発見（8/3週の行が下端に
  // 貼り付いていた）。原因は2つあり、両方に対処する。
  //  (1) SafeAreaView の edges から "bottom" を意図的に外している
  //      （背景色を画面下端まで伸ばすため。この意図は維持する）ので、
  //      端末の下端インセットぶんの余白がどこにも入っていなかった
  //  (2) 固定の paddingBottom が s8（32）しかなく、行が詰まって見えた
  // (1) は useSafeAreaInsets() で明示的に足す。ただしWeb版（GitHub Pages を
  // Chrome で開く現在の運用）では env(safe-area-inset-bottom) が 0 を返すため
  // これだけでは解決せず、(2) の固定値も 32 → 64 に広げる。
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }, style]} edges={["top", "left", "right"]}>
      <Container
        style={scroll ? styles.scroll : [styles.flex, styles.outer]}
        contentContainerStyle={scroll ? styles.scrollOuter : undefined}
      >
        <View style={[styles.content, !scroll && styles.flex, { paddingBottom: BASE_BOTTOM_PADDING + insets.bottom }, contentStyle]}>{children}</View>
      </Container>
    </SafeAreaView>
  );
}

/** 画面下端の基本余白。端末の下端インセットをこれに足して使う（上のコメント参照）。 */
const BASE_BOTTOM_PADDING = theme.spacing.s8 * 2;

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
    // paddingBottom は描画時に BASE_BOTTOM_PADDING + 下端インセットで上書きする
  },
});

export default Screen;
