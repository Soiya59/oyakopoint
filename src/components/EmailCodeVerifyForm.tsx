import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { verifyEmailOtp, AUTH_ERRCODE, type ApiResult } from "@/data/api";
import { useSession } from "@/lib/session";
import { GENERIC_ERROR_MESSAGE } from "@/lib/errorMessages";
import { formatAuthFailureRef } from "@/lib/authFailureRef";

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
 *
 * [2026-09-17変更・やること.md 4-36 症状1・実装メモ.md 230章] 成功後に
 * `useSession().refreshParentMember()`を明示的に呼ぶ（下記submit参照）。
 * 以前は`onAuthStateChange`の`SIGNED_IN`イベントを待って自動的にstatusが
 * 切り替わるのに任せていたが、こどもセッションが有効な間はこのイベントを
 * 無条件で無視する設計（31章のレース対策）のため、こどもモードから保護者に
 * 戻ろうとするとstatusが変わらず「たしかめています…」のまま止まっていた。
 * イベントを待たず、検証成功をこの場で知っているこの関数から直接
 * `refreshParentMember()`を呼ぶことで、イベントの取り合い・時間切れの懸念を
 * 構造的に無くした（詳細はsrc/lib/session.tsxのコメント）。
 *
 * [2026-09-20変更・実装メモ.md 262章・軽微変更ルート（統括指示）] 本番で
 * みまもりメンバー1名がログインできず（TestFlight build 18・iPhone）、
 * 表示は常に「通信エラーが発生しました」の1文だった。以前は
 * 429/overRequestRateLimit・otpExpired以外の失敗を全てこの1文に丸めており、
 * 本当の通信断・サーバー側の一時的な異常・その他の未知の失敗を区別できず、
 * 本部長が本番の`auth.users`・`auth.audit_log_entries`（記録が残らない設定）
 * を見ても手がかりが無かった。教訓: 失敗を1つの文言に丸めると、本番で
 * 原因が追えなくなる。
 * 対応: (1) AuthRetryableFetchError（status===0＝端末側のfetch自体が失敗＝
 * 真の通信断、status>=500＝サーバー側ゲートウェイ異常。AUTH_ERRCODE.retryableFetch
 * 参照）を切り分け、行動が変わる2つの文言（MSG_OFFLINE・MSG_SERVER_BUSY）に
 * 分けた。(2) それでも原因不明な失敗のために、利用者向け文言はそのまま、
 * 小さく控えめな識別子（formatAuthFailureRef、src/lib/authFailureRef.ts）を
 * 添えた。統括のスクリーンショット1枚から本部長が原因を絞り込める。
 * コード誤り・期限切れ・使い回しの区別は128章の実測どおりGoTrue側が同一の
 * `otp_expired`しか返さないため、今回も区別できない（申し送りは262章）。
 */

const RESEND_COOLDOWN_MS = 30000;
const RESEND_NOTICE_MS = 2500;

// UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 29.2章・29.4章・29.5章の文言をそのまま使う。
const MSG_CODE_INVALID =
  "うまく確認できませんでした。もう一度、メールの数字をご確認のうえ入力してください。";
const MSG_RATE_LIMIT = "何度か試していただいたようです。少し時間をおいてから、もう一度お試しください。";
// [2026-09-17変更・やること.md 4-40] 文言はsrc/lib/errorMessages.tsに集約した
// （元々ここと同一の文言だった）。
const MSG_NETWORK = GENERIC_ERROR_MESSAGE;
// [2026-09-20新設・実装メモ.md 262章] fetch自体が失敗した場合（status===0）専用。
// 「電波」という言葉で、アプリ側ではなく端末の通信状態を確認してほしいことを示す
// （MSG_NETWORKの「もう一度お試しください」より具体的な行動を示せる）。
const MSG_OFFLINE = "電波の状態が悪いようです。電波の良い場所で、もう一度お試しください。";
// [2026-09-20新設・実装メモ.md 262章] サーバー側のゲートウェイ異常（status>=500）専用。
// 今すぐの再試行ではなく少し時間を置くことを促す点がMSG_NETWORKと異なる。
const MSG_SERVER_BUSY = "サーバーが混み合っているようです。少し時間をおいてから、もう一度お試しください。";
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
  const { refreshParentMember } = useSession();
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // [2026-09-20新設・実装メモ.md 262章] 利用者向け文言とは別に、原因追跡用の
  // 短い識別子（個人情報を含まない）。errorMessageと連動して出し分けるため、
  // 別state（同じ失敗のたびに一緒に更新・一緒にクリアする）にしている。
  const [errorRef, setErrorRef] = useState<string | null>(null);
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
    setErrorRef(null);
    const res = await verifyEmailOtp(email, candidate);
    if (!res.ok) {
      setVerifying(false);
      // [2026-09-20変更・実装メモ.md 262章] AuthRetryableFetchErrorの2パターン
      // （status===0＝真の通信断、status>=500＝サーバー側ゲートウェイ異常）を
      // 追加で切り分ける。それ以外（AuthUnknownError・想定外のAuthApiError等）は
      // 引き続きMSG_NETWORKに丸めるが、errorRefで見分けられるようにする。
      setErrorMessage(
        res.error.status === 429 || res.error.code === AUTH_ERRCODE.overRequestRateLimit
          ? MSG_RATE_LIMIT
          : res.error.code === AUTH_ERRCODE.otpExpired
          ? MSG_CODE_INVALID
          : res.error.code === AUTH_ERRCODE.retryableFetch && res.error.status === 0
          ? MSG_OFFLINE
          : res.error.code === AUTH_ERRCODE.retryableFetch
          ? MSG_SERVER_BUSY
          : MSG_NETWORK
      );
      setErrorRef(formatAuthFailureRef(res.error));
      return;
    }
    // 成功時: こどもモードから保護者に戻る場合を含め、ここで明示的に
    // refreshParentMember()を呼んでstatusを確定させる（上のコメント参照）。
    // これが終わればuseSession()のstatus監視（呼び出し元画面）が次へ進む
    // （設計部10.3章）。この画面はそのまま切り替わるため、verifyingは明示的にfalseへ戻さない。
    await refreshParentMember();
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
        // [2026-09-06] 未入力の見本が実際の入力と同じ濃さで出ていて「既に入っている」
        // ように見えるという統括の指摘により、薄い灰色を明示する（統括指示）。
        placeholderTextColor={theme.colors.neutralBorder}
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
      {/* [2026-09-20新設・実装メモ.md 262章] 原因追跡用の識別子。利用者向けの
          文言（上のerrorMessage）とは見た目を分け、小さく・目立たない色にする
          （赤字にしない＝01章3原則「不安を煽らない」）。個人情報は含まない
          （src/lib/authFailureRef.ts参照）。 */}
      {errorRef && (
        <Text style={[captionTypography, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
          {errorRef}
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
