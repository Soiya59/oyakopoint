import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { useSession } from "@/lib/session";
import { useAppData } from "@/data/store";
import { createChildProfile, setChildPin } from "@/data/api";

/**
 * P15 子どもプロフィール追加・PIN設定
 * 参照: 画面一覧・遷移図.md P15、API仕様.md 2b章
 * （family_members.insert + Edge Function `set-child-pin`）
 *
 * [2026-08-15実装] スタブから実データ連携の簡易フォームへ差し替えた。
 * 手順1: PostgREST `family_members`へのINSERT（RLS: family_members_insert_by_parent）
 * 手順2: Edge Function `set-child-pin`でPINをbcryptハッシュ化して登録
 * （呼び出し元の保護者Auth JWTはsupabase.functions.invoke()が自動付与する）。
 */
type Step = "profile" | "pin" | "done";

export default function ChildProfileScreen() {
  const { parentMember, client } = useSession();
  const { refresh } = useAppData();
  const [step, setStep] = useState<Step>("profile");
  const [displayName, setDisplayName] = useState("");
  const [avatarColor, setAvatarColor] = useState<string>(theme.memberColorPalette[0].value);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdChildName, setCreatedChildName] = useState("");
  const [createdMemberId, setCreatedMemberId] = useState<string | null>(null);

  const submitProfile = async () => {
    if (!parentMember || !displayName.trim()) return;
    setSubmitting(true);
    setErrorMessage(null);
    const res = await createChildProfile(client, {
      family_id: parentMember.family_id,
      display_name: displayName.trim(),
      avatar_color: avatarColor,
    });
    setSubmitting(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    setCreatedChildName(res.data.display_name);
    setCreatedMemberId(res.data.id);
    setStep("pin");
    // メンバー一覧をuseAppData側にも反映（P14家族管理画面等の表示を最新化する）。
    void refresh();
  };

  const submitPin = async () => {
    if (!createdMemberId || pin.length !== 4) return;
    setSubmitting(true);
    setErrorMessage(null);
    const res = await setChildPin(createdMemberId, pin);
    setSubmitting(false);
    if (!res.ok) {
      setErrorMessage(res.error.code === "invalid_pin_format" ? "4桁の数字を入力してください" : res.error.message);
      return;
    }
    setStep("done");
  };

  return (
    <Screen tone="parent">
      <View style={styles.badge}>
        <Text style={styles.badgeText}>P15</Text>
      </View>
      <Text style={theme.typography.parentTitle}>子どもプロフィール追加</Text>

      {step === "profile" && (
        <>
          <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s4 }]}>ニックネーム</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="例: ちひろ"
            style={styles.input}
          />

          <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s4 }]}>アバターカラー</Text>
          <View style={styles.colorGrid}>
            {theme.memberColorPalette.map((c) => (
              <Pressable
                key={c.value}
                onPress={() => setAvatarColor(c.value)}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: c.value, borderWidth: avatarColor === c.value ? 3 : 0 },
                ]}
              />
            ))}
          </View>
          <View style={{ marginTop: theme.spacing.s3 }}>
            <MemberAvatar name={displayName || "?"} color={avatarColor} size={48} />
          </View>

          {errorMessage && (
            <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
          )}

          <AppButton
            label={submitting ? "作成中…" : "つぎへ（PIN設定）"}
            loading={submitting}
            disabled={submitting || !displayName.trim()}
            style={{ marginTop: theme.spacing.s6 }}
            onPress={submitProfile}
          />
        </>
      )}

      {step === "pin" && (
        <>
          <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s4 }]}>
            {createdChildName} の4桁PINを設定してください
          </Text>
          <TextInput
            value={pin}
            onChangeText={(t) => setPin(t.replace(/[^0-9]/g, "").slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="0000"
            style={[styles.input, { letterSpacing: 8, textAlign: "center", fontSize: 20 }]}
          />

          {errorMessage && (
            <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
          )}

          <AppButton
            label={submitting ? "設定中…" : "PINを設定する"}
            loading={submitting}
            disabled={submitting || pin.length !== 4}
            style={{ marginTop: theme.spacing.s6 }}
            onPress={submitPin}
          />
        </>
      )}

      {step === "done" && (
        <>
          <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s4 }]}>
            {createdChildName} のプロフィールを作成しました。
          </Text>
          <AppButton
            label="家族管理へ戻る"
            style={{ marginTop: theme.spacing.s6 }}
            onPress={() => router.replace("/parent/family")}
          />
        </>
      )}

      <AppButton label="戻る" variant="ghost" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.brandPrimarySoft,
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s1,
    borderRadius: theme.radius.parentMd,
    marginBottom: theme.spacing.s3,
  },
  badgeText: { color: theme.colors.brandPrimaryStrong, fontWeight: "700", fontSize: 12 },
  input: {
    marginTop: theme.spacing.s2,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    padding: theme.spacing.s3,
    backgroundColor: theme.colors.neutralSurface,
  },
  colorGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s2 },
  colorSwatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderColor: theme.colors.neutralTextPrimary,
  },
});
