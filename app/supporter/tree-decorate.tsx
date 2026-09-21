import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import TreeDecoratePanel from "@/components/TreeDecoratePanel";
import TreeStickerDragCanvas from "@/components/TreeStickerDragCanvas";
import TreeHabitFigureDragCanvas from "@/components/TreeHabitFigureDragCanvas";
import theme from "@/theme/theme";
import type { StickerRarity, StickerShape } from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useFamilyTreeDetail } from "@/hooks/useFamilyTree";
import { useDecorateTreeAction, useDecoratableCompletions } from "@/hooks/useTreeDecoration";
import { useDecorateTreeWithStickerAction, useMoveTreeStickerAction } from "@/hooks/useStickers";
import { useDecorateTreeWithHabitFigureAction, useMoveTreeHabitFigureAction } from "@/hooks/useHabitCards";

const SUCCESS_DISPLAY_MS = 600;

/**
 * [2026-09-14追加・実装メモ224章] 飾り終わったあと`/supporter/family-tree`へ移る際、
 * `router.replace`だけだと直前のガチャ結果（`gacha-result.tsx`「木に飾る →」の
 * 画面）がスタックに残り、木の画面から戻ると飾り終わっているのにその画面へ
 * 戻ってしまう不具合があった（統括の実機報告）。詳しい理由・検討して不採用に
 * した方法（`dismissAll`・replaceの二重掛け・`navigation.reset()`）は
 * `app/child/tree-decorate.tsx`の同名関数のコメントを参照（3ロール共通の理由）。
 * `/supporter/family`（ホーム、S17への起点は必ずここを経由する）まで戻った
 * うえで`family-tree`を積み直すことで、木の画面からの「戻る」を必ずホームへ
 * 着地させる。
 */
function goToTreeWithCleanHistory() {
  router.dismissTo("/supporter/family");
  router.push("/supporter/family-tree");
}

/**
 * S17 木に飾る（みまもりメンバー、交換相手選択・自由配置）。P26/C20/S14「かざりつけモード」
 * 参照: 画面一覧・遷移図.md S17、主要画面ワイヤーフレーム.md 21.4節・32.3節、
 * 設計部/成果物/スキーマ設計.sql 49章、開発部/成果物/実装メモ.md 142章
 *
 * P29と全く同じ構造（トーンのみsupporter）。起点は3種類
 * （app/parent/tree-decorate.tsxのコメント参照）。
 *
 * [2026-09-17追加・要件定義書07-28章決定21] フィギュアの配置・移動
 * （`habitFigureGrantId`／`moveHabitFigureDecorationId`）にも対応する
 * （app/parent/tree-decorate.tsxと同型）。
 */
export default function SupporterTreeDecorateScreen() {
  const {
    drawId,
    purchaseId,
    moveDecorationId,
    shape,
    rarity,
    posX,
    posY,
    habitFigureGrantId,
    habitFigureKey,
    habitFigureKindEmoji,
    moveHabitFigureDecorationId,
  } = useLocalSearchParams<{
    drawId?: string;
    purchaseId?: string;
    moveDecorationId?: string;
    shape?: StickerShape;
    rarity?: StickerRarity;
    posX?: string;
    posY?: string;
    habitFigureGrantId?: string;
    habitFigureKey?: string;
    habitFigureKindEmoji?: string;
    moveHabitFigureDecorationId?: string;
  }>();
  const { state } = useAppData();
  const myId = state.activeParentMemberId;
  const { loadState: treeLoadState, season, dots, stickerPlacements, habitFigurePlacements, reload: reloadTree } = useFamilyTreeDetail();
  const { loadState: candidatesLoadState, candidates, reload: reloadCandidates } = useDecoratableCompletions(
    myId,
    season?.season_start ?? null,
    treeLoadState !== "loading"
  );
  const { decorating: decoratingGacha, decorate: decorateGacha } = useDecorateTreeAction();
  const { decorating: placingSticker, decorate: placeSticker } = useDecorateTreeWithStickerAction();
  const { moving: movingSticker, move: moveSticker } = useMoveTreeStickerAction();
  const { decorating: placingHabitFigure, decorate: placeHabitFigure } = useDecorateTreeWithHabitFigureAction();
  const { moving: movingHabitFigure, move: moveHabitFigure } = useMoveTreeHabitFigureAction();
  const [decorateError, setDecorateError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const isStickerMode = !!purchaseId || !!moveDecorationId;
  const isHabitFigureMode = !!habitFigureGrantId || !!moveHabitFigureDecorationId;

  if (!drawId && !purchaseId && !moveDecorationId && !habitFigureGrantId && !moveHabitFigureDecorationId) {
    return (
      <Screen tone="supporter">
        <Text style={theme.typography.supporterBody}>対象が見つかりませんでした</Text>
        <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/supporter/family")} />
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
    setTimeout(() => goToTreeWithCleanHistory(), SUCCESS_DISPLAY_MS);
  };

  const handleConfirmSticker = async (nx: number, ny: number) => {
    setDecorateError(null);
    const res = purchaseId ? await placeSticker(purchaseId, nx, ny) : await moveSticker(moveDecorationId!, nx, ny);
    if (!res.ok) {
      setDecorateError(res.error.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => goToTreeWithCleanHistory(), SUCCESS_DISPLAY_MS);
  };

  const handleConfirmHabitFigure = async (nx: number, ny: number) => {
    setDecorateError(null);
    const res = habitFigureGrantId
      ? await placeHabitFigure(habitFigureGrantId, nx, ny)
      : await moveHabitFigure(moveHabitFigureDecorationId!, nx, ny);
    if (!res.ok) {
      setDecorateError(res.error.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => goToTreeWithCleanHistory(), SUCCESS_DISPLAY_MS);
  };

  if (success) {
    return (
      <Screen tone="supporter">
        <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
          <Text style={{ fontSize: 40 }}>🎉</Text>
          <Text style={[theme.typography.supporterTitle, { marginTop: theme.spacing.s3 }]}>
            {moveDecorationId || moveHabitFigureDecorationId ? "動かしました" : "木に飾りました"}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen tone="supporter">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.supporterBody}>← もどる</Text>
      </Pressable>
      {/* [2026-09-21改訂・要件定義書07-34章「メダルとフィギュアの入れ替え」] 見出しの語を
          入れ替えた。 */}
      <Text style={[theme.typography.supporterTitle, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        {isHabitFigureMode
          ? moveHabitFigureDecorationId
            ? "メダルを動かす"
            : "メダルを飾る"
          : moveDecorationId
          ? "フィギュアを動かす"
          : purchaseId
          ? "フィギュアを飾る"
          : "木に飾る"}
      </Text>

      {isHabitFigureMode ? (
        <TreeHabitFigureDragCanvas
          tone="supporter"
          treeLoadState={treeLoadState}
          stage={season?.current_stage ?? 0}
          dots={dots}
          habitFigurePlacements={habitFigurePlacements}
          figureKey={habitFigureKey ?? ""}
          kindEmoji={habitFigureKindEmoji ?? null}
          mode={habitFigureGrantId ? "place" : "move"}
          movingDecorationId={moveHabitFigureDecorationId ?? null}
          initialPos={posX && posY ? { x: Number(posX), y: Number(posY) } : null}
          confirming={placingHabitFigure || movingHabitFigure}
          confirmErrorMessage={decorateError}
          onRetryLoad={reloadTree}
          onConfirm={handleConfirmHabitFigure}
        />
      ) : isStickerMode ? (
        <TreeStickerDragCanvas
          tone="supporter"
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
          tone="supporter"
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
