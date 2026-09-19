import React, { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import HabitCardBoard from "@/components/HabitCardBoard";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useActiveHabitCard, useHabitFigureCatalog } from "@/hooks/useHabitCards";

/**
 * P38 シール帳（保護者、新設）
 * 参照: 要件定義書07-28章2026-09-19全面改訂、主要画面ワイヤーフレーム.md
 * 49-B.5章決定45〜46
 *
 * じぶんタブのシール帳カードから遷移する、本章で新設する唯一の画面
 * （みまもりメンバー版はapp/supporter/habit-cards.tsx、子どもは新規画面を
 * 持たずChildHabitCardModalで同じ内容を見る）。
 */
export default function ParentHabitCardsScreen() {
  const { state } = useAppData();
  const myMemberId = state.activeParentMemberId;
  const [selectedMemberId, setSelectedMemberId] = useState(myMemberId);
  const { catalog } = useHabitFigureCatalog();
  const { loadState, card, breakdown, totalCount, grants, reload } = useActiveHabitCard(selectedMemberId);

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent")} />
      <Text style={theme.typography.parentTitle}>シール帳</Text>

      <HabitCardBoard
        tone="parent"
        members={state.members}
        myMemberId={myMemberId}
        selectedMemberId={selectedMemberId}
        onSelectMember={setSelectedMemberId}
        chores={state.chores}
        catalog={catalog}
        loadState={loadState}
        card={card}
        breakdown={breakdown}
        totalCount={totalCount}
        grants={grants}
        onRetry={reload}
        onKindChosen={reload}
      />

      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/parent")} />
    </Screen>
  );
}
