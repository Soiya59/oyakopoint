import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import Card from "@/components/Card";
import MemberAvatar from "@/components/MemberAvatar";
import InviteVisibilityConsent, { JOIN_CONSENT_VERSION } from "@/components/InviteVisibilityConsent";
import theme from "@/theme/theme";
import { joinFamilyWithInviteCode, PG_ERRCODE } from "@/data/api";
import { useSession } from "@/lib/session";
import type { InviteLookupChild } from "@/data/api";

/**
 * P6 招待プレビュー・参加確認
 * 参照: API仕様.md 2f章手順③ supabase.rpc('join_family_with_invite_code', ...)
 * UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 26.4節
 *
 * P5（invite-lookup）から受け取った家族名・子ども一覧をそのまま表示する
 * （invite-lookupは保護者一覧を返さない設計のため、子ども一覧のみのプレビューになる。
 *  join-family.tsxのコメント参照）。
 *
 * [2026-09-02改訂] 招待受諾フローにおける可視範囲の説明と同意取得（要件定義書.md
 * 06章）に伴い、家族名・子ども一覧のプレビューカードの直後、表示名入力欄の前に
 * InviteVisibilityConsent（role="parent"、4項目版）を追加した。チェックが入る
 * まで「参加を確定する」ボタンをdisabledにし、常時キャプションで理由を示す
 * （26.3節）。
 */
export default function JoinPreviewScreen() {
  const { inviteCode, familyName, childrenJson } = useLocalSearchParams<{
    inviteCode?: string;
    familyName?: string;
    childrenJson?: string;
  }>();
  const { refreshParentMember } = useSession();
  const [displayName, setDisplayName] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const children: InviteLookupChild[] = childrenJson ? JSON.parse(childrenJson) : [];

  const submit = async () => {
    if (!inviteCode || !displayName.trim() || !consentChecked) return;
    setSubmitting(true);
    setErrorMessage(null);
    const res = await joinFamilyWithInviteCode(inviteCode, displayName.trim(), JOIN_CONSENT_VERSION);
    if (!res.ok) {
      setSubmitting(false);
      setErrorMessage(
        res.error.code === PG_ERRCODE.insufficientPrivilege
          ? "メールのリンクをタップして認証を完了してから、もう一度お試しください"
          : res.error.code === PG_ERRCODE.uniqueViolation
          ? "すでに家族に参加しています"
          : res.error.code === PG_ERRCODE.noDataFound
          ? "招待コードが無効です"
          : // res.error.code === PG_ERRCODE.checkViolation（同意版数不一致。
            // スキーマ設計.sql 40.5章）の場合も含め、DB側のRAISE EXCEPTIONの
            // メッセージ本文（例:「アプリが古い可能性があります。最新の状態に
            // 更新してからもう一度お試しください」）をそのまま表示する
            // （API仕様.md 9章の指針どおり）。
            res.error.message
      );
      return;
    }
    await refreshParentMember();
    setSubmitting(false);
    router.replace("/parent/home");
  };

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>この家族に参加しますか？</Text>

      <Card style={{ marginTop: theme.spacing.s4 }}>
        <Text style={theme.typography.parentBodyMedium}>{familyName}</Text>
        <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s3 }}>
          {children.map((c) => (
            <MemberAvatar key={c.member_id} name={c.display_name} color={c.avatar_color} />
          ))}
        </View>
      </Card>

      <InviteVisibilityConsent role="parent" checked={consentChecked} onChange={setConsentChecked} />

      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s6 }]}>あなたの表示名</Text>
      <TextInput
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="例: たろう"
        style={{
          borderWidth: 1,
          borderColor: theme.colors.neutralBorder,
          borderRadius: theme.radius.parentMd,
          padding: theme.spacing.s3,
          backgroundColor: theme.colors.neutralSurface,
          marginTop: theme.spacing.s2,
        }}
      />

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <AppButton
        label={submitting ? "参加中…" : "参加を確定する"}
        loading={submitting}
        disabled={submitting || !displayName.trim() || !consentChecked}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={submit}
      />
      {/* 26.3節: disabled状態の理由を常時表示するキャプション（ポップアップ等は出さない） */}
      <Text
        style={[
          theme.typography.parentCaption,
          { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
        ]}
      >
        内容を確認してチェックを入れると、参加を確定できます
      </Text>
    </Screen>
  );
}
