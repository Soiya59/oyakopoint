import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { createFamilyWithOwner, PG_ERRCODE } from "@/data/api";
import { useSession } from "@/lib/session";

/**
 * P4 家族名入力（新規作成）
 * 参照: API仕様.md 1章手順3 supabase.rpc('create_family_with_owner', ...)
 */
export default function CreateFamilyScreen() {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { refreshParentMember } = useSession();

  const submit = async () => {
    if (!name.trim() || !displayName.trim()) return;
    setSubmitting(true);
    setErrorMessage(null);
    const res = await createFamilyWithOwner(name.trim(), displayName.trim());
    if (!res.ok) {
      setSubmitting(false);
      setErrorMessage(
        res.error.code === PG_ERRCODE.insufficientPrivilege
          ? "メールのリンクをタップして認証を完了してから、もう一度お試しください"
          : res.error.code === PG_ERRCODE.uniqueViolation
          ? "すでに家族に参加しています"
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
      <Text style={theme.typography.parentTitle}>家族名を入力</Text>
      <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }}>
        あとから変更できます。
      </Text>
      <View style={{ marginTop: theme.spacing.s6 }}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="例: 森下家"
          style={{
            borderWidth: 1,
            borderColor: theme.colors.neutralBorder,
            borderRadius: theme.radius.parentMd,
            padding: theme.spacing.s3,
            backgroundColor: theme.colors.neutralSurface,
          }}
        />
      </View>

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
        label={submitting ? "作成中…" : "作成する"}
        loading={submitting}
        disabled={submitting || !name.trim() || !displayName.trim()}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={submit}
      />
    </Screen>
  );
}
