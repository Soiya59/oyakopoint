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
 * S17 木に飾る（みまもりメンバー、交換相手選択。P26/C20/S14「かざりつけモード」）
 * 参照: 画面一覧・遷移図.md S17、主要画面ワイヤーフレーム.md 21.4節
 *
 * P29と全く同じ部品（TreeDecoratePanel等）を使う。トーンのみsupporter。
 */
export default function SupporterTreeDecorateScreen() {
  const { drawId } = useLocalSearchParams<{ drawId?: string }>();
  const { state } = useAppData();
  const myId = state.activeParentMemberId;
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
      <Screen tone="supporter">
        <Text style={theme.typography.supporterBody}>景品が見つかりませんでした</Text>
        <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />
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
    setTimeout(() => router.replace("/supporter/family-tree"), SUCCESS_DISPLAY_MS);
  };

  if (success) {
    return (
      <Screen tone="supporter">
        <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
          <Text style={{ fontSize: 40 }}>🎉</Text>
          <Text style={[theme.typography.supporterTitle, { marginTop: theme.spacing.s3 }]}>木に飾りました</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen tone="supporter">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.supporterBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.supporterTitle, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        木に飾る
      </Text>

      <TreeDecoratePanel
        tone="supporter"
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
