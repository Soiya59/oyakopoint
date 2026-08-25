/**
 * ガチャ画面（P27／C21／S15）本体の3ロール共通コンポーネント。
 * 参照: 主要画面ワイヤーフレーム.md 21.2節。
 *
 * 「まわす」操作自体（`draw_gacha()`呼び出し、抽選中の短い待機）はここでは行わず、
 * 呼び出し側（各ロールの画面）が`useGachaDrawAction`で行った結果をpropsで渡す
 * （DrawingBoardと同じ役割分担：本コンポーネントは表示とボタンの活性/非活性のみに責任を持つ）。
 *
 * [今回のスコープ外の確認] 21.2節「未配置の景品あり」の案内カードは、木への飾り付け
 * （`decorate_tree_with_gacha_prize()`、第4段階）が前提の状態であり、本コンポーネントには
 * 実装しない（依頼「第4段階には手を付けない」に対応。開発部/成果物/実装メモ.md参照）。
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import GachaProgressDots from "./GachaProgressDots";
import { ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";

type Tone = "parent" | "child" | "supporter";

export interface GachaDrawPanelProps {
  tone: Tone;
  loadState: "loading" | "error" | "ready";
  remaining: number;
  canDrawNow: boolean;
  /** 抽選中（`draw_gacha()`呼び出し〜短い待機演出の終了まで）。 */
  drawing: boolean;
  /** 直近の「まわす」操作で発生した通信エラー文言。 */
  drawErrorMessage: string | null;
  onDraw: () => void;
  onRetryLoad: () => void;
}

const bodyStyleFor = (tone: Tone) =>
  tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;

export function GachaDrawPanel({
  tone,
  loadState,
  remaining,
  canDrawNow,
  drawing,
  drawErrorMessage,
  onDraw,
  onRetryLoad,
}: GachaDrawPanelProps) {
  const bodyStyle = bodyStyleFor(tone);
  const isChild = tone === "child";
  const dotSize = theme.gachaPlateSize[tone];

  if (loadState === "loading") {
    return <SkeletonList count={2} />;
  }

  if (loadState === "error") {
    return (
      <ErrorState
        tone={isChild ? "child" : "parent"}
        title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"}
        onRetry={onRetryLoad}
      />
    );
  }

  const title = canDrawNow
    ? isChild
      ? "ガチャが ひけるよ！"
      : "ガチャが引けます"
    : isChild
    ? `あと ${remaining}かいで ひけるよ`
    : `あと${remaining}回で引けます`;

  const drawLabel = canDrawNow
    ? drawErrorMessage && isChild
      ? "もういちど"
      : isChild
      ? "まわす！"
      : "まわす"
    : isChild
    ? `まわす（あと${remaining}かい）`
    : `まわす（あと${remaining}回）`;

  return (
    <View style={styles.container}>
      <View style={styles.dotsWrap}>
        <GachaProgressDots remaining={remaining} size={dotSize} />
      </View>
      <Text style={[bodyStyle, styles.title]}>{title}</Text>

      {drawErrorMessage && !isChild && <Text style={styles.errorText}>読み込みに失敗しました</Text>}
      {drawErrorMessage && isChild && <Text style={styles.errorText}>{drawErrorMessage}</Text>}

      <AppButton
        label={drawLabel}
        tone={tone}
        loading={drawing}
        disabled={!canDrawNow || drawing}
        onPress={onDraw}
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", marginTop: theme.spacing.s8 },
  dotsWrap: { marginBottom: theme.spacing.s4 },
  title: { marginBottom: theme.spacing.s6, textAlign: "center" },
  button: { marginTop: theme.spacing.s2, minWidth: 200 },
  errorText: { color: theme.colors.statusBlocking, marginBottom: theme.spacing.s3, textAlign: "center" },
});

export default GachaDrawPanel;
