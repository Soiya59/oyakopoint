import React, { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import GachaResultView from "@/components/GachaResultView";
import { ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useGachaPrizeDetail } from "@/hooks/useGacha";
import { playSound } from "@/lib/sound";
import type { GachaPrizeKind } from "@/types/domain";

/**
 * C22 ガチャ結果（子ども）
 * 参照: 画面一覧・遷移図.md C22、主要画面ワイヤーフレーム.md 21.3節
 *
 * 家族の絵が当たった場合、GachaResultView内部で「だれかの ひみつが...」→
 * 「ひみつが あいたよ！」の2段階開示演出になる（決定3、子ども向けのみ）。
 * [2026-08-26改訂・第4段階] 「木に飾る」導線を実装した。C21（app/child/gacha.tsx）
 * から受け取った`drawId`をそのままC23（app/child/tree-decorate.tsx）へ引き継ぐ。
 *
 * [2026-09-14追加・やること.md 2-3「効果音」] ガチャの結果が出たとき（景品データの
 * 取得が完了しdetailが表示できる状態になったとき）に1回だけ鳴らす（統括決定）。
 * 家族の絵の2段階開示演出（上記）が始まる前の、結果が確定した瞬間に鳴らす
 * （開示演出自体には手を加えない）。
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

  const hasPlayedSoundRef = useRef(false);
  useEffect(() => {
    if (loadState !== "ready" || !detail) return;
    if (hasPlayedSoundRef.current) return;
    hasPlayedSoundRef.current = true;
    playSound("gacha");
  }, [loadState, detail]);

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
          onGoToShelf={() => router.replace("/child/collector-shelf")}
        />
      )}
    </Screen>
  );
}
