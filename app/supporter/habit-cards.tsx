import React, { useState } from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import HabitCardBoard from "@/components/HabitCardBoard";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useHabitCardsForMember, useHabitFigureCatalog } from "@/hooks/useHabitCards";

/**
 * S26 台紙（みまもりメンバー、新設）
 * 参照: 要件定義書07-28章、主要画面ワイヤーフレーム.md 49.6章決定16〜18
 *
 * app/parent/habit-cards.tsx（P38）と同一設計の複製（49.0節「役割ごとに
 * P38・S26の番号を持つが、同一設計の複製であり複雑さの上限が言う『新画面1つ』は
 * この1コンセプトを指す」）。
 */
export default function SupporterHabitCardsScreen() {
  const { state } = useAppData();
  const myMemberId = state.activeParentMemberId;
  const [selectedMemberId, setSelectedMemberId] = useState(myMemberId);
  const { catalog } = useHabitFigureCatalog();
  const { loadState, activeCards, archivedCards, reload } = useHabitCardsForMember(selectedMemberId);

  return (
    <Screen tone="supporter">
      <ScreenBackLink tone="supporter" onPress={() => router.replace("/supporter")} />
      <Text style={theme.typography.supporterTitle}>台紙</Text>

      <HabitCardBoard
        tone="supporter"
        members={state.members}
        myMemberId={myMemberId}
        selectedMemberId={selectedMemberId}
        onSelectMember={setSelectedMemberId}
        chores={state.chores}
        catalog={catalog}
        loadState={loadState}
        activeCards={activeCards}
        archivedCards={archivedCards}
        onRetry={reload}
        onEndedCard={reload}
      />

      <AppButton tone="supporter" label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/supporter")} />
    </Screen>
  );
}
