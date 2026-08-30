/**
 * クラッカー程度の簡単な紙吹雪。
 *
 * [2026-08-29追加・本部長／軽微変更ルート] ユーザーの要望
 * 「NFCしたら、よくできました！とか少し音も加え、すごい簡単なアニメーション
 *  （クラッカー程度）を想定している。達成感を出すため」への対応。
 *
 * **ライブラリを追加していない。** React Native標準の `Animated` だけで作っている。
 * lottie等を入れるとネイティブ依存になり、将来アプリ化したときにストア再ビルドが
 * 必要な種類の変更になるため（要件定義書08章「実装状況の記録」参照）。
 *
 * 音は入れていない。ライブラリ追加が要るうえ、ブラウザは「ユーザー操作の直後」以外の
 * 自動再生をブロックするため、NFCタグからURLで開いた直後は鳴らない可能性が高い
 * （本部長・ユーザー協議で「音はアプリ化以降」と決定）。
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import theme from "@/theme/theme";

const PIECE_COUNT = 12;
const DURATION_MS = 1200;

/** 紙吹雪の色。お絵かきの8色パレットをそのまま使う（2026-08-29に赤・ピンクを見直し済み）。 */
const COLORS = theme.drawingPalette.filter((c) => c.name !== "くろ").map((c) => c.value);

interface Piece {
  left: number;
  delay: number;
  color: string;
  size: number;
  drift: number;
  spin: number;
}

/**
 * 見た目のばらつきは固定の擬似乱数で作る（毎回同じ配置でよい）。
 * 家族全員で同じ絵を見る家族の木（FamilyTree.tsx）と違い、ここは同一である必要は
 * 無いが、レンダーのたびに位置が変わると再描画で揺れるため、生成は1回に固定する。
 */
function buildPieces(): Piece[] {
  return Array.from({ length: PIECE_COUNT }).map((_, i) => {
    const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    return {
      left: 6 + r(1) * 88,
      // 落ち始めを「全体の進捗のうち何割の時点か」で持つ（0〜0.25）。
      delay: r(2) * 0.25,
      color: COLORS[i % COLORS.length],
      size: 7 + Math.round(r(3) * 6),
      drift: (r(4) - 0.5) * 60,
      spin: r(5) > 0.5 ? 1 : -1,
    };
  });
}

export interface ConfettiProps {
  /** 降る高さ。既定はポップアップ内に収まる程度。 */
  height?: number;
}

export function Confetti({ height = 180 }: ConfettiProps) {
  const pieces = useRef<Piece[]>(buildPieces()).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  return (
    // pointerEvents="none" にしないと、紙吹雪が消えたあとも透明な層が
    // 下のボタンのタップを吸ってしまう。
    <View style={[styles.wrap, { height }]} pointerEvents="none">
      {pieces.map((p, i) => {
        // 全部を同時に落とすと「カーテン」に見えるので、粒ごとに落ち始めをずらす。
        // Animated.Valueは1つだけ使い、interpolateのinputRangeをずらすことで表現する
        // （粒ごとにAnimationを作らないぶん軽い）。
        const start = p.delay;
        const translateY = progress.interpolate({
          inputRange: [0, start, 1],
          outputRange: [-20, -20, height],
        });
        const translateX = progress.interpolate({
          inputRange: [0, start, 1],
          outputRange: [0, 0, p.drift],
        });
        const rotate = progress.interpolate({
          inputRange: [0, start, 1],
          outputRange: ["0deg", "0deg", `${p.spin * 540}deg`],
        });
        // 落ち切る手前で消す（下端で唐突に切れないように）。
        const opacity = progress.interpolate({
          inputRange: [0, 0.75, 1],
          outputRange: [1, 1, 0],
        });
        return (
          <Animated.View
            key={i}
            style={[
              styles.piece,
              {
                left: `${p.left}%`,
                width: p.size,
                height: p.size * 1.6,
                backgroundColor: p.color,
                opacity,
                transform: [{ translateY }, { translateX }, { rotate }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // bottomは指定しない。absoluteFillObject（top/right/bottom/left:0）にheightを
  // 重ねると高さの解釈が競合するため、上辺から height 分だけの帯として置く。
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    overflow: "hidden",
  },
  piece: {
    position: "absolute",
    top: 0,
    borderRadius: 2,
  },
});

export default Confetti;
