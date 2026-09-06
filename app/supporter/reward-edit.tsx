import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { createSupporterSharedReward, deleteReward, updatePersonalReward } from "@/data/api";

/**
 * S9 ごほうび登録・編集（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S9、API仕様.md 7b章・7b-2章
 *
 * [2026-09-06改訂・要件定義書07-18章決定6'・UIUXデザイン部30.1節決定2・30.6節]
 * 新規登録は常にscope='supporter_shared'（みまもり共通）になり、作成者を問わず
 * みまもりメンバー全員が自分のポイントで交換できる（決定6'-2）。編集・削除は
 * 引き続き作成者本人のみに限定される（既存のscope='personal'行も同様）。
 */

// [2026-09-04追加・実装メモ.md 127章] app/supporter/chore-edit.tsxの
// SUPPORTER_CHORE_EMOJI_SUGGESTIONSと同じ発想の候補チップ。みまもりメンバー自身が
// 自分へのごほうびとして交換するものを想定した5個にした（UIUXデザイン部/成果物/
// 主要画面ワイヤーフレーム.md 14.2.1節）。
const SUPPORTER_REWARD_EMOJI_SUGGESTIONS = ["🍰", "☕", "🛍️", "♨️", "🎬"];
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
      : await createSupporterSharedReward(client, state.family.id, input);

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
    const res = await deleteReward(client, reward.id);
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
        {reward ? `${reward.emoji ?? "🎁"} ごほうびを編集` : "ごほうびを新規登録"}
      </Text>
      {/* [2026-08-23改訂] 「ごほうびも家族に見せたい」というユーザー要望を受け、
          choreと同じく家族公開に変更した（rewards_select_scoped、family_id一致のみ）。
          [2026-09-06改訂・要件定義書07-18章決定6'-2・UIUXデザイン部30.6節決定16]
          対象reward（既存か新規か）で文言を出し分ける。既存のscope='personal'行に
          限り、決定6'-3の案内（削除して登録し直す）も兼ねる。 */}
      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        {reward?.scope === "personal"
          ? "このごほうびは家族みんなに見えますが、交換できるのはあなただけです。今後あたらしく登録するごほうびは、みまもりメンバーなら誰でも交換できるようになります。共通にしたい場合は、いちど削除して登録し直してください（これまでの交換記録は残ります）。"
          : "このごほうびは家族みんなに見えます。みまもりメンバーなら誰でも、自分のポイントで交換できます。編集・削除ができるのはあなただけです。"}
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
      <View style={styles.chipRow}>
        {SUPPORTER_REWARD_EMOJI_SUGGESTIONS.map((e) => (
          <Pressable
            key={e}
            onPress={() => setEmoji(e)}
            style={[styles.chip, emoji === e && styles.chipSelected]}
          >
            <Text style={{ fontSize: 18 }}>{e}</Text>
          </Pressable>
        ))}
      </View>

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
  // [2026-09-04追加・実装メモ.md 127章] app/supporter/chore-edit.tsxと同じ内容。
  // このファイルにはchipRow/chip/chipSelectedが未定義だったため新設した。
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
  chipSelected: { borderColor: theme.colors.supporterAccent, backgroundColor: theme.colors.supporterAccentSoft },
});
