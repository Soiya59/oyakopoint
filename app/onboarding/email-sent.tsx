import React, { useEffect } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import EmailCodeVerifyForm from "@/components/EmailCodeVerifyForm";
import theme from "@/theme/theme";
import { useSession } from "@/lib/session";
import { signInWithEmail } from "@/data/api";
import { buildAuthRedirectUrl } from "@/lib/authRedirect";

/**
 * P3 メール送信完了
 * 参照: 認証・データ管理設計書.md 10章（6桁コード方式への切替、2026-09-04）、
 * UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 29.2章、
 * 開発部/成果物/実装メモ.md 128章
 *
 * [2026-09-04改訂] マジックリンク方式から6桁コード入力方式へ切替（統括の実機報告
 * 「iPhoneでGmailを登録して、Gmailをサファリで開くと『リンクが切れてます、もしくは
 * すでに使用されてます』と出る」への対応）。この画面はコード入力欄
 * （EmailCodeVerifyForm）を持ち、`verifyEmailOtp`成功後は`useSession()`の`status`が
 * 自動的に"parentNoFamily"/"parent"に変わるのを検知する既存のuseEffectがそのまま
 * 動く。`app/auth-callback.tsx`は一切経由しない（設計部10.3章）。
 *
 * [2026-08-15由来・経路として温存] app/_layout.tsx の useMagicLinkListener() が
 * ディープリンクを検知するリンク経由の予備経路も、コードとは別に変更せず残っている
 * （設計部10.4章。`auth-callback.tsx`を削除しない）。
 */
export default function EmailSentScreen() {
  const { email, intent } = useLocalSearchParams<{ email?: string; intent?: string }>();
  const { status } = useSession();

  useEffect(() => {
    if (status === "parentNoFamily" || status === "parent") {
      router.replace(intent === "join" ? "/onboarding/join-family" : "/onboarding/create-family");
    }
  }, [status, intent]);

  const resend = async () => {
    if (!email) return { ok: false as const, error: { code: "no_email", message: "メールアドレスが分かりません" } };
    // [2026-08-16由来] app/onboarding/email.tsxと同じ理由でintentをredirectToへ
    // 明示的に埋め込む（emailRedirectToはリンク経由の予備経路のために残す、10.4章）。
    const redirectTo = buildAuthRedirectUrl(intent ?? "create");
    return signInWithEmail(email, redirectTo);
  };

  return (
    <Screen tone="parent">
      <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
        <Text style={{ fontSize: 48 }}>📩</Text>
        <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
          メールに届いた6桁の数字を{"\n"}入力してください
        </Text>
      </View>

      <EmailCodeVerifyForm tone="parent" email={email ?? ""} onResend={resend} />
    </Screen>
  );
}
