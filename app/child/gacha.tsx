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
 * C21 ガチャ（子ども）
 * 参照: 画面一覧・遷移図.md C21、主要画面ワイヤーフレーム.md 21.2節
 *
 * 構造・ロジックはGachaDrawPanel（3ロール共通）に集約する（依頼「共通コンポーネント
 * として作ること」対応）。子どものみ`router.push`でC22（結果画面）へ遷移する
 * （ここでは`replace`を使わない。まだ引けるうちは何度でもこの画面に戻れてよいため）。
 * [2026-08-26改訂・第4段階] 21.2節「未配置の景品あり」案内カード用に
 * `useUndecoratedGachaDraw`を追加した。
 */
export default function ChildGachaScreen() {
  const { state } = useAppData();
  const myId = state.activeChildMemberId;
  const { loadState, remaining, canDrawNow, reload } = useGachaProgress(myId);
  const { drawing, draw } = useGachaDrawAction();
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
      pathname: "/child/gacha-result",
      params: {
        drawId: res.data.draw_id,
        prizeKind: res.data.prize_kind,
        presetOrnamentId: res.data.preset_ornament_id ?? "",
        prizeDrawingId: res.data.prize_drawing_id ?? "",
      },
    });
  };

  return (
    <Screen tone="child">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.childBody}>← もどる</Text>
        </Pressable>
      </View>
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        🎰 ガチャ
      </Text>

      <GachaDrawPanel
        tone="child"
        loadState={loadState}
        remaining={remaining}
        canDrawNow={canDrawNow}
        drawing={drawing}
        drawErrorMessage={drawErrorMessage}
        onDraw={handleDraw}
        onRetryLoad={reload}
        undecoratedDrawId={undecoratedDraw?.draw_id ?? null}
        onGoToDecorate={(drawId) =>
          router.push({ pathname: "/child/tree-decorate", params: { drawId } })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
});
