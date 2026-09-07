import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import TreeDecoratePanel from "@/components/TreeDecoratePanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useFamilyTreeDetail } from "@/hooks/useFamilyTree";
import { useDecorateTreeAction, useDecoratableCompletions } from "@/hooks/useTreeDecoration";
import { useDecorateTreeWithStickerAction } from "@/hooks/useStickers";

const SUCCESS_DISPLAY_MS = 600;

/**
 * P29 木に飾る（保護者、交換相手選択。P26/C20/S14「かざりつけモード」）
 * 参照: 画面一覧・遷移図.md P29、主要画面ワイヤーフレーム.md 21.4節・32.3節
 *
 * P28（app/parent/gacha-result.tsx）から`drawId`を受け取る（ガチャ景品）か、
 * P31区画3（app/parent/collector-shelf.tsx）「木に かざる」から`purchaseId`を
 * 受け取る（購入ステッカー、07-19-9a章「決定16」・32.0節決定7）。構造・ロジックは
 * TreeDecoratePanel（3ロール共通）に集約し、本画面はトーン・遷移先・起点に応じた
 * 呼び出し先RPCの切替のみを担う（依頼「共通コンポーネントとして作ること」対応。
 * 木のビジュアル・一覧UIから選ぶ方式・確定処理はすべて共通コンポーネントを再利用）。
 */
export default function ParentTreeDecorateScreen() {
  const { drawId, purchaseId } = useLocalSearchParams<{ drawId?: string; purchaseId?: string }>();
  const { state } = useAppData();
  const myId = state.activeParentMemberId;
  const { loadState: treeLoadState, season, dots, reload: reloadTree } = useFamilyTreeDetail();
  const { loadState: candidatesLoadState, candidates, reload: reloadCandidates } = useDecoratableCompletions(
    myId,
    season?.season_start ?? null,
    treeLoadState !== "loading"
  );
  const { decorating: decoratingGacha, decorate: decorateGacha } = useDecorateTreeAction();
  const { decorating: decoratingSticker, decorate: decorateSticker } = useDecorateTreeWithStickerAction();
  const decorating = decoratingGacha || decoratingSticker;
  const [decorateError, setDecorateError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!drawId && !purchaseId) {
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentBody}>対象が見つかりませんでした</Text>
        <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/parent/home")} />
      </Screen>
    );
  }

  const handleConfirm = async (completionId: string) => {
    setDecorateError(null);
    const res = purchaseId ? await decorateSticker(purchaseId, completionId) : await decorateGacha(drawId!, completionId);
    if (!res.ok) {
      setDecorateError(res.error.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => router.replace("/parent/family-tree"), SUCCESS_DISPLAY_MS);
  };

  if (success) {
    return (
      <Screen tone="parent">
        <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
          <Text style={{ fontSize: 40 }}>🎉</Text>
          <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3 }]}>木に飾りました</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.parentBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        {purchaseId ? "ステッカーを飾る" : "木に飾る"}
      </Text>

      <TreeDecoratePanel
        tone="parent"
        treeLoadState={treeLoadState}
        stage={season?.current_stage ?? 0}
        dots={dots}
        candidatesLoadState={candidatesLoadState}
        candidates={candidates}
        myMemberId={myId}
        decorationKind={purchaseId ? "sticker" : "prize"}
        decorating={decorating}
        decorateErrorMessage={decorateError}
        onRetryLoad={() => {
          reloadTree();
          reloadCandidates();
        }}
        onConfirm={handleConfirm}
      />
    </Screen>
  );
}
