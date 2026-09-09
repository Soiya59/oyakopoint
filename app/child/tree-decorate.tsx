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
 * C23 木に飾る（子ども、交換相手選択・自由配置）。P26/C20/S14「かざりつけモード」
 * 参照: 画面一覧・遷移図.md C23、主要画面ワイヤーフレーム.md 21.4節・32.3節、
 * 設計部/成果物/スキーマ設計.sql 49章、開発部/成果物/実装メモ.md 142章
 *
 * 起点は3種類（P29と同じ、app/parent/tree-decorate.tsxのコメント参照）。
 *   1. C22（app/child/gacha-result.tsx）「きに かざる →」から`drawId`
 *      → `TreeDecoratePanel`
 *   2. コレクター棚「あつめたもの」区画・シール区分（app/child/collector-shelf.tsx）
 *      「木に かざる」から`purchaseId`＋`shape`＋`rarity`
 *      → `TreeStickerDragCanvas`（mode="place"）
 *   3. 同区分「うごかす」から`moveDecorationId`＋`shape`＋`rarity`＋`posX`＋`posY`
 *      → `TreeStickerDragCanvas`（mode="move"）
 */
export default function ChildTreeDecorateScreen() {
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
  const myId = state.activeChildMemberId;
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
      <Screen tone="child">
        <Text style={theme.typography.childBody}>たいしょうが みつかりませんでした</Text>
        <AppButton
          label="もどる"
          tone="child"
          style={{ marginTop: theme.spacing.s6 }}
          onPress={() => router.replace("/child/home")}
        />
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
    setTimeout(() => router.replace("/child/family-tree"), SUCCESS_DISPLAY_MS);
  };

  const handleConfirmSticker = async (nx: number, ny: number) => {
    setDecorateError(null);
    const res = purchaseId ? await placeSticker(purchaseId, nx, ny) : await moveSticker(moveDecorationId!, nx, ny);
    if (!res.ok) {
      setDecorateError(res.error.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => router.replace("/child/family-tree"), SUCCESS_DISPLAY_MS);
  };

  if (success) {
    return (
      <Screen tone="child">
        <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
          <Text style={{ fontSize: 48 }}>🎉</Text>
          <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3 }]}>
            {moveDecorationId ? "うごかしたよ！" : "かざったよ！"}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen tone="child">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.childBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        {moveDecorationId ? "メダルを うごかす" : purchaseId ? "メダルを かざる" : "きに かざる"}
      </Text>

      {isStickerMode ? (
        <TreeStickerDragCanvas
          tone="child"
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
          tone="child"
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
