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
 * S16 ガチャ結果（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md S16、主要画面ワイヤーフレーム.md 21.3節
 *
 * P28と全く同じ構成（GachaResultView等）を使う。トーンのみsupporter。
 * [2026-08-26改訂・第4段階] 「木に飾る」導線を実装した（P28と同じ理由）。
 *
 * [2026-09-16追加・やること.md 2-3「効果音」保護者・みまもりへの拡張]
 * app/parent/gacha-result.tsx（P28）・app/child/gacha-result.tsx（C22）と
 * 同じタイミング・同じ二重発火防止（useRef）で鳴らす。
 */
export default function SupporterGachaResultScreen() {
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
    <Screen tone="supporter">
      <Text style={[theme.typography.supporterTitle, { textAlign: "center" }]}>ガチャ結果</Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s6 }}>
          <SkeletonList count={2} />
        </View>
      )}
      {loadState === "error" && (
        <ErrorState title="読み込みに失敗しました" onRetry={() => router.back()} />
      )}
      {loadState === "ready" && detail && (
        <GachaResultView
          tone="supporter"
          result={detail}
          onDecorate={() => router.push({ pathname: "/supporter/tree-decorate", params: { drawId: drawId ?? "" } })}
          onGoToShelf={() => router.replace("/supporter/collector-shelf")}
        />
      )}
    </Screen>
  );
}
