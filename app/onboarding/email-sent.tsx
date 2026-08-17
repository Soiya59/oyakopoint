import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useSession } from "@/lib/session";
import { signInWithEmail } from "@/data/api";
import { buildAuthRedirectUrl } from "@/lib/authRedirect";

/**
 * P3 メール送信完了
 * 参照: API仕様.md 1章手順2「リンク踏んでセッション確立（Supabase Auth SDKが自動処理）」
 *
 * [2026-08-15改訂] app/_layout.tsx の useMagicLinkListener() がディープリンクを
 * 検知して supabase.auth.exchangeCodeForSession() を呼ぶと、SessionProvider の
 * status が自動的に "parentNoFamily"（またはすでに家族所属済みなら "parent"）に
 * 変わる。この画面はその変化を検知して自動的に次へ進む。
 *
 * [未検証・正直な申告] 本セッションでは実際のメール受信箱を開いてリンクをタップする
 * 操作までは確認していない（ブラウザ/メールクライアント操作ツールがこの実行環境に
 * 無いため）。ディープリンク受信〜exchangeCodeForSession〜status遷移のロジックは
 * 実装したが、実機/実ブラウザでの受信確認は実装メモ.md 15章「未検証」に記載する。
 */
export default function EmailSentScreen() {
  const { email, intent } = useLocalSearchParams<{ email?: string; intent?: string }>();
  const { status } = useSession();
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === "parentNoFamily" || status === "parent") {
      router.replace(intent === "join" ? "/onboarding/join-family" : "/onboarding/create-family");
    }
  }, [status, intent]);

  const resend = async () => {
    if (!email) return;
    setResending(true);
    setResendMessage(null);
    // [2026-08-16修正・本部長] app/onboarding/email.tsxと同じ理由でintentを
    // redirectToへ明示的に埋め込む（再送時もjoin/createの区別を引き継ぐ必要があるため）。
    const redirectTo = buildAuthRedirectUrl(intent ?? "create");
    const res = await signInWithEmail(email, redirectTo);
    setResending(false);
    setResendMessage(res.ok ? "再送しました" : res.error.message);
  };

  return (
    <Screen tone="parent">
      <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
        <Text style={{ fontSize: 48 }}>📩</Text>
        <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3 }]}>
          メールを送信しました
        </Text>
        <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary, textAlign: "center" }}>
          {email || "入力されたアドレス"} 宛にログインリンクを送りました。メールを確認してリンクをタップしてください。
        </Text>
        <Text style={{ marginTop: theme.spacing.s4, color: theme.colors.neutralTextSecondary, textAlign: "center" }}>
          リンクをタップすると、この画面が自動的に次へ進みます。
        </Text>
      </View>

      {resendMessage && (
        <Text style={{ marginTop: theme.spacing.s3, textAlign: "center", color: theme.colors.neutralTextSecondary }}>
          {resendMessage}
        </Text>
      )}

      <AppButton
        label={resending ? "再送中…" : "再送する"}
        variant="secondary"
        loading={resending}
        style={{ marginTop: theme.spacing.s8 }}
        onPress={resend}
      />
    </Screen>
  );
}
