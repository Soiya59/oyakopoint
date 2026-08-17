import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import Card from "@/components/Card";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { joinFamilyWithInviteCode, PG_ERRCODE } from "@/data/api";
import { useSession } from "@/lib/session";
import type { InviteLookupChild } from "@/data/api";

/**
 * P6 招待プレビュー・参加確認
 * 参照: API仕様.md 2a章 supabase.rpc('join_family_with_invite_code', ...)
 *
 * P5（invite-lookup）から受け取った家族名・子ども一覧をそのまま表示する
 * （invite-lookupは保護者一覧を返さない設計のため、子ども一覧のみのプレビューになる。
 *  join-family.tsxのコメント参照）。
 */
export default function JoinPreviewScreen() {
  const { inviteCode, familyName, childrenJson } = useLocalSearchParams<{
    inviteCode?: string;
    familyName?: string;
    childrenJson?: string;
  }>();
  const { refreshParentMember } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const children: InviteLookupChild[] = childrenJson ? JSON.parse(childrenJson) : [];

  const submit = async () => {
    if (!inviteCode || !displayName.trim()) return;
    setSubmitting(true);
    setErrorMessage(null);
    const res = await joinFamilyWithInviteCode(inviteCode, displayName.trim());
    if (!res.ok) {
      setSubmitting(false);
      setErrorMessage(
        res.error.code === PG_ERRCODE.insufficientPrivilege
          ? "メールのリンクをタップして認証を完了してから、もう一度お試しください"
          : res.error.code === PG_ERRCODE.uniqueViolation
          ? "すでに家族に参加しています"
          : res.error.code === PG_ERRCODE.noDataFound
          ? "招待コードが無効です"
          : res.error.message
      );
      return;
    }
    await refreshParentMember();
    setSubmitting(false);
    router.replace("/parent/home");
  };

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>この家族に参加しますか？</Text>

      <Card style={{ marginTop: theme.spacing.s4 }}>
        <Text style={theme.typography.parentBodyMedium}>{familyName}</Text>
        <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s3 }}>
          {children.map((c) => (
            <MemberAvatar key={c.member_id} name={c.display_name} color={c.avatar_color} />
          ))}
        </View>
      </Card>

      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s6 }]}>あなたの表示名</Text>
      <TextInput
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="例: もりした けい"
        style={{
          borderWidth: 1,
          borderColor: theme.colors.neutralBorder,
          borderRadius: theme.radius.parentMd,
          padding: theme.spacing.s3,
          backgroundColor: theme.colors.neutralSurface,
          marginTop: theme.spacing.s2,
        }}
      />

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <AppButton
        label={submitting ? "参加中…" : "参加を確定する"}
        loading={submitting}
        disabled={submitting || !displayName.trim()}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={submit}
      />
    </Screen>
  );
}
