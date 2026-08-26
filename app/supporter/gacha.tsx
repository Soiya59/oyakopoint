import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import GachaDrawPanel from "@/components/GachaDrawPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useGachaDrawAction, useGachaProgress } from "@/hooks/useGacha";
import { useUndecoratedGachaDraw } from "@/hooks/useTreeDecoration";

/**
 * S15 ガチャ（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md S15、主要画面ワイヤーフレーム.md 21.2節
 *
 * P27と全く同じ部品（GachaDrawPanel等）を使う。トーンのみsupporter。
 */
export default function SupporterGachaScreen() {
  const { state } = useAppData();
  const myId = state.activeParentMemberId;
  const { loadState, remaining, canDrawNow, reload } = useGachaProgress(myId);
  const { drawing, draw } = useGachaDrawAction();
  // [2026-08-26追加・第4段階] 21.2節「未配置の景品あり」案内カード用。
  const { draw: undecoratedDraw, reload: reloadUndecorated } = useUndecoratedGachaDraw(myId);
  const [drawErrorMessage, setDrawErrorMessage] = useState<string | null>(null);

  const handleDraw = async () => {
    setDrawErrorMessage(null);
    const res = await draw();
    if (!res.ok) {
      setDrawErrorMessage(res.error.message);
      return;
    }
    void reloadUndecorated();
    router.push({
      pathname: "/supporter/gacha-result",
      params: {
        drawId: res.data.draw_id,
        prizeKind: res.data.prize_kind,
        presetOrnamentId: res.data.preset_ornament_id ?? "",
        prizeDrawingId: res.data.prize_drawing_id ?? "",
      },
    });
  };

  return (
    <Screen tone="supporter">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.supporterBody}>← もどる</Text>
        </Pressable>
      </View>
      <Text style={[theme.typography.supporterTitle, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        🎰 ガチャ
      </Text>

      <GachaDrawPanel
        tone="supporter"
        loadState={loadState}
        remaining={remaining}
        canDrawNow={canDrawNow}
        drawing={drawing}
        drawErrorMessage={drawErrorMessage}
        onDraw={handleDraw}
        onRetryLoad={reload}
        undecoratedDrawId={undecoratedDraw?.draw_id ?? null}
        onGoToDecorate={(drawId) =>
          router.push({ pathname: "/supporter/tree-decorate", params: { drawId } })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
});
