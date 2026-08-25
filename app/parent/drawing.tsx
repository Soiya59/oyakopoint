import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import DrawingBoard from "@/components/DrawingBoard";
import { ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useMyDrawings } from "@/hooks/useDrawings";
import type { FamilyDrawingLineData } from "@/types/domain";

/**
 * P30 お絵かき（保護者）
 * 参照: 画面一覧・遷移図.md P30、主要画面ワイヤーフレーム.md 21.5節
 *
 * 決定4（21章）: キャンバス・パレットは3ロール共通コンポーネント
 * （DrawingBoard/DrawingCanvas/DrawingPalette）を使う。保護者は保存成功時に
 * 新しい画面へ遷移せず、画面内の控えめなスナックバーのみで完結する
 * （P20/S7と同じ演出強度。21.5節）。
 */
export default function ParentDrawingScreen() {
  const { state } = useAppData();
  const myId = state.activeParentMemberId;
  const { loadState, unpublished, atLimit, reload, save, remove } = useMyDrawings(myId);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showSavedSnackbar, setShowSavedSnackbar] = useState(false);

  const handleSave = async (lineData: FamilyDrawingLineData): Promise<boolean> => {
    setSaving(true);
    setErrorMessage(null);
    setShowSavedSnackbar(false);
    const res = await save(lineData);
    setSaving(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return false;
    }
    setShowSavedSnackbar(true);
    return true;
  };

  const handleDeleteRequest = async (drawingId: string) => {
    setDeletingId(drawingId);
    setErrorMessage(null);
    const res = await remove(drawingId);
    setDeletingId(null);
    if (!res.ok) setErrorMessage(res.error.message);
  };

  return (
    <Screen tone="parent">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.parentBody}>← もどる</Text>
        </Pressable>
        <Text style={theme.typography.parentBody}>
          ひみつ {unpublished.length}/{theme.drawingLimits.maxUnpublished}まい
        </Text>
      </View>
      <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3 }]}>お絵かき</Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={2} />
        </View>
      )}
      {loadState === "error" && <ErrorState title="読み込みに失敗しました" onRetry={reload} />}

      {loadState === "ready" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          {showSavedSnackbar && !atLimit && (
            <Text style={styles.snackbar}>ひみつが できました。だれかが みつけてくれるまで ないしょです</Text>
          )}
          <DrawingBoard
            tone="parent"
            unpublished={unpublished}
            atLimit={atLimit}
            saving={saving}
            errorMessage={errorMessage}
            saveLabel="せーぶする"
            clearLabel="ぜんぶけす"
            onSave={handleSave}
            onDeleteRequest={handleDeleteRequest}
            deletingId={deletingId}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  snackbar: {
    backgroundColor: theme.colors.brandPrimarySoft,
    color: theme.colors.brandPrimaryStrong,
    padding: theme.spacing.s3,
    borderRadius: theme.radius.parentMd,
    marginBottom: theme.spacing.s4,
    textAlign: "center",
  },
});
