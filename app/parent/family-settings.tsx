import React, { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { Text } from "react-native";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { updateFamilyName } from "@/data/api";

/**
 * P40 家族の設定（保護者、2026-09-21新設）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 59.2節 決定2
 *       画面一覧・遷移図.md P14「設定」の「家族の設定 →」から遷移
 *
 * `app/parent/family.tsx`（P14）にあった「家族名の変更」と「家族のやりとりの
 * 設定」（トグル）を、そのままこの画面へ移設した。文言・状態・保存の挙動は
 * 一切変えていない（そのままコピー。59.2節決定2）。
 */
export default function FamilySettingsScreen() {
  const { state, refresh, setFamilySocialInteractionsEnabled } = useAppData();
  const { client } = useSession();

  const [familyName, setFamilyName] = useState(state.family.name);
  const [savingFamilyName, setSavingFamilyName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [savingSocial, setSavingSocial] = useState(false);
  const [socialSuccess, setSocialSuccess] = useState(false);
  const [socialError, setSocialError] = useState<string | null>(null);

  const saveFamilyName = async () => {
    const trimmed = familyName.trim();
    if (!trimmed || trimmed === state.family.name) return;
    setSavingFamilyName(true);
    setNameError(null);
    setNameSaved(false);
    const res = await updateFamilyName(client, state.family.id, trimmed);
    setSavingFamilyName(false);
    if (!res.ok) {
      setNameError(res.error.message);
      return;
    }
    await refresh();
    setNameSaved(true);
  };

  // [2026-09-21追加・要件定義書07-32章 決定18・56.3節決定18] 押した瞬間に保存する
  // （「保存する」ボタンは置かない）。
  const setSocialInteractionsEnabled = async (enabled: boolean) => {
    setSavingSocial(true);
    setSocialError(null);
    const res = await setFamilySocialInteractionsEnabled(enabled);
    setSavingSocial(false);
    if (!res.ok) {
      setSocialError("変更できませんでした。もう一度お試しください。");
      return;
    }
    setSocialSuccess(true);
    setTimeout(() => setSocialSuccess(false), 4000);
  };

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/family")} />
      <Text style={theme.typography.parentTitle}>家族の設定</Text>

      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s4 }]}>家族名</Text>
      <TextInput
        value={familyName}
        onChangeText={(t) => {
          setFamilyName(t);
          setNameSaved(false);
        }}
        maxLength={100}
        style={[theme.typography.parentBody, styles.nameInput, { marginTop: theme.spacing.s2 }]}
      />
      {nameError && <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.statusBlocking }}>{nameError}</Text>}
      {nameSaved && !nameError && (
        <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.brandPrimaryStrong }}>変更しました</Text>
      )}
      <AppButton
        label={savingFamilyName ? "保存中…" : "家族名を保存する"}
        variant="secondary"
        style={{ marginTop: theme.spacing.s3 }}
        onPress={saveFamilyName}
        disabled={savingFamilyName || !familyName.trim() || familyName.trim() === state.family.name}
      />

      <Card style={{ marginTop: theme.spacing.s6 }}>
        <Text style={theme.typography.parentBodyMedium}>家族のやりとりの設定</Text>
        <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
          家族みんなの画面に反映されます。これまでに書いたものは消えません。
        </Text>
        <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s3 }]}>
          家族の掲示板・完了報告への「＋コメント」・ありがとうのメッセージを使う
        </Text>
        <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
          ・掲示板は、子どもの画面では「かぞくのけいじばん」といいます
        </Text>
        <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
          ・「＋コメント」は、子どもの画面では「＋ひとこと」といいます
        </Text>
        <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
          「いまは使わない」にすると、この3つを書く・送ることが止まります。スタンプを送ることと、ありがとうのポイントを贈ることは、そのまま使えます。とまるのはメッセージだけです。
        </Text>
        <View style={[styles.chipRow, { marginTop: theme.spacing.s2 }]}>
          <Pressable
            onPress={() => setSocialInteractionsEnabled(true)}
            disabled={savingSocial}
            style={[styles.chip, state.family.social_interactions_enabled && styles.chipSelected]}
          >
            <Text>使う</Text>
          </Pressable>
          <Pressable
            onPress={() => setSocialInteractionsEnabled(false)}
            disabled={savingSocial}
            style={[styles.chip, !state.family.social_interactions_enabled && styles.chipSelected]}
          >
            <Text>いまは使わない</Text>
          </Pressable>
        </View>
        {savingSocial && (
          <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
            保存中…
          </Text>
        )}
        {socialSuccess && (
          <Text style={{ color: theme.colors.brandPrimaryStrong, marginTop: theme.spacing.s1 }}>変更しました</Text>
        )}
        {socialError && (
          <Text style={{ color: theme.colors.statusBlocking, marginTop: theme.spacing.s1 }}>{socialError}</Text>
        )}
        {/* [2026-09-21追加・主要画面ワイヤーフレーム.md 56.4節 決定21] オフの間だけ、
            過去の投稿を読む道を残す（読み取り専用。投稿ボタンは出さない）。 */}
        {!state.family.social_interactions_enabled && (
          <Pressable onPress={() => router.push("/parent/family-board")} style={{ marginTop: theme.spacing.s2 }}>
            <Text style={[theme.typography.parentBody, { textDecorationLine: "underline" }]}>これまでの書き込みを読む</Text>
          </Pressable>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  nameInput: {
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    backgroundColor: theme.colors.neutralSurface,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  chipSelected: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
});
