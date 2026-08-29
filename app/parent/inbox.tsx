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
 * P34 とどいたもの（保護者）
 *
 * [2026-08-29新設] ユーザーの「保護者や見守りも同じようにしてほしい」への対応。
 * 07-6章の双方向リアクション（子→親）と07-5章の感謝ポイントにより、保護者も
 * 受け取る側になる。本番でも保護者「せいや」がリアクション6件・感謝4件を
 * 受け取っていたが、それをまとめて見る場所が無かった。
 */
export default function ParentInboxScreen() {
  const { state } = useAppData();

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/home")} />

      <Text style={theme.typography.parentTitle}>💌 とどいたもの</Text>
      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
        家族から届いたスタンプ・コメント・感謝ポイント
      </Text>

      <InboxPanel tone="parent" memberId={state.activeParentMemberId} />

      <AppButton
        label="ホームへ戻る"
        variant="ghost"
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => router.replace("/parent/home")}
      />
    </Screen>
  );
}
