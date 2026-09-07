import React, { useState } from "react";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import CollectorShelfPanel, { ALL_MEMBERS_ID } from "@/components/CollectorShelfPanel";
import theme from "@/theme/theme";
import type { StickerRarity, StickerShape } from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useCollectedPrizes, usePastTreeSeasonDots, usePastTreeSeasons } from "@/hooks/useCollectorShelf";
import { useFamilyTreeDetail } from "@/hooks/useFamilyTree";
import { useMyStickerPurchases } from "@/hooks/useStickers";
import { useMemberBadgeRows } from "@/hooks/useBadges";

/**
 * C26 コレクションだな（子ども）
 * 参照: 画面一覧・遷移図.md C26、主要画面ワイヤーフレーム.md 21.6節・32.0a節・32.2a節、
 * 開発部/成果物/実装メモ.md 142章
 *
 * 07-13-3章「コレクター棚」に対応する。見出しを「あつめたもの」「まえの木」
 * 「だれの？」「バッジ」「つくった・あつめたもの」「シール」に置き換える（32.2a節）
 * 以外はP31/S19と同一構成で、CollectorShelfPanel（3ロール共通）にロジックを集約する。
 */
export default function ChildCollectorShelfScreen() {
  const { state } = useAppData();
  const familyId = state.family.id;
  const myId = state.activeChildMemberId;
  const { loadState: collectedLoadState, items: collectedItems, reload: reloadCollected } = useCollectedPrizes(familyId);
  const { loadState: pastSeasonsLoadState, seasons: pastSeasons, reload: reloadPastSeasons } = usePastTreeSeasons(familyId);
  const { dotsBySeasonId, stickerPlacementsBySeasonId, weeklyBySeasonId, loadingSeasonIds, errorSeasonIds, loadSeason } =
    usePastTreeSeasonDots(familyId);

  const [selectedMemberId, setSelectedMemberId] = useState(ALL_MEMBERS_ID);
  const isViewingIndividual = selectedMemberId !== ALL_MEMBERS_ID;
  const effectiveMemberId = isViewingIndividual ? selectedMemberId : "";

  const { season } = useFamilyTreeDetail();
  const { loadState: badgesLoadState, rows: badgeRows, reload: reloadBadges } = useMemberBadgeRows(effectiveMemberId);
  const { loadState: stickersLoadState, purchases: stickerPurchases, reload: reloadStickers } = useMyStickerPurchases(
    effectiveMemberId,
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
        stickerPlacementsBySeasonId={stickerPlacementsBySeasonId}
        weeklyBySeasonId={weeklyBySeasonId}
        loadingSeasonIds={loadingSeasonIds}
        errorSeasonIds={errorSeasonIds}
        onExpandSeason={loadSeason}
        members={state.members}
        myMemberId={myId}
        selectedMemberId={selectedMemberId}
        onSelectMember={setSelectedMemberId}
        badgesLoadState={badgesLoadState}
        badgeRows={badgeRows}
        onRetryBadges={reloadBadges}
        stickersLoadState={stickersLoadState}
        stickerPurchases={stickerPurchases}
        onRetryStickers={reloadStickers}
        onGoToStickerShop={() => router.push("/child/sticker-shop")}
        onPlaceSticker={(purchaseId: string, shape: StickerShape, rarity: StickerRarity) =>
          router.push({ pathname: "/child/tree-decorate", params: { purchaseId, shape, rarity } })
        }
        onMoveSticker={(decorationId: string, shape: StickerShape, rarity: StickerRarity, posX: number, posY: number) =>
          router.push({
            pathname: "/child/tree-decorate",
            params: { moveDecorationId: decorationId, shape, rarity, posX: String(posX), posY: String(posY) },
          })
        }
      />
    </Screen>
  );
}
