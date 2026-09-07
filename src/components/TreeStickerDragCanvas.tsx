/**
 * 木の上でステッカーを自由にドラッグして配置・移動する画面（P29／C23／S17拡張、
 * 32.3節「木にステッカーを飾る」・スキーマ設計.sql 49章）本体の3ロール共通
 * コンポーネント。
 *
 * [2026-09-07改訂・本部長／実装メモ152章] 画面に出す呼び名は「メダル」に統一した
 * （統括判断）。コンポーネント名・DBの`sticker_key`・本コメントの「シール」
 * 「ステッカー」はそのまま変更していない。
 *
 * 統括要望「ステッカーは自分の好きなところに貼りたい」（2026-09-07）を受け、
 * ステッカーの木への配置は「本人の色丸1つと交換する」（`TreeDecoratePanel`が
 * 担っていた方式）から「木の上の任意の座標へ自由配置する」方式に変わった
 * （決定49-1〜49-2）。本コンポーネントはその配置・移動操作のUIを担う。
 *
 * [参考にした実装] お絵かき（`DrawingCanvas.tsx`）のPanResponderによる座標取得
 * （0〜1000正規化、Web版でのスクロール抑止`touchAction:"none"`を含む）と同じ
 * 仕組みを流用した。お絵かきは連続した線（複数点）を記録するのに対し、本
 * コンポーネントは「今どこにあるか」という単一の点だけを保持する点が異なる。
 *
 * [木のキャンバスとの座標系の共有について] `TreeStageVisual`はキャンバス幅を
 * 自身の`onLayout`で実測して保持しているため、外側から直接読み取れない。
 * 本コンポーネントは`TreeStageVisual`を子として描画し、その真上に同じ寸法
 * （幅100%・高さ`CANVAS_HEIGHT`）の透明なオーバーレイViewを重ね、そのオーバーレイ
 * 自身の`onLayout`で幅を実測する。オーバーレイは`TreeStageVisual`と同じ親の
 * 直下で幅100%を取るため、実測値は`TreeStageVisual`内部の`canvasWidth`と
 * 一致する（同じレイアウト制約〈親の幅いっぱい〉を受けるため）。
 *
 * [配置 or 移動の切替] `mode="place"`（新規配置、`purchaseId`を指定）と
 * `mode="move"`（既存配置の移動、`decorationId`と`initialPos`を指定）の
 * 2つのモードを持つ。移動モードでは、動かす対象の1件を`stickerPlacements`
 * （読み取り専用の他の配置一覧）から除外して二重に描画されないようにする
 * （`TreeStageVisual`の`hiddenStickerDecorationId`）。
 */
