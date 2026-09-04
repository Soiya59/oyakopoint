import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { verifyEmailOtp, AUTH_ERRCODE, type ApiResult } from "@/data/api";

/**
 * P3「メール送信完了」・S0「招待プレビュー・参加確認」未ログイン時状態の
 * コード入力欄（数字コード方式・桁数は theme.emailOtpLength、認証・データ管理設計書.md 10章、
 * UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 29章）を、
 * 決定6「見出し・説明文・エラー文言は共通」のとおり1つのコンポーネントに集約する。
 *
 * [実測・実装メモ128章] コード誤り・期限切れはGoTrue（AuthApiError.code）が
 * 区別しないことをローカルSupabaseで確認済み（正しいコード→成功、存在しない
 * コード→otp_expired、期限切れコード→otp_expiredの3パターンをcurlで実測）。
 * 29.6章の代替方針どおり、両者を1つの文言（MSG_CODE_INVALID）に一本化する。
 */

const RESEND_COOLDOWN_MS = 30000;
const RESEND_NOTICE_MS = 2500;

// UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 29.2章・29.4章・29.5章の文言をそのまま使う。
const MSG_CODE_INVALID =
  "うまく確認できませんでした。もう一度、メールの数字をご確認のうえ入力してください。";
const MSG_RATE_LIMIT = "何度か試していただいたようです。少し時間をおいてから、もう一度お試しください。";
const MSG_NETWORK = "通信エラーが発生しました。もう一度お試しください。";
const MSG_RESEND_RATE_LIMIT =
  "メールの送信回数が上限に達しました。しばらく時間をおいてからもう一度お試しください。";

export interface EmailCodeVerifyFormProps {
  /** 画面のトーン（決定6: 文言は共通、色調のみ異なる） */
  tone: "parent" | "supporter";
  /** コードを送った宛先メールアドレス（決定4） */
  email: string;
  /** 「再送する」タップ時に呼ぶ。呼び出し元がintent/tokenを引き継いだ上でsignInWithEmailを呼ぶこと。 */
  onResend: () => Promise<ApiResult<null>>;
}

export default function EmailCodeVerifyForm({ tone, email, onResend }: EmailCodeVerifyFormProps) {
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "cooldown">("idle");
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  const submit = async (candidate: string) => {
    if (candidate.length !== 6 || verifying) return;
    setVerifying(true);
    setErrorMessage(null);
    const res = await verifyEmailOtp(email, candidate);
    if (!res.ok) {
      setVerifying(false);
      setErrorMessage(
        res.error.status === 429 || res.error.code === AUTH_ERRCODE.overRequestRateLimit
          ? MSG_RATE_LIMIT
          : res.error.code === AUTH_ERRCODE.otpExpired
          ? MSG_CODE_INVALID
          : MSG_NETWORK
      );
      return;
    }
    // 成功時: useSession()のstatus監視（呼び出し元画面）が自動的に検知して次へ進む
    // （設計部10.3章）。この画面はそのまま切り替わるため、verifyingは明示的にfalseへ戻さない。
  };

  const onChangeCode = (raw: string) => {
    const digitsOnly = raw.replace(/[^0-9]/g, "").slice(0, theme.emailOtpLength);
    setCode(digitsOnly);
    if (digitsOnly.length === theme.emailOtpLength) {
      submit(digitsOnly);
    }
  };

  const resend = async () => {
    setResendState("sending");
    setResendNotice(null);
    const res = await onResend();
    if (!res.ok) {
      setResendState("idle");
      setErrorMessage(
        res.error.code === AUTH_ERRCODE.overEmailSendRateLimit ? MSG_RESEND_RATE_LIMIT : MSG_NETWORK
      );
      return;
    }
    // 決定: 再送成功時はコード入力欄を空にする（直前のコードは新しいコードの発行で無効になるため）
    setCode("");
    setErrorMessage(null);
    setResendNotice("新しいコードを送りました");
    noticeTimer.current = setTimeout(() => setResendNotice(null), RESEND_NOTICE_MS);
    setResendState("cooldown");
    cooldownTimer.current = setTimeout(() => setResendState("idle"), RESEND_COOLDOWN_MS);
  };

  const bodyTypography = tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  const captionTypography = tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;

  return (
    <View style={{ marginTop: theme.spacing.s4 }}>
      <Text style={[captionTypography, { color: theme.colors.neutralTextSecondary }]}>
        <Text style={{ fontWeight: "700", color: theme.colors.neutralTextPrimary }}>{email}</Text>
        {" "}宛にログインコードを送りました
      </Text>

      <TextInput
        value={code}
        onChangeText={onChangeCode}
        keyboardType="number-pad"
        maxLength={theme.emailOtpLength}
        editable={!verifying}
        placeholder="000000"
        accessibilityLabel={`${theme.emailOtpLength}桁の確認コード`}
        style={{
          marginTop: theme.spacing.s4,
          borderWidth: 1,
          borderColor: theme.colors.neutralBorder,
          borderRadius: theme.radius.parentMd,
          paddingVertical: theme.spacing.s3,
          backgroundColor: theme.colors.neutralSurface,
          fontSize: 38,
          fontWeight: "700",
          letterSpacing: 12,
          textAlign: "center",
        }}
      />
      <Text style={[captionTypography, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
        コードは1時間だけ使えます
      </Text>

      {errorMessage && (
        <Text style={[bodyTypography, { marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }]}>
          {errorMessage}
        </Text>
      )}

      <AppButton
        tone={tone}
        label={verifying ? "たしかめています…" : "ログインする"}
        loading={verifying}
        disabled={verifying || code.length !== 6}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => submit(code)}
      />

      <AppButton
        tone={tone}
        variant="secondary"
        label={resendState === "sending" ? "送信中…" : resendState === "cooldown" ? "送信しました" : "再送する"}
        loading={resendState === "sending"}
        disabled={resendState !== "idle"}
        style={{ marginTop: theme.spacing.s3 }}
        onPress={resend}
      />

      {resendNotice ? (
        <Text style={[captionTypography, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
          {resendNotice}
        </Text>
      ) : resendState === "cooldown" ? (
        <Text style={[captionTypography, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
          30秒ほど経つと、もう一度送れるようになります
        </Text>
      ) : null}
    </View>
  );
}
