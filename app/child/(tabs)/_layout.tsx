import React from "react";
import { Tabs } from "expo-router";
import { Text } from "react-native";
import theme from "@/theme/theme";

/**
 * 子ども向け下部タブ: [🏠やる] [📅きろく] [💰つうちょう] [🎁ごほうび]
 * 参照: 主要画面ワイヤーフレーム.md 1章 C5ワイヤーフレーム、画面一覧・遷移図.md 3.5章
 *
 * [2026-08-15追加] 実施履歴カレンダー（C15、要件定義書07-3章）への導線として
 * 「きろく」タブを追加した（画面一覧・遷移図.md 3.5章「下部タブは[🏠やる][📅きろく]
 * [💰つうちょう][🎁ごほうび]の4つに拡張する」）。下部タブアイコンは📅で固定し、
 * 他の絵文字（🎉等の達成系）と混同しないようにする（デザイントークン.md 4章）。
 */
export default function ChildTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brandPrimaryStrong,
        tabBarInactiveTintColor: theme.colors.neutralTextSecondary,
        tabBarStyle: { backgroundColor: theme.colors.neutralSurface, height: 64, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "やる",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 20 }}>🏠</Text>,
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
      <Tabs.Screen
        name="rewards"
        options={{
          title: "ごほうび",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>🎁</Text>,
        }}
      />
    </Tabs>
  );
}
