import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import TreeDecoratePanel from "@/components/TreeDecoratePanel";
import TreeStickerDragCanvas from "@/components/TreeStickerDragCanvas";
import theme from "@/theme/theme";
import type { StickerRarity, StickerShape } from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useFamilyTreeDetail } from "@/hooks/useFamilyTree";
import { useDecorateTreeAction, useDecoratableCompletions } from "@/hooks/useTreeDecoration";
import { useDecorateTreeWithStickerAction, useMoveTreeStickerAction } from "@/hooks/useStickers";

const SUCCESS_DISPLAY_MS = 600;

/**
 * P29 木に飾る（保護者、交換相手選択・自由配置）。P26/C20/S14「かざりつけモード」
 * 参照: 画面一覧・遷移図.md P29、主要画面ワイヤーフレーム.md 21.4節・32.3節、
 * 設計部/成果物/スキーマ設計.sql 49章、開発部/成果物/実装メモ.md 142章
 *
 * 起点は3種類。
 *   1. P28（app/parent/gacha-result.tsx）から`drawId`を受け取る（ガチャ景品。
 *      色丸との交換方式、無変更）→ `TreeDecoratePanel`
 *   2. コレクター棚「集めたもの」区画・シール区分（app/parent/collector-shelf.tsx）
 *      「木に かざる」から`purchaseId`＋`shape`＋`rarity`を受け取る（購入ステッカーの
 *      新規配置。木の上をドラッグして座標を選ぶ自由配置方式、49章）→
 *      `TreeStickerDragCanvas`（mode="place"）
 *   3. 同区分「うごかす」から`moveDecorationId`＋`shape`＋`rarity`＋`posX`＋`posY`を
 *      受け取る（既存配置の座標変更、その月のうちのみ）→
 *      `TreeStickerDragCanvas`（mode="move"）
 */
export default function ParentTreeDecorateScreen() {
  const { drawId, purchaseId, moveDecorationId, shape, rarity, posX, posY } = useLocalSearchParams<{
    drawId?: string;
    purchaseId?: string;
    moveDecorationId?: string;
    shape?: StickerShape;
    rarity?: StickerRarity;
    posX?: string;
    posY?: string;
  }>();
  const { state } = useAppData();
  const myId = state.activeParentMemberId;
  const { loadState: treeLoadState, season, dots, stickerPlacements, reload: reloadTree } = useFamilyTreeDetail();
  const { loadState: candidatesLoadState, candidates, reload: reloadCandidates } = useDecoratableCompletions(
    myId,
    season?.season_start ?? null,
    treeLoadState !== "loading"
  );
  const { decorating: decoratingGacha, decorate: decorateGacha } = useDecorateTreeAction();
  const { decorating: placingSticker, decorate: placeSticker } = useDecorateTreeWithStickerAction();
  const { moving: movingSticker, move: moveSticker } = useMoveTreeStickerAction();
  const [decorateError, setDecorateError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isStickerMode = !!purchaseId || !!moveDecorationId;

  if (!drawId && !purchaseId && !moveDecorationId) {
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentBody}>対象が見つかりませんでした</Text>
        <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/parent/home")} />
      </Screen>
    );
  }

  const handleConfirmGacha = async (completionId: string) => {
    setDecorateError(null);
    const res = await decorateGacha(drawId!, completionId);
    if (!res.ok) {
      setDecorateError(res.error.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => router.replace("/parent/family-tree"), SUCCESS_DISPLAY_MS);
  };

  const handleConfirmSticker = async (nx: number, ny: number) => {
    setDecorateError(null);
    const res = purchaseId ? await placeSticker(purchaseId, nx, ny) : await moveSticker(moveDecorationId!, nx, ny);
    if (!res.ok) {
      setDecorateError(res.error.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => router.replace("/parent/family-tree"), SUCCESS_DISPLAY_MS);
  };

  if (success) {
    return (
      <Screen tone="parent">
        <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
          <Text style={{ fontSize: 40 }}>🎉</Text>
          <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3 }]}>
            {moveDecorationId ? "動かしました" : "木に飾りました"}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.parentBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        {moveDecorationId ? "メダルを動かす" : purchaseId ? "メダルを飾る" : "木に飾る"}
      </Text>

      {isStickerMode ? (
        <TreeStickerDragCanvas
          tone="parent"
          treeLoadState={treeLoadState}
          stage={season?.current_stage ?? 0}
          dots={dots}
          stickerPlacements={stickerPlacements}
          shape={(shape as StickerShape) ?? "beetle"}
          rarity={(rarity as StickerRarity) ?? "bronze"}
          mode={purchaseId ? "place" : "move"}
          movingDecorationId={moveDecorationId ?? null}
          initialPos={posX && posY ? { x: Number(posX), y: Number(posY) } : null}
          confirming={placingSticker || movingSticker}
          confirmErrorMessage={decorateError}
          onRetryLoad={reloadTree}
          onConfirm={handleConfirmSticker}
        />
      ) : (
        <TreeDecoratePanel
          tone="parent"
          treeLoadState={treeLoadState}
          stage={season?.current_stage ?? 0}
          dots={dots}
          candidatesLoadState={candidatesLoadState}
          candidates={candidates}
          myMemberId={myId}
          decorating={decoratingGacha}
          decorateErrorMessage={decorateError}
          onRetryLoad={() => {
            reloadTree();
            reloadCandidates();
          }}
          onConfirm={handleConfirmGacha}
        />
      )}
    </Screen>
  );
}
