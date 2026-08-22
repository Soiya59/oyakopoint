import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { createPersonalChore, deactivateChore, updatePersonalChore } from "@/data/api";

/**
 * S6 自分専用のお手伝い登録・編集（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S6、API仕様.md 3b章
 *
 * app/parent/chore-edit.tsx（P11）と同じ構成の基本項目フォームだが、以下が異なる。
 * - カテゴリー・担当（assigned_to）・NFCタグ登録は対象外（自分専用choreには存在しない
 *   概念、19章「自分専用choreにおけるassigned_toは自己指定」のためUIで選ばせる必要が無い）
 * - 削除ボタンを追加（編集時のみ。論理削除＝is_active=false）
 *
 * [2026-08-23改訂] 要件定義書07-7章4回目のスコープ変更（ユーザーの要望「いっしょに
 * やるというのはいらない」）により、「家族に共有する／しない」トグルは撤回した。
 * [2026-08-23再改訂・5回目のスコープ変更] 「常に非公開」という方針を撤回し、
 * 自分専用のお手伝いは常に家族全員に公開される（可視性を選べる設定は引き続き
 * 設けない）。編集・完了報告は引き続き作成者本人のみが行える（要件定義書07-7章
 * 「自分専用choreの公開方針」参照）。
 */
export default function SupporterChoreEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state, refresh } = useAppData();
  const { client } = useSession();
  const isEditMode = !!id;
  const chore = isEditMode ? state.chores.find((c) => c.id === id) : undefined;

  const [title, setTitle] = useState(chore?.title ?? "");
  const [emoji, setEmoji] = useState<string | null>(chore?.emoji ?? null);
  const [pointsText, setPointsText] = useState(chore ? String(chore.points) : "");
  const [isRepeatable, setIsRepeatable] = useState(chore?.is_repeatable ?? false);
  const [dailyLimitText, setDailyLimitText] = useState(chore?.daily_limit != null ? String(chore.daily_limit) : "");

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const validate = (): string | null => {
    if (!title.trim()) return "タイトルを入力してください";
    if (title.trim().length > 100) return "タイトルは100文字以内で入力してください";
    const pointsNum = Number(pointsText);
    if (!Number.isInteger(pointsNum) || pointsNum < 1) return "ポイントは1以上の整数で入力してください";
    if (isRepeatable && dailyLimitText.trim()) {
      const limitNum = Number(dailyLimitText);
      if (!Number.isInteger(limitNum) || limitNum < 1) return "1日の上限回数は1以上の整数で入力してください（空欄で無制限）";
    }
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
      title: title.trim(),
      emoji,
      points: Number(pointsText),
      is_repeatable: isRepeatable,
      daily_limit: isRepeatable && dailyLimitText.trim() ? Number(dailyLimitText) : null,
    };

    const res = chore
      ? await updatePersonalChore(client, chore.id, input)
      : await createPersonalChore(client, state.family.id, input);

    setSaving(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    await refresh();
    router.replace("/supporter/my-chores");
  };

  const remove = async () => {
    if (!chore) return;
    setDeleting(true);
    const res = await deactivateChore(client, chore.id);
    setDeleting(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    await refresh();
    router.replace("/supporter/my-chores");
  };

  if (isEditMode && !chore) {
    return (
      <Screen tone="supporter">
        <Text style={theme.typography.supporterBody}>お手伝いが見つかりませんでした</Text>
        <AppButton tone="supporter" label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s4 }} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen tone="supporter">
      <Text style={theme.typography.supporterTitle}>
        {chore ? `${chore.emoji ?? "🎯"} お手伝いを編集` : "じぶんのお手伝いを新規登録"}
      </Text>

      <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>タイトル（必須）</Text>
      <TextInput value={title} onChangeText={setTitle} placeholder="例：ウォーキング30分" maxLength={100} style={styles.input} />

      <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>絵文字（任意）</Text>
      <TextInput
        value={emoji ?? ""}
        onChangeText={(t) => setEmoji(t || null)}
        placeholder="例：🚶（絵文字キーボードから入力）"
        maxLength={8}
        style={[styles.input, styles.emojiInput]}
      />

      <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>ポイント（1以上の整数）</Text>
      <TextInput
        value={pointsText}
        onChangeText={(t) => setPointsText(t.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        placeholder="例：10"
        style={styles.input}
      />

      <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>繰り返し設定</Text>
      <View style={styles.chipRow}>
        <Pressable onPress={() => setIsRepeatable(false)} style={[styles.chip, !isRepeatable && styles.chipSelected]}>
          <Text>1回だけ</Text>
        </Pressable>
        <Pressable onPress={() => setIsRepeatable(true)} style={[styles.chip, isRepeatable && styles.chipSelected]}>
          <Text>くり返す</Text>
        </Pressable>
      </View>

      {isRepeatable && (
        <>
          <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>1日の上限回数（空欄で無制限）</Text>
          <TextInput
            value={dailyLimitText}
            onChangeText={(t) => setDailyLimitText(t.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            placeholder="空欄=無制限"
            style={styles.input}
          />
        </>
      )}

      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s4, color: theme.colors.neutralTextSecondary }]}>
        ※ このお手伝いは家族みんなに見えます（ごほうびは見えません）。完了報告や編集ができるのは自分だけです。
      </Text>

      {errorMessage && <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>}

      <AppButton
        tone="supporter"
        label={saving ? "保存中…" : "保存する"}
        loading={saving}
        disabled={saving || deleting}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={save}
      />

      {chore && (
        <AppButton
          tone="supporter"
          label={deleting ? "削除中…" : "このお手伝いを削除する"}
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
