import React, { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { playSound } from "@/lib/sound";

/**
 * C11 交換完了
 * 参照: 主要画面ワイヤーフレーム.md 5章
 *
 * [2026-09-14追加・やること.md 2-3「効果音」] ごほうび交換が完了したときに鳴らす
 * （統括決定）。マウント時に1回だけ（useRefで二重発火を防止）。
 */
export default function RewardCompleteScreen() {
  const { rewardName, rewardEmoji, remaining } = useLocalSearchParams<{
    rewardName?: string;
    rewardEmoji?: string;
    remaining?: string;
  }>();

  const hasPlayedSoundRef = useRef(false);
  useEffect(() => {
    if (hasPlayedSoundRef.current) return;
    hasPlayedSoundRef.current = true;
    playSound("reward");
  }, []);

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
