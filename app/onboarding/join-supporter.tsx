import React, { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import EmailCodeVerifyForm from "@/components/EmailCodeVerifyForm";
import InviteVisibilityConsent, { JOIN_CONSENT_VERSION } from "@/components/InviteVisibilityConsent";
import theme from "@/theme/theme";
import { acceptFamilyInvite, familyInviteLookup, signInWithEmail, PG_ERRCODE } from "@/data/api";
import { buildAuthRedirectUrl } from "@/lib/authRedirect";
import { useSession } from "@/lib/session";
import { formatPgFailureRef } from "@/lib/pgFailureRef";
import { formatAuthFailureRef } from "@/lib/authFailureRef";
import { authSendErrorText } from "@/lib/authSendError";

/**
 * S0 招待プレビュー・参加確認（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S0・3.11節、API仕様.md 2d章・2f章、
 * 認証・データ管理設計書.md 8.2〜8.5章、UIUXデザイン部/成果物/
 * 主要画面ワイヤーフレーム.md 26.5節
 *
 * P6「招待プレビュー・参加確認」（保護者の参加）とほぼ同じ構成だが、以下が異なる。
 * - ロール表示は「みまもりメンバーとして参加します」という編集不可のラベル固定
 *   （自己申告防止、07-7章「認証・招待方式」）
 * - 家族名のプレビューは`family_invite_lookup` RPC（未ログインでも呼べる）で取得する
 * - 保護者の参加フロー（P5→P6、認証が先）とは順序が逆で、みまもりメンバーはこの画面に
 *   直接メールの招待リンク（token付き）から到達するため、未ログインの間は先に
 *   メールアドレス入力→コード送信の導線を出し、コード認証完了後に同じ画面のまま
 *   表示名入力＋参加確定ボタンを出す2段階構成にした（画面数を増やさない設計判断。
 *   設計書はS0を1画面として定義しており、この2段階の出し分けは実装判断）。
 *
 * [2026-09-02改訂] 招待受諾フローにおける可視範囲の説明と同意取得（要件定義書.md
 * 06章）に伴い、「役割（変更できません）」カードの直後、表示名入力欄の前に
 * InviteVisibilityConsent（role="supporter"、3項目版。aの感謝メッセージ本文は
 * 対象外）を追加した。チェックが入るまで「参加を確定する」ボタンをdisabledにし、
 * 常時キャプションで理由を示す（26.3節）。
 *
 * [2026-09-04改訂] マジックリンク方式から数字コード入力方式へ切替
 * （認証・データ管理設計書.md 10章、UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md
 * 29.3章、開発部/成果物/実装メモ.md 128章）。「メールを送りました。リンクをタップして
 * 戻ってきてください」だった`emailSent`状態を、EmailCodeVerifyForm（P3と共通、決定6）
 * を使ったコード入力状態に置き換えた。認証成功後は`status`が"parentNoFamily"に変わり、
 * 画面遷移せずこのコンポーネントが再レンダリングされ、下の`status === "parentNoFamily"`
 * 分岐がそのまま表示される（設計部10.3章）。
 *
 * [2026-09-27変更・ワイヤーフレーム67章決定7順位3] familyInviteLookup・
 * acceptFamilyInviteの失敗は、以前は個別の想定エラー以外をすべて
 * `res.error.message`（PostgrestErrorの生の文言）のまま表示していた。
 * ログインの画面と同じ考え方で、行動が変わるもの（電波・混み合い）だけ
 * 文言を分け、原因を追うための「目印」を小さく添える。この画面はS0専用で
 * 子ども向けの分岐は無い（67.3節決定5の対象外＝常に目印を出してよい）。
 *
 * [2026-09-29追加・本部長差し戻し（軽微変更ルート）、開発部/成果物/実装メモ.md
 * 322章] `status === "parentUnreachable"`（コード認証は成功したが、直後の
 * `family_members`問い合わせが自動再試行後も失敗した状態。src/lib/session.tsxの
 * コメント参照）専用の分岐を追加した。以前はこの分岐が無く、下の
 * `emailSent`分岐（`EmailCodeVerifyForm`）がそのまま描画され続けていたため、
 * `EmailCodeVerifyForm`内部の`verifying`（コード確認成功後は意図的にfalseへ
 * 戻さない設計）が真のまま、「たしかめています…」の表示で止まって見えていた
 * （データ破壊や誤操作は起きないが、原因不明のまま進めなくなる）。
 */
const MSG_OFFLINE = "電波の状態が悪いようです。電波の良い場所で、もう一度お試しください。";
const MSG_SERVER_BUSY = "ただいま混み合っているようです。少し時間をおいてから、もう一度お試しください。";
// [2026-09-29追加・実装メモ.md 322章] APIエラーオブジェクトから作る
// `formatPgFailureRef`等とは別物（session.tsx側の再試行はPostgrestErrorを
// 呼び出し元に返さないため）。固定の目印文字列にして、他の「目印」表示と
// 同じ場所・同じ見た目で出す。
const REF_PARENT_UNREACHABLE = "session-unreachable";

export default function JoinSupporterScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { status, refreshParentMember } = useSession();
  // [2026-09-29追加・実装メモ.md 322章] 「もう一度」ボタン用。押してから
  // 読み直しが終わるまで無反応に見えるため、連打防止も兼ねてボタンを
  // 無効化しつつスピナーを出す（app/index.tsxの`retryingConnection`と同じ流儀）。
  const [retryingConnection, setRetryingConnection] = useState(false);

  const [previewState, setPreviewState] = useState<"loading" | "ready" | "error">("loading");
  const [familyName, setFamilyName] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  // [2026-09-27新設・ワイヤーフレーム67章決定7順位3] 原因追跡用の識別子
  // （個人情報を含まない）。
  const [previewErrorRef, setPreviewErrorRef] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailErrorRef, setEmailErrorRef] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // [2026-09-27新設・ワイヤーフレーム67章決定7順位3] 原因追跡用の識別子
  // （個人情報を含まない）。
  const [submitErrorRef, setSubmitErrorRef] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!token) {
        setPreviewState("error");
        setPreviewError("招待リンクが正しくありません（tokenがありません）");
        return;
      }
      const res = await familyInviteLookup(token);
      if (!mounted) return;
      if (!res.ok) {
        setPreviewState("error");
        const e = res.error;
        setPreviewError(
          e.code === "no_data_found"
            ? "招待が見つかりませんでした"
            : e.status === 0
            ? MSG_OFFLINE
            : typeof e.status === "number" && e.status >= 500
            ? MSG_SERVER_BUSY
            : e.message
        );
        setPreviewErrorRef(formatPgFailureRef(e));
        return;
      }
      if (res.data.status === "revoked") {
        setPreviewState("error");
        setPreviewError("この招待は取り消されています");
        return;
      }
      if (res.data.status === "accepted") {
        setPreviewState("error");
        setPreviewError("この招待はすでに使用されています");
        return;
      }
      if (new Date(res.data.expires_at).getTime() < Date.now()) {
        setPreviewState("error");
        setPreviewError("この招待の有効期限が切れています。招待した保護者に再発行を依頼してください");
        return;
      }
      setFamilyName(res.data.family_name);
      setPreviewState("ready");
    })();
    return () => {
      mounted = false;
    };
  }, [token]);

  const sendMagicLink = async () => {
    if (!email.trim() || !token) return;
    setSendingEmail(true);
    setEmailError(null);
    setEmailErrorRef(null);
    const redirectTo = buildAuthRedirectUrl("join-supporter", { token });
    const res = await signInWithEmail(email.trim(), redirectTo);
    setSendingEmail(false);
    if (!res.ok) {
      // [2026-09-27修正・実装メモ317章の申し送り] 英語の生の文言を出さない（authSendError.ts）。
      setEmailError(authSendErrorText(res.error));
      setEmailErrorRef(formatAuthFailureRef(res.error));
      return;
    }
    setEmailSent(true);
  };

  /**
   * [2026-09-04新設] EmailCodeVerifyFormの「再送する」から呼ぶ。emailSent状態への
   * 遷移前後で使うsendMagicLinkとは異なり、この画面自身のsendingEmail/emailError状態は
   * 一切触らない（EmailCodeVerifyFormが自分の再送状態を内部で管理するため）。
   */
  const resendCode = async () => {
    if (!token) {
      return { ok: false as const, error: { code: "no_token", message: "招待リンクが正しくありません" } };
    }
    const redirectTo = buildAuthRedirectUrl("join-supporter", { token });
    return signInWithEmail(email.trim(), redirectTo);
  };

  const confirmJoin = async () => {
    if (!token || !displayName.trim() || !consentChecked) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitErrorRef(null);
    const res = await acceptFamilyInvite(token, displayName.trim(), JOIN_CONSENT_VERSION);
    if (!res.ok) {
      setSubmitting(false);
      const e = res.error;
      setSubmitError(
        // [2026-09-27追加・ワイヤーフレーム67章決定7順位3] 通信断・サーバー混雑
        // （ログインの画面と同じ言い回し）だけ先に切り分ける。
        e.status === 0
          ? MSG_OFFLINE
          : e.code === PG_ERRCODE.insufficientPrivilege
          ? "この招待は別のメールアドレス宛てです。招待されたメールアドレスでログインし直してください"
          : e.code === PG_ERRCODE.noDataFound
          ? "招待が見つかりません"
          : e.code === PG_ERRCODE.checkViolation
          ? // check_violationは「招待がすでに確定・期限切れ」と「同意版数が
            // 古い」（スキーマ設計.sql 40.5章）の2種類がありSQLSTATEだけでは
            // 区別できないため、DB側のRAISE EXCEPTIONメッセージ本文で判別する。
            // [2026-09-02修正] 従来はres.error.code === "check_violation"という
            // 可読名の文字列比較になっており、実際に返るSQLSTATE（23514、
            // PG_ERRCODE.checkViolation）と一致せず常にfalseだった（このthen節が
            // 一度も実行されず、常にelseのres.error.messageへ落ちていた）。今回
            // 3種類目のcheck_violation原因が増えたのを機に修正した。
            e.message.includes("アプリが古い")
            ? e.message
            : "この招待はすでに確定済み、または有効期限が切れています"
          : typeof e.status === "number" && e.status >= 500
          ? MSG_SERVER_BUSY
          : e.message
      );
      setSubmitErrorRef(formatPgFailureRef(e));
      return;
    }
    router.replace("/supporter/family");
  };

  if (previewState === "loading") {
    return (
      <Screen tone="supporter">
        <Text style={theme.typography.supporterTitle}>招待を確認しています…</Text>
      </Screen>
    );
  }

  if (previewState === "error") {
    return (
      <Screen tone="supporter">
        <Text style={theme.typography.supporterTitle}>招待を確認できませんでした</Text>
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.neutralTextSecondary }}>{previewError}</Text>
        {previewErrorRef && (
          <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
            目印 {previewErrorRef}
          </Text>
        )}
        <AppButton
          tone="supporter"
          label="さいしょから やりなおす"
          style={{ marginTop: theme.spacing.s8 }}
          onPress={() => router.replace("/")}
        />
      </Screen>
    );
  }

  return (
    <Screen tone="supporter">
      <Text style={theme.typography.supporterTitle}>この家族に参加しますか？</Text>

      <Card tone="supporter" style={{ marginTop: theme.spacing.s4, backgroundColor: theme.colors.supporterAccentSoft }}>
        <Text style={theme.typography.supporterBodyMedium}>{familyName}</Text>
        <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
          役割（変更できません）
        </Text>
        <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s1 }]}>
          🤝 みまもりメンバーとして参加します
        </Text>
      </Card>

      {status === "parentUnreachable" ? (
        // [2026-09-29追加・実装メモ.md 322章] コード認証は成功したが、直後の
        // family_members問い合わせが自動再試行後も失敗した状態。
        // 「たしかめています…」で止めず、他の失敗表示（previewError等）と
        // 同じ流儀（メッセージ＋目印＋再試行ボタン）で出す。
        <View style={{ marginTop: theme.spacing.s6 }}>
          <Text style={theme.typography.supporterBody}>{MSG_OFFLINE}</Text>
          <Text
            style={[
              theme.typography.supporterCaption,
              { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary },
            ]}
          >
            目印 {REF_PARENT_UNREACHABLE}
          </Text>
          <AppButton
            tone="supporter"
            label={retryingConnection ? "たしかめています…" : "もう一度"}
            loading={retryingConnection}
            disabled={retryingConnection}
            style={{ marginTop: theme.spacing.s6 }}
            onPress={() => {
              if (retryingConnection) return;
              setRetryingConnection(true);
              void refreshParentMember().finally(() => setRetryingConnection(false));
            }}
          />
        </View>
      ) : status === "parentNoFamily" ? (
        <>
          <InviteVisibilityConsent role="supporter" checked={consentChecked} onChange={setConsentChecked} />

          <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s6 }]}>あなたの表示名（ニックネーム）</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="例: おじいちゃん"
            style={{
              borderWidth: 1,
              borderColor: theme.colors.neutralBorder,
              borderRadius: theme.radius.parentMd,
              padding: theme.spacing.s3,
              backgroundColor: theme.colors.neutralSurface,
              marginTop: theme.spacing.s2,
            }}
          />

          {submitError && (
            <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{submitError}</Text>
          )}
          {submitErrorRef && (
            <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
              目印 {submitErrorRef}
            </Text>
          )}

          <AppButton
            tone="supporter"
            label={submitting ? "参加中…" : "参加を確定する"}
            loading={submitting}
            disabled={submitting || !displayName.trim() || !consentChecked}
            style={{ marginTop: theme.spacing.s6 }}
            onPress={confirmJoin}
          />
          {/* 26.3節: disabled状態の理由を常時表示するキャプション（ポップアップ等は出さない） */}
          <Text
            style={[
              theme.typography.supporterCaption,
              { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
            ]}
          >
            内容を確認してチェックを入れると、参加できます
          </Text>
        </>
      ) : emailSent ? (
        <View style={{ marginTop: theme.spacing.s6 }}>
          <Text style={[theme.typography.supporterTitle, { textAlign: "center" }]}>
            メールに届いた{theme.emailOtpLength}桁の数字を{"\n"}入力してください
          </Text>
          <EmailCodeVerifyForm tone="supporter" email={email} onResend={resendCode} />
        </View>
      ) : (
        <>
          <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s6 }]}>
            参加するには、メールアドレスでログインしてください（パスワードは不要です）
          </Text>
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
              marginTop: theme.spacing.s2,
            }}
          />

          {emailError && (
            <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{emailError}</Text>
          )}
          {emailErrorRef && (
            <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
              目印 {emailErrorRef}
            </Text>
          )}

          <AppButton
            tone="supporter"
            label={sendingEmail ? "送信中…" : "ログイン用のメールを送る"}
            loading={sendingEmail}
            disabled={sendingEmail || !email.trim()}
            style={{ marginTop: theme.spacing.s6 }}
            onPress={sendMagicLink}
          />
        </>
      )}
    </Screen>
  );
}
