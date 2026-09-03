import React, { useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { PG_ERRCODE } from "@/data/api";

/**
 * P36 保護者代理の交換確認（保護者、2026-09-03新設）
 * 参照: 画面一覧・遷移図.md P36、主要画面ワイヤーフレーム.md 5.5.3節
 *
 * app/parent/my-reward-confirm.tsx（P15「じぶんのごほうび」の確認画面）を土台にした
 * 保護者代理版。dispatch("REDEEM_REWARD")はmemberIdベースで完全に汎用のため、
 * 渡すmemberIdを操作している保護者自身ではなく選択した子どものIDにするだけで成立する
 * （5.5.0節決定4・5.5.3節）。子ども向けC10の演出は使わない。
 *
 * 交換成功後はP12（app/parent/rewards.tsx）へrouter.replaceし、同画面のスナックバーで
 * 「◯◯さんの代わりに交換しました -◯◯pt」を表示する（5.5.0節決定5、5.5.4節）。
 * 完了演出画面（C11相当）は新設しない。
 */
export default function RedeemForChildConfirmScreen() {
  const { rewardId, memberId } = useLocalSearchParams<{ rewardId: string; memberId: string }>();
  const { state, dispatch, memberPoints } = useAppData();
  const reward = state.rewards.find((r) => r.id === rewardId);
  const child = state.members.find((m) => m.id === memberId && m.role === "child" && m.is_active);
  const balance = child ? memberPoints.find((m) => m.member_id === child.id)?.current_points ?? 0 : 0;
  const [insufficientError, setInsufficientError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 5.5.3節「対象データが見つからない（edge case）」: reward／対象の子のいずれかが
  // 解決できない（my-reward-confirm.tsxの既存パターンを踏襲）。
  if (!reward || !child) {
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentBody}>見つかりませんでした</Text>
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
    // dispatch内部でapi.redeemReward({ reward_id, member_id })を呼び、成功後にload()で
    // reward_redemptions・member_pointsを再取得する（src/data/store.tsx REDEEM_REWARD）。
    const result = await dispatch({ type: "REDEEM_REWARD", rewardId: reward.id, memberId: child.id });
    setSubmitting(false);
    if (!result.ok) {
      // 可読名の文字列比較はしない。PG_ERRCODEの定数と比較する（実装メモ.md 117章の教訓）。
      if (result.error.code === PG_ERRCODE.checkViolation) {
        setInsufficientError(true);
      }
      return;
    }
    router.replace({
      pathname: "/parent/rewards",
      params: {
        justRewardId: reward.id,
        justChildName: child.display_name,
        justCost: String(reward.cost),
      },
    });
  };

  if (insufficientError) {
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentTitle}>{child.display_name}さんのポイントが足りません</Text>
        <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s2 }]}>（いま {balance}pt）</Text>
        <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s4 }]}>
          もう少したまってから、また代わりに交換してあげてください
        </Text>
        <AppButton
          label="ごほうび管理へもどる"
          style={{ marginTop: theme.spacing.s6 }}
          onPress={() => router.replace("/parent/rewards")}
        />
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>
        {reward.emoji ?? "🎁"} {reward.name} と交換しますか？
      </Text>
      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        {child.display_name}さんの代わりに交換します
      </Text>

      <View style={{ marginTop: theme.spacing.s6, gap: theme.spacing.s2 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={theme.typography.parentBody}>必要</Text>
          <Text style={theme.typography.parentBody}>{reward.cost}pt</Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={theme.typography.parentBody}>{child.display_name}さんの残高</Text>
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
