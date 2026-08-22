import React, { useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { PG_ERRCODE } from "@/data/api";

/**
 * S11 交換確認（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S11
 *
 * app/parent/my-reward-confirm.tsxと同じロジック・同じdispatch（REDEEM_REWARDは
 * member_idベースで役割を区別しない設計。RLS reward_redemptions_insert_scoped
 * （スキーマ設計.sql 23章）が対象rewardが自分専用の場合は作成者本人のみを許可する）。
 */
export default function SupporterRewardConfirmScreen() {
  const { rewardId } = useLocalSearchParams<{ rewardId: string }>();
  const { state, dispatch, memberPoints } = useAppData();
  const reward = state.rewards.find((r) => r.id === rewardId);
  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const balance = me ? memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0 : 0;
  const [insufficientError, setInsufficientError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!reward || !me) {
    return (
      <Screen tone="supporter">
        <Text style={theme.typography.supporterBody}>ごほうびが見つかりませんでした</Text>
        <AppButton tone="supporter" label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s4 }} onPress={() => router.back()} />
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
      pathname: "/supporter/reward-redeem",
      params: { justRewardId: reward.id, justName: reward.name, justCost: String(reward.cost) },
    });
  };

  if (insufficientError) {
    return (
      <Screen tone="supporter">
        <Text style={theme.typography.supporterTitle}>ポイントが足りません</Text>
        <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s2 }]}>（いま {balance}pt）</Text>
        <AppButton
          tone="supporter"
          label="じぶんのごほうびへもどる"
          style={{ marginTop: theme.spacing.s6 }}
          onPress={() => router.replace("/supporter/reward-redeem")}
        />
      </Screen>
    );
  }

  return (
    <Screen tone="supporter">
      <Text style={theme.typography.supporterTitle}>
        {reward.emoji ?? "🎁"} {reward.name} と交換しますか？
      </Text>

      <View style={{ marginTop: theme.spacing.s6, gap: theme.spacing.s2 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={theme.typography.supporterBody}>必要</Text>
          <Text style={theme.typography.supporterBody}>{reward.cost}pt</Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={theme.typography.supporterBody}>いまの残高</Text>
          <Text style={theme.typography.supporterBody}>{balance}pt</Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={theme.typography.supporterBody}>交換後</Text>
          <Text style={theme.typography.supporterBody}>{balance - reward.cost}pt</Text>
        </View>
      </View>

      <AppButton
        tone="supporter"
        label={submitting ? "交換しています…" : "交換する"}
        loading={submitting}
        disabled={submitting}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={confirm}
      />
      <AppButton tone="supporter" label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.back()} />
    </Screen>
  );
}
