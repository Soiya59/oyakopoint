import React, { useState } from "react";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import CollectorShelfPanel from "@/components/CollectorShelfPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useCollectedPrizes, usePastTreeSeasonDots, usePastTreeSeasons } from "@/hooks/useCollectorShelf";
import { useFamilyTreeDetail } from "@/hooks/useFamilyTree";
import { useDecoratableCompletions } from "@/hooks/useTreeDecoration";
import { useMyStickerPurchases } from "@/hooks/useStickers";

/**
 * P31 コレクター棚（保護者）
 * 参照: 画面一覧・遷移図.md P31、主要画面ワイヤーフレーム.md 21.6節・32.2節
 *
 * 07-13-3章「コレクター棚」に対応する。「集めたもの」（家族共有・永久保管）・
 * 「過去の木」（シーズンごとの木を、飾られた景品が乗った状態のまま振り返る）・
 * 「自分のステッカー」（区画3、個人所有、07-19-9a章）の3区画で構成する。
 * 構造・ロジックはCollectorShelfPanel（3ロール共通）に集約し、本画面はトーン・
 * 遷移先のみを渡す薄い殻にする（依頼「共通コンポーネントとして作ること」対応）。
 * 決定6のとおり、区画1・区画2には木に飾る・並べ替える導線は一切持たない
 * （区画3のみ21.0節決定6改訂注記により例外的に持つ）。
 */
export default function ParentCollectorShelfScreen() {
  const { state } = useAppData();
  const familyId = state.family.id;
  const myId = state.activeParentMemberId;
  const { loadState: collectedLoadState, items: collectedItems, reload: reloadCollected } = useCollectedPrizes(familyId);
  const { loadState: pastSeasonsLoadState, seasons: pastSeasons, reload: reloadPastSeasons } = usePastTreeSeasons(familyId);
  const { dotsBySeasonId, weeklyBySeasonId, loadingSeasonIds, errorSeasonIds, loadSeason } = usePastTreeSeasonDots(familyId);

  // [2026-09-07追加] 区画3「自分のステッカー」用データ。
  const { loadState: treeLoadState, season } = useFamilyTreeDetail();
  const { candidates } = useDecoratableCompletions(myId, season?.season_start ?? null, treeLoadState !== "loading");
  const [stickersSelectedMemberId, setStickersSelectedMemberId] = useState(myId);
  const { loadState: stickersLoadState, purchases: stickerPurchases, reload: reloadStickers } = useMyStickerPurchases(
    stickersSelectedMemberId,
    season?.id ?? null
  );

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
        weeklyBySeasonId={weeklyBySeasonId}
        loadingSeasonIds={loadingSeasonIds}
        errorSeasonIds={errorSeasonIds}
        onExpandSeason={loadSeason}
        members={state.members}
        myMemberId={myId}
        stickersSelectedMemberId={stickersSelectedMemberId}
        onSelectStickersMember={setStickersSelectedMemberId}
        stickersLoadState={stickersLoadState}
        stickerPurchases={stickerPurchases}
        onRetryStickers={reloadStickers}
        canPlaceStickerThisSeason={candidates.length > 0}
        onGoToStickerShop={() => router.push("/parent/sticker-shop")}
        onDecorateSticker={(purchaseId) => router.push({ pathname: "/parent/tree-decorate", params: { purchaseId } })}
      />
    </Screen>
  );
}
