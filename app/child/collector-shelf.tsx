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
 * C26 コレクションだな（子ども）
 * 参照: 画面一覧・遷移図.md C26、主要画面ワイヤーフレーム.md 21.6節・32.2節
 *
 * 07-13-3章「コレクター棚」に対応する。見出しを「あつめたもの」「まえの木」
 * 「じぶんのシール」に置き換える（21.6節・32.2節）以外はP31/S19と同一構成で、
 * CollectorShelfPanel（3ロール共通）にロジックを集約する。区画1・区画2には
 * かざるボタン・ならべかえボタンは無い（決定6）。区画3のみ例外的に持つ。
 */
export default function ChildCollectorShelfScreen() {
  const { state } = useAppData();
  const familyId = state.family.id;
  const myId = state.activeChildMemberId;
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
    <Screen tone="child">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.childBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        コレクションだな
      </Text>

      <CollectorShelfPanel
        tone="child"
        collectedLoadState={collectedLoadState}
        collectedItems={collectedItems}
        onRetryCollected={reloadCollected}
        onGoToGacha={() => router.push("/child/gacha")}
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
        onGoToStickerShop={() => router.push("/child/sticker-shop")}
        onDecorateSticker={(purchaseId) => router.push({ pathname: "/child/tree-decorate", params: { purchaseId } })}
      />
    </Screen>
  );
}
