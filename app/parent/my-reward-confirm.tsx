import React, { useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { PG_ERRCODE } from "@/data/api";

/**
 * じぶんのごほうび：交換確認（保護者版）
 * 参照: app/child/reward-confirm.tsx（C10）と同じロジック・同じdispatch
 * （REDEEM_REWARDはmember_idベースで、子ども/保護者を区別しない設計）。
 * 交換後は子ども版のような専用完了画面を挟まず、P19「じぶんのお手伝い」と同じ
 * スナックバー方式でじぶんのごほうび一覧へ戻る（主要画面ワイヤーフレーム.md
 * 9.0決定1「淡々とした記録」トーン）。
 */
export default function ParentMyRewardConfirmScreen() {
  const { rewardId } = useLocalSearchParams<{ rewardId: string }>();
  const { state, dispatch, memberPoints } = useAppData();
  const reward = state.rewards.find((r) => r.id === rewardId);
  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const balance = me ? memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0 : 0;
  const [insufficientError, setInsufficientError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!reward || !me) {
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentBody}>ごほうびが見つかりませんでした</Text>
        <AppButton label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s4 }} onPress={() => router.back()} />
      </Screen>
    );
  }

  const confirm = async () => {
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
      pathname: "/parent/my-rewards",
      params: { justRewardId: reward.id, justName: reward.name, justCost: String(reward.cost) },
    });
  };

  if (insufficientError) {
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentTitle}>ポイントが足りません</Text>
        <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s2 }]}>（いま {balance}pt）</Text>
        <AppButton
          label="じぶんのごほうびへもどる"
          style={{ marginTop: theme.spacing.s6 }}
          onPress={() => router.replace("/parent/my-rewards")}
        />
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>
        {reward.emoji ?? "🎁"} {reward.name} と交換しますか？
      </Text>

      <View style={{ marginTop: theme.spacing.s6, gap: theme.spacing.s2 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={theme.typography.parentBody}>必要</Text>
          <Text style={theme.typography.parentBody}>{reward.cost}pt</Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={theme.typography.parentBody}>いまの残高</Text>
          <Text style={theme.typography.parentBody}>{balance}pt</Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={theme.typography.parentBody}>交換後</Text>
          <Text style={theme.typography.parentBody}>{balance - reward.cost}pt</Text>
        </View>
      </View>

      <AppButton
        label={submitting ? "交換しています…" : "交換する"}
        loading={submitting}
        disabled={submitting}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={confirm}
      />
      <AppButton label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.back()} />
    </Screen>
  );
}
