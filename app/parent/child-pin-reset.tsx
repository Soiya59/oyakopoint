import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { setChildPin } from "@/data/api";

/**
 * P15拡張 子どものPIN設定・再発行（家族管理P14から）
 *
 * [2026-08-16追加・本部長] 既存のP15（app/parent/child-profile.tsx）はプロフィール新規
 * 作成とPIN設定が一体化した1本のフローで、既にプロフィールが存在する子ども（PIN未設定・
 * または再発行したい場合）に単独でPINを設定し直す導線が存在しなかった。ユーザーが実際に
 * 子どもとしてログインしようとして発見した不具合。要件定義書10章未決事項「子ども用PINの
 * 再発行フロー（忘れた場合、保護者が家族管理画面からリセットする想定でよいか）」への対応でもある。
 * 既存のsetChildPin() API（Edge Function `set-child-pin`。既存のfamily_member_pinsを
 * UPSERTするため新規・再発行のどちらでも同じ呼び出しで動く）をそのまま流用し、
 * child-profile.tsxの「pin」ステップと同じUIをこの画面単独で再現した。
 */
export default function ChildPinResetScreen() {
  const { memberId, displayName } = useLocalSearchParams<{ memberId: string; displayName: string }>();
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!memberId || pin.length !== 4) return;
    setSubmitting(true);
    setErrorMessage(null);
    const res = await setChildPin(memberId, pin);
    setSubmitting(false);
    if (!res.ok) {
      setErrorMessage(res.error.code === "invalid_pin_format" ? "4桁の数字を入力してください" : res.error.message);
      return;
    }
    setDone(true);
  };

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>PINを設定</Text>

      {done ? (
        <>
          <Text style={{ marginTop: theme.spacing.s4 }}>{displayName} のPINを設定しました。</Text>
          <AppButton
            label="家族管理へ戻る"
            style={{ marginTop: theme.spacing.s6 }}
            onPress={() => router.replace("/parent/family")}
          />
        </>
      ) : (
        <>
          <Text style={{ marginTop: theme.spacing.s4 }}>{displayName} の4桁PINを設定してください</Text>
          <TextInput
            value={pin}
            onChangeText={(t) => setPin(t.replace(/[^0-9]/g, "").slice(0, 4))}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="0000"
            style={{
              marginTop: theme.spacing.s2,
              borderWidth: 1,
              borderColor: theme.colors.neutralBorder,
              borderRadius: theme.radius.parentMd,
              padding: theme.spacing.s3,
              backgroundColor: theme.colors.neutralSurface,
              letterSpacing: 8,
              textAlign: "center",
              fontSize: 20,
            }}
          />

          {errorMessage && (
            <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
          )}

          <AppButton
            label={submitting ? "設定中…" : "PINを設定する"}
            loading={submitting}
            disabled={submitting || pin.length !== 4}
            style={{ marginTop: theme.spacing.s6 }}
            onPress={submit}
          />
        </>
      )}

      <AppButton label="戻る" variant="ghost" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.back()} />
    </Screen>
  );
}