import React, { useRef, useState } from "react";
import { PanResponder, Platform, StyleSheet, Text, View, ViewStyle } from "react-native";
import AppButton from "./AppButton";
import { CANVAS_HEIGHT, STICKER_DOT_SIZE, TreeStageVisual } from "./FamilyTree";
import { StickerIcon } from "./StickerIcon";
import { ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";
import type { StickerRarity, StickerShape } from "@/theme/theme";
import type { FamilyTreeCompletionDot, FamilyTreeStickerPlacement } from "@/data/api";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";

/**
 * [2026-09-04対応・実装メモ126章と同じ理由] Web版でキャンバス上のドラッグが
 * ブラウザの縦スクロールに変換されるのを防ぐ。DrawingCanvas.tsxと同じ対応。
 */
const webTouchActionNoneStyle: ViewStyle =
  Platform.OS === "web" ? ({ touchAction: "none" } as unknown as ViewStyle) : {};

/** キャンバス実測前の初期値（DrawingCanvas.tsx・FamilyTree.tsxのFALLBACK_WIDTHと同じ考え方）。 */
const FALLBACK_WIDTH = 320;

const DEFAULT_POS = { x: 500, y: 500 };

export interface TreeStickerDragCanvasProps {
  tone: Tone;
  treeLoadState: LoadState;
  stage: number;
  dots: FamilyTreeCompletionDot[];
  /** 木の上にすでにある他の自由配置ステッカー（読み取り専用、背景として表示する）。 */
  stickerPlacements: FamilyTreeStickerPlacement[];
  /** 今まさに配置・移動しようとしているステッカーの絵柄（ドラッグ中のプレビュー表示用）。 */
  shape: StickerShape;
  rarity: StickerRarity;
  /** "place"＝新規配置（decorate_tree_with_sticker）、"move"＝既存配置の座標変更（move_tree_sticker）。 */
  mode: "place" | "move";
  /** mode="move"のとき、動かす対象の現在の配置ID（stickerPlacementsから除外し二重描画を防ぐ）。 */
  movingDecorationId?: string | null;
  /** 初期座標（mode="move"なら現在の座標、mode="place"なら通常は指定しない＝中央から始める）。 */
  initialPos?: { x: number; y: number } | null;
  confirming: boolean;
  confirmErrorMessage: string | null;
  onRetryLoad: () => void;
  onConfirm: (posX: number, posY: number) => void;
}

export function TreeStickerDragCanvas({
  tone,
  treeLoadState,
  stage,
  dots,
  stickerPlacements,
  shape,
  rarity,
  mode,
  movingDecorationId = null,
  initialPos = null,
  confirming,
  confirmErrorMessage,
  onRetryLoad,
  onConfirm,
}: TreeStickerDragCanvasProps) {
  const isChild = tone === "child";
  const bodyStyle =
    tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;

  const [pos, setPos] = useState(initialPos ?? DEFAULT_POS);
  const [canvasWidth, setCanvasWidth] = useState(FALLBACK_WIDTH);
  const posRef = useRef(pos);
  posRef.current = pos;
  const canvasWidthRef = useRef(canvasWidth);
  canvasWidthRef.current = canvasWidth;
  const confirmingRef = useRef(confirming);
  confirmingRef.current = confirming;

  const toNormalized = (px: number, py: number): { x: number; y: number } => {
    const x = Math.max(0, Math.min(1000, Math.round((px / canvasWidthRef.current) * 1000)));
    const y = Math.max(0, Math.min(1000, Math.round((py / CANVAS_HEIGHT) * 1000)));
    return { x, y };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !confirmingRef.current,
      onMoveShouldSetPanResponder: () => !confirmingRef.current,
      onPanResponderGrant: (evt) => {
        // Web版でのスクロール抑止の保険（DrawingCanvas.tsxと同じ理由。主たる
        // 防御はwebTouchActionNoneStyle）。
        evt.preventDefault?.();
        if (confirmingRef.current) return;
        const { locationX, locationY } = evt.nativeEvent;
        setPos(toNormalized(locationX, locationY));
      },
      onPanResponderMove: (evt) => {
        evt.preventDefault?.();
        if (confirmingRef.current) return;
        const { locationX, locationY } = evt.nativeEvent;
        setPos(toNormalized(locationX, locationY));
      },
    })
  ).current;

  if (treeLoadState === "loading") return <SkeletonList count={3} />;
  if (treeLoadState === "error") {
    return <ErrorState tone={isChild ? "child" : "parent"} title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"} onRetry={onRetryLoad} />;
  }

  const instructionText =
    mode === "place"
      ? isChild
        ? "ドラッグして すきな ばしょに おいてね"
        : "ドラッグして好きな場所に置いてください"
      : isChild
      ? "ドラッグして うごかしてね"
      : "ドラッグして動かしてください";

  const confirmLabel = mode === "place" ? (isChild ? "ここに かざる！" : "ここに飾る") : isChild ? "ここに うごかす！" : "ここに動かす";

  return (
    <View>
      <Text style={[bodyStyle, styles.instruction]}>{instructionText}</Text>

      <View style={styles.stack}>
        <TreeStageVisual
          stage={stage}
          dots={dots}
          stickerPlacements={stickerPlacements}
          hiddenStickerDecorationId={movingDecorationId}
        />
        <View
          style={[styles.dragOverlay, webTouchActionNoneStyle]}
          onLayout={(e) => setCanvasWidth(e.nativeEvent.layout.width)}
          {...panResponder.panHandlers}
        >
          <View
            pointerEvents="none"
            style={[
              styles.dragMarkerRing,
              {
                left: (pos.x / 1000) * canvasWidth - (STICKER_DOT_SIZE + 6) / 2,
                top: (pos.y / 1000) * CANVAS_HEIGHT - (STICKER_DOT_SIZE + 6) / 2,
                width: STICKER_DOT_SIZE + 6,
                height: STICKER_DOT_SIZE + 6,
                borderRadius: (STICKER_DOT_SIZE + 6) / 2,
              },
            ]}
          >
            <StickerIcon shape={shape} rarity={rarity} size={STICKER_DOT_SIZE} />
          </View>
        </View>
      </View>

      {confirmErrorMessage && <Text style={styles.errorText}>{confirmErrorMessage}</Text>}

      <AppButton
        label={confirmLabel}
        tone={tone}
        fullWidth
        loading={confirming}
        disabled={confirming}
        onPress={() => onConfirm(posRef.current.x, posRef.current.y)}
        style={styles.confirmButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  instruction: { textAlign: "center", marginTop: theme.spacing.s4, marginBottom: theme.spacing.s2 },
  // TreeStageVisualと同じ幅・高さのオーバーレイを重ねるための位置基準コンテナ。
  stack: { position: "relative", width: "100%" },
  dragOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: CANVAS_HEIGHT,
  },
  dragMarkerRing: {
    position: "absolute",
    borderWidth: 2,
    borderColor: theme.gachaColors.accent,
    backgroundColor: theme.colors.neutralSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: { color: theme.colors.statusBlocking, textAlign: "center", marginTop: theme.spacing.s3 },
  confirmButton: { marginTop: theme.spacing.s6 },
});

export default TreeStickerDragCanvas;
