import React, { useState } from "react";
import { TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { Text } from "react-native";
import { signInWithEmail } from "@/data/api";

/**
 * P2 メールアドレス入力
 * 参照: 画面一覧・遷移図.md P2、API仕様.md 1章手順1
 * supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } }) に対応。
 *
 * emailRedirectToには app.json の scheme（"oyakopoint"）を使ったディープリンク
 * （Linking.createURL('auth-callback')）を指定する。このURLはSupabaseダッシュボードの
 * Authentication > URL Configuration > Redirect URLs に許可リスト登録が必要
 * （実装メモ.md 15章「未検証・運用手順」参照。ダッシュボード設定はコードの範囲外）。
 *
 * [2026-08-16修正・本部長] ユーザーが実際に「招待コードをもってきた（保護者）」から
 * マジックリンクを踏んだところ、常に「家族を新しくつくる」画面へ進んでしまう不具合を
 * 発見した。原因は、redirectToのURLにintent（create/join）を一切含めていなかったこと。
 * メールのリンクは別タブ・別セッション（メールクライアント経由）で開かれるため、この
 * 画面のURLパラメータのintentはリンク先（app/auth-callback.tsx）には引き継がれない。
 * そのため、intentをredirectToのクエリパラメータとして明示的に埋め込み、
 * auth-callback.tsx側で読み取れるようにした。
 */
export default function EmailInputScreen() {
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim()) return;
    setSending(true);
    setErrorMessage(null);
    const redirectTo = Linking.createURL("auth-callback", { queryParams: { intent: intent ?? "create" } });
    const res = await signInWithEmail(email.trim(), redirectTo);
    setSending(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    router.push({ pathname: "/onboarding/email-sent", params: { email, intent: intent ?? "create" } });
  };

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>メールアドレスを入力</Text>
      <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }}>
        パスワードは不要です。届いたメールのリンクをタップしてログインします。
      </Text>

      <View style={{ marginTop: theme.spacing.s6 }}>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
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
        label={sending ? "送信中…" : "送信する"}
        loading={sending}
        disabled={sending || !email.trim()}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={submit}
      />
    </Screen>
  );
}
