import React from "react";
import { useLocalSearchParams } from "expo-router";
import StubScreen from "@/components/StubScreen";
import { useAppData } from "@/data/store";

/**
 * P13 ごほうび登録・編集（スタブ）
 * 参照: 画面一覧・遷移図.md P13、API仕様.md 7章
 */
export default function RewardEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state } = useAppData();
  const reward = state.rewards.find((r) => r.id === id);

  return (
    <StubScreen
      screenCode="P13"
      title={reward ? `${reward.emoji} ${reward.name} を編集` : "ごほうびを新規登録"}
      purpose="reward作成・編集"
      elements={["名前", "コスト（cost）", "説明（description）"]}
    />
  );
}
