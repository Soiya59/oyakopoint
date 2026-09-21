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
import { useFamilyStickerPurchases, useMyStickerPurchases } from "@/hooks/useStickers";
import { useFamilyHabitFigureGrants, useMyHabitFigureGrants } from "@/hooks/useHabitCards";

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
  const {
    dotsBySeasonId,
    stickerPlacementsBySeasonId,
    habitFigurePlacementsBySeasonId,
    weeklyBySeasonId,
    loadingSeasonIds,
    errorSeasonIds,
    loadSeason,
  } = usePastTreeSeasonDots(familyId);

  // [2026-09-08新設・主要画面ワイヤーフレーム.md 32.0a節決定19〜22] 「集めたもの」
  // 区画内のメンバー選択チップ。既定は「全員」（決定22）。
  const [selectedMemberId, setSelectedMemberId] = useState(ALL_MEMBERS_ID);
  const isViewingIndividual = selectedMemberId !== ALL_MEMBERS_ID;
  const effectiveMemberId = isViewingIndividual ? selectedMemberId : "";

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
  // 「フィギュア」区分。シール区分（useMyStickerPurchases/useFamilyStickerPurchases）と
  // 全く同じ構造。
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
    <Screen tone="parent">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.parentBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3 }]}>コレクション</Text>
      {/* [2026-09-16追加・主要画面ワイヤーフレーム.md 45.7.6節、実装メモ.md 227章]
          常時表示の一文。 */}
      <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        {/* [2026-09-21改訂・要件定義書07-34章「メダルとフィギュアの入れ替え」、UIUXデザイン部/
            成果物/主要画面ワイヤーフレーム.md 62.6節] 1文の中に両語が共存する箇所。3段階
            置換（「メダル」→一時語→「フィギュア」を「メダル」に→一時語を「フィギュア」に）で
            動作確認した最初の箇所。 */}
        ガチャの景品・お絵かき・フィギュア・メダルなど、これまで集めたものを振り返れる棚です。過去の木もここで見られます。
      </Text>

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
        habitFiguresLoadState={habitFiguresLoadState}
        habitFigureGrants={habitFigureGrants}
        onRetryHabitFigures={reloadHabitFigures}
        familyHabitFiguresLoadState={familyHabitFiguresLoadState}
        familyHabitFigureGrants={familyHabitFigureGrants}
        onRetryFamilyHabitFigures={reloadFamilyHabitFigures}
        onPlaceHabitFigure={(grantId: string, figureKey: string, kindEmoji: string | null) =>
          router.push({
            pathname: "/parent/tree-decorate",
            params: { habitFigureGrantId: grantId, habitFigureKey: figureKey, habitFigureKindEmoji: kindEmoji ?? "" },
          })
        }
        onMoveHabitFigure={(decorationId: string, figureKey: string, kindEmoji: string | null, posX: number, posY: number) =>
          router.push({
            pathname: "/parent/tree-decorate",
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
