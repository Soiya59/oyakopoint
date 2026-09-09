import React from "react";
import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import theme from "@/theme/theme";
import { createTabBarButton } from "@/components/TabBarButton";

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
        // [2026-09-09追加・本部長／軽微変更ルート] 子どものタブと同じ理由・同じ部品。
        // 詳細は src/components/TabBarButton.tsx のコメント参照。
        tabBarButton: createTabBarButton(theme.colors.supporterAccent, theme.colors.supporterAccentSoft),
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
