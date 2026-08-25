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
 * P28 ガチャ結果（保護者）
 * 参照: 画面一覧・遷移図.md P28、主要画面ワイヤーフレーム.md 21.3節
 *
 * P27（app/parent/gacha.tsx）から`draw_gacha()`の戻り値（prizeKind・IDのみ）を
 * 遷移パラメータとして受け取り、表示に必要な詳細をここで取得する。
 *
 * [今回のスコープ外の確認] 「木に飾る」（`decorate_tree_with_gacha_prize()`、第4段階）は
 * 実装しない。GachaResultViewの「とじる」で前の画面（P27）に戻る。
 */
export default function ParentGachaResultScreen() {
  const { prizeKind, presetOrnamentId, prizeDrawingId } = useLocalSearchParams<{
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
    <Screen tone="parent">
      <Text style={[theme.typography.parentTitle, { textAlign: "center" }]}>ガチャ結果</Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s6 }}>
          <SkeletonList count={2} />
        </View>
      )}
      {loadState === "error" && (
        <ErrorState title="読み込みに失敗しました" onRetry={() => router.back()} />
      )}
      {loadState === "ready" && detail && (
        <GachaResultView tone="parent" result={detail} onClose={() => router.back()} />
      )}
    </Screen>
  );
}
