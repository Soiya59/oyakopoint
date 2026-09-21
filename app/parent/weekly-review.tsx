import React from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import ScreenBackLink from "@/components/ScreenBackLink";
import WeeklyReviewPanel from "@/components/WeeklyReviewPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useWeeklyReview } from "@/hooks/useWeeklyReview";
import { useHabitFigureCatalog } from "@/hooks/useHabitCards";

/**
 * P43 先週のふりかえり（保護者、新設）
 * 参照: 要件定義書07-35章「振り返る機会」、主要画面ワイヤーフレーム.md 60.4節
 *
 * かぞくタブ入口（`app/parent/(tabs)/index.tsx`）の「先週のふりかえり」カードから
 * 遷移する、本章で新設する唯一の画面（みまもりメンバー版は
 * `app/supporter/weekly-review.tsx`、子どもは新規画面を持たず
 * ChildWeeklyReviewModalで同じ内容を見る、60.4節）。
 */
export default function ParentWeeklyReviewScreen() {
  const { state } = useAppData();
  const { loadState, data, reload } = useWeeklyReview();
  const { catalog } = useHabitFigureCatalog();

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" label="← もどる" onPress={() => router.replace("/parent")} />
      <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s2 }]}>先週のふりかえり</Text>

      <WeeklyReviewPanel
        tone="parent"
        loadState={loadState}
        data={data}
        chores={state.chores}
        habitFigureCatalog={catalog}
        onRetry={reload}
      />
    </Screen>
  );
}
