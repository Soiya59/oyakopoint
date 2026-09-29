import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import GachaDrawPanel from "@/components/GachaDrawPanel";
import { describeApiFailure, type FailureDisplay } from "@/lib/apiFailureDisplay";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useGachaDrawAction, useGachaProgress } from "@/hooks/useGacha";
import { useUndecoratedGachaDraw } from "@/hooks/useTreeDecoration";

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
  // [2026-08-26追加・第4段階] 21.2節「未配置の景品あり」案内カード用。
  const { draw: undecoratedDraw, reload: reloadUndecorated } = useUndecoratedGachaDraw(myId);
  // [2026-09-29変更・実装メモ331章] 生のエラー文言でなく、原因に応じた文言＋目印で出す。
  const [drawFailure, setDrawFailure] = useState<FailureDisplay | null>(null);

  const handleDraw = async () => {
    setDrawFailure(null);
    const res = await draw();
    if (!res.ok) {
      setDrawFailure(describeApiFailure("parent", res.error, { fallback: "読み込みに失敗しました", useDbMessage: false }));
      return;
    }
    void reloadUndecorated();
    router.push({
      pathname: "/parent/gacha-result",
      params: {
        drawId: res.data.draw_id,
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
      {/* [2026-09-16追加・主要画面ワイヤーフレーム.md 45.7.3節、実装メモ.md 227章]
          常時表示の一文。GachaHomeWidget（3ロール共通部品）には足さず、保護者専用の
          この画面ファイル側にのみ追加する（こども側への波及を避けるため、45.7.3節
          却下案参照）。 */}
      <Text
        style={[
          theme.typography.parentCaption,
          { marginTop: theme.spacing.s2, textAlign: "center", color: theme.colors.neutralTextSecondary },
        ]}
      >
        クエストをがんばると引けるようになる、景品ガチャです。{"\n"}
        当たった景品はコレクションに入ります。{"\n"}
        コレクションでは、景品を大きく表示できます。{"\n"}
        木に飾れるのは家族の絵だけです（絵文字は飾れません）。
      </Text>

      <GachaDrawPanel
        tone="parent"
        loadState={loadState}
        remaining={remaining}
        canDrawNow={canDrawNow}
        drawing={drawing}
        drawErrorMessage={drawFailure?.message ?? null}
        drawErrorRef={drawFailure?.ref ?? null}
        onDraw={handleDraw}
        onRetryLoad={reload}
        undecoratedDrawId={undecoratedDraw?.draw_id ?? null}
        onGoToDecorate={(drawId) =>
          router.push({ pathname: "/parent/tree-decorate", params: { drawId } })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
});
