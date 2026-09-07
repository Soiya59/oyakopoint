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
 * P31 コレクター棚（保護者）
 * 参照: 画面一覧・遷移図.md P31、主要画面ワイヤーフレーム.md 21.6節・32.0a節・32.2a節、
 * 開発部/成果物/実装メモ.md 142章
 *
 * 07-13-3章「コレクター棚」に対応する。「集めたもの」（家族共有・永久保管、
 * メンバー選択チップ付き）・「過去の木」（シーズンごとの木を、飾られた景品・
 * 自由配置ステッカーが乗った状態のまま振り返る）の2区画で構成する（32.0a節決定19、
 * 旧「区画3：自分のステッカー」は集めたもの区画に統合・廃止）。構造・ロジックは
 * CollectorShelfPanel（3ロール共通）に集約し、本画面はトーン・遷移先のみを渡す
 * 薄い殻にする（依頼「共通コンポーネントとして作ること」対応）。
 */
export default function ParentCollectorShelfScreen() {
  const { state } = useAppData();
  const familyId = state.family.id;
  const myId = state.activeParentMemberId;
  const { loadState: collectedLoadState, items: collectedItems, reload: reloadCollected } = useCollectedPrizes(familyId);
  const { loadState: pastSeasonsLoadState, seasons: pastSeasons, reload: reloadPastSeasons } = usePastTreeSeasons(familyId);
  const { dotsBySeasonId, stickerPlacementsBySeasonId, weeklyBySeasonId, loadingSeasonIds, errorSeasonIds, loadSeason } =
    usePastTreeSeasonDots(familyId);

  // [2026-09-08新設・主要画面ワイヤーフレーム.md 32.0a節決定19〜22] 「集めたもの」
  // 区画内のメンバー選択チップ。既定は「全員」（決定22）。
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
        onGoToStickerShop={() => router.push("/parent/sticker-shop")}
        onPlaceSticker={(purchaseId: string, shape: StickerShape, rarity: StickerRarity) =>
          router.push({ pathname: "/parent/tree-decorate", params: { purchaseId, shape, rarity } })
        }
        onMoveSticker={(decorationId: string, shape: StickerShape, rarity: StickerRarity, posX: number, posY: number) =>
          router.push({
            pathname: "/parent/tree-decorate",
            params: { moveDecorationId: decorationId, shape, rarity, posX: String(posX), posY: String(posY) },
          })
        }
      />
    </Screen>
  );
}
