import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { inviteLookup } from "@/data/api";
import { formatEdgeFailureRef } from "@/lib/edgeFailureRef";
import { GENERIC_ERROR_MESSAGE } from "@/lib/errorMessages";

/**
 * P5 招待コード入力（保護者として参加）
 * 参照: API仕様.md 2a章 Edge Function `invite-lookup`
 *
 * [設計判断の補完] invite-lookupのレスポンス（認証・データ管理設計書.md 3.1章）は
 * `family_name` と `children`（ニックネーム＋アバター色）のみを返し、保護者メンバーの
 * 一覧は返さない（個人情報最小化方針、4章参照）。そのためP6のプレビューは
 * 家族名＋子どもの一覧のみで構成する（保護者一覧は表示しない）。
 *
 * [2026-09-27変更・ワイヤーフレーム67章決定7順位3] 以前は「招待コードが見つから
 * ない」以外の失敗をすべて`res.error.message`（Edge Functionの生の文言）を
 * そのまま表示していた。ログインの画面（EmailCodeVerifyForm.tsx、実装メモ262章）
 * と同じ考え方で、行動が変わるもの（電波・混み合い）だけ文言を分け、原因を
 * 追うための「目印」を小さく添える。この画面は保護者（P5）専用で子ども向けの
 * 分岐は無い（67.3節決定5の対象外＝常に目印を出してよい）。
 */
const MSG_OFFLINE = "電波の状態が悪いようです。電波の良い場所で、もう一度お試しください。";
const MSG_SERVER_BUSY = "ただいま混み合っているようです。少し時間をおいてから、もう一度お試しください。";

export default function JoinFamilyScreen() {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorRef, setErrorRef] = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim()) return;
    setChecking(true);
    setErrorMessage(null);
    setErrorRef(null);
    const res = await inviteLookup(code.trim());
    setChecking(false);
    if (!res.ok) {
      const e = res.error;
      setErrorMessage(
        e.code === "invite_code_not_found"
          ? "招待コードが見つかりませんでした"
          : e.code === "network_error"
          ? MSG_OFFLINE
          : typeof e.status === "number" && e.status >= 500
          ? MSG_SERVER_BUSY
          : GENERIC_ERROR_MESSAGE
      );
      setErrorRef(formatEdgeFailureRef(e));
      return;
    }
    router.push({
      pathname: "/onboarding/join-preview",
      params: {
        inviteCode: code.trim().toUpperCase(),
        familyName: res.data.family_name,
        childrenJson: JSON.stringify(res.data.children),
      },
    });
  };

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>招待コードを入力</Text>
      <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }}>
        もう一人の保護者から共有された8桁のコードを入力してください。
      </Text>
      <View style={{ marginTop: theme.spacing.s6 }}>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="AB3CD9EF"
          autoCapitalize="characters"
          maxLength={8}
          style={{
            borderWidth: 1,
            borderColor: theme.colors.neutralBorder,
            borderRadius: theme.radius.parentMd,
            padding: theme.spacing.s3,
            backgroundColor: theme.colors.neutralSurface,
            letterSpacing: 2,
          }}
        />
      </View>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}
      {errorRef && (
        <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
          目印 {errorRef}
        </Text>
      )}

      <AppButton
        label={checking ? "確認中…" : "確認する"}
        loading={checking}
        disabled={checking || code.trim().length === 0}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={submit}
      />
    </Screen>
  );
}
