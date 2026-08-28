import React from "react";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import FamilyBoardHistoryPanel from "@/components/FamilyBoardHistoryPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useFamilyBoardHistory } from "@/hooks/useFamilyBoard";

/**
 * P32 家族の書き込み（投稿履歴一覧、保護者）
 * 参照: 主要画面ワイヤーフレーム.md 22.2節、要件定義書07-14章
 *
 * [2026-08-28新設・第1段階「見る側」のみ] P7ホームの「今週のできごと」カード
 * （書き込みがあれば最新1件、無ければ従来のまとめメッセージ）をタップした遷移先。
 * ロジック自体はFamilyBoardHistoryPanel（3ロール共通）に集約し、本画面は
 * トーン・見出し文言のみを渡す薄い殻にする（P31/C26/S19のCollectorShelfPanelと
 * 同じ構成パターン）。「書き込む」ボタン・削除/取消導線は第2段階まで未実装
 * （FamilyBoardHistoryPanel冒頭コメント参照）。
 */
export default function ParentFamilyBoardScreen() {
  const { state } = useAppData();
  const familyId = state.family.id;
  const { loadState, posts, hasMore, loadingMore, loadMore, reload } = useFamilyBoardHistory(familyId);

  return (
    <Screen tone="parent">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.parentBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3 }]}>家族の書き込み</Text>

      <FamilyBoardHistoryPanel
        tone="parent"
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
