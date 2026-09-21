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
 * [2026-09-14追加・実装メモ224章] 飾り終わったあと`/child/family-tree`へ移る際、
 * `router.replace`だけだと「飾る前に通ってきたガチャ結果（`gacha-result.tsx`、
 * 「きに かざる →」の画面）」がスタックに残ったままになり、木の画面で
 * ハードウェア戻る・スワイプ戻るを行うと、飾り終わっているのに
 * 「きに かざる →」へ戻ってしまう不具合があった（統括の実機報告）。
 *
 * 木の画面を最初に見せる導線自体は変えない（結果が見えるのは良い体験）。
 * 変えるのは「木の画面から戻ったときの行き先」だけ。`router.dismissTo(homePath)`は
 * 「現在のスタックに`homePath`が既にあれば、そこまで戻る（間の画面は全て破棄）。
 * 無ければ現在の画面をそのまま`homePath`に置き換える」という公式に文書化された
 * 挙動（node_modules/expo-router/build/global-state/router.d.ts）を持つ。
 * ガチャ・コレクター棚のいずれの起点でも、必ず`/child/home`を経由してから
 * この画面に辿り着いている（app/child/(tabs)/home.tsx → gacha/collector-shelf →
 * tree-decorate）ため、スタックには`/child/home`が必ず存在し、そこまで一気に
 * 戻ったうえで`family-tree`を新しく積み直す。結果、木の画面の「戻る」（ハード
 * ウェア戻る・スワイプ戻るのいずれも）は必ずホームに着地する。
 *
 * [検討して不採用にした方法]
 * - `router.dismissAll()`（POP_TO_TOP）: 現在のスタック全体の「一番最初の画面」
 *   まで戻る。このアプリはルートに`headerShown:false`の単一Stackを敷いている
 *   （app/_layout.tsx）ため、「一番最初の画面」はホームではなくログイン直後の
 *   画面（あるいはそれより前）になる可能性が高く、意図せずログイン画面等まで
 *   戻ってしまう恐れがあるため採用しなかった（実機・エミュレータで確認できず
 *   検証できなかったため、より挙動が読める`dismissTo`を選んだ）。
 * - `router.replace`を2回重ねる（例: 一度homeにreplace→続けてfamily-treeに
 *   replace）: これだと「replaceする直前の1画面」しか置き換わらないため、
 *   ガチャ結果より前の画面は変わらず、結局ガチャ結果が1段階手前の「戻り先」
 *   として残ってしまい、今回の不具合を解決しない。
 * - `navigation.reset()`（React Navigation標準API）: スタックを完全に組み直せる
 *   が、expo-routerのファイルベースルーティングが内部的にどの文字列を
 *   ルート名として登録しているかを確実に知る必要があり、指定を誤ると
 *   型エラー・実行時エラーの双方のリスクがある。`dismissTo`は同じ目的を
 *   `Href`文字列（既存コードで使っているものと同じ文字列）だけで実現できる
 *   公式APIのため、こちらを優先した。
 */
function goToTreeWithCleanHistory() {
  router.dismissTo("/child/home");
  router.push("/child/family-tree");
}

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
    // [2026-09-17追加・要件定義書07-28章決定21] フィギュアの木への配置（新規配置）。
    habitFigureGrantId?: string;
    habitFigureKey?: string;
    habitFigureKindEmoji?: string;
    // フィギュアの配置移動。
    moveHabitFigureDecorationId?: string;
  }>();
  const { state } = useAppData();
  const myId = state.activeChildMemberId;
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

  // [2026-09-17追加・要件定義書07-28章決定21] フィギュアの配置・移動。
  // `TreeStickerDragCanvas`と対になる`TreeHabitFigureDragCanvas`を使う。
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
      <Screen tone="child">
        <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
          <Text style={{ fontSize: 48 }}>🎉</Text>
          <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3 }]}>
            {moveDecorationId || moveHabitFigureDecorationId ? "うごかしたよ！" : "かざったよ！"}
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
      {/* [2026-09-21改訂・要件定義書07-34章「メダルとフィギュアの入れ替え」] 見出しの語を
          入れ替えた。isHabitFigureMode（habit_figure_catalog由来）は「メダル」、
          sticker由来は「フィギュア」になる。 */}
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        {isHabitFigureMode
          ? moveHabitFigureDecorationId
            ? "メダルを うごかす"
            : "メダルを きに かざる"
          : moveDecorationId
          ? "フィギュアを うごかす"
          : purchaseId
          ? "フィギュアを かざる"
          : "きに かざる"}
      </Text>

      {isHabitFigureMode ? (
        <TreeHabitFigureDragCanvas
          tone="child"
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
