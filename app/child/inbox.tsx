import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import InboxPanel from "@/components/InboxPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * C29 とどいたよ（子ども）
 * ロジックは3ロール共通の InboxPanel に集約し、本画面はトーンと遷移先だけを渡す殻にする
 * （お絵かき21.5節決定4・コレクション等と同じ構成）。
 */
export default function ChildInboxScreen() {
  const { state } = useAppData();

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

      <AppButton
        label="やることリストへもどる"
        tone="child"
        variant="secondary"
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => router.replace("/child/home")}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { minHeight: theme.tapTarget.child, justifyContent: "center", alignSelf: "flex-start" },
  sub: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
});
