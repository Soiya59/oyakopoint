/**
 * 下部タブの1マス分のボタン。**選択中であることを、文字色だけでなく
 * 「淡い背景」と「下線」でも示す。**
 *
 * [2026-09-09新設・本部長／軽微変更ルート] 統括の実機確認
 * 「したのタブだけど選択していることがもっとわかりやすくしてほしい。
 * 添付のように下線か、軽く色付けしてほしい」。
 *
 * それまでの子ども（C5〜C8）・みまもり（かぞく／じぶん）のタブは、選択中かどうかを
 * `tabBarActiveTintColor` による**文字とアイコンの色の違いだけ**で表していた。
 * 絵文字アイコンは色が変わらないため、実質は12pxのラベルの色だけが手がかりで、
 * 弱かった。統括の例示（下線）に加えて淡い背景も足し、2つの手がかりで示す。
 *
 * [実装の注意] React Navigationの`tabBarButton`は、押下処理・アクセシビリティ・
 * Web版のhrefをすべてpropsで渡してくる。**必ず全部そのまま展開すること。**
 * 選択中かどうかは`accessibilityState.selected`で判定する（`focused`という
 * propは渡ってこない）。
 */
import React from "react";
import { Pressable, View, type PressableProps } from "react-native";
import theme from "@/theme/theme";

type TabBarButtonProps = PressableProps & {
  accessibilityState?: { selected?: boolean };
  children?: React.ReactNode;
};

/** 下線・淡い背景に使う色を、ロールごとに差し替えられるようにする。 */
export function createTabBarButton(activeColor: string, softColor: string) {
  return function TabBarButton({ children, style, ...rest }: TabBarButtonProps) {
    const selected = rest.accessibilityState?.selected === true;
    return (
      <Pressable
        {...rest}
        style={[{ flex: 1, alignItems: "stretch", justifyContent: "flex-end" }, style as object]}
      >
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            marginHorizontal: theme.spacing.s2,
            borderRadius: theme.radius.parentMd,
            backgroundColor: selected ? softColor : "transparent",
          }}
        >
          {children}
        </View>
        {/* 下線。選択していないときも同じ高さの透明な帯を置いて、
            選択の切り替えで上下にずれないようにする。 */}
        <View
          style={{
            height: 3,
            marginHorizontal: theme.spacing.s4,
            borderRadius: 2,
            backgroundColor: selected ? activeColor : "transparent",
          }}
        />
      </Pressable>
    );
  };
}

export default createTabBarButton;
