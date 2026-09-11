import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AvatarDrawingPanel from "@/components/AvatarDrawingPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { deleteMemberAvatar, saveMemberAvatar } from "@/data/api";
import type { FamilyDrawingLineData } from "@/types/domain";

/**
 * S26 アバターを描く（みまもりメンバー、本人のみ）
 * 参照: 要件定義書07-27章 決定1〜22、主要画面ワイヤーフレーム.md 43章
 * （43.2節 決定7・43.7節ワイヤーフレーム）。
 *
 * 決定13: みまもりメンバーは自分の分のみ操作できるため`memberId`パラメータを持たない
 * （C31と同じ考え方。P38〈保護者、代理操作あり〉との違い）。
 */
export default function SupporterMyAvatarScreen() {
  const { state, memberAvatars, memberAvatarsLoaded, memberAvatarsError, refreshMemberAvatars, setMemberAvatarLocal, clearMemberAvatarLocal } =
    useAppData();
  const { client } = useSession();
  const myId = state.activeParentMemberId;
  const me = state.members.find((m) => m.id === myId);

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetErrorMessage, setResetErrorMessage] = useState<string | null>(null);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);

  const handleSave = async (lineData: FamilyDrawingLineData): Promise<boolean> => {
    setSaving(true);
    setErrorMessage(null);
    setSavedMessage(null);
    const res = await saveMemberAvatar(client, myId, lineData);
    setSaving(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return false;
    }
    setMemberAvatarLocal(myId, lineData);
    setSavedMessage("アバターを保存しました");
    setTimeout(() => setSavedMessage((prev) => (prev ? null : prev)), 4000);
    return true;
  };

  const handleReset = async (): Promise<boolean> => {
    setResetting(true);
    setResetErrorMessage(null);
    setResetSuccessMessage(null);
    const res = await deleteMemberAvatar(client, myId);
    setResetting(false);
    if (!res.ok) {
      setResetErrorMessage(res.error.message);
      return false;
    }
    clearMemberAvatarLocal(myId);
    setResetSuccessMessage("色にもどしました");
    setTimeout(() => setResetSuccessMessage((prev) => (prev ? null : prev)), 4000);
    return true;
  };

  return (
    <Screen tone="supporter">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.supporterBody}>← もどる</Text>
        </Pressable>
      </View>
      <Text style={[theme.typography.supporterTitle, styles.title]}>アバターを描く</Text>

      {/* 依頼3（企画部決定17）: ガチャの絵と取り違えないための常時表示の説明文言。 */}
      <Text style={[theme.typography.supporterBody, styles.explain]}>
        ここで描いた絵は、あなたのアバターになります。ガチャに出す絵とは別ものです（ガチャの景品にはなりません）
      </Text>

      {!me || !memberAvatarsLoaded ? (
        <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s4 }]}>読み込み中…</Text>
      ) : memberAvatarsError ? (
        <View style={{ marginTop: theme.spacing.s4, alignItems: "center" }}>
          <Text style={theme.typography.supporterBody}>読み込みに失敗しました</Text>
          <Pressable onPress={() => void refreshMemberAvatars()} style={{ marginTop: theme.spacing.s2 }}>
            <Text style={[theme.typography.supporterBody, styles.retryLink]}>もういちど</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <AvatarDrawingPanel
            tone="supporter"
            isProxy={false}
            displayName={me.display_name}
            backgroundColor={me.avatar_color ?? theme.colors.neutralBorder}
            savedLineData={memberAvatars[myId] ?? null}
            saving={saving}
            errorMessage={errorMessage}
            savedMessage={savedMessage}
            onSave={handleSave}
            resetting={resetting}
            resetErrorMessage={resetErrorMessage}
            resetSuccessMessage={resetSuccessMessage}
            onReset={handleReset}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  title: { marginTop: theme.spacing.s3 },
  explain: { marginTop: theme.spacing.s3 },
  retryLink: { textDecorationLine: "underline" },
});
