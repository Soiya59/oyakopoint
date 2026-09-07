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
 * S19 コレクター棚（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md S19、主要画面ワイヤーフレーム.md 21.6節・32.2節
 *
 * P31と同一構成（演出は控えめのまま据え置く、1.7節）。CollectorShelfPanel
 * （3ロール共通）にロジックを集約する。区画1・区画2には木に飾る・並べ替える導線は
 * 一切持たない（決定6）。区画3のみ例外的に持つ。
 */
export default function SupporterCollectorShelfScreen() {
  const { state } = useAppData();
  const familyId = state.family.id;
  const myId = state.activeParentMemberId;
  const { loadState: collectedLoadState, items: collectedItems, reload: reloadCollected } = useCollectedPrizes(familyId);
  const { loadState: pastSeasonsLoadState, seasons: pastSeasons, reload: reloadPastSeasons } = usePastTreeSeasons(familyId);
  const { dotsBySeasonId, weeklyBySeasonId, loadingSeasonIds, errorSeasonIds, loadSeason } = usePastTreeSeasonDots(familyId);

  const { loadState: treeLoadState, season } = useFamilyTreeDetail();
  const { candidates } = useDecoratableCompletions(myId, season?.season_start ?? null, treeLoadState !== "loading");
  const [stickersSelectedMemberId, setStickersSelectedMemberId] = useState(myId);
  const { loadState: stickersLoadState, purchases: stickerPurchases, reload: reloadStickers } = useMyStickerPurchases(
    stickersSelectedMemberId,
    season?.id ?? null
  );

  return (
    <Screen tone="supporter">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.supporterBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.supporterTitle, { marginTop: theme.spacing.s3 }]}>コレクター棚</Text>

      <CollectorShelfPanel
        tone="supporter"
        collectedLoadState={collectedLoadState}
        collectedItems={collectedItems}
        onRetryCollected={reloadCollected}
        onGoToGacha={() => router.push("/supporter/gacha")}
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
        onGoToStickerShop={() => router.push("/supporter/sticker-shop")}
        onDecorateSticker={(purchaseId) => router.push({ pathname: "/supporter/tree-decorate", params: { purchaseId } })}
      />
    </Screen>
  );
}
