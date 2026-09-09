import React from "react";
import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import theme from "@/theme/theme";

/**
 * 保護者向け下部タブ: [👨‍👩‍👧‍👦かぞく] [🌟じぶん] [🌳木] [⚙️かんり]
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 35章（35.1節・35.9節）、
 * 実装メモ.md 187章
 *
 * [2026-09-10新規追加・実装メモ.md 187章] みまもりメンバーのタブ化第1弾
 * （実装メモ182・183・186章）を保護者へ広げたもの。`app/supporter/(tabs)/_layout.tsx`
 * と全く同じ構成（expo-routerの`(tabs)`ルートグループ、`Tabs`コンポーネント）を
 * そのまま踏襲した。**`tabBarStyle`・`tabBarActiveBackgroundColor`等、タブバー本体の
 * スタイルはみまもり実装からコピーし、自分で作り直していない**（実装メモ178・184章の
 * 教訓「見た目は実機でしか分からない、下部タブは一度壊した」を踏まえた指示どおり）。
 *
 * みまもりとの違いは2点のみ:
 * 1. 色を`supporterAccent`系ではなく`brandPrimaryStrong`／`brandPrimarySoft`系にした
 *    （`app/child/(tabs)/_layout.tsx`・旧`app/parent/home.tsx`のsectionHeadingが
 *    使っていた保護者向けの色をそのまま流用。新しい色は作っていない）。
 * 2. タブが3つではなく4つ（かぞく→じぶん→木→かんり）。みまもりは
 *    かぞく→じぶん→木の3つ（実装メモ186章で確定した並び。統括指示「かぞくじぶん木にして」）
 *    で、そこに保護者専用の「かんり」（クエスト管理・ごほうび管理・設定）を最後に
 *    足す形にした（本部長指示）。かんり区画はみまもりメンバーには存在しない
 *    （権限が無いため、35.4節）。
 *
 * ファイル名の対応関係（`/parent/family`が既存のP14「家族の管理」で使用済みのため、
 * かぞく・かんりタブは`family.tsx`ではなく`index.tsx`・`manage.tsx`にした）は
 * `app/parent/(tabs)/index.tsx`冒頭のコメント参照。
 */
export default function ParentTabsLayout() {
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
        // React Navigationの組み込みオプションを使う。自作のtabBarButtonは使わない
        // （実装メモ184章の教訓。`app/supporter/(tabs)/_layout.tsx`・
        // `app/child/(tabs)/_layout.tsx`と同じ理由・同じ書き方）。
        tabBarActiveBackgroundColor: theme.colors.brandPrimarySoft,
      }}
    >
      {/* Tabsは最初に列挙したScreenを初期タブとして扱う（子ども・みまもりの(tabs)と同じ挙動）。
          決定2（35.1節）「起動後・ログイン後に最初に開くタブは『かぞく』」のとおり。 */}
      <Tabs.Screen
        name="index"
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
      <Tabs.Screen
        name="tree"
        options={{
          title: "木",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>🌳</Text>,
        }}
      />
      <Tabs.Screen
        name="manage"
        options={{
          title: "かんり",
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>⚙️</Text>,
        }}
      />
    </Tabs>
  );
}
