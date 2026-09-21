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
import { NotificationDeviceStatusRow } from "@/components/NotificationSoftAsk";

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
  const { state, refresh, setFamilySocialInteractionsEnabled, setFamilyPushNotificationsEnabled } = useAppData();
  const { client } = useSession();

  const [familyName, setFamilyName] = useState(state.family.name);
  const [savingFamilyName, setSavingFamilyName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [savingSocial, setSavingSocial] = useState(false);
  const [socialSuccess, setSocialSuccess] = useState(false);
  const [socialError, setSocialError] = useState<string | null>(null);

  // [2026-09-22追加・要件定義書07-37章3-1節、UIUXデザイン部/成果物/
  // 主要画面ワイヤーフレーム.md 63.1節] 通知トグル（やりとりトグルの直下に
  // 1段インデントして従属配置）。
  const [savingNotify, setSavingNotify] = useState(false);
  const [notifySuccess, setNotifySuccess] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);

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

  // [2026-09-22追加・主要画面ワイヤーフレーム.md 63.1.1節] 押した瞬間に保存する。
  // 「お知らせする」への保存が成功したときだけ、ソフトアスクモーダルが
  // 自動的に表示される（PushSoftAskProviderがfamily.push_notifications_enabled
  // の変化を見て判定するため、ここで明示的に開く必要はない）。
  const setNotificationsEnabled = async (enabled: boolean) => {
    setSavingNotify(true);
    setNotifyError(null);
    const res = await setFamilyPushNotificationsEnabled(enabled);
    setSavingNotify(false);
    if (!res.ok) {
      setNotifyError("変更できませんでした。もう一度お試しください。");
      return;
    }
    setNotifySuccess(true);
    setTimeout(() => setNotifySuccess(false), 4000);
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

        {/* [2026-09-22追加・要件定義書07-37章3-1節、UIUXデザイン部/成果物/
            主要画面ワイヤーフレーム.md 63.1節] 通知トグル。やりとりトグルと
            同じCardの中に、区切り線＋1段インデントで従属配置する
            （決定1。新しいCardは作らない・横並びの独立トグルとして置かない）。
            やりとりトグルが「いまは使わない」のときはグレーアウト（非表示に
            しない。決定4）。保存済みの値は保持する。 */}
        <View style={styles.notifyDivider} />
        <View style={{ paddingLeft: theme.spacing.s4 }}>
          <Text style={[theme.typography.parentBody, !state.family.social_interactions_enabled && styles.disabledText]}>
            書き込みがあったら、お知らせする
          </Text>
          <Text
            style={[
              theme.typography.parentCaption,
              { color: theme.colors.neutralTextSecondary },
              !state.family.social_interactions_enabled && styles.disabledText,
            ]}
          >
            「いまは使わない」にすると、書き込み自体が止まるため、お知らせも届きません。
          </Text>
          <View style={[styles.chipRow, { marginTop: theme.spacing.s2, paddingLeft: theme.spacing.s4 }]}>
            <Pressable
              onPress={() => setNotificationsEnabled(true)}
              disabled={savingNotify || !state.family.social_interactions_enabled}
              style={[
                styles.chip,
                state.family.push_notifications_enabled && styles.chipSelected,
                !state.family.social_interactions_enabled && styles.chipDisabled,
              ]}
            >
              <Text>お知らせする</Text>
            </Pressable>
            <Pressable
              onPress={() => setNotificationsEnabled(false)}
              disabled={savingNotify || !state.family.social_interactions_enabled}
              style={[
                styles.chip,
                !state.family.push_notifications_enabled && styles.chipSelected,
                !state.family.social_interactions_enabled && styles.chipDisabled,
              ]}
            >
              <Text>いまはお知らせしない</Text>
            </Pressable>
          </View>
          {savingNotify && (
            <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
              保存中…
            </Text>
          )}
          {notifySuccess && (
            <Text style={{ color: theme.colors.brandPrimaryStrong, marginTop: theme.spacing.s1 }}>変更しました</Text>
          )}
          {notifyError && (
            <Text style={{ color: theme.colors.statusBlocking, marginTop: theme.spacing.s1 }}>{notifyError}</Text>
          )}
          {/* [主要画面ワイヤーフレーム.md 63.5.1節] 通知トグルが「お知らせする」で、
              かつこの端末の状態が「行動が必要」なときだけ、再挑戦の導線を出す。
              [2026-09-22本部長の画面確認で追加] やりとりトグルがオフのときも
              条件に入れる。オフの間は投稿自体が止まり通知は一切発生しないため、
              チップだけグレーアウトしてこの行が押せるままだと、押しても何も
              起きない導線が残ってしまう（決定4「やりとりがオフならグレー
              アウト」の趣旨と食い違う）。 */}
          <NotificationDeviceStatusRow
            visible={state.family.push_notifications_enabled && state.family.social_interactions_enabled}
            tone="parent"
          />
        </View>
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
  // [2026-09-22追加・主要画面ワイヤーフレーム.md 63.1.0節決定1] やりとりトグルの
  // チップ列と通知トグルの間に挟む区切り線（既存のsettingsDivider流用、
  // app/parent/family.tsxと同じ値）。
  notifyDivider: {
    marginTop: theme.spacing.s4,
    borderTopWidth: 1,
    borderTopColor: theme.colors.neutralBorder,
    paddingTop: theme.spacing.s4,
  },
  // [決定4] グレーアウト時の淡色表示。新しい色トークンは作らず、既存の
  // neutralTextSecondaryを流用する。
  disabledText: { color: theme.colors.neutralTextSecondary },
  chipDisabled: { opacity: 0.5 },
});
