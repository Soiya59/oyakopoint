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
 * P28 ガチャ結果（保護者）
 * 参照: 画面一覧・遷移図.md P28、主要画面ワイヤーフレーム.md 21.3節
 *
 * P27（app/parent/gacha.tsx）から`draw_gacha()`の戻り値（prizeKind・IDのみ）を
 * 遷移パラメータとして受け取り、表示に必要な詳細をここで取得する。
 *
 * [2026-08-26改訂・第4段階] 「木に飾る」導線を実装した。P27から受け取った`drawId`を
 * そのままP29（app/parent/tree-decorate.tsx）へ引き継ぐ。
 *
 * [2026-09-16追加・やること.md 2-3「効果音」保護者・みまもりへの拡張]
 * app/child/gacha-result.tsx（C22）と全く同じタイミング（`loadState`が
 * `"ready"`になり`detail`が揃った瞬間）に1回だけ鳴らす。二重発火防止も
 * 同じくuseRefで行う。
 */
export default function ParentGachaResultScreen() {
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
        <GachaResultView
          tone="parent"
          result={detail}
          onDecorate={() => router.push({ pathname: "/parent/tree-decorate", params: { drawId: drawId ?? "" } })}
          onGoToShelf={() => router.replace("/parent/collector-shelf")}
        />
      )}
    </Screen>
  );
}
