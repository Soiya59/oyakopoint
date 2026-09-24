import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { PG_ERRCODE } from "@/data/api";
import { cancelRedemptionErrorText, CANCEL_LABEL, CANCEL_PROCESSING_TEXT, CANCEL_SUCCESS_TEXT } from "@/lib/cancelChoreCompletion";
import { playSound } from "@/lib/sound";

/**
 * じぶんのごほうび：交換確認（保護者版）
 * 参照: app/child/reward-confirm.tsx（C10）と同じロジック・同じdispatch
 * （REDEEM_REWARDはmember_idベースで、子ども/保護者を区別しない設計）。
 *
 * [2026-09-25改訂・要件定義書07-39章「ごほうびの交換の直後の取消」、設計部/成果物/
 * スキーマ設計.sql 77.9章] 従来は交換成功時に一覧（P19相当）へ即座に`router.replace`
 * していたが、1分間の取消猶予を持たせるため、**この確認画面上で「交換しました」
 * という状態を表示し、そこに1分間「取消」リンクを出す**方式に変更した（77.9章が
 * 推奨する改修）。P19「じぶんのお手伝い」と同じスナックバー方式は使わなくなった
 * （主要画面ワイヤーフレーム.md 9.0決定1「淡々とした記録」トーン自体は維持）。
 * 確認は自分の交換であっても1回はさむ（07-39章決定）。
 */
type CancelState = "idle" | "confirming" | "processing" | "success" | "error" | "networkError";

export default function ParentMyRewardConfirmScreen() {
  const { rewardId } = useLocalSearchParams<{ rewardId: string }>();
  const { state, dispatch, memberPoints } = useAppData();
  const reward = state.rewards.find((r) => r.id === rewardId);
  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const balance = me ? memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0 : 0;
  const [insufficientError, setInsufficientError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // [2026-09-25追加] 交換成功後の状態。redeemedがnullの間は交換前の確認UIを出す。
  const [redeemed, setRedeemed] = useState<{ redemptionId: string; costPaid: number } | null>(null);
  const [cancelState, setCancelState] = useState<CancelState>("idle");
  const [cancelErrorText, setCancelErrorText] = useState<string | null>(null);
  const [withinWindow, setWithinWindow] = useState(true);
  useEffect(() => {
    if (!redeemed) return;
    const mountedAt = Date.now();
    setWithinWindow(true);
    const id = setInterval(() => {
      if (Date.now() - mountedAt > 60_000) {
        setWithinWindow(false);
        clearInterval(id);
      }
    }, 5_000);
    return () => clearInterval(id);
  }, [redeemed]);

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
    // [2026-09-16追加・やること.md 2-3「効果音」保護者・みまもりへの拡張]
    // `confirm()`は`result.ok`が真（＝交換成功）のときにしか到達しない
    // （失敗時は上のif文でreturn済み）ため、ここで鳴らせば「成功時に1回だけ」
    // を満たせる。子どものC11（app/child/reward-complete.tsx）と同じ音。
    playSound("reward");

    // [2026-09-25追加] result.redemptionIdが無い（＝古いキャッシュ等で取得できな
    // かった）場合は取消導線を出せないため、その場合でも交換自体は成功している
    // ことをそのまま示す（redemptionIdが無ければ下記の取消リンクは表示されない）。
    setRedeemed({ redemptionId: result.redemptionId ?? "", costPaid: reward.cost });
  };

  const handleCancel = async () => {
    if (!redeemed?.redemptionId) return;
    setCancelState("processing");
    setCancelErrorText(null);
    const result = await dispatch({ type: "CANCEL_REDEMPTION", redemptionId: redeemed.redemptionId });
    if (!result.ok) {
      const isKnownDbError =
        result.error.code === PG_ERRCODE.checkViolation ||
        result.error.code === PG_ERRCODE.noDataFound ||
        result.error.code === PG_ERRCODE.insufficientPrivilege;
      if (!isKnownDbError) {
        setCancelState("networkError");
        return;
      }
      setCancelState("error");
      setCancelErrorText(cancelRedemptionErrorText("parent", result.error));
      return;
    }
    setCancelState("success");
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

  if (redeemed) {
    const showCancelArea = redeemed.redemptionId && withinWindow && cancelState !== "success";
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentTitle}>
          {reward.emoji ?? "🎁"} {reward.name} と交換しました
        </Text>
        <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s2 }]}>
          -{redeemed.costPaid}pt（残高 {balance - redeemed.costPaid}pt）
        </Text>

        {showCancelArea && (
          <View style={{ marginTop: theme.spacing.s4 }}>
            {cancelState === "confirming" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.s3 }}>
                <Text style={theme.typography.parentBody}>この交換を取り消しますか？</Text>
                <Pressable onPress={() => setCancelState("idle")} hitSlop={8}>
                  <Text style={{ color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" }}>
                    やめる
                  </Text>
                </Pressable>
                <Pressable onPress={handleCancel} hitSlop={8}>
                  <Text style={{ color: theme.colors.statusBlocking, textDecorationLine: "underline" }}>
                    取り消す
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => setCancelState("confirming")}
                disabled={cancelState === "processing"}
                hitSlop={8}
              >
                <Text style={{ color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" }}>
                  {cancelState === "processing" ? CANCEL_PROCESSING_TEXT.parent : CANCEL_LABEL.parent}
                </Text>
              </Pressable>
            )}
            {cancelState === "error" && cancelErrorText && (
              <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.statusBlocking }}>
                {cancelErrorText}
              </Text>
            )}
            {cancelState === "networkError" && (
              <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.statusBlocking }}>
                とどきませんでした…
              </Text>
            )}
          </View>
        )}
        {cancelState === "success" && (
          <Text style={{ marginTop: theme.spacing.s4, color: theme.colors.neutralTextSecondary }}>
            {CANCEL_SUCCESS_TEXT.parent}
          </Text>
        )}

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
