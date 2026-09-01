import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { useSession } from "@/lib/session";
import { useAppData } from "@/data/store";
import { createChildProfile, setChildPin } from "@/data/api";
import { resolveAvatarColorOptions, hasNoSelectableColor } from "@/lib/avatarColorAvailability";

/**
 * P15 子どもプロフィール追加・PIN設定
 * 参照: 画面一覧・遷移図.md P15、API仕様.md 2b章
 * （family_members.insert + Edge Function `set-child-pin`）
 *
 * [2026-08-15実装] スタブから実データ連携の簡易フォームへ差し替えた。
 * 手順1: PostgREST `family_members`へのINSERT（RLS: family_members_insert_by_parent）
 * 手順2: Edge Function `set-child-pin`でPINをbcryptハッシュ化して登録
 * （呼び出し元の保護者Auth JWTはsupabase.functions.invoke()が自動付与する）。
 *
 * [2026-09-01追加] 色の重複防止（主要画面ワイヤーフレーム.md 25.2節）。在籍中の
 * 他メンバーが使っている色はグレーアウトし、タップすると「この色は、今〇〇さんが
 * 使っています」を表示する（選択肢からは消さない）。判定は src/lib/avatarColorAvailability.ts
 * の共通関数を使い、P14「設定」の色変更と同じロジックを共有する（実装メモ100章）。
 */
type Step = "profile" | "pin" | "done";

export default function ChildProfileScreen() {
  const { parentMember, client } = useSession();
  const { state, refresh } = useAppData();
  const [step, setStep] = useState<Step>("profile");
  const [displayName, setDisplayName] = useState("");

  // P15では対象本人がまだ存在しないため excludeMemberId は null（25.3節）。
  const colorOptions = useMemo(
    () => resolveAvatarColorOptions(theme.memberColorPalette, state.members, null),
    [state.members]
  );
  const noSelectableColor = hasNoSelectableColor(colorOptions);
  // デフォルト選択は先頭の色（25.2節）。ただし先頭の色が在籍中の他メンバーで
  // 使用中の場合にそのまま初期選択すると、画面を開いた直後に何も操作せず
  // 保存すると即座に重複が発生してしまうため、先頭から見て最初に選べる色を
  // 初期値にする（全色使用中の場合のみ、そのまま先頭の色を初期値にする）。
  const [avatarColor, setAvatarColor] = useState<string>(
    () => colorOptions.find((c) => c.usedByName === null)?.value ?? theme.memberColorPalette[0].value
  );
  const [usedColorMessage, setUsedColorMessage] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdChildName, setCreatedChildName] = useState("");
  const [createdMemberId, setCreatedMemberId] = useState<string | null>(null);

  const selectColor = (colorValue: string, usedByName: string | null) => {
    if (usedByName) {
      setUsedColorMessage(`この色は、今${usedByName}さんが使っています`);
      return;
    }
    setUsedColorMessage(null);
    setAvatarColor(colorValue);
  };

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
            {colorOptions.map((c) => (
              <Pressable
                key={c.value}
                onPress={() => selectColor(c.value, c.usedByName)}
                style={[
                  styles.colorSwatch,
                  {
                    backgroundColor: c.value,
                    borderWidth: avatarColor === c.value ? 3 : 0,
                    opacity: c.usedByName ? 0.4 : 1,
                  },
                ]}
              />
            ))}
          </View>
          {usedColorMessage && (
            <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
              {usedColorMessage}
            </Text>
          )}
          {noSelectableColor && (
            <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }}>
              今選べる色がありません。どなたかが家族を離れると、また選べるようになります。
            </Text>
          )}
          <View style={{ marginTop: theme.spacing.s3 }}>
            <MemberAvatar name={displayName || "?"} color={avatarColor} size={48} />
          </View>

          {errorMessage && (
            <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
          )}

          <AppButton
            label={submitting ? "作成中…" : "つぎへ（PIN設定）"}
            loading={submitting}
            disabled={submitting || !displayName.trim() || noSelectableColor}
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
