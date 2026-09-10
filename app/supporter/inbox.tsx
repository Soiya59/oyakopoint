import React from "react";
import { Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import InboxPanel from "@/components/InboxPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useMarkSeen } from "@/hooks/useLastSeen";

/**
 * S22 とどいたもの（みまもりメンバー）
 * P34と同一構成。みまもりメンバーも自分専用クエストの完了報告にリアクションを
 * 受け取り、感謝ポイントの受取対象にもなる（本番でも受領実績あり）。
 */
export default function SupporterInboxScreen() {
  const { state } = useAppData();
  // [2026-09-11追加・実装メモ.md 190章] この画面を開いたことを記録し、
  // ベル／新着件数を未読方式で数えられるようにする。**入口がどこであったかは問わない**
  // （統括の指摘。「新着◯件」カードからでも「最近の報告」の行からでも同じ画面に来る）。
  useMarkSeen("inbox", state.activeParentMemberId);


  return (
    <Screen tone="supporter">
      <ScreenBackLink tone="supporter" onPress={() => router.replace("/supporter/family")} />

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
        onPress={() => router.replace("/supporter/family")}
      />
    </Screen>
  );
}
