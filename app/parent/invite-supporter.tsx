import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { createFamilyInvite } from "@/data/api";

/**
 * P23 みまもりメンバーを招待（保護者、2026-08-22新規）
 * 参照: 画面一覧・遷移図.md P23・3.11節、API仕様.md 2d章手順1
 *
 * 対象ロールを「みまもりメンバー」と明示した招待を、メールアドレス宛に発行する。
 * トークンはクライアント側で生成し（3a章のNFCタグトークン生成と同じ設計判断）、
 * family_invitesへ通常のPostgREST INSERTで書き込む（新規Edge Function不要）。
 */
export default function InviteSupporterScreen() {
  const { state } = useAppData();
  const { client } = useSession();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim()) return;
    setSending(true);
    setErrorMessage(null);
    const res = await createFamilyInvite(client, email.trim());
    setSending(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    router.replace({
      pathname: "/parent/invite-supporter-sent",
      params: { email: res.data.invited_email, token: res.data.token },
    });
  };

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>みまもりメンバーを招待</Text>
      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
        「{state.family.name}」に、みまもりメンバーとして招待します。
      </Text>

      <View
        style={{
          marginTop: theme.spacing.s4,
          padding: theme.spacing.s3,
          borderRadius: theme.radius.parentMd,
          backgroundColor: theme.colors.brandPrimarySoft,
        }}
      >
        <Text style={theme.typography.parentBody}>
          参加すると、家族のがんばりを見て、スタンプやコメントを送れるようになります。お手伝い・ごほうびの管理はできません。
        </Text>
      </View>

      <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>メールアドレス</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="grandma@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        style={{
          marginTop: theme.spacing.s2,
          borderWidth: 1,
          borderColor: theme.colors.neutralBorder,
          borderRadius: theme.radius.parentMd,
          padding: theme.spacing.s3,
          backgroundColor: theme.colors.neutralSurface,
        }}
      />

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <AppButton
        label={sending ? "送信中…" : "招待を送る"}
        loading={sending}
        disabled={sending || !email.trim()}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={submit}
      />
      <AppButton label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.back()} />
    </Screen>
  );
}
