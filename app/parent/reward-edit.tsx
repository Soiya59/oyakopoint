import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { createReward, updateReward } from "@/data/api";
import { REWARD_EMOJI_OPTIONS } from "@/lib/emojiOptions";

/**
 * P13 ごほうび登録・編集
 * 参照: 画面一覧・遷移図.md P13、API仕様.md 7章
 *
 * [2026-08-18実装・本部長] StubScreenのまま放置されており、ユーザーが実機で
 * 「ご褒美の追加ができない」と発見した。P11（app/parent/chore-edit.tsx、
 * 実装メモ.md 21章）と同じ構成で、実際に保存できるフォームに差し替えた。
 * カテゴリー・担当・繰り返し設定・NFC等、choreに存在する項目はrewardsテーブルには
 * 無いため対象外。
 *
 * [2026-08-20追加] 当初emojiは入力項目に含めていなかったが、絵文字が一切表示されず
 * 見にくいとユーザーが実機で発見したため、chore-edit.tsxと同じ絵文字ピッカーを追加した。
 */
export default function RewardEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state, refresh } = useAppData();
  const { client } = useSession();
  const isEditMode = !!id;
  const reward = isEditMode ? state.rewards.find((r) => r.id === id) : undefined;

  const [name, setName] = useState(reward?.name ?? "");
  const [emoji, setEmoji] = useState<string | null>(reward?.emoji ?? null);
  const [costText, setCostText] = useState(reward ? String(reward.cost) : "");
  const [description, setDescription] = useState(reward?.description ?? "");

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const validate = (): string | null => {
    if (!name.trim()) return "名前を入力してください";
    if (name.trim().length > 100) return "名前は100文字以内で入力してください";
    const costNum = Number(costText);
    if (!Number.isInteger(costNum) || costNum < 1) return "コストは1以上の整数で入力してください";
    return null;
  };

  const save = async () => {
    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setErrorMessage(null);
    setSaving(true);

    const input = {
      name: name.trim(),
      emoji,
      cost: Number(costText),
      description: description.trim() ? description.trim() : null,
    };

    const res = reward
      ? await updateReward(client, reward.id, input)
      : await createReward(client, state.family.id, input);

    setSaving(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    await refresh();
    router.replace("/parent/rewards");
  };

  if (isEditMode && !reward) {
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentBody}>ごほうびが見つかりませんでした</Text>
        <AppButton label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s4 }} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>
        {reward ? `${reward.emoji ?? "🎁"} ごほうびを編集` : "ごほうびを新規登録"}
      </Text>
      <Text style={[theme.typography.parentBody, styles.purpose]}>reward作成・編集</Text>

      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>名前（必須）</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="例：おかし1つ"
        maxLength={100}
        style={styles.input}
      />

      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>絵文字（未選択でも登録できます）</Text>
      <View style={styles.chipRow}>
        <Pressable onPress={() => setEmoji(null)} style={[styles.chip, emoji === null && styles.chipSelected]}>
          <Text>未選択</Text>
        </Pressable>
        {REWARD_EMOJI_OPTIONS.map((e) => (
          <Pressable key={e} onPress={() => setEmoji(e)} style={[styles.chip, emoji === e && styles.chipSelected]}>
            <Text style={{ fontSize: 18 }}>{e}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>コスト（1以上の整数）</Text>
      <TextInput
        value={costText}
        onChangeText={(t) => setCostText(t.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        placeholder="例：10"
        style={styles.input}
      />

      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>説明（任意）</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="例：好きなおかしを1つえらべる"
        multiline
        style={[styles.input, styles.textArea]}
      />

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <AppButton
        label={saving ? "保存中…" : "保存する"}
        loading={saving}
        disabled={saving}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={save}
      />

      <AppButton label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  purpose: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  fieldLabel: { marginTop: theme.spacing.s4 },
  input: {
    marginTop: theme.spacing.s2,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    padding: theme.spacing.s3,
    backgroundColor: theme.colors.neutralSurface,
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s2 },
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
