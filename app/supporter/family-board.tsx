import React from "react";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import FamilyBoardHistoryPanel from "@/components/FamilyBoardHistoryPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useFamilyBoardHistory } from "@/hooks/useFamilyBoard";

/**
 * S20 家族の書き込み（投稿履歴一覧、みまもりメンバー）
 * 参照: 主要画面ワイヤーフレーム.md 22.2節、要件定義書07-14章
 *
 * [2026-08-28新設・第1段階「見る側」のみ] S1ホームの「家族の書き込み」カードを
 * タップした遷移先。P32と同一構成（見出しのみ「家族の書き込み」のまま）。
 * みまもりメンバーには保護者の是正削除は無く、「取消」（自分の投稿・5分以内）は
 * 第2段階まで未実装（FamilyBoardHistoryPanel冒頭コメント参照）。
 */
export default function SupporterFamilyBoardScreen() {
  const { state } = useAppData();
  const familyId = state.family.id;
  const { loadState, posts, hasMore, loadingMore, loadMore, reload } = useFamilyBoardHistory(familyId);

  return (
    <Screen tone="supporter">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.supporterBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.supporterTitle, { marginTop: theme.spacing.s3 }]}>家族の書き込み</Text>

      <FamilyBoardHistoryPanel
        tone="supporter"
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
