import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AvatarDrawingPanel from "@/components/AvatarDrawingPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { deleteMemberAvatar, saveMemberAvatar } from "@/data/api";
import type { FamilyDrawingLineData } from "@/types/domain";

/**
 * P38 アバターを描く（保護者。本人操作・代理操作を同じ画面が扱う）
 * 参照: 要件定義書07-27章 決定1〜22、主要画面ワイヤーフレーム.md 43章
 * （43.2節 決定7〜13・43.7節ワイヤーフレーム）。
 *
 * 決定8: 自分の分を描く場合も含め、必ず呼び出し元（じぶんタブ・`family.tsx`の
 * いずれか）から`memberId`・`displayName`をパラメータで渡される（暗黙の「自分」を
 * 持たない）。決定12: `memberId`が自分自身でない場合、代理操作中であることが
 * 分かるバナーを表示する。
 */
export default function ParentMemberAvatarScreen() {
  const { memberId, displayName } = useLocalSearchParams<{ memberId: string; displayName: string }>();
  const { state, memberAvatars, memberAvatarsLoaded, memberAvatarsError, refreshMemberAvatars, setMemberAvatarLocal, clearMemberAvatarLocal } =
    useAppData();
  const { client } = useSession();
  const target = state.members.find((m) => m.id === memberId);
  const isProxy = memberId !== state.activeParentMemberId;

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetErrorMessage, setResetErrorMessage] = useState<string | null>(null);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);

  const handleSave = async (lineData: FamilyDrawingLineData): Promise<boolean> => {
    if (!memberId) return false;
    setSaving(true);
    setErrorMessage(null);
    setSavedMessage(null);
    const res = await saveMemberAvatar(client, memberId, lineData);
    setSaving(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return false;
    }
    setMemberAvatarLocal(memberId, lineData);
    setSavedMessage(isProxy ? `${displayName}さんのアバターを保存しました` : "アバターを保存しました");
    setTimeout(() => setSavedMessage((prev) => (prev ? null : prev)), 4000);
    return true;
  };

  const handleReset = async (): Promise<boolean> => {
    if (!memberId) return false;
    setResetting(true);
    setResetErrorMessage(null);
    setResetSuccessMessage(null);
    const res = await deleteMemberAvatar(client, memberId);
    setResetting(false);
    if (!res.ok) {
      setResetErrorMessage(res.error.message);
      return false;
    }
    clearMemberAvatarLocal(memberId);
    setResetSuccessMessage("色にもどしました");
    setTimeout(() => setResetSuccessMessage((prev) => (prev ? null : prev)), 4000);
    return true;
  };

  // 決定13: タイトルは対象で出し分ける。
  const title = isProxy ? `${displayName}さんのアバターを描く` : "アバターを描く";
  // 依頼3（企画部決定17）: 対象・代理有無で出し分ける常時表示の説明文言。
  const explainText = isProxy
    ? `ここで描いた絵は、${displayName}さんのアバターになります。ガチャに出す絵とは別ものです（ガチャの景品にはなりません）`
    : "ここで描いた絵は、あなたのアバターになります。ガチャに出す絵とは別ものです（ガチャの景品にはなりません）";

  return (
    <Screen tone="parent">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.parentBody}>← もどる</Text>
        </Pressable>
      </View>
      <Text style={[theme.typography.parentTitle, styles.title]}>{title}</Text>

      {/* 決定12: 代理操作中であることが分かるバナー（自分自身のmemberIdのときは非表示）。 */}
      {isProxy && (
        <Card tone="parent" style={styles.proxyBanner}>
          <Text style={theme.typography.parentBody}>{displayName}さんの 絵を 描いています</Text>
        </Card>
      )}

      <Text style={[theme.typography.parentBody, styles.explain]}>{explainText}</Text>

      {!memberId || !target || !memberAvatarsLoaded ? (
        memberAvatarsError ? (
          <View style={{ marginTop: theme.spacing.s4, alignItems: "center" }}>
            <Text style={theme.typography.parentBody}>読み込みに失敗しました</Text>
            <Pressable onPress={() => void refreshMemberAvatars()} style={{ marginTop: theme.spacing.s2 }}>
              <Text style={[theme.typography.parentBody, styles.retryLink]}>もういちど</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s4 }]}>読み込み中…</Text>
        )
      ) : (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <AvatarDrawingPanel
            tone="parent"
            isProxy={isProxy}
            displayName={target.display_name}
            backgroundColor={target.avatar_color ?? theme.colors.neutralBorder}
            savedLineData={memberAvatars[memberId] ?? null}
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
  proxyBanner: {
    marginTop: theme.spacing.s3,
    alignItems: "center",
    backgroundColor: theme.colors.brandPrimarySoft,
    borderColor: theme.colors.brandPrimary,
  },
  explain: { marginTop: theme.spacing.s3 },
  retryLink: { textDecorationLine: "underline" },
});
