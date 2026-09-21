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
 * S29 先週のふりかえり（みまもりメンバー、新設）
 * 参照: 要件定義書07-35章「振り返る機会」、主要画面ワイヤーフレーム.md 60.4節
 *
 * app/parent/weekly-review.tsx（P43）と同一設計の複製（49.0節「役割ごとに
 * P38・S26の番号を持つが、同一設計の複製」と同じ考え方）。
 */
export default function SupporterWeeklyReviewScreen() {
  const { state } = useAppData();
  const { loadState, data, reload } = useWeeklyReview();
  const { catalog } = useHabitFigureCatalog();

  return (
    <Screen tone="supporter">
      <ScreenBackLink tone="supporter" label="← もどる" onPress={() => router.replace("/supporter")} />
      <Text style={[theme.typography.supporterTitle, { marginTop: theme.spacing.s2 }]}>先週のふりかえり</Text>

      <WeeklyReviewPanel
        tone="supporter"
        loadState={loadState}
        data={data}
        chores={state.chores}
        habitFigureCatalog={catalog}
        onRetry={reload}
      />
    </Screen>
  );
}
