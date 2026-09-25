import React, { useRef, useState } from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import CollectorShelfPanel, { ALL_MEMBERS_ID } from "@/components/CollectorShelfPanel";
import theme from "@/theme/theme";
import type { StickerRarity, StickerShape } from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useCollectedPrizes, usePastTreeSeasonDots, usePastTreeSeasons } from "@/hooks/useCollectorShelf";
import { useFamilyTreeDetail } from "@/hooks/useFamilyTree";
import { useFamilyStickerPurchases, useMyStickerPurchases } from "@/hooks/useStickers";
import { useFamilyHabitFigureGrants, useMyHabitFigureGrants } from "@/hooks/useHabitCards";

/**
 * C26 コレクションだな（子ども）
 * 参照: 画面一覧・遷移図.md C26、主要画面ワイヤーフレーム.md 21.6節・32.0a節・32.2a節、
 * 開発部/成果物/実装メモ.md 142章
 *
 * 07-13-3章「コレクター棚」に対応する。見出しを「あつめたもの」「まえの木」
 * 「だれの？」「つくった・あつめたもの」「シール」に置き換える（32.2a節）以外は
 * P31/S19と同一構成で、CollectorShelfPanel（3ロール共通）にロジックを集約する。
 * [2026-09-21改訂・主要画面ワイヤーフレーム.md 58.5a節決定3] 「バッジ」区分は
 * コレクター棚から削除した（絵が無く集めるものでもないため）。
 */
export default function ChildCollectorShelfScreen() {
  const { state } = useAppData();
  const familyId = state.family.id;
  const myId = state.activeChildMemberId;
  const { loadState: collectedLoadState, items: collectedItems, reload: reloadCollected } = useCollectedPrizes(familyId);
  const { loadState: pastSeasonsLoadState, seasons: pastSeasons, reload: reloadPastSeasons } = usePastTreeSeasons(familyId);
  const {
    dotsBySeasonId,
    stickerPlacementsBySeasonId,
    habitFigurePlacementsBySeasonId,
    weeklyBySeasonId,
    loadingSeasonIds,
    errorSeasonIds,
    loadSeason,
  } = usePastTreeSeasonDots(familyId);

  const [selectedMemberId, setSelectedMemberId] = useState(ALL_MEMBERS_ID);
  const isViewingIndividual = selectedMemberId !== ALL_MEMBERS_ID;
  const effectiveMemberId = isViewingIndividual ? selectedMemberId : "";

  // [2026-09-25追加・実装メモ303.x章] 「集めたもの」タブの区分ジャンプボタン
  // （目次）用。ScreenのScrollViewへscrollToするためのref。
  const scrollRef = useRef<ScrollView>(null);

  const { season } = useFamilyTreeDetail();
  const { loadState: stickersLoadState, purchases: stickerPurchases, reload: reloadStickers } = useMyStickerPurchases(
    effectiveMemberId,
    season?.id ?? null
  );
  // [2026-09-08追加・実装メモ158章] 「全員」選択時の「メダル」区分用。
  const {
    loadState: familyStickersLoadState,
    purchases: familyStickerPurchases,
    reload: reloadFamilyStickers,
  } = useFamilyStickerPurchases(familyId, season?.id ?? null);
  // [2026-09-17追加・要件定義書07-28章決定27、開発部/成果物/実装メモ.md 237章]
  // 「フィギュア」区分。シール区分と全く同じ構造。
  const { loadState: habitFiguresLoadState, grants: habitFigureGrants, reload: reloadHabitFigures } = useMyHabitFigureGrants(
    effectiveMemberId,
    season?.id ?? null
  );
  const {
    loadState: familyHabitFiguresLoadState,
    grants: familyHabitFigureGrants,
    reload: reloadFamilyHabitFigures,
  } = useFamilyHabitFigureGrants(familyId, season?.id ?? null);

  return (
    <Screen tone="child" scrollRef={scrollRef}>
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.childBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        コレクションだな
      </Text>

      <CollectorShelfPanel
        tone="child"
        scrollViewRef={scrollRef}
        collectedLoadState={collectedLoadState}
        collectedItems={collectedItems}
        onRetryCollected={reloadCollected}
        onGoToGacha={() => router.push("/child/gacha")}
        pastSeasonsLoadState={pastSeasonsLoadState}
        pastSeasons={pastSeasons}
        onRetryPastSeasons={reloadPastSeasons}
        dotsBySeasonId={dotsBySeasonId}
        stickerPlacementsBySeasonId={stickerPlacementsBySeasonId}
        habitFigurePlacementsBySeasonId={habitFigurePlacementsBySeasonId}
        weeklyBySeasonId={weeklyBySeasonId}
        loadingSeasonIds={loadingSeasonIds}
        errorSeasonIds={errorSeasonIds}
        onExpandSeason={loadSeason}
        members={state.members}
        myMemberId={myId}
        selectedMemberId={selectedMemberId}
        onSelectMember={setSelectedMemberId}
        stickersLoadState={stickersLoadState}
        stickerPurchases={stickerPurchases}
        onRetryStickers={reloadStickers}
        familyStickersLoadState={familyStickersLoadState}
        familyStickerPurchases={familyStickerPurchases}
        onRetryFamilyStickers={reloadFamilyStickers}
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
        habitFiguresLoadState={habitFiguresLoadState}
        habitFigureGrants={habitFigureGrants}
        onRetryHabitFigures={reloadHabitFigures}
        familyHabitFiguresLoadState={familyHabitFiguresLoadState}
        familyHabitFigureGrants={familyHabitFigureGrants}
        onRetryFamilyHabitFigures={reloadFamilyHabitFigures}
        onPlaceHabitFigure={(grantId: string, figureKey: string, kindEmoji: string | null) =>
          router.push({
            pathname: "/child/tree-decorate",
            params: { habitFigureGrantId: grantId, habitFigureKey: figureKey, habitFigureKindEmoji: kindEmoji ?? "" },
          })
        }
        onMoveHabitFigure={(decorationId: string, figureKey: string, kindEmoji: string | null, posX: number, posY: number) =>
          router.push({
            pathname: "/child/tree-decorate",
            params: {
              moveHabitFigureDecorationId: decorationId,
              habitFigureKey: figureKey,
              habitFigureKindEmoji: kindEmoji ?? "",
              posX: String(posX),
              posY: String(posY),
            },
          })
        }
      />
    </Screen>
  );
}
