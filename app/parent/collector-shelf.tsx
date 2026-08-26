import React from "react";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import CollectorShelfPanel from "@/components/CollectorShelfPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useCollectedPrizes, usePastTreeSeasonDots, usePastTreeSeasons } from "@/hooks/useCollectorShelf";

/**
 * P31 コレクター棚（保護者）
 * 参照: 画面一覧・遷移図.md P31、主要画面ワイヤーフレーム.md 21.6節
 *
 * 07-13-3章「コレクター棚」に対応する。「集めたもの」（家族共有・永久保管）・
 * 「過去の木」（シーズンごとの木を、飾られた景品が乗った状態のまま振り返る）の
 * 2区画のみで構成する。構造・ロジックはCollectorShelfPanel（3ロール共通）に集約し、
 * 本画面はトーン・遷移先のみを渡す薄い殻にする（依頼「共通コンポーネントとして
 * 作ること」対応）。決定6のとおり、木に飾る・並べ替える導線は一切持たない。
 */
export default function ParentCollectorShelfScreen() {
  const { state } = useAppData();
  const familyId = state.family.id;
  const { loadState: collectedLoadState, items: collectedItems, reload: reloadCollected } = useCollectedPrizes(familyId);
  const { loadState: pastSeasonsLoadState, seasons: pastSeasons, reload: reloadPastSeasons } = usePastTreeSeasons(familyId);
  const { dotsBySeasonId, loadingSeasonIds, errorSeasonIds, loadSeason } = usePastTreeSeasonDots(familyId);

  return (
    <Screen tone="parent">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.parentBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3 }]}>コレクター棚</Text>

      <CollectorShelfPanel
        tone="parent"
        collectedLoadState={collectedLoadState}
        collectedItems={collectedItems}
        onRetryCollected={reloadCollected}
        onGoToGacha={() => router.push("/parent/gacha")}
        pastSeasonsLoadState={pastSeasonsLoadState}
        pastSeasons={pastSeasons}
        onRetryPastSeasons={reloadPastSeasons}
        dotsBySeasonId={dotsBySeasonId}
        loadingSeasonIds={loadingSeasonIds}
        errorSeasonIds={errorSeasonIds}
        onExpandSeason={loadSeason}
      />
    </Screen>
  );
}
