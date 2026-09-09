import React from "react";
import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import theme from "@/theme/theme";

/**
 * みまもりメンバー向け下部タブ: [👨‍👩‍👧‍👦かぞく] [🌟じぶん]
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 35章
 * （35.1節「区画の最終決定」・35.9節「みまもりメンバーから先に導入する」）
 *
 * [2026-09-09追加・実装メモ.md 182章] S1みまもりホーム廃止に伴うタブ化第1弾。
 * `app/child/(tabs)/_layout.tsx`と同じ実装パターン（expo-routerの`(tabs)`
 * ルートグループ）をそのまま踏襲する（本部長指示「新しい仕組みを持ち込まない」）。
 * タブ数はみまもりメンバーには「かんり」区画が無いため2つ（35.4節末尾
 * 「かんり区画はみまもりメンバーには存在しない」）。
 *
 * タブアイコンは35.12節のとおり4章の既存絵文字を再利用し、新しい絵・色は追加しない
 * （👨‍👩‍👧‍👦＝旧P14「家族」タイルで既出、🌟＝ポイント表示で既出）。
 */
export default function SupporterTabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.supporterAccent,
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
        tabBarActiveBackgroundColor: theme.colors.supporterAccentSoft,
      }}
    >
      {/* 決定2（35.1節）: 起動後・ログイン後に最初に開くタブは「かぞく」。
          Tabsは最初に列挙したScreenを初期タブとして扱う（子どもの(tabs)と同じ挙動）。 */}
      <Tabs.Screen
        name="family"
        options={{
          title: "かぞく",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>👨‍👩‍👧‍👦</Text>,
        }}
      />
      <Tabs.Screen
        name="self"
        options={{
          title: "じぶん",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>🌟</Text>,
        }}
      />
    </Tabs>
  );
}
