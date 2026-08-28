import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import FamilyBoardHistoryPanel from "@/components/FamilyBoardHistoryPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useFamilyBoardHistory, useFamilyBoardRemainingToday } from "@/hooks/useFamilyBoard";

/**
 * P32 家族の書き込み（投稿履歴一覧、保護者）
 * 参照: 主要画面ワイヤーフレーム.md 22.2節、要件定義書07-14章
 *
 * [2026-08-28新設・第1段階「見る側」のみ] P7ホームの「今週のできごと」カード
 * （書き込みがあれば最新1件、無ければ従来のまとめメッセージ）をタップした遷移先。
 * ロジック自体はFamilyBoardHistoryPanel（3ロール共通）に集約し、本画面は
 * トーン・見出し文言のみを渡す薄い殻にする（P31/C26/S19のCollectorShelfPanelと
 * 同じ構成パターン）。
 *
 * [2026-08-29追加・第2段階] 「書き込む」ボタン・削除/取消導線を追加した。
 * P33（投稿画面）から`router.replace({pathname: "/parent/family-board", params: {posted: "1"}})`
 * で戻ってくる想定（`app/parent/gratitude.tsx`のtoastNameパターンと同じ、「一度きりの
 * 合図としてナビゲーションパラメータを使う」）。`router.replace`は新しい画面インスタンスを
 * 積むため、`useFamilyBoardHistory`/`useFamilyBoardRemainingToday`のマウント時fetchで
 * 一覧・残数ともに自動的に最新化される（22.3.1節「送信成功後は履歴一覧に戻り、控えめな
 * スナックバー『書き込みました』を1.5秒程度表示する」）。
 */
export default function ParentFamilyBoardScreen() {
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
    <Screen tone="parent">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.parentBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3 }]}>家族の書き込み</Text>

      {showToast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>書き込みました</Text>
        </View>
      )}

      <FamilyBoardHistoryPanel
        tone="parent"
        loadState={loadState}
        posts={posts}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={loadMore}
        onRetry={reload}
        myMemberId={myMemberId}
        remaining={remaining}
        onCompose={() => router.push("/parent/family-board-post")}
        removingPostId={removingPostId}
        actionError={actionError}
        onRemovePost={removePost}
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
