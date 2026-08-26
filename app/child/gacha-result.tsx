import React from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import GachaResultView from "@/components/GachaResultView";
import { ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useGachaPrizeDetail } from "@/hooks/useGacha";
import type { GachaPrizeKind } from "@/types/domain";

/**
 * C22 ガチャ結果（子ども）
 * 参照: 画面一覧・遷移図.md C22、主要画面ワイヤーフレーム.md 21.3節
 *
 * 家族の絵が当たった場合、GachaResultView内部で「だれかの ひみつが...」→
 * 「ひみつが あいたよ！」の2段階開示演出になる（決定3、子ども向けのみ）。
 * [2026-08-26改訂・第4段階] 「木に飾る」導線を実装した。C21（app/child/gacha.tsx）
 * から受け取った`drawId`をそのままC23（app/child/tree-decorate.tsx）へ引き継ぐ。
 */
export default function ChildGachaResultScreen() {
  const { drawId, prizeKind, presetOrnamentId, prizeDrawingId } = useLocalSearchParams<{
    drawId?: string;
    prizeKind?: string;
    presetOrnamentId?: string;
    prizeDrawingId?: string;
  }>();
  const { loadState, detail } = useGachaPrizeDetail(
    (prizeKind as GachaPrizeKind) ?? null,
    presetOrnamentId || null,
    prizeDrawingId || null
  );

  return (
    <Screen tone="child">
      <Text style={[theme.typography.childHeadline, { textAlign: "center" }]}>ガチャけっか</Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s6 }}>
          <SkeletonList count={2} />
        </View>
      )}
      {loadState === "error" && (
        <ErrorState tone="child" title="つうしんがおやすみ中みたい" onRetry={() => router.back()} />
      )}
      {loadState === "ready" && detail && (
        <GachaResultView
          tone="child"
          result={detail}
          onDecorate={() => router.push({ pathname: "/child/tree-decorate", params: { drawId: drawId ?? "" } })}
        />
      )}
    </Screen>
  );
}
