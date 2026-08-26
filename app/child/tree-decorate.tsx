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

const SUCCESS_DISPLAY_MS = 600;

/**
 * C23 木に飾る（子ども、交換相手選択。P26/C20/S14「かざりつけモード」）
 * 参照: 画面一覧・遷移図.md C23、主要画面ワイヤーフレーム.md 21.4節
 *
 * C22（app/child/gacha-result.tsx）の「きに かざる →」から`drawId`を受け取り、
 * 自分の今シーズンの完了報告一覧から交換相手を選んで確定する
 * （`decorate_tree_with_gacha_prize()`）。構造・ロジックはTreeDecoratePanel
 * （3ロール共通）に集約し、本画面はトーン・遷移先のみを渡す薄い殻にする。
 */
export default function ChildTreeDecorateScreen() {
  const { drawId } = useLocalSearchParams<{ drawId?: string }>();
  const { state } = useAppData();
  const myId = state.activeChildMemberId;
  const { loadState: treeLoadState, season, dots, reload: reloadTree } = useFamilyTreeDetail();
  const { loadState: candidatesLoadState, candidates, reload: reloadCandidates } = useDecoratableCompletions(
    myId,
    season?.season_start ?? null
  );
  const { decorating, decorate } = useDecorateTreeAction();
  const [decorateError, setDecorateError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!drawId) {
    return (
      <Screen tone="child">
        <Text style={theme.typography.childBody}>けいひんが みつかりませんでした</Text>
        <AppButton
          label="やることリストへもどる"
          tone="child"
          style={{ marginTop: theme.spacing.s6 }}
          onPress={() => router.replace("/child/home")}
        />
      </Screen>
    );
  }

  const handleConfirm = async (completionId: string) => {
    setDecorateError(null);
    const res = await decorate(drawId, completionId);
    if (!res.ok) {
      setDecorateError(res.error.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => router.replace("/child/family-tree"), SUCCESS_DISPLAY_MS);
  };

  if (success) {
    return (
      <Screen tone="child">
        <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
          <Text style={{ fontSize: 48 }}>🎉</Text>
          <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3 }]}>かざったよ！</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen tone="child">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.childBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        きに かざる
      </Text>

      <TreeDecoratePanel
        tone="child"
        treeLoadState={treeLoadState}
        stage={season?.current_stage ?? 0}
        dots={dots}
        candidatesLoadState={candidatesLoadState}
        candidates={candidates}
        myMemberId={myId}
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
