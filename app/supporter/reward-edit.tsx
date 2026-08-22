import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { createPersonalReward, deactivateReward, updatePersonalReward } from "@/data/api";

/**
 * S9 自分専用のごほうび登録・編集（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S9、API仕様.md 7b章
 */
export default function SupporterRewardEditScreen() {
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
  const [deleting, setDeleting] = useState(false);
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
    if (!state.family.id) {
      setErrorMessage("家族データの読み込みが完了していません。もう一度お試しください");
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
      ? await updatePersonalReward(client, reward.id, input)
      : await createPersonalReward(client, state.family.id, input);

    setSaving(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    await refresh();
    router.replace("/supporter/rewards");
  };

  const remove = async () => {
    if (!reward) return;
    setDeleting(true);
    const res = await deactivateReward(client, reward.id);
    setDeleting(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    await refresh();
    router.replace("/supporter/rewards");
  };

  if (isEditMode && !reward) {
    return (
      <Screen tone="supporter">
        <Text style={theme.typography.supporterBody}>ごほうびが見つかりませんでした</Text>
        <AppButton tone="supporter" label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s4 }} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen tone="supporter">
      <Text style={theme.typography.supporterTitle}>
        {reward ? `${reward.emoji ?? "🎁"} ごほうびを編集` : "じぶんのごほうびを新規登録"}
      </Text>
      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        この一覧は本人専用です。家族には公開されません。
      </Text>

      <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>名前（必須）</Text>
      <TextInput value={name} onChangeText={setName} placeholder="例：2kg痩せたら好きなものを買う" maxLength={100} style={styles.input} />

      <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>絵文字（任意）</Text>
      <TextInput
        value={emoji ?? ""}
        onChangeText={(t) => setEmoji(t || null)}
        placeholder="例：🍰（絵文字キーボードから入力）"
        maxLength={8}
        style={[styles.input, styles.emojiInput]}
      />

      <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>コスト（1以上の整数）</Text>
      <TextInput
        value={costText}
        onChangeText={(t) => setCostText(t.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        placeholder="例：50"
        style={styles.input}
      />

      <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>説明（任意）</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="例：好きなケーキを1つ"
        multiline
        style={[styles.input, styles.textArea]}
      />

      {errorMessage && <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>}

      <AppButton
        tone="supporter"
        label={saving ? "保存中…" : "保存する"}
        loading={saving}
        disabled={saving || deleting}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={save}
      />

      {reward && (
        <AppButton
          tone="supporter"
          label={deleting ? "削除中…" : "このごほうびを削除する"}
          variant="danger"
          disabled={saving || deleting}
          style={{ marginTop: theme.spacing.s3 }}
          onPress={remove}
        />
      )}

      <AppButton tone="supporter" label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { marginTop: theme.spacing.s4 },
  input: {
    marginTop: theme.spacing.s2,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    padding: theme.spacing.s3,
    backgroundColor: theme.colors.neutralSurface,
  },
  emojiInput: { width: 96, fontSize: 20, textAlign: "center" },
  textArea: { minHeight: 80, textAlignVertical: "top" },
});
