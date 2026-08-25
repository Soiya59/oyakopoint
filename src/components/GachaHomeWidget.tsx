/**
 * 「あと◯回でガチャ」ホームウィジェット（P7／C5／S1）の3ロール共通コンポーネント。
 * 参照: 主要画面ワイヤーフレーム.md 21.0節決定1・21.1節。
 *
 * 07-13-1章「これが本機能の中核であり、単なる補助表示ではない」との明記どおり、
 * 既存の家族の木ミニウィジェット（20.6節決定7、控えめ表示）とは別の専用コンポーネント
 * として、専用の差し色（color-gacha-accent）と5コマ表示を持たせる。
 *
 * ロールごとに違うのは文言・タイポグラフィ・5コマのサイズのみで、状態遷移
 * （読み込み中／未到達／到達／通信エラー）のロジックは共通にする。
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import GachaProgressDots from "./GachaProgressDots";
import theme from "@/theme/theme";

type Tone = "parent" | "child" | "supporter";

export interface GachaHomeWidgetProps {
  tone: Tone;
  loadState: "loading" | "error" | "ready";
  /** あと何回で引けるか（0〜5）。loadState==="ready"のときのみ意味を持つ。 */
  remaining: number;
  canDrawNow: boolean;
  /** タップ時の遷移（ガチャ画面へ）。読み込み中・エラー時はタップ不可。 */
  onPress: () => void;
}

const bodyStyleFor = (tone: Tone) =>
  tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;

export function GachaHomeWidget({ tone, loadState, remaining, canDrawNow, onPress }: GachaHomeWidgetProps) {
  const bodyStyle = bodyStyleFor(tone);
  const dotSize = theme.gachaPlateSize[tone];

  if (loadState === "loading") {
    return (
      <Card tone={tone} style={styles.card}>
        <View style={styles.skeletonLine} />
        <View style={{ marginTop: theme.spacing.s2 }}>
          <GachaProgressDots remaining={5} size={dotSize} />
        </View>
      </Card>
    );
  }

  if (loadState === "error") {
    // 主要画面ワイヤーフレーム.md 21.1節「通信エラー」: 赤色・再試行ボタンは使わず、
    // 19.2節「今週のできごとカードの通信エラー」と同じ控えめな文言に差し替える。
    return (
      <Card tone={tone} style={styles.card}>
        <Text style={bodyStyle}>また あとで みてみてね</Text>
      </Card>
    );
  }

  const title = canDrawNow
    ? tone === "child"
      ? "🎉 ガチャが ひけるよ！"
      : "🎉 ガチャが 引けます"
    : tone === "child"
    ? `🎰 あと${remaining}かいで ガチャ！`
    : `🎰 あと${remaining}回で ガチャ`;

  const actionLabel = canDrawNow ? (tone === "child" ? "まわしに いく →" : "まわす →") : "→";

  return (
    <Pressable onPress={onPress}>
      <Card
        tone={tone}
        style={{
          ...styles.card,
          ...(canDrawNow ? { backgroundColor: theme.gachaColors.accentSoft, borderColor: theme.gachaColors.accent } : null),
        }}
      >
        <Text style={bodyStyle}>{title}</Text>
        <View style={styles.bottomRow}>
          <GachaProgressDots remaining={remaining} size={dotSize} />
          <Text style={[bodyStyle, styles.action]}>{actionLabel}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: theme.spacing.s3 },
  bottomRow: {
    marginTop: theme.spacing.s2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  action: { color: theme.colors.neutralTextSecondary },
  skeletonLine: {
    height: 18,
    borderRadius: theme.radius.parentMd,
    backgroundColor: theme.colors.neutralBorder,
    opacity: 0.6,
  },
});

export default GachaHomeWidget;
