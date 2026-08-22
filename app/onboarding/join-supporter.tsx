import React, { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { acceptFamilyInvite, familyInviteLookup, signInWithEmail } from "@/data/api";
import { buildAuthRedirectUrl } from "@/lib/authRedirect";
import { useSession } from "@/lib/session";

/**
 * S0 招待プレビュー・参加確認（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S0・3.11節、API仕様.md 2d章、認証・データ管理設計書.md 8.2〜8.5章
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
    if (!token || !displayName.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    const res = await acceptFamilyInvite(token, displayName.trim());
    if (!res.ok) {
      setSubmitting(false);
      setSubmitError(
        res.error.code === "insufficient_privilege"
          ? "この招待は別のメールアドレス宛てです。招待されたメールアドレスでログインし直してください"
          : res.error.code === "no_data_found"
          ? "招待が見つかりません"
          : res.error.code === "check_violation"
          ? "この招待はすでに確定済み、または有効期限が切れています"
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
            disabled={submitting || !displayName.trim()}
            style={{ marginTop: theme.spacing.s6 }}
            onPress={confirmJoin}
          />
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
