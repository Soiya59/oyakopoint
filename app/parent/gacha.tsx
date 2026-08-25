import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import GachaDrawPanel from "@/components/GachaDrawPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useGachaDrawAction, useGachaProgress } from "@/hooks/useGacha";

/**
 * P27 ガチャ（保護者）
 * 参照: 画面一覧・遷移図.md P27、主要画面ワイヤーフレーム.md 21.2節
 *
 * 構造・ロジックはGachaDrawPanel（3ロール共通）に集約し、本画面はトーン・
 * 遷移先・戻るボタンのラベルのみを渡す薄い殻にする（依頼「共通コンポーネントとして
 * 作ること」対応）。
 */
export default function ParentGachaScreen() {
  const { state } = useAppData();
  const myId = state.activeParentMemberId;
  const { loadState, remaining, canDrawNow, reload } = useGachaProgress(myId);
  const { drawing, draw } = useGachaDrawAction();
  const [drawErrorMessage, setDrawErrorMessage] = useState<string | null>(null);

  const handleDraw = async () => {
    setDrawErrorMessage(null);
    const res = await draw();
    if (!res.ok) {
      setDrawErrorMessage(res.error.message);
      return;
    }
    router.push({
      pathname: "/parent/gacha-result",
      params: {
        prizeKind: res.data.prize_kind,
        presetOrnamentId: res.data.preset_ornament_id ?? "",
        prizeDrawingId: res.data.prize_drawing_id ?? "",
      },
    });
  };

  return (
    <Screen tone="parent">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.parentBody}>← もどる</Text>
        </Pressable>
      </View>
      <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        🎰 ガチャ
      </Text>

      <GachaDrawPanel
        tone="parent"
        loadState={loadState}
        remaining={remaining}
        canDrawNow={canDrawNow}
        drawing={drawing}
        drawErrorMessage={drawErrorMessage}
        onDraw={handleDraw}
        onRetryLoad={reload}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
});
