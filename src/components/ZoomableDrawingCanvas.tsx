/**
 * お絵かき画面の拡大表示（主要画面ワイヤーフレーム.md 47章、開発部/成果物/実装メモ.md
 * 235章）。`DrawingBoard.tsx`が直接`DrawingCanvas`を描いていた箇所を、この部品に
 * 置き換える。`DrawingCanvas.tsx`本体・その座標正規化ロジックは変更していない
 * （47.3節決定8、47.4節決定12）。
 *
 * [仕組み]
 * - 外側の「窓」View（基準直径、円形の枠線・クリップを持つ）の中に、
 *   「基準直径×倍率」の大きさの`DrawingCanvas`（`chromeless`、枠無し）を
 *   `translate`で配置する。倍率1倍のときは窓と内側のサイズが一致し、
 *   translateは常に(0,0)になる＝本章適用前と見た目が完全に同一（47.3節決定8）。
 * - 基準直径は`Screen.tsx`のcontent幅（パディング済み）を`onLayout`で実測し、
 *   280〜360ptにクランプする（47.1節決定1・2、`src/lib/drawingZoomPan.ts`）。
 * - パン（移動）は2本指ドラッグのみ。`DrawingCanvas`の`onPan`（1本指描画中に
 *   2本目が触れたら描きかけの線を破棄して移動に切り替える。DrawingCanvas.tsx側で
 *   保証、47.3節決定9・10）から呼ばれる移動量を、`drawingZoomPan.ts`の
 *   `clampDrawingPan`で許容範囲内にクランプして反映する（47.3節決定11）。
 * - 倍率ボタンを押すたびにパン位置を中央へリセットする（決定11）。
 * - キャンバスが空になった瞬間（ぜんぶけす・保存成功・「ひとつ もどす」で0本化）、
 *   および編集開始（`startEdit`）の瞬間に、倍率・パン位置を1倍・中央へリセットする
 *   （47.6節決定15）。呼び出し元（`DrawingBoard.tsx`）から`lines`・`editingId`を
 *   そのまま受け取り、その変化を見て自律的にリセットする。
 */
import React, { useEffect, useRef, useState } from "react";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";
import DrawingCanvas from "./DrawingCanvas";
import DrawingZoomPicker from "./DrawingZoomPicker";
import theme from "@/theme/theme";
import {
  centerDrawingPan,
  clampBaseDiameter,
  clampDrawingPan,
  type DrawingZoomLevel,
} from "@/lib/drawingZoomPan";
import type { FamilyDrawingLine } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

interface ZoomableDrawingCanvasProps {
  tone: Tone;
  color: string;
  strokeWidth: number;
  lines: FamilyDrawingLine[];
  onStrokeEnd: (line: FamilyDrawingLine) => void;
  /** キャンバス自体（描画）の無効化。保存中・上限到達時（`saving || atCapacity`）を渡す。 */
  disabled?: boolean;
  /**
   * [47.2節本文「3つのボタンの実装」] 倍率ボタンの無効化。`disabled={saving}`のみとし、
   * `atCapacity`（上限到達）では無効化しない（既に描いた絵を拡大して見返す・
   * 「ひとつ もどす」の後に続きを描くために拡大したままにしておく、といった操作を
   * 妨げないため）。`disabled`（キャンバス自体の無効化）とは意図的に別のpropにしている。
   */
  zoomPickerDisabled?: boolean;
  /**
   * 47.6節決定15: nullから非nullへ変わった瞬間（未公開の絵の編集を開始した瞬間）に
   * 1倍・中央へリセットする。`DrawingBoard.tsx`の`editingId`をそのまま渡す。
   */
  editingId: string | null;
  /**
   * [2026-09-17追加・主要画面ワイヤーフレーム.md 48.5節決定17、実装メモ.md 236章]
   * 48章「まんなかに おおきく」ボタンで座標変換が成功するたびに1ずつ増える値。
   * `DrawingBoard.tsx`側でボタン押下・変換成功のたびにインクリメントして渡す。
   * 47.6節決定15の一覧（キャンバスが空になった瞬間・編集開始の瞬間）に、
   * 「48章のボタンを押した瞬間」を1行追記する形で1倍・中央へリセットする。
   */
  fitToCircleSignal: number;
  /**
   * [2026-09-17追加・実装メモ243章] `DrawingCanvas`の`onGestureActiveChange`を
   * そのまま上（`DrawingBoard.tsx`）へ橋渡しする。ここでは何も加工しない
   * （2本指パン自体は`handlePan`で別途処理しており、この値は「画面のスクロールを
   * 止めるべきか」だけを伝えるためのもの）。
   */
  onGestureActiveChange?: (active: boolean) => void;
}

