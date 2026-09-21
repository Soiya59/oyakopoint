/**
 * 木の上でhabit_figure_catalog（入れ替え後の呼び名「メダル」、要件定義書07-28章
 * 決定21、スキーマ設計.sql 55.9章）を自由にドラッグして配置・移動する画面本体の
 * 3ロール共通コンポーネント。関数名`TreeHabitFigureDragCanvas`自体は07-34章5節の
 * 原則により変更していない（呼び名の入れ替え後も指しているデータは変わらない）。
 *
 * `TreeStickerDragCanvas.tsx`（sticker_catalog、入れ替え後の呼び名「フィギュア」の
 * 自由配置）と全く同じ操作方式（座標を0〜1000に正規化してドラッグ、
 * PanResponder）を流用するが、独立した別コンポーネントとして実装している
 * （主要画面ワイヤーフレーム.md 49.14章開発部への申し送り(3)）。
 *
 * [2026-09-21改訂・要件定義書07-34章、62.5節「結線の入れ替え」] ドラッグ中の
 * マーカーは、入れ替え前は五角形の枠（`FigureFrame`）だったが、呼び名の入れ替えに
 * 合わせて円形の枠（`CircleFrame`）＋`HabitFigureCircleIcon`（`StickerIcon.tsx`）に
 * 差し替えた。`TreeStickerDragCanvas.tsx`側が逆に五角形へ差し替わっており、
 * 混同しないための「形を分ける」という考え方自体は変えていない。
 */
import React, { useRef, useState } from "react";
import { PanResponder, Platform, StyleSheet, Text, View, ViewStyle } from "react-native";
import AppButton from "./AppButton";
import { CANVAS_HEIGHT, STICKER_DOT_SIZE, TreeStageVisual } from "./FamilyTree";
import { HabitFigureCircleIcon } from "./StickerIcon";
import CircleFrame from "./CircleFrame";
import { ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";
import type { FamilyTreeCompletionDot, FamilyTreeHabitFigurePlacement } from "@/data/api";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";

const webTouchActionNoneStyle: ViewStyle =
  Platform.OS === "web" ? ({ touchAction: "none" } as unknown as ViewStyle) : {};

const FALLBACK_WIDTH = 320;
const DEFAULT_POS = { x: 500, y: 500 };

export interface TreeHabitFigureDragCanvasProps {
  tone: Tone;
  treeLoadState: LoadState;
  stage: number;
  dots: FamilyTreeCompletionDot[];
  /** 木の上にすでにある他の自由配置フィギュア（読み取り専用、背景として表示する）。 */
  habitFigurePlacements: FamilyTreeHabitFigurePlacement[];
  /** 今まさに配置・移動しようとしているフィギュアの絵柄（ドラッグ中のプレビュー表示用）。 */
  figureKey: string;
  kindEmoji: string | null;
  /** "place"＝新規配置（decorate_tree_with_habit_figure）、"move"＝既存配置の座標変更（move_tree_habit_figure）。 */
  mode: "place" | "move";
  /** mode="move"のとき、動かす対象の現在の配置ID。 */
  movingDecorationId?: string | null;
  initialPos?: { x: number; y: number } | null;
  confirming: boolean;
  confirmErrorMessage: string | null;
  onRetryLoad: () => void;
  onConfirm: (posX: number, posY: number) => void;
}

export function TreeHabitFigureDragCanvas({
  tone,
  treeLoadState,
  stage,
  dots,
  habitFigurePlacements,
  figureKey,
  kindEmoji,
  mode,
  movingDecorationId = null,
  initialPos = null,
  confirming,
  confirmErrorMessage,
  onRetryLoad,
  onConfirm,
}: TreeHabitFigureDragCanvasProps) {
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
          habitFigurePlacements={habitFigurePlacements}
          hiddenHabitFigureDecorationId={movingDecorationId}
        />
        <View
          style={[styles.dragOverlay, webTouchActionNoneStyle]}
          onLayout={(e) => setCanvasWidth(e.nativeEvent.layout.width)}
          {...panResponder.panHandlers}
        >
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: (pos.x / 1000) * canvasWidth - (STICKER_DOT_SIZE + 6) / 2,
              top: (pos.y / 1000) * CANVAS_HEIGHT - (STICKER_DOT_SIZE + 6) / 2,
            }}
          >
            {/* [2026-09-21改訂・要件定義書07-34章、62.5節「結線の入れ替え」]
                habit_figure_catalog（入れ替え後「メダル」）はCircleFrame（円形の枠）＋
                HabitFigureCircleIconで表示する。FigureFrameは使わない。 */}
            <CircleFrame size={STICKER_DOT_SIZE + 6} ringColor={theme.gachaColors.accent}>
              <HabitFigureCircleIcon figureKey={figureKey} kindEmoji={kindEmoji} size={(STICKER_DOT_SIZE + 6) * 0.5} />
            </CircleFrame>
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
  stack: { position: "relative", width: "100%" },
  dragOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: CANVAS_HEIGHT,
  },
  errorText: { color: theme.colors.statusBlocking, textAlign: "center", marginTop: theme.spacing.s3 },
  confirmButton: { marginTop: theme.spacing.s6 },
});

export default TreeHabitFigureDragCanvas;
