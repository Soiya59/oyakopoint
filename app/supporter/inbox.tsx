import React from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import InboxPanel from "@/components/InboxPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * S22 とどいたもの（みまもりメンバー）
 * P34と同一構成。みまもりメンバーも自分専用クエストの完了報告にリアクションを
 * 受け取り、感謝ポイントの受取対象にもなる（本番でも受領実績あり）。
 */
export default function SupporterInboxScreen() {
  const { state } = useAppData();

  return (
    <Screen tone="supporter">
      <ScreenBackLink tone="supporter" onPress={() => router.replace("/supporter/home")} />

      <Text style={theme.typography.supporterTitle}>🔔 とどいたもの</Text>
      <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
        家族から届いたスタンプ・コメント・感謝ポイント
      </Text>

      <InboxPanel tone="supporter" memberId={state.activeParentMemberId} />

      <AppButton
        tone="supporter"
        label="ホームへ戻る"
        variant="ghost"
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => router.replace("/supporter/home")}
      />
    </Screen>
  );
}
