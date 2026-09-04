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
import { PanResponder, Platform, StyleSheet, View, ViewStyle } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import theme from "@/theme/theme";
import type { FamilyDrawingLine, FamilyDrawingLineData } from "@/types/domain";

/**
 * [2026-09-04対応・実装メモ126章] Web版（GitHub Pagesをモバイルブラウザで開く運用）で、
 * キャンバス上で指を動かして線を引こうとすると、ブラウザが標準の縦スクロール操作だと
 * 解釈してしまい画面が動く不具合への対処。CSSの`touch-action: none`をキャンバスの
 * ルート要素に効かせ、ブラウザ側のタッチ→スクロール変換そのものを起こさせないようにする。
 * react-native-web自身がScrollViewのスクロール無効化に同じ手法を使っている
 * （node_modules/react-native-web/dist/exports/ScrollView/ScrollViewBase.js の
 * `scrollDisabled`スタイルで`touchAction: 'none'`を使用しており、実行時にreact-native-webが
 * このキーをそのままDOMのCSSへ渡すことを確認済み）ため、実行時の安全性は確認できている。
 * ただし`'react-native'`の`ViewStyle`型には`touchAction`が定義されておらず、そのまま
 * オブジェクトリテラルに書くとTSの型エラーになる。`as unknown as ViewStyle`で型だけを
 * 逃がす（`@ts-expect-error`より、値自体に説明コメントを添えられるこちらを選んだ）。
 * ネイティブ（iOS/Android実機。現状はWeb版運用のため未使用）ではこのキー自体が
 * 意味を持たないためPlatform.OS==="web"のときだけ付与する。
 */
const webTouchActionNoneStyle: ViewStyle =
  Platform.OS === "web" ? ({ touchAction: "none" } as unknown as ViewStyle) : {};

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
        // Web版でのスクロール抑止の保険（主たる防御はwebTouchActionNoneStyle）。
        // react-native-webの responder システムは document に touchstart/touchmove
        // リスナーを{passive: true}指定無しで登録している
        // （node_modules/react-native-web/dist/modules/useResponderEvents/ResponderSystem.js
        // のattachListeners内`document.addEventListener(eventType, eventListener)`）が、
        // Chrome等のブラウザはwindow/document直下のtouchstart/touchmoveリスナーを
        // 既定でpassive扱いする仕様介入を持つため、実際にpreventDefault()が効くかは
        // ブラウザ実装依存。効かせられなくても実害は無く（`touch-action: none`が
        // 別途スクロールを止める）、これ以上は深追いしない方針とした。
        evt.preventDefault?.();
        if (disabledRef.current || linesCountRef.current >= theme.drawingLimits.maxLines) return;
        const { locationX, locationY } = evt.nativeEvent;
        const [nx, ny] = toNormalized(locationX, locationY);
        currentPointsRef.current = [nx, ny];
        setLivePoints([nx, ny]);
      },
      onPanResponderMove: (evt) => {
        evt.preventDefault?.();
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
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2 },
        // キャンバスの矩形の上でだけスクロールを止める。この`View`の外
        // （題名入力欄・パレット・保存ボタン・過去の絵の一覧）にはこのスタイルを
        // 付けないため、画面全体のスクロール（Screenのscroll=true）は従来どおり働く。
        webTouchActionNoneStyle,
      ]}
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
