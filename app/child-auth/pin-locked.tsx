import React from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";

/**
 * C4 PINロック中（5回連続失敗時の待機案内）
 * 参照: 認証・データ管理設計書.md 3.2章（5回連続失敗でlocked_until = now() + 15分）
 */
export default function PinLockedScreen() {
  return (
    <Screen tone="child">
      <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
        <Text style={{ fontSize: 56 }}>😴</Text>
        <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s4, textAlign: "center" }]}>
          すこしおやすみしてから、{"\n"}もういちど
        </Text>
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.neutralTextSecondary, textAlign: "center" }}>
          15ふんくらい まってね。{"\n"}わからなくなったら おうちのひとに きいてね。
        </Text>
      </View>
      <AppButton
        label="もどる"
        tone="child"
        fullWidth
        style={{ marginTop: theme.spacing.s8 }}
        onPress={() => router.back()}
      />
    </Screen>
  );
}
