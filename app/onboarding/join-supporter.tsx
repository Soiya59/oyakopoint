import React, { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import InviteVisibilityConsent, { JOIN_CONSENT_VERSION } from "@/components/InviteVisibilityConsent";
import theme from "@/theme/theme";
import { acceptFamilyInvite, familyInviteLookup, signInWithEmail, PG_ERRCODE } from "@/data/api";
import { buildAuthRedirectUrl } from "@/lib/authRedirect";
import { useSession } from "@/lib/session";

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
 *   メールアドレス入力→マジックリンク送信の導線を出し、認証完了後に同じ画面へ戻ってきた
 *   ときに表示名入力＋参加確定ボタンを出す2段階構成にした（画面数を増やさない設計判断。
 *   設計書はS0を1画面として定義しており、この2段階の出し分けは実装判断）。
 *
 * [2026-09-02改訂] 招待受諾フローにおける可視範囲の説明と同意取得（要件定義書.md
 * 06章）に伴い、「役割（変更できません）」カードの直後、表示名入力欄の前に
 * InviteVisibilityConsent（role="supporter"、3項目版。aの感謝メッセージ本文は
 * 対象外）を追加した。チェックが入るまで「参加を確定する」ボタンをdisabledにし、
 * 常時キャプションで理由を示す（26.3節）。
 */
export default function JoinSupporterScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { status } = useSession();

  const [previewState, setPreviewState] = useState<"loading" | "ready" | "error">("loading");
  const [familyName, setFamilyName] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
        setPreviewError(
          res.error.code === "no_data_found" ? "招待が見つかりませんでした" : res.error.message
        );
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
    const redirectTo = buildAuthRedirectUrl("join-supporter", { token });
    const res = await signInWithEmail(email.trim(), redirectTo);
    setSendingEmail(false);
    if (!res.ok) {
      setEmailError(res.error.message);
      return;
    }
    setEmailSent(true);
  };

  const confirmJoin = async () => {
    if (!token || !displayName.trim() || !consentChecked) return;
    setSubmitting(true);
    setSubmitError(null);
    const res = await acceptFamilyInvite(token, displayName.trim(), JOIN_CONSENT_VERSION);
    if (!res.ok) {
      setSubmitting(false);
      setSubmitError(
        res.error.code === PG_ERRCODE.insufficientPrivilege
          ? "この招待は別のメールアドレス宛てです。招待されたメールアドレスでログインし直してください"
          : res.error.code === PG_ERRCODE.noDataFound
          ? "招待が見つかりません"
          : res.error.code === PG_ERRCODE.checkViolation
          ? // check_violationは「招待がすでに確定・期限切れ」と「同意版数が
            // 古い」（スキーマ設計.sql 40.5章）の2種類がありSQLSTATEだけでは
            // 区別できないため、DB側のRAISE EXCEPTIONメッセージ本文で判別する。
            // [2026-09-02修正] 従来はres.error.code === "check_violation"という
            // 可読名の文字列比較になっており、実際に返るSQLSTATE（23514、
            // PG_ERRCODE.checkViolation）と一致せず常にfalseだった（このthen節が
            // 一度も実行されず、常にelseのres.error.messageへ落ちていた）。今回
            // 3種類目のcheck_violation原因が増えたのを機に修正した。
            res.error.message.includes("アプリが古い")
            ? res.error.message
            : "この招待はすでに確定済み、または有効期限が切れています"
          : res.error.message
      );
      return;
    }
    router.replace("/supporter/home");
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

      {status === "parentNoFamily" ? (
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
          <Text style={theme.typography.supporterBody}>
            {email} にログイン用のメールを送りました。メール内のリンクをタップしてこの画面に戻ってきてください。
          </Text>
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
