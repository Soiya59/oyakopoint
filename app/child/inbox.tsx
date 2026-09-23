import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import Card from "@/components/Card";
import InboxPanel from "@/components/InboxPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { setMemberScheduledAnnouncementReceiveEnabled } from "@/data/api";
import { SCHEDULED_ANNOUNCEMENT_FEATURE_NAME } from "@/constants/scheduledAnnouncement";
import { useMarkSeen } from "@/hooks/useLastSeen";

/**
 * C29 とどいたよ（子ども）
 * ロジックは3ロール共通の InboxPanel に集約し、本画面はトーンと遷移先だけを渡す殻にする
 * （お絵かき21.5節決定4・コレクション等と同じ構成）。
 *
 * [2026-09-23追加・要件定義書07-37章4-8節、UIUXデザイン部/成果物/主要画面
 * ワイヤーフレーム.md 64.7.3節] 子ども向けの個人受信設定は専用画面が無いため
 * （C29・C34・C40等いずれも子どもは「やる/きろく/つうちょう/ごほうび」の
 * 4タブのみで構成される）、既存のC29の末尾に1行のリンクを追加し、タップで
 * 軽量モーダルを開く（InboxPanel自体は変更しない）。
 */
export default function ChildInboxScreen() {
  const { state, refresh } = useAppData();
  const { client } = useSession();
  // [2026-09-11追加・実装メモ.md 190章] この画面を開いたことを記録し、
  // ベル／新着件数を未読方式で数えられるようにする。**入口がどこであったかは問わない**
  // （統括の指摘。「新着◯件」カードからでも「最近の報告」の行からでも同じ画面に来る）。
  useMarkSeen("inbox", state.activeChildMemberId);

  const hasActiveScheduledAnnouncement = state.scheduledAnnouncements.some((a) => a.enabled && !!a.message);
  const myMember = state.members.find((m) => m.id === state.activeChildMemberId);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const setMyReceive = async (enabled: boolean) => {
    setSaving(true);
    const res = await setMemberScheduledAnnouncementReceiveEnabled(client, state.activeChildMemberId, enabled);
    setSaving(false);
    if (res.ok) await refresh();
  };

  return (
    <Screen tone="child">
      <Pressable onPress={() => router.replace("/child/home")} hitSlop={8} style={styles.back}>
        <Text style={theme.typography.childBody}>← もどる</Text>
      </Pressable>

      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s2 }]}>🔔 とどいたよ</Text>
      <Text style={[theme.typography.childBody, styles.sub]}>
        かぞくから もらった スタンプ・コメント・ありがとうポイント
      </Text>

      <InboxPanel tone="child" memberId={state.activeChildMemberId} />

      {hasActiveScheduledAnnouncement && (
        <Pressable onPress={() => setModalVisible(true)} style={{ marginTop: theme.spacing.s4 }}>
          <Text style={[theme.typography.childBody, { textDecorationLine: "underline" }]}>
            {SCHEDULED_ANNOUNCEMENT_FEATURE_NAME}について
          </Text>
        </Pressable>
      )}

      <AppButton
        label="もどる"
        tone="child"
        variant="secondary"
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => router.replace("/child/home")}
      />

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.backdrop}>
          <Card tone="child" style={styles.card}>
            <Text style={styles.emoji}>{"\u{1F514}"}</Text>
            <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s2 }]}>
              {SCHEDULED_ANNOUNCEMENT_FEATURE_NAME}について
            </Text>
            <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
              かぞくから{SCHEDULED_ANNOUNCEMENT_FEATURE_NAME}が とどくことが あります。うけとりたくないときは、とめることが できます。
            </Text>
            <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s4 }}>
              <AppButton
                tone="child"
                label="うけとる"
                variant={myMember?.scheduled_announcement_notifications_enabled ? "primary" : "secondary"}
                onPress={() => void setMyReceive(true)}
                disabled={saving}
              />
              <AppButton
                tone="child"
                label="いまは うけとらない"
                variant={myMember && !myMember.scheduled_announcement_notifications_enabled ? "primary" : "secondary"}
                onPress={() => void setMyReceive(false)}
                disabled={saving}
              />
            </View>
            <AppButton
              tone="child"
              label="とじる"
              variant="ghost"
              style={{ marginTop: theme.spacing.s4 }}
              onPress={() => setModalVisible(false)}
            />
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { minHeight: theme.tapTarget.child, justifyContent: "center", alignSelf: "flex-start" },
  sub: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  card: { width: "100%", maxWidth: 480, alignItems: "center" },
  emoji: { fontSize: 40 },
});
