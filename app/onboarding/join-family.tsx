import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { inviteLookup } from "@/data/api";

/**
 * P5 招待コード入力（保護者として参加）
 * 参照: API仕様.md 2a章 Edge Function `invite-lookup`
 *
 * [設計判断の補完] invite-lookupのレスポンス（認証・データ管理設計書.md 3.1章）は
 * `family_name` と `children`（ニックネーム＋アバター色）のみを返し、保護者メンバーの
 * 一覧は返さない（個人情報最小化方針、4章参照）。そのためP6のプレビューは
 * 家族名＋子どもの一覧のみで構成する（保護者一覧は表示しない）。
 */
export default function JoinFamilyScreen() {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim()) return;
    setChecking(true);
    setErrorMessage(null);
    const res = await inviteLookup(code.trim());
    setChecking(false);
    if (!res.ok) {
      setErrorMessage(res.error.code === "invite_code_not_found" ? "招待コードが見つかりませんでした" : res.error.message);
      return;
    }
    router.push({
      pathname: "/onboarding/join-preview",
      params: {
        inviteCode: code.trim().toUpperCase(),
        familyName: res.data.family_name,
        childrenJson: JSON.stringify(res.data.children),
      },
    });
  };

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>招待コードを入力</Text>
      <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }}>
        もう一人の保護者から共有された8桁のコードを入力してください。
      </Text>
      <View style={{ marginTop: theme.spacing.s6 }}>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="AB3CD9EF"
          autoCapitalize="characters"
          maxLength={8}
          style={{
            borderWidth: 1,
            borderColor: theme.colors.neutralBorder,
            borderRadius: theme.radius.parentMd,
            padding: theme.spacing.s3,
            backgroundColor: theme.colors.neutralSurface,
            letterSpacing: 2,
          }}
        />
      </View>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <AppButton
        label={checking ? "確認中…" : "確認する"}
        loading={checking}
        disabled={checking || code.trim().length === 0}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={submit}
      />
    </Screen>
  );
}
