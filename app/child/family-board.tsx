import React from "react";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import FamilyBoardHistoryPanel from "@/components/FamilyBoardHistoryPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useFamilyBoardHistory } from "@/hooks/useFamilyBoard";

/**
 * C27 かぞくのけいじばん（投稿履歴一覧、子ども）
 * 参照: 主要画面ワイヤーフレーム.md 22.2節、要件定義書07-14章
 *
 * [2026-08-28新設・第1段階「見る側」のみ] C5ホームの「かぞくのできごと」カードを
 * タップした遷移先。P32/S20と同一構成、見出しのみ子ども向けに置き換える
 * （22.2節ワイヤーフレーム）。「かきこむ」ボタン・削除は子ども向けにそもそも
 * 存在しない導線（保護者の是正削除のみ）で、「とりけす」（自分の投稿・5分以内）は
 * 第2段階まで未実装（FamilyBoardHistoryPanel冒頭コメント参照）。
 */
export default function ChildFamilyBoardScreen() {
  const { state } = useAppData();
  const familyId = state.family.id;
  const { loadState, posts, hasMore, loadingMore, loadMore, reload } = useFamilyBoardHistory(familyId);

  return (
    <Screen tone="child">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.childBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        かぞくのけいじばん
      </Text>

      <FamilyBoardHistoryPanel
        tone="child"
        loadState={loadState}
        posts={posts}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        onRetry={reload}
      />
    </Screen>
  );
}
