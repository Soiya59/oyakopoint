import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
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
 * P21 感謝ポイント（保護者ビュー・ハブ）
 * 参照: 主要画面ワイヤーフレーム.md 10.1章、画面一覧・遷移図.md P21・3.10章
 *
 * 残存原資（my_gratitude_giveable_balance RPC）・自分が贈った履歴（誤操作取消リンク付き）・
 * 直近もらった感謝の簡易プレビュー（詳細はP16通帳へ）をまとめる。
 * 感謝ポイントは家族全体で共有される`useAppData()`の中核stateには含めず
 * （store.tsx 15.9節「感謝ポイントは別会計・ランキング防止のため専用RPC/クエリで
 * 都度取得する」設計方針、10章参照）、この画面が必要になった時点でsession.clientを
 * 使い直接取得する。
 */
type LoadState = "loading" | "error" | "ready";

const FIVE_MIN_MS = 5 * 60 * 1000;

export default function ParentGratitudeHubScreen() {
  const { state } = useAppData();
  const { client } = useSession();
  const myId = state.activeParentMemberId;

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [balance, setBalance] = useState<number>(0);
  const [sent, setSent] = useState<GratitudePointWithCounterpart[]>([]);
  const [received, setReceived] = useState<GratitudePointWithCounterpart[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // P22からの復帰時のみ表示する送信完了トースト（既存のC6→C7/P20→P19と同じ
  // 「ナビゲーションパラメータを一度きりの合図として使う」パターン）。
  const params = useLocalSearchParams<{ toastName?: string; toastPoints?: string }>();
  const [toast, setToast] = useState<{ name: string; points: string } | null>(null);

  const load = useCallback(async () => {
    if (!myId) {
      // [2026-08-16修正・本部長] 通常はAppDataProvider側の全画面ローディングゲート
      // （store.tsx「familyIdが確定していて未読み込みの間はスピナーのみを表示する」）
      // により、この画面が描画される時点でstate.activeParentMemberIdは確定している
      // はずである。それでも空のままここに到達した場合（セッションが想定外の状態で
      // 直接この画面へ遷移した等）に、スケルトンのまま無限に固まる不具合を本部長が
      // ブラウザ検証で発見したため、フォールバックとしてエラー状態（再試行可能）に
      // 倒すよう修正した。
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
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>感謝ポイント</Text>

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
          <Card style={styles.balanceCard}>
            <Text style={theme.typography.parentBodyMedium}>今週あと {balance}pt 贈れます</Text>
            <AppButton
              label="ありがとうを贈る"
              style={{ marginTop: theme.spacing.s3 }}
              onPress={() => router.push("/parent/gratitude-send")}
              disabled={balance <= 0}
            />
          </Card>

          <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>贈った記録</Text>
          {sent.length === 0 ? (
            <EmptyState emoji="💌" title="まだ贈った記録はありません。気づいたことがあれば贈ってみましょう" />
          ) : (
            <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
              {sent.map((g) => {
                const canRevoke = !g.revoked_at && Date.now() - new Date(g.created_at).getTime() <= FIVE_MIN_MS;
                return (
                  <Card key={g.id} style={{ opacity: g.revoked_at ? 0.6 : 1 }}>
                    <View style={styles.rowTop}>
                      <Text style={theme.typography.parentCaption}>
                        {new Date(g.created_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}{" "}
                        {new Date(g.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                      <Text style={{ flex: 1 }} />
                      <Text style={theme.typography.parentBodyMedium}>
                        {g.family_members?.display_name ?? "?"} さんへ {g.points}pt
                      </Text>
                    </View>
                    <Text style={{ marginTop: theme.spacing.s1 }}>「{g.note}」</Text>
                    {g.revoked_at ? (
                      <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1 }]}>
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

          <View style={[styles.rowTop, { marginTop: theme.spacing.s6 }]}>
            <Text style={theme.typography.parentBodyMedium}>最近もらった感謝（{received.length}件）</Text>
            <Text style={{ flex: 1 }} />
            <Pressable onPress={() => router.push("/parent/points")}>
              <Text style={styles.linkText}>通帳へ→</Text>
            </Pressable>
          </View>
          {received.slice(0, 3).map((g) => (
            <Text key={g.id} style={[theme.typography.parentBody, { marginTop: theme.spacing.s1 }]}>
              {new Date(g.created_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}{" "}
              {g.family_members?.display_name ?? "?"}から {g.points}pt
            </Text>
          ))}

          {/* [2026-08-16修正・本部長] P19と同じ理由でホームへ戻るボタンを追加した。 */}
          <AppButton
            label="ホームへ戻る"
            variant="ghost"
            style={{ marginTop: theme.spacing.s6 }}
            onPress={() => router.back()}
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
  linkText: { color: theme.colors.brandPrimaryStrong },
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
