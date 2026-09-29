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
import { updateFamilyName, setMemberScheduledAnnouncementReceiveEnabled } from "@/data/api";
import { NotificationDeviceStatusRow } from "@/components/NotificationSoftAsk";
import { useFailureNotice } from "@/hooks/useFailureNotice";
import FailureRefText from "@/components/FailureRefText";
import { NOTIFY_SWITCH_DESCRIPTION, NOTIFY_SWITCH_HEADING } from "@/lib/requestChoreText";

// [2026-09-29追加・実装メモ331章] 設定の変更に失敗したときの一文（従来のまま）。電波・混み合い等のときだけ別の文言に入れ替わる。
const SETTING_CHANGE_FAILED_MESSAGE = "変更できませんでした。もう一度お試しください。";
import { SCHEDULED_ANNOUNCEMENT_FEATURE_NAME } from "@/constants/scheduledAnnouncement";

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
  const { client, parentMember } = useSession();

  // [2026-09-23追加・要件定義書07-37章4-8節、UIUXデザイン部/成果物/
  // 主要画面ワイヤーフレーム.md 64.7.1節] 保護者自身の「メッセージ」
  // 受信オンオフ。
  const me = state.members.find((m) => m.id === parentMember?.id);
  const [savingReceive, setSavingReceive] = useState(false);
  const { errorMessage: receiveError, errorRef: receiveErrorRef, setErrorMessage: setReceiveError, showFailure: showReceiveFailure } =
    useFailureNotice("parent");
  const setMyScheduledAnnouncementReceive = async (enabled: boolean) => {
    if (!parentMember) return;
    setSavingReceive(true);
    setReceiveError(null);
    const res = await setMemberScheduledAnnouncementReceiveEnabled(client, parentMember.id, enabled);
    setSavingReceive(false);
    if (!res.ok) {
      showReceiveFailure(res.error, { fallback: SETTING_CHANGE_FAILED_MESSAGE, useDbMessage: false });
      return;
    }
    await refresh();
  };

  // [2026-09-23追加・要件定義書07-37章4章] 「メッセージ」2枠のうち、実際に
  // 「そうしんする」状態のものが1つでもあるか（64.7節の表示条件）。
  const hasActiveScheduledAnnouncement = state.scheduledAnnouncements.some((a) => a.enabled && !!a.message);

  const [familyName, setFamilyName] = useState(state.family.name);
  const [savingFamilyName, setSavingFamilyName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const { errorMessage: nameError, errorRef: nameErrorRef, setErrorMessage: setNameError, showFailure: showNameFailure } =
    useFailureNotice("parent");

  const [savingSocial, setSavingSocial] = useState(false);
  const [socialSuccess, setSocialSuccess] = useState(false);
  const { errorMessage: socialError, errorRef: socialErrorRef, setErrorMessage: setSocialError, showFailure: showSocialFailure } =
    useFailureNotice("parent");

  // [2026-09-22追加・要件定義書07-37章3-1節、UIUXデザイン部/成果物/
  // 主要画面ワイヤーフレーム.md 63.1節] 通知トグル。[2026-09-30変更・70.5節D11] やりとりトグルの
  // 従属配置をやめ、独立したCard「お知らせの通知（家族みんな共通）」にした。
  const [savingNotify, setSavingNotify] = useState(false);
  const [notifySuccess, setNotifySuccess] = useState(false);
  const { errorMessage: notifyError, errorRef: notifyErrorRef, setErrorMessage: setNotifyError, showFailure: showNotifyFailure } =
    useFailureNotice("parent");

  const saveFamilyName = async () => {
    const trimmed = familyName.trim();
    if (!trimmed || trimmed === state.family.name) return;
    setSavingFamilyName(true);
    setNameError(null);
    setNameSaved(false);
    const res = await updateFamilyName(client, state.family.id, trimmed);
    setSavingFamilyName(false);
    if (!res.ok) {
      showNameFailure(res.error);
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
      showSocialFailure(res.error, { fallback: SETTING_CHANGE_FAILED_MESSAGE, useDbMessage: false });
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
      showNotifyFailure(res.error, { fallback: SETTING_CHANGE_FAILED_MESSAGE, useDbMessage: false });
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
      <FailureRefText value={nameErrorRef} tone="parent" />
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

      {/* [2026-09-23追加・要件定義書07-37章4章、UIUXデザイン部/成果物/
          主要画面ワイヤーフレーム.md 64.1.1節] 「メッセージ」の入口Card。
          やりとりトグルとは独立した新しいCard（64.1.0節決定1。掲示板の
          通知トグルとは異なり、「やりとり」機能の可否とは無関係のため）。
          置き場所は64.1章のとおりP40。名前は1か所の定数から参照する
          （SCHEDULED_ANNOUNCEMENT_FEATURE_NAME、実装メモ292.1章）。 */}
      {/* [2026-09-25・統括「メッセージをうえがわにしてほしい。こっちのほうが使うとおもうから」] 文字の書き込みのCardより上に移した（実装メモ300章）。 */}
      <Card style={{ marginTop: theme.spacing.s6 }}>
        <Text style={theme.typography.parentBodyMedium}>{SCHEDULED_ANNOUNCEMENT_FEATURE_NAME}</Text>
        <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
          家族の毎日に、決まった時間の一言を届けます。書いた本人にも届きます。
        </Text>
        {[1, 2].map((slot) => {
          const item = state.scheduledAnnouncements.find((a) => a.slot === slot);
          const label = slot === 1 ? "1つ目" : "2つ目";
          return (
            <Text key={slot} style={[theme.typography.parentBody, { marginTop: theme.spacing.s2 }]}>
              {label}：
              {item?.message
                ? `${item.send_time.slice(0, 5)}「${item.message.slice(0, 12)}${item.message.length > 12 ? "…" : ""}」`
                : "まだ設定されていません"}
            </Text>
          );
        })}
        <AppButton
          label={state.scheduledAnnouncements.length > 0 ? "編集する" : "設定する"}
          variant="secondary"
          style={{ marginTop: theme.spacing.s3, alignSelf: "flex-end" }}
          onPress={() => router.push("/parent/scheduled-announcements")}
        />

        {/* [ワイヤーフレーム64.7.1節] 保護者自身の受信オンオフ。1つ以上の
            枠が「送信する」状態のときだけ表示する（64.7節）。 */}
        {hasActiveScheduledAnnouncement && (
          <View style={styles.notifyDivider}>
            {/* [2026-09-25改称・統括「メッセージの通知とかどうかな」・実装メモ300章]
                設定は人ごと（family_members列）なので「あなたの端末にだけ」は
                不正確だった（同じ人の端末が2台なら2台とも止まる）。 */}
            <Text style={theme.typography.parentBody}>メッセージの通知（あなただけ）</Text>
            <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
              「通知しない」にしても、ほかの家族には届きます。
            </Text>
            <View style={[styles.chipRow, { marginTop: theme.spacing.s2 }]}>
              <Pressable
                onPress={() => void setMyScheduledAnnouncementReceive(true)}
                disabled={savingReceive || !me}
                style={[styles.chip, me?.scheduled_announcement_notifications_enabled && styles.chipSelected]}
              >
                <Text>通知する</Text>
              </Pressable>
              <Pressable
                onPress={() => void setMyScheduledAnnouncementReceive(false)}
                disabled={savingReceive || !me}
                style={[styles.chip, me && !me.scheduled_announcement_notifications_enabled && styles.chipSelected]}
              >
                <Text>通知しない</Text>
              </Pressable>
            </View>
            {receiveError && (
              <Text style={{ color: theme.colors.statusBlocking, marginTop: theme.spacing.s1 }}>{receiveError}</Text>
            )}
            <FailureRefText value={receiveErrorRef} tone="parent" />
          </View>
        )}
      </Card>

      {/* [2026-09-30変更・統括の回答（Q2）案A・主要画面ワイヤーフレーム.md 70.5節D11、実装メモ.md 335章]
          通知スイッチを、「文字の書き込み」Cardの中の従属配置（区切り線の下）から切り離し、
          「メッセージ」Cardと「文字の書き込み」Cardの間の**独立したCard**にした。名前は
          「書き込みの通知」から「お知らせの通知（家族みんな共通）」に広げた（おねがい・ありがとうの
          ポイントの通知もこのスイッチに乗るため）。**やりとりスイッチが「止める」でも、このCardは
          常に出す**（2026-09-25の「やりとりを止めるときは通知スイッチを隠す」〈実装メモ299章〉は、
          このスイッチに限って戻した。おねがい・ありがとうの通知は、やりとりを止めていても起きる出来事
          のため、見えない設定が動く状態を作らない）。DBは変わらない（もともと別の列・別のRPCで、
          互いに連動しない）。既定は今までどおり「通知しない」（OSの許可は一度断られると聞き直せない
          ため。家族が自分でオンにしない限り、おねがいのプッシュは鳴らない）。保存中・保存成功
          「変更しました」・保存失敗・端末の状態行・ソフトアスクの出方は今までと同じ。 */}
      <Card style={{ marginTop: theme.spacing.s4 }}>
        <Text style={theme.typography.parentBodyMedium}>{NOTIFY_SWITCH_HEADING}</Text>
        <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
          {NOTIFY_SWITCH_DESCRIPTION}
        </Text>
        <View style={[styles.chipRow, { marginTop: theme.spacing.s2 }]}>
          <Pressable
            onPress={() => setNotificationsEnabled(true)}
            disabled={savingNotify}
            style={[styles.chip, state.family.push_notifications_enabled && styles.chipSelected]}
          >
            <Text>通知する</Text>
          </Pressable>
          <Pressable
            onPress={() => setNotificationsEnabled(false)}
            disabled={savingNotify}
            style={[styles.chip, !state.family.push_notifications_enabled && styles.chipSelected]}
          >
            <Text>通知しない</Text>
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
        <FailureRefText value={notifyErrorRef} tone="parent" />
        {/* [主要画面ワイヤーフレーム.md 63.5.1節・70.5節D11] 通知スイッチが「通知する」（または
            「メッセージ」が有効）で、かつこの端末の状態が「行動が必要」なときだけ、再挑戦の導線を出す。
            やりとりスイッチの値は条件に入れない（切り離したため）。 */}
        <NotificationDeviceStatusRow
          visible={state.family.push_notifications_enabled || hasActiveScheduledAnnouncement}
          tone="parent"
        />
      </Card>

      <Card style={{ marginTop: theme.spacing.s4 }}>
        {/* [2026-09-25短縮・統括「記載が長く見にくい」・実装メモ299章] 子どもの
            画面での呼び名（かぞくのけいじばん／＋ひとこと）の説明は取扱説明書に
            移し、ここでは何が止まり何が残るかだけを1行で書く。 */}
        {/* [2026-09-25再改訂・統括「家族のやりとりという記載がいまいち違和感」
            「通常は設定せずに使う」・実装メモ300章] 見出しを止まるもの（文字）に
            合わせ、ふだんは触らない設定であることと、家族みんな共通であることを
            見出しと説明で示す。 */}
        <Text style={theme.typography.parentBodyMedium}>文字の書き込み（家族みんな共通）</Text>
        <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s2 }]}>
          掲示板・コメント・ありがとうのメッセージ
        </Text>
        <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
          ふだんはこのままお使いください。お子さんに文字でのやりとりをさせたくないときだけ止めます。スタンプとありがとうのポイントは止まりません。書いたものは消えません。
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
            <Text>止める</Text>
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
        <FailureRefText value={socialErrorRef} tone="parent" />
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
  // [2026-09-22追加・主要画面ワイヤーフレーム.md 63.1.0節決定1] やりとりトグルの
  // チップ列と通知トグルの間に挟む区切り線（既存のsettingsDivider流用、
  // app/parent/family.tsxと同じ値）。
  notifyDivider: {
    marginTop: theme.spacing.s4,
    borderTopWidth: 1,
    borderTopColor: theme.colors.neutralBorder,
    paddingTop: theme.spacing.s4,
  },
});
