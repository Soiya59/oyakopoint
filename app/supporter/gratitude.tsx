import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import {
  fetchGratitudeReceivedHistory,
  fetchGratitudeSentHistory,
  fetchMyGratitudeGiveableBalance,
  revokeGratitudePoints,
  type GratitudePointWithCounterpart,
} from "@/data/api";

/**
 * S? 感謝ポイント（みまもりメンバービュー・ハブ）
 * [2026-09-07新設・実装メモ.md 141章] 本部長指示「みまもりメンバーも感謝ポイントを
 * 送受信できるようにする」（スキーマ設計.sql 48章）に伴う開発部の判断で新設した画面。
 * `app/parent/gratitude.tsx`（P21）とほぼ同一構成（tone違いのみ）。
 *
 * [UIUXデザイン部への申し送り] この画面はUIUXデザイン部の画面設計に未掲載
 * （画面一覧・遷移図.md 837行目は現時点で「みまもりメンバーは対象外」のまま。
 * スキーマ設計.sql 48.12章(1)が指摘する未確認事項）。本部長指示「みまもりのホーム・
 * 通帳から感謝ポイントを贈る導線が無ければスコープに含める」に基づき、開発部の
 * 判断でP21を最小限踏襲する形で実装した。以下、P21との差分:
 * - 「通帳へ→」の遷移リンクは持たない（みまもりメンバー向けの通帳画面〈P16相当〉が
 *   存在しないため。S1ホーム`MyPointsCard`のコメント参照）。もらった感謝の
 *   プレビューはこの画面内で完結させる。
 * - 迷った点として実装メモ.md 141章に記録済み。UIUXデザイン部・企画部の正式な
 *   画面設計が別途必要かどうかは本部長の判断に委ねる。
 */
type LoadState = "loading" | "error" | "ready";

const FIVE_MIN_MS = 5 * 60 * 1000;

export default function SupporterGratitudeHubScreen() {
  const { state } = useAppData();
  const { client } = useSession();
  const myId = state.activeParentMemberId;

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [balance, setBalance] = useState<number>(0);
  const [sent, setSent] = useState<GratitudePointWithCounterpart[]>([]);
  const [received, setReceived] = useState<GratitudePointWithCounterpart[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const params = useLocalSearchParams<{ toastName?: string; toastPoints?: string }>();
  const [toast, setToast] = useState<{ name: string; points: string } | null>(null);

  const load = useCallback(async () => {
    if (!myId) {
      setLoadState("error");
      return;
    }
    setLoadState("loading");
    const [balanceRes, sentRes, receivedRes] = await Promise.all([
      fetchMyGratitudeGiveableBalance(client),
      fetchGratitudeSentHistory(client, myId),
      fetchGratitudeReceivedHistory(client, myId),
    ]);
    if (!balanceRes.ok || !sentRes.ok || !receivedRes.ok) {
      setLoadState("error");
      return;
    }
    setBalance(balanceRes.data);
    setSent(sentRes.data);
    setReceived(receivedRes.data);
    setLoadState("ready");
  }, [client, myId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (params.toastName && params.toastPoints) {
      setToast({ name: params.toastName, points: params.toastPoints });
      void load();
      const t = setTimeout(() => setToast(null), 1500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toastName, params.toastPoints]);

  const revoke = async (id: string) => {
    setRevokingId(id);
    const res = await revokeGratitudePoints(client, id);
    setRevokingId(null);
    if (res.ok) {
      void load();
    }
  };

  return (
    <Screen tone="supporter">
      <ScreenBackLink tone="supporter" onPress={() => router.replace("/supporter/home")} />
      <Text style={theme.typography.supporterTitle}>感謝ポイント</Text>

      {toast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>
            {toast.name}さんに{toast.points}pt贈りました
          </Text>
        </View>
      )}

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={3} />
        </View>
      )}

      {loadState === "error" && <ErrorState title="読み込みに失敗しました" onRetry={load} />}

      {loadState === "ready" && (
        <>
          <Card tone="supporter" style={styles.balanceCard}>
            <Text style={theme.typography.supporterBodyMedium}>きょうあと {balance}pt 贈れます</Text>
            <AppButton
              tone="supporter"
              label="ありがとうを贈る"
              style={{ marginTop: theme.spacing.s3 }}
              onPress={() => router.push("/supporter/gratitude-send")}
              disabled={balance <= 0}
            />
          </Card>

          <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s6 }]}>贈った記録</Text>
          {sent.length === 0 ? (
            <EmptyState emoji="💌" title="まだ贈った記録はありません。気づいたことがあれば贈ってみましょう" />
          ) : (
            <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
              {sent.map((g) => {
                const canRevoke = !g.revoked_at && Date.now() - new Date(g.created_at).getTime() <= FIVE_MIN_MS;
                return (
                  <Card key={g.id} tone="supporter" style={{ opacity: g.revoked_at ? 0.6 : 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={theme.typography.supporterCaption}>
                        {new Date(g.created_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}{" "}
                        {new Date(g.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                      <Text style={{ flex: 1 }} />
                      <Text style={theme.typography.supporterBodyMedium}>
                        {g.family_members?.display_name ?? "?"} さんへ {g.points}pt
                      </Text>
                    </View>
                    <Text style={{ marginTop: theme.spacing.s1 }}>「{g.note}」</Text>
                    {g.revoked_at ? (
                      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1 }]}>
                        （取消済み）
                      </Text>
                    ) : canRevoke ? (
                      <Pressable onPress={() => revoke(g.id)} disabled={revokingId === g.id}>
                        <Text style={styles.revokeLink}>
                          {revokingId === g.id ? "取消しています…" : "取消"}
                        </Text>
                      </Pressable>
                    ) : null}
                  </Card>
                );
              })}
            </View>
          )}

          <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s6 }]}>
            最近もらった感謝（{received.length}件）
          </Text>
          <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
            {received.slice(0, 3).map((g) => (
              <View key={g.id}>
                <Text style={theme.typography.supporterBody}>
                  {new Date(g.created_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}{" "}
                  {g.family_members?.display_name ?? "?"}から {g.points}pt
                </Text>
                <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1 }]}>「{g.note}」</Text>
              </View>
            ))}
          </View>

          <AppButton
            tone="supporter"
            label="ホームへ戻る"
            variant="ghost"
            style={{ marginTop: theme.spacing.s6 }}
            onPress={() => router.replace("/supporter/home")}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceCard: { marginTop: theme.spacing.s4, alignItems: "center" },
  rowTop: { flexDirection: "row", alignItems: "center" },
  revokeLink: { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  toast: {
    marginTop: theme.spacing.s3,
    backgroundColor: theme.colors.neutralTextPrimary,
    borderRadius: theme.radius.parentMd,
    paddingVertical: theme.spacing.s3,
    paddingHorizontal: theme.spacing.s4,
    alignItems: "center",
  },
  toastText: { color: "#FFFFFF", fontWeight: "600" },
});
