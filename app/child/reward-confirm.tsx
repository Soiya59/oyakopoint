import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { PG_ERRCODE } from "@/data/api";

/**
 * C10 交換確認（主要5画面のひとつ、C9〜C11の一連）
 * 参照: 主要画面ワイヤーフレーム.md 5章
 * 交換エラー：残高不足（他の交換との競合で確定直前に残高が減っていた場合）にも対応。
 */
export default function RewardConfirmScreen() {
  const { rewardId } = useLocalSearchParams<{ rewardId: string }>();
  const { state, dispatch, memberPoints } = useAppData();
  const reward = state.rewards.find((r) => r.id === rewardId);
  const me = state.members.find((m) => m.id === state.activeChildMemberId)!;
  const balance = memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0;
  const [insufficientError, setInsufficientError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!reward) {
    return (
      <Screen tone="child">
        <Text style={theme.typography.childBody}>ごほうびが見つかりませんでした</Text>
        <AppButton label="やることリストへもどる" tone="child" onPress={() => router.replace("/child/home")} />
      </Screen>
    );
  }

  const confirm = async () => {
    // API仕様.md 7章「交換申請」相当。
    // supabase.from('reward_redemptions').insert({ reward_id, member_id })
    // 最終判定はDBトリガー（reward_redemptions_before_insert）が行うため、
    // ここでのbalanceチェックはUXのための事前判定に過ぎない（クライアントの
    // memberPointsが最新でない可能性があるため、check_violationが返った場合も
    // 同じ残高不足エラーとして扱う）。
    if (balance < reward.cost) {
      setInsufficientError(true);
      return;
    }
    setSubmitting(true);
    const result = await dispatch({ type: "REDEEM_REWARD", rewardId: reward.id, memberId: me.id });
    setSubmitting(false);
    if (!result.ok) {
      if (result.error.code === PG_ERRCODE.checkViolation) {
        setInsufficientError(true);
      }
      return;
    }
    router.replace({
      pathname: "/child/reward-complete",
      params: { rewardName: reward.name, rewardEmoji: reward.emoji, remaining: String(balance - reward.cost) },
    });
  };

  if (insufficientError) {
    return (
      <Screen tone="child">
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.childBody}>← もどる</Text>
        </Pressable>
        <View style={styles.centerBlock}>
          <Text style={{ fontSize: 40 }}>😲💭</Text>
          <Text style={[theme.typography.childHeadline, { textAlign: "center", marginTop: theme.spacing.s4 }]}>
            あれ、ちょっとポイントが{"\n"}たりなかったみたい
          </Text>
          <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s2 }]}>（いま {balance}pt）</Text>
          <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
            もう少しがんばって ためよう！
          </Text>
        </View>
        <AppButton label="やることリストへもどる" tone="child" fullWidth onPress={() => router.replace("/child/home")} />
      </Screen>
    );
  }

  return (
    <Screen tone="child">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.childBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.childHeadline, { textAlign: "center", marginTop: theme.spacing.s6 }]}>
        {reward.emoji} {reward.name} を こうかんする？
      </Text>

      <View style={styles.summaryBox}>
        <View style={styles.summaryRow}>
          <Text style={theme.typography.childBody}>ひつよう</Text>
          <Text style={theme.typography.childBody}>{reward.cost}pt</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={theme.typography.childBody}>いまの残高</Text>
          <Text style={theme.typography.childBody}>{balance}pt</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={theme.typography.childBody}>こうかんあと</Text>
          <Text style={theme.typography.childBody}>{balance - reward.cost}pt</Text>
        </View>
      </View>

      <AppButton
        label={submitting ? "こうかんしています…" : "こうかんする！"}
        tone="child"
        fullWidth
        loading={submitting}
        disabled={submitting}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={confirm}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerBlock: { alignItems: "center", marginTop: theme.spacing.s8 },
  summaryBox: {
    marginTop: theme.spacing.s6,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    padding: theme.spacing.s4,
    gap: theme.spacing.s2,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
});
