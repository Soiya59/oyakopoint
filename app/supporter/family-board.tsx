import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import FamilyBoardHistoryPanel from "@/components/FamilyBoardHistoryPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useFamilyBoardHistory, useFamilyBoardRemainingToday } from "@/hooks/useFamilyBoard";

/**
 * S20 家族の掲示板（投稿履歴一覧、みまもりメンバー）
 * 参照: 主要画面ワイヤーフレーム.md 22.2節、要件定義書07-14章
 *
 * [2026-08-28新設・第1段階「見る側」のみ] S1ホームの「家族の書き込み」カードを
 * タップした遷移先。P32と同一構成（見出しのみ「家族の書き込み」のまま）。
 *
 * [2026-08-29追加・第2段階] 「書き込む」ボタンを追加した。みまもりメンバーには
 * 保護者の是正削除は無く、「取消」（自分の投稿・5分以内）のみ利用できる
 * （FamilyBoardHistoryPanel側でtone="supporter"のため`canDelete=false`に自動的になる）。
 * P32と同じくrouter.replaceの`posted`パラメータで一覧・残数を最新化する。
 */
export default function SupporterFamilyBoardScreen() {
  const { state } = useAppData();
  const familyId = state.family.id;
  const myMemberId = state.activeParentMemberId;
  const {
    loadState,
    posts,
    hasMore,
    loadingMore,
    loadMore,
    reload,
    removingPostId,
    actionError,
    removePost,
    reactingReaction,
    reactionError,
    reactToPost,
    viewReactorsForPost,
  } = useFamilyBoardHistory(familyId);
  const { remaining, reload: reloadRemaining } = useFamilyBoardRemainingToday();

  const params = useLocalSearchParams<{ posted?: string }>();
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (!params.posted) return;
    setShowToast(true);
    void reload();
    void reloadRemaining();
    const t = setTimeout(() => setShowToast(false), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.posted]);

  return (
    <Screen tone="supporter">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.supporterBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.supporterTitle, { marginTop: theme.spacing.s3 }]}>家族の掲示板</Text>

      {showToast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>書き込みました</Text>
        </View>
      )}

      <FamilyBoardHistoryPanel
        tone="supporter"
        loadState={loadState}
        posts={posts}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        onRetry={reload}
        myMemberId={myMemberId}
        remaining={remaining}
        onCompose={() => router.push("/supporter/family-board-post")}
        removingPostId={removingPostId}
        actionError={actionError}
        onRemovePost={removePost}
        reactingReaction={reactingReaction}
        reactionError={reactionError}
        onReact={(postId, stampKey) => reactToPost(postId, myMemberId, stampKey)}
        onViewReactors={viewReactorsForPost}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  toast: {
    marginTop: theme.spacing.s3,
    backgroundColor: theme.colors.neutralTextPrimary,
    borderRadius: theme.radius.parentMd,
    paddingVertical: theme.spacing.s3,
    paddingHorizontal: theme.spacing.s4,
    alignItems: "center",
  },
  toastText: { color: "#FFFFFF", fontWeight: "600" },
});
