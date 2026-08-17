import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { inviteLookup } from "@/data/api";

/**
 * C1 招待コード入力（子ども）
 * 参照: API仕様.md 2c章手順1 Edge Function `invite-lookup`
 *
 * 取得したプロフィール一覧（ニックネーム＋アバター色のみ）をC2へパラメータで渡す。
 */
export default function ChildInviteCodeScreen() {
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
      setErrorMessage(
        res.error.code === "invite_code_not_found" ? "コードがみつからなかったよ。もういちどたしかめてね" : res.error.message
      );
      return;
    }
    if (res.data.children.length === 0) {
      setErrorMessage("まだこどものプロフィールがとうろくされていないよ。おうちのひとにきいてね");
      return;
    }
    router.push({
      pathname: "/child-auth/profile-select",
      params: {
        inviteCode: code.trim().toUpperCase(),
        childrenJson: JSON.stringify(res.data.children),
      },
    });
  };

  return (
    <Screen tone="child">
      <Text style={theme.typography.childHeadline}>コードをいれてね</Text>
      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s2 }]}>
        おうちのひとに もらった コード
      </Text>
      <View style={{ marginTop: theme.spacing.s6 }}>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="AB3CD9EF"
          autoCapitalize="characters"
          maxLength={8}
          style={{
            borderWidth: 2,
            borderColor: theme.colors.brandPrimary,
            borderRadius: theme.radius.childXl,
            padding: theme.spacing.s4,
            backgroundColor: theme.colors.neutralSurface,
            fontSize: 22,
            letterSpacing: 3,
            textAlign: "center",
          }}
        />
      </View>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s4, textAlign: "center", color: theme.colors.statusBlocking }}>
          {errorMessage}
        </Text>
      )}

      <AppButton
        label={checking ? "たしかめています…" : "すすむ"}
        tone="child"
        fullWidth
        loading={checking}
        disabled={checking || code.trim().length === 0}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={submit}
      />
    </Screen>
  );
}
