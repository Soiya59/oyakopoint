import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { createReward, deleteReward, updateReward } from "@/data/api";
import { toJstDateString } from "@/lib/calendarDates";

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
 * 見にくいとユーザーが実機で発見したため追加した。候補から選ぶチップ形式を一度試したが、
 * ユーザーから「自分で決めたい、選択ではなく」との要望があり、自由入力（TextInput、
 * OS標準の絵文字キーボードを使う想定）に変更した。
 *
 * [2026-09-03追加・本部長] 保護者代理でのごほうび交換の入口（主要画面ワイヤーフレーム.md
 * 5.5節、画面一覧・遷移図.md P13行）。編集モードかつ在籍中の子ども（role='child' &&
 * is_active）が1人以上いる場合のみ、「保存する」ボタンの下・削除セクションの上に
 * 「🎁 子どもの代わりに交換する」導線を出す。子どもが1人ならP36（保護者代理の交換確認）
 * へ直行、2人以上ならP35（だれの代わりに交換するか選ぶ）を経由する（5.5.0決定2）。
 * P12の各行の見た目は変更しない（24.1節決定5、5.5.0決定1との整合）。
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
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // [2026-09-03追加] 主要画面ワイヤーフレーム.md 5.5.1節。対象は在籍中の子どものみ
  // （5.5節「背景」: 保護者自身の交換はP15、みまもりメンバーの自分専用ごほうびは
  // reward_redemptions_insert_scopedポリシー上そもそも代理交換できない）。
  const redeemableChildren = state.members.filter((m) => m.role === "child" && m.is_active);

  const validate = (): string | null => {
    if (!name.trim()) return "名前を入力してください";
    if (name.trim().length > 100) return "名前は100文字以内で入力してください";
    const costNum = Number(costText);
    if (!Number.isInteger(costNum) || costNum < 1) return "コストは1以上の整数で入力してください";
    return null;
  };

  const remove = async () => {
    if (!reward) return;
    setDeleting(true);
    setErrorMessage(null);
    const res = await deleteReward(client, reward.id);
    setDeleting(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    await refresh();
    router.replace("/parent/rewards");
  };

  const save = async () => {
    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    // app/parent/chore-edit.tsxと同じ理由の安全策（実装メモ.md参照）。
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

      {/* [2026-08-30追加] 登録者・最終編集者（要件定義書07-15章、主要画面ワイヤーフレーム.md
          24.2節決定4）。app/parent/chore-edit.tsxと全く同じ構成・分岐。 */}
      {reward && (
        <Card style={styles.metaCard} tone="parent">
          <Text style={[theme.typography.parentCaption, styles.metaLine, { color: theme.colors.neutralTextSecondary }]}>
            登録: {reward.creator?.display_name ?? "記録なし"}
          </Text>
          <Text style={[theme.typography.parentCaption, styles.metaLine, { color: theme.colors.neutralTextSecondary }]}>
            最終編集:{" "}
            {reward.editor
              ? `${reward.editor.display_name}・${toJstDateString(reward.updated_at).replace(/-/g, "/")}`
              : "記録なし"}
          </Text>
        </Card>
      )}

      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>名前（必須）</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="例：おかし1つ"
        maxLength={100}
        style={styles.input}
      />

      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>絵文字（任意）</Text>
      <TextInput
        value={emoji ?? ""}
        onChangeText={(t) => setEmoji(t || null)}
        placeholder="例：🎁（絵文字キーボードから入力）"
        maxLength={8}
        style={[styles.input, styles.emojiInput]}
      />
      <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
        Windowsは「Windowsキー + .（ピリオド）」、スマホは絵文字キーボードから入力できます
      </Text>

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

      {/* [2026-09-03追加] 保護者代理でのごほうび交換の入口（主要画面ワイヤーフレーム.md
          5.5.1節）。編集モード・家族共有（scope==='family'、この画面が扱うのは常に
          家族共有のはずだが念のため確認する）・在籍中の子どもが1人以上、の3条件を
          すべて満たすときのみ表示する。P12「🎮 みまもりのごほうび →」カードと同型
          （見出し行＋説明キャプション）にし、押し間違い防止のため「保存する」
          ボタンとは形を変える（5.5.1節）。 */}
      {isEditMode && reward && reward.scope === "family" && redeemableChildren.length > 0 && (
        <Pressable
          onPress={() => {
            if (redeemableChildren.length === 1) {
              router.push({
                pathname: "/parent/redeem-for-child-confirm",
                params: { rewardId: reward.id, memberId: redeemableChildren[0].id },
              });
            } else {
              router.push({ pathname: "/parent/redeem-for-child", params: { rewardId: reward.id } });
            }
          }}
          style={{ marginTop: theme.spacing.s6 }}
          hitSlop={8}
        >
          <Card>
            <Text style={theme.typography.parentBodyMedium}>🎁 子どもの代わりに交換する →</Text>
            <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
              選んだお子さんの残高から交換します
            </Text>
          </Card>
        </Pressable>
      )}

      {/* [2026-08-29追加・本部長／軽微変更ルート] ごほうびの削除。ユーザー要望
          「ごほうびにおいても削除できるようにしてほしい」。クエストの削除と同じ扱いで、
          完全削除（DELETE）だが交換履歴とポイントは残る（src/data/api.ts deleteReward参照）。
          取り消せないため、家族削除・クエスト削除と同じ画面内2段階確認にする。 */}
      {isEditMode && reward && (
        <View style={{ marginTop: theme.spacing.s8 }}>
          {confirmingDelete ? (
            <View style={{ gap: theme.spacing.s2 }}>
              <Text style={{ color: theme.colors.statusBlocking }}>
                「{reward.name}」を削除しますか？取り消せません。
              </Text>
              <Text style={theme.typography.parentCaption}>
                これまでの交換の記録とポイントはそのまま残ります。
              </Text>
              <Text style={theme.typography.parentCaption}>
                ただし通帳に残る過去の交換の絵文字は、{reward.emoji ?? "🎁"} ではなく 🎁 に変わります。
              </Text>
              <AppButton
                label={deleting ? "削除中…" : "本当に削除する"}
                variant="danger"
                onPress={remove}
                disabled={deleting}
              />
              <AppButton label="やめる" variant="ghost" onPress={() => setConfirmingDelete(false)} disabled={deleting} />
            </View>
          ) : (
            <AppButton
              label="このごほうびを削除する"
              variant="danger"
              onPress={() => setConfirmingDelete(true)}
              disabled={saving || deleting}
            />
          )}
        </View>
      )}

      <AppButton label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  purpose: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  // [2026-08-30追加] app/parent/chore-edit.tsxと同じスタイル。
  metaCard: { marginTop: theme.spacing.s4 },
  metaLine: { marginTop: theme.spacing.s1 },
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