export function ZoomableDrawingCanvas({
  tone,
  color,
  strokeWidth,
  lines,
  onStrokeEnd,
  disabled = false,
  zoomPickerDisabled = false,
  editingId,
  fitToCircleSignal,
  onGestureActiveChange,
}: ZoomableDrawingCanvasProps) {
  // 47.1節決定1: Screen.tsxのcontent幅（パディング済み）をonLayoutで実測する。
  // `Dimensions.get('window')`は使わない。初回描画前は旧来の固定直径280ptを仮置きする
  // （280は下限と同値のため、実測後にクランプしても値が飛ばない）。
  const [measuredWidth, setMeasuredWidth] = useState<number>(theme.drawingLimits.canvasDiameter);
  const baseDiameter = clampBaseDiameter(measuredWidth);

  const [zoom, setZoom] = useState<DrawingZoomLevel>(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // 47.6節決定15: 「ぜんぶけす」・保存成功・「ひとつ もどす」でキャンバスが
  // 0本になった瞬間に1倍・中央へ戻す。最初から0本（初期状態）ではリセットしない
  // （>0 → ===0 の遷移のときだけ発火させる）。
  const prevLinesLengthRef = useRef(lines.length);
  useEffect(() => {
    if (prevLinesLengthRef.current > 0 && lines.length === 0) {
      resetZoom();
    }
    prevLinesLengthRef.current = lines.length;
  }, [lines.length]);

  // 47.6節決定15: 編集開始（startEdit、editingIdがnull以外になった瞬間）は、
  // 読み込む絵の線の本数に関わらず常に1倍・中央から見せる。
  useEffect(() => {
    if (editingId !== null) {
      resetZoom();
    }
    // editingIdの変化だけを見る（他の依存はresetZoom自体が参照する最新stateで十分）。
  }, [editingId]);

  // 48.5節決定17: 48章の「まんなかに おおきく」ボタンで座標変換が成功するたびに
  // （2倍・3倍で拡大中であっても）1倍・中央へリセットする。初回マウント時は
  // 値が変化していない（前回値と同じ）ため発火しない（lines.length監視と同じ方式）。
  const prevFitToCircleSignalRef = useRef(fitToCircleSignal);
  useEffect(() => {
    if (prevFitToCircleSignalRef.current !== fitToCircleSignal) {
      resetZoom();
    }
    prevFitToCircleSignalRef.current = fitToCircleSignal;
  }, [fitToCircleSignal]);

  const handleLayout = (e: LayoutChangeEvent) => {
    setMeasuredWidth(e.nativeEvent.layout.width);
  };

  const handleSelectZoom = (next: DrawingZoomLevel) => {
    setZoom(next);
    // 47.3節決定11: 倍率を切り替えるたびに、パン位置を中央へ戻す
    // （ピンチのような「今見ている位置を中心に拡大する」動きはしない）。
    const center = centerDrawingPan(baseDiameter, next);
    setPan({ x: center, y: center });
  };

  // 47.3節決定9・10: 2本指ドラッグでのみ呼ばれる（DrawingCanvas.tsx側で保証、
  // 同ファイルのonPanResponderMove参照）。移動量をクランプ範囲内に収めて反映する。
  const handlePan = (dx: number, dy: number) => {
    setPan((prev) => ({
      x: clampDrawingPan(prev.x + dx, baseDiameter, zoom),
      y: clampDrawingPan(prev.y + dy, baseDiameter, zoom),
    }));
  };

  const innerSize = baseDiameter * zoom;

  return (
    <View style={styles.measureWrap} onLayout={handleLayout}>
      <DrawingZoomPicker tone={tone} selected={zoom} onSelect={handleSelectZoom} disabled={zoomPickerDisabled} />

      {/* 47.6節決定14: 外周の円形枠線・クリップは「窓」側にのみ持たせる。
          窓のサイズは基準直径のまま固定し、中の拡大キャンバスだけが動く。 */}
      <View
        style={[
          styles.window,
          { width: baseDiameter, height: baseDiameter, borderRadius: baseDiameter / 2 },
        ]}
      >
        <View
          style={{
            width: innerSize,
            height: innerSize,
            transform: [{ translateX: pan.x }, { translateY: pan.y }],
          }}
        >
          <DrawingCanvas
            size={innerSize}
            color={color}
            strokeWidth={strokeWidth}
            lines={lines}
            onStrokeEnd={onStrokeEnd}
            disabled={disabled}
            chromeless
            onPan={handlePan}
            onGestureActiveChange={onGestureActiveChange}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // width:"100%"にすることで、onLayoutの実測値がScreen.tsxのcontent幅
  // （パディングs4×2を引いた後の幅）とそのまま一致する（47.1節決定1）。
  measureWrap: { width: "100%", alignItems: "center" },
  window: {
    marginTop: theme.spacing.s4,
    borderWidth: 2,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
    overflow: "hidden",
    alignSelf: "center",
  },
});

export default ZoomableDrawingCanvas;
