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
 * S16 ガチャ結果（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md S16、主要画面ワイヤーフレーム.md 21.3節
 *
 * P28と全く同じ構成（GachaResultView等）を使う。トーンのみsupporter。
 * [2026-08-26改訂・第4段階] 「木に飾る」導線を実装した（P28と同じ理由）。
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
        />
      )}
    </Screen>
  );
}
