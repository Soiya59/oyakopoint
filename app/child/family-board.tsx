import React from "react";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import FamilyBoardHistoryPanel from "@/components/FamilyBoardHistoryPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useFamilyBoardHistory, useFamilyBoardRemainingToday } from "@/hooks/useFamilyBoard";

/**
 * C27 かぞくのけいじばん（投稿履歴一覧、子ども）
 * 参照: 主要画面ワイヤーフレーム.md 22.2節、要件定義書07-14章
 *
 * [2026-08-28新設・第1段階「見る側」のみ] C5ホームの「かぞくのできごと」カードを
 * タップした遷移先。P32/S20と同一構成、見出しのみ子ども向けに置き換える
 * （22.2節ワイヤーフレーム）。
 *
 * [2026-08-29追加・第2段階] 「かきこむ」ボタンを追加した。子ども向けには
 * 保護者の是正削除の導線が無く、「とりけす」（自分の投稿・5分以内）のみ
 * （FamilyBoardHistoryPanel側でtone="child"のため`canDelete=false`に自動的になる）。
 * 送信成功の演出はC28（投稿画面）内で完結し（22.3.2節「かぞくに とどいたよ！」）、
 * 本画面側にはP32/S20のようなスナックバーは無い（22.5節「送信が完了した状態」表）。
 * C28からの復帰は`router.replace("/child/family-board")`のみを使うため、新しい
 * 画面インスタンスがマウントされ、`useFamilyBoardHistory`/`useFamilyBoardRemainingToday`の
 * マウント時fetchで一覧・残数ともに自動的に最新化される（toastパラメータ不要）。
 */
export default function ChildFamilyBoardScreen() {
  const { state } = useAppData();
  const familyId = state.family.id;
  const myMemberId = state.activeChildMemberId;
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
  const { remaining } = useFamilyBoardRemainingToday();

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
        myMemberId={myMemberId}
        remaining={remaining}
        onCompose={() => router.push("/child/family-board-post")}
        removingPostId={removingPostId}
        actionError={actionError}
        onRemovePost={removePost}
      />
    </Screen>
  );
}
