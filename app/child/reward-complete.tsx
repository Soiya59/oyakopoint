import React from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";

/**
 * C11 交換完了
 * 参照: 主要画面ワイヤーフレーム.md 5章
 */
export default function RewardCompleteScreen() {
  const { rewardName, rewardEmoji, remaining } = useLocalSearchParams<{
    rewardName?: string;
    rewardEmoji?: string;
    remaining?: string;
  }>();

  return (
    <Screen tone="child">
      <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
        <Text style={{ fontSize: 48 }}>
          🎉{rewardEmoji}🎉
        </Text>
        <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s4 }]}>やったね！</Text>
        <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s2, textAlign: "center" }]}>
          「{rewardName}」とこうかんしたよ
        </Text>
        <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s4 }]}>のこり {remaining}pt</Text>
      </View>
      <AppButton
        label="つうちょうへ"
        tone="child"
        fullWidth
        style={{ marginTop: theme.spacing.s8 }}
        onPress={() => router.replace("/child/points")}
      />
    </Screen>
  );
}
