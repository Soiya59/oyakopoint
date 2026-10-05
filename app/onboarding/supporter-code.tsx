import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { extractSupporterInviteToken } from "@/lib/supporterInviteToken";

/**
 * みまもりの招待コード入力（やること4-96・実装メモ.md 360章・軽微変更ルート）
 * 保護者のP5（join-family.tsx、招待コードを入力）と同じ形。招待リンク
 * （oyakopoint://…）は、メッセージアプリでタップできない・アプリが入っていない
 * 相手には使えないため、リンクまたはコードを貼って先へ進める入口を足した。
 * コードの確認（family_invite_lookup）と参加は、既存のS0（join-supporter.tsx）が行う
 * （token付きで遷移させるだけ。ここでは検証しない）。
 */
export default function SupporterCodeScreen() {
  const [text, setText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = () => {
    const token = extractSupporterInviteToken(text);
    if (!token) {
      setErrorMessage("招待コードの形が正しくありません。招待してくれた人から届いたリンクかコードを、そのまま貼ってください。");
      return;
    }
    setErrorMessage(null);
    router.push({ pathname: "/onboarding/join-supporter", params: { token } });
  };

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>みまもりの招待コードを入力</Text>
      <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }}>
        招待してくれた保護者から届いたリンクまたはコードを、そのまま貼ってください。
      </Text>
      <View style={{ marginTop: theme.spacing.s6 }}>
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            setErrorMessage(null);
          }}
          placeholder="リンクまたはコードを貼り付け"
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            borderWidth: 1,
            borderColor: theme.colors.neutralBorder,
            borderRadius: theme.radius.parentMd,
            padding: theme.spacing.s3,
            backgroundColor: theme.colors.neutralSurface,
          }}
        />
      </View>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <AppButton
        label="つぎへ"
        disabled={text.trim().length === 0}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={submit}
      />
    </Screen>
  );
}
