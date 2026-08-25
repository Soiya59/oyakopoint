/**
 * お絵かき（要件定義書07-13-2章、デザイントークン.md 1.9節）の丸いキャンバス。
 * 参照: 開発部/成果物/実装メモ.md「描画方式の調査」章（react-native-svg採用の経緯）。
 *
 * [設計方針]
 * - 座標はスキーマ設計.sql 33b章の仕様どおり、0〜1000に正規化した整数のフラット配列
 *   （[x1,y1,x2,y2,...]）として扱う。キャンバスの実ピクセルサイズ（デザイントークン.md
 *   1.9節: 直径280pt）には依存しない。
 * - 「一定距離未満の移動では点を追加しない」簡易な間引きを行う（33b章コメント
 *   「開発部への実装メモ」対応）。典型的な1枚をDB上限（20KB）よりずっと小さく保つため。
 * - PanResponderで指/マウスの動きを取る。react-native-webはPanResponderをサポートして
 *   おり（node_modules/react-native-web/src/vendor/react-native/PanResponder確認済み）、
 *   Expo Web export（GitHub Pages配信）でもマウスドラッグでの描画が動作する。
 */
import React, { useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import theme from "@/theme/theme";
import type { FamilyDrawingLine, FamilyDrawingLineData } from "@/types/domain";

const MIN_POINT_DISTANCE_PX = 4;

function pointsToPolylineString(p: number[], size: number): string {
  const out: string[] = [];
  for (let i = 0; i < p.length - 1; i += 2) {
    const x = (p[i] / 1000) * size;
    const y = (p[i + 1] / 1000) * size;
    out.push(`${x},${y}`);
  }
  return out.join(" ");
}

interface DrawingCanvasProps {
  /** 直径（pt）。デザイントークン.md 1.9節「直径280pt」がデフォルト。 */
  size?: number;
  /** 選択中の色（8色パレットのHEXコードのいずれか）。 */
  color: string;
  /** すでに確定済みの線（0〜1000正規化座標）。 */
  lines: FamilyDrawingLine[];
  /** 1本描き終える（指を離す）たびに呼ばれる。1点しか無いタップは呼ばれない。 */
  onStrokeEnd: (line: FamilyDrawingLine) => void;
  /** 上限到達時・保存中などにtrueにして新規ストロークの開始をブロックする。 */
  disabled?: boolean;
}

export function DrawingCanvas({
  size = theme.drawingLimits.canvasDiameter,
  color,
  lines,
  onStrokeEnd,
  disabled = false,
}: DrawingCanvasProps) {
  const [livePoints, setLivePoints] = useState<number[]>([]);
  const colorRef = useRef(color);
  colorRef.current = color;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const linesCountRef = useRef(lines.length);
  linesCountRef.current = lines.length;
  const currentPointsRef = useRef<number[]>([]);

  const toNormalized = (px: number, py: number): [number, number] => {
    const nx = Math.max(0, Math.min(1000, Math.round((px / size) * 1000)));
    const ny = Math.max(0, Math.min(1000, Math.round((py / size) * 1000)));
    return [nx, ny];
  };

  const finishStroke = () => {
    const pts = currentPointsRef.current;
    currentPointsRef.current = [];
    setLivePoints([]);
    // DB側chk_family_drawings_line_data（33b章）はp配列2要素以上を要求する。
    // 1点だけのタップ（指を置いてすぐ離した）は線として保存しない。
    if (pts.length < 2) return;
    onStrokeEnd({ c: colorRef.current, p: pts });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        !disabledRef.current && linesCountRef.current < theme.drawingLimits.maxLines,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderGrant: (evt) => {
        if (disabledRef.current || linesCountRef.current >= theme.drawingLimits.maxLines) return;
        const { locationX, locationY } = evt.nativeEvent;
        const [nx, ny] = toNormalized(locationX, locationY);
        currentPointsRef.current = [nx, ny];
        setLivePoints([nx, ny]);
      },
      onPanResponderMove: (evt) => {
        if (disabledRef.current) return;
        const pts = currentPointsRef.current;
        if (pts.length === 0) return;
        // 1本あたりの座標点数上限（DB側は300点=p配列600要素、33b章）に達したら、
        // このストロークではこれ以上点を追加しない（指を動かしても線が伸びなくなる）。
        if (pts.length / 2 >= theme.drawingLimits.maxPointsPerLine) return;
        const { locationX, locationY } = evt.nativeEvent;
        const [nx, ny] = toNormalized(locationX, locationY);
        const lastX = pts[pts.length - 2];
        const lastY = pts[pts.length - 1];
        // 「一定距離未満の移動では点を追加しない」簡略化（33b章コメント対応）。
        // 正規化後(0-1000)スケールでの距離判定に、size基準のpxしきい値を変換して使う。
        const thresholdNormalized = (MIN_POINT_DISTANCE_PX / size) * 1000;
        const dx = nx - lastX;
        const dy = ny - lastY;
        if (dx * dx + dy * dy < thresholdNormalized * thresholdNormalized) return;
        const next = [...pts, nx, ny];
        currentPointsRef.current = next;
        setLivePoints(next);
      },
      onPanResponderRelease: finishStroke,
      onPanResponderTerminate: finishStroke,
    })
  ).current;

  return (
    <View
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
      {...panResponder.panHandlers}
    >
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={theme.colors.neutralSurface} />
        {lines.map((line, idx) => (
          <Polyline
            key={idx}
            points={pointsToPolylineString(line.p, size)}
            fill="none"
            stroke={line.c}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {livePoints.length >= 2 && (
          <Polyline
            points={pointsToPolylineString(livePoints, size)}
            fill="none"
            stroke={color}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </Svg>
    </View>
  );
}

/** コレクター棚等での小さい静止プレビュー用（非インタラクティブ）。上限到達時の自分の絵一覧に使う。 */
export function DrawingThumbnail({ lineData, size = 72 }: { lineData: FamilyDrawingLineData; size?: number }) {
  return (
    <View style={[styles.circle, styles.thumbnail, { width: size, height: size, borderRadius: size / 2 }]}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={theme.colors.neutralSurface} />
        {lineData.lines.map((line, idx) => (
          <Polyline
            key={idx}
            points={pointsToPolylineString(line.p, size)}
            fill="none"
            stroke={line.c}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderWidth: 2,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
    overflow: "hidden",
    alignSelf: "center",
  },
  thumbnail: {
    borderWidth: 1,
  },
});

export default DrawingCanvas;
