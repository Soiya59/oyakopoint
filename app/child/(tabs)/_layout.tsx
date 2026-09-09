import React from "react";
import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import theme from "@/theme/theme";

/**
 * 子ども向け下部タブ: [🏠やる] [📅きろく] [💰つうちょう] [🎁ごほうび]
 * 参照: 主要画面ワイヤーフレーム.md 1章 C5ワイヤーフレーム、画面一覧・遷移図.md 3.5章
 *
 * [2026-08-15追加] 実施履歴カレンダー（C15、要件定義書07-3章）への導線として
 * 「きろく」タブを追加した（画面一覧・遷移図.md 3.5章「下部タブは[🏠やる][📅きろく]
 * [💰つうちょう][🎁ごほうび]の4つに拡張する」）。下部タブアイコンは📅で固定し、
 * 他の絵文字（🎉等の達成系）と混同しないようにする（デザイントークン.md 4章）。
 *
 * [2026-08-22修正・本部長] tabBarStyleの高さ・paddingBottomを固定値にしていたため、
 * ホームインジケーター/ジェスチャーバーのある実機（iPhone X以降・Android等）で
 * タブバーのラベル（「やる」「きろく」等）がその領域と重なり見切れる、と
 * ユーザーが実機で発見した。Screen.tsx側はedges=["top","left","right"]でbottomの
 * safe areaを意図的に含めていない（スクロール領域を圧迫しないため）ため、
 * タブバー自体でuseSafeAreaInsets().bottomを高さ・paddingに加算するよう修正した。
 *
 * [2026-08-22追加修正・本部長] 上記対応後も「絵文字の下の文字が5分の1くらい途切れる」
 * と実機で再現した。height・paddingBottomの両方にinsets.bottomを加算していたため
 * 打ち消し合い、アイコン+ラベルに使える実質の高さ（height-paddingTop-paddingBottom）は
 * 従来の64pxのときから50pxのまま変わっておらず、実機のフォント描画では
 * この50pxがアイコン(fontSize20の絵文字)+ラベル(fontSize12)にそもそも不足していた
 * ことが真因だった（PCブラウザでの検証では余裕があり再現しなかった）。
 * ベースの高さを64→80に増やして実質の高さを66pxに広げ、ラベルにも明示的な
 * lineHeightを指定して端末ごとのフォント行高のばらつきで再び詰まらないようにした。
 */
export default function ChildTabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brandPrimaryStrong,
        tabBarInactiveTintColor: theme.colors.neutralTextSecondary,
        tabBarStyle: {
          backgroundColor: theme.colors.neutralSurface,
          height: 80 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700", lineHeight: 16 },
        // [2026-09-09追加・本部長／軽微変更ルート] 統括の実機確認「選択していることが
        // もっとわかりやすくしてほしい」。従来はtabBarActiveTintColorによる色の違い
        // だけで、**絵文字アイコンは色が変わらない**ため実質12pxのラベルの色だけが
        // 手がかりだった。
        //
        // **React Navigationの組み込みオプションを使う。自作のtabBarButtonは使わない。**
        // 一度は自作の部品で「下線＋背景」を入れたが（`1d73014`）、下線用の3pxの帯を
        // 足したことでタブの高さ（80 + 端末の下余白）に収まらなくなり、**中身が下へ
        // 押し出されて見えなくなった**（統括の実機報告により`ed9cc49`で撤回）。
        // 型チェックもlintも通り、ビルドも成功していた。**見た目は実機でしか分からない。**
        // 統括判断により、高さを一切変えない「背景の色付けだけ」にした。
        tabBarActiveBackgroundColor: theme.colors.brandPrimarySoft,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "やる",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20 }}>🏠</Text>,
        }}
      />
      {/* [2026-09-08・統括指示] タブの並びを「やる→ごほうび→きろく→つうちょう」に変更。
          従来は「やる→きろく→つうちょう→ごほうび」で、毎日使う「ごほうび」が
          いちばん端にあった。使う頻度の順に並べ直したもの。 */}
      <Tabs.Screen
        name="rewards"
        options={{
          title: "ごほうび",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>🎁</Text>,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "きろく",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>📅</Text>,
        }}
      />
      <Tabs.Screen
        name="points"
        options={{
          title: "つうちょう",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>💰</Text>,
        }}
      />
    </Tabs>
  );
}
