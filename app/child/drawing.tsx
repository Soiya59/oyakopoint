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
 * C24 おえかき（子ども）
 * 参照: 画面一覧・遷移図.md C24、主要画面ワイヤーフレーム.md 21.5節
 *
 * 決定4: キャンバス・パレットは3ロール共通コンポーネント（DrawingBoard等）を使う。
 * 子どものみ、保存成功時にC25（全画面演出）へ遷移する（`router.replace`で、
 * 使い終えたキャンバスへ「もどる」で戻れないようにする。app/child/report-sent.tsx
 * と同じ設計）。
 */
export default function ChildDrawingScreen() {
  const { state } = useAppData();
  const myId = state.activeChildMemberId;
  const { loadState, unpublished, atLimit, reload, save, remove, edit } = useMyDrawings(myId);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleSave = async (lineData: FamilyDrawingLineData): Promise<boolean> => {
    setSaving(true);
    setErrorMessage(null);
    const res = await save(lineData);
    setSaving(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return false;
    }
    router.replace("/child/drawing-done");
    return true;
  };

  /**
   * API仕様.md 12.2a章「未公開の絵を編集する」。ガチャ競合時
   * （`check_violation`、対象の絵がすでに公開されていた）もDBのメッセージを
   * そのまま`errorMessage`に表示する（12.2a章「危険2」参照。ひらがな中心の
   * 文言指定はデザイントークン.md 2章に従いDB側メッセージをそのまま使う）。
   */
  const handleEditSave = async (drawingId: string, lineData: FamilyDrawingLineData): Promise<boolean> => {
    setSaving(true);
    setErrorMessage(null);
    const res = await edit(drawingId, lineData);
    setSaving(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return false;
    }
    router.replace("/child/drawing-done");
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
    <Screen tone="child">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.childBody}>← もどる</Text>
        </Pressable>
        <Text style={theme.typography.childBody}>
          ひみつ {unpublished.length}/{theme.drawingLimits.maxUnpublished}まい
        </Text>
      </View>
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        おえかき
      </Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={2} />
        </View>
      )}
      {loadState === "error" && <ErrorState tone="child" title="つうしんがおやすみ中みたい" onRetry={reload} />}

      {loadState === "ready" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <DrawingBoard
            tone="child"
            unpublished={unpublished}
            atLimit={atLimit}
            saving={saving}
            errorMessage={errorMessage}
            saveLabel="とっておく"
            clearLabel="ぜんぶ けす"
            undoLabel="ひとつ もどす"
            editLabel="なおす"
            onSave={handleSave}
            onEditSave={handleEditSave}
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
});
