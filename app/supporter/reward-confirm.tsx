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
 * S11 交換確認（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S11
 *
 * app/parent/my-reward-confirm.tsxと同じロジック・同じdispatch（REDEEM_REWARDは
 * member_idベースで役割を区別しない設計。RLS reward_redemptions_insert_scoped
 * （スキーマ設計.sql 23章・45.9章）が対象rewardが自分専用（personal）の場合は
 * 作成者本人のみ、みまもり共通（supporter_shared）の場合は作成者を問わず
 * role='supporter'本人のみを許可する）。
 *
 * [2026-09-06追加・要件定義書07-18章決定6'-2・UIUXデザイン部30.8節決定21] 変更なし。
 * このコンポーネントは`rewardId`のみを見て残高判定・確定処理を行い、`created_by`を
 * 一切参照しないため、決定6'-2の受け入れ判定はDB側（reward_redemptions_before_insert、
 * 45.9章）が担保する。
 *
 * [2026-09-08改訂・UIUXデザイン部33.2節決定6] S10「ごほうびと交換」（旧ルート、
 * 削除済み）廃止に伴い、成功後の戻り先・残高不足時の「ごほうびへもどる」ボタンの
 * 戻り先を、両方とも旧S10のルートから`/supporter/rewards`（S8）へ変更した。
 * ロジック自体（`rewardId`のみで判定）は変更なし。
 *
 * [2026-09-25改訂・要件定義書07-39章「ごほうびの交換の直後の取消」、設計部/成果物/
 * スキーマ設計.sql 77.9章] app/parent/my-reward-confirm.tsxと同じ改修（成功時に
 * 一覧へ即遷移するのをやめ、この画面上で1分間「取消」リンクを出す）。取消権限は
 * みまもり共通・自分専用いずれも本人のみ（77.3章）で、保護者は取り消せない。
 */
type CancelState = "idle" | "confirming" | "processing" | "success" | "error" | "networkError";

export default function SupporterRewardConfirmScreen() {
  const { rewardId } = useLocalSearchParams<{ rewardId: string }>();
  const { state, dispatch, memberPoints } = useAppData();
  const reward = state.rewards.find((r) => r.id === rewardId);
  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const balance = me ? memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0 : 0;
  const [insufficientError, setInsufficientError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
    // [2026-09-16追加・やること.md 2-3「効果音」保護者・みまもりへの拡張]
    // app/parent/my-reward-confirm.tsxと同じ理由（成功時にしか到達しない
    // `confirm()`内で鳴らす）。
    playSound("reward");

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
      setCancelErrorText(cancelRedemptionErrorText("supporter", result.error));
      return;
    }
    setCancelState("success");
  };

  if (insufficientError) {
    return (
      <Screen tone="supporter">
        <Text style={theme.typography.supporterTitle}>ポイントが足りません</Text>
        <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s2 }]}>（いま {balance}pt）</Text>
        <AppButton
          tone="supporter"
          label="ごほうびへもどる"
          style={{ marginTop: theme.spacing.s6 }}
          onPress={() => router.replace("/supporter/rewards")}
        />
      </Screen>
    );
  }

  if (redeemed) {
    const showCancelArea = redeemed.redemptionId && withinWindow && cancelState !== "success";
    return (
      <Screen tone="supporter">
        <Text style={theme.typography.supporterTitle}>
          {reward.emoji ?? "🎁"} {reward.name} と交換しました
        </Text>
        <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s2 }]}>
          -{redeemed.costPaid}pt（残高 {balance - redeemed.costPaid}pt）
        </Text>

        {showCancelArea && (
          <View style={{ marginTop: theme.spacing.s4 }}>
            {cancelState === "confirming" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.s3 }}>
                <Text style={theme.typography.supporterBody}>この交換を取り消しますか？</Text>
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
                  {cancelState === "processing" ? CANCEL_PROCESSING_TEXT.supporter : CANCEL_LABEL.supporter}
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
            {CANCEL_SUCCESS_TEXT.supporter}
          </Text>
        )}

        <AppButton
          tone="supporter"
          label="ごほうびへもどる"
          style={{ marginTop: theme.spacing.s6 }}
          onPress={() => router.replace("/supporter/rewards")}
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
