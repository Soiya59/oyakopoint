import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import {
  fetchGratitudeReceivedHistory,
  fetchGratitudeSentHistory,
  fetchMyGratitudeGiveableBalance,
  type GratitudePointWithCounterpart,
} from "@/data/api";
import { formatDateShort, toJstDateString } from "@/lib/calendarDates";

/**
 * C16 感謝ポイント（子どもビュー・ハブ）
 * 参照: 主要画面ワイヤーフレーム.md 10.3章、画面一覧・遷移図.md C16・3.10章
 *
 * C8通帳の「ありがとうをおくる」ボタンから遷移する（下部タブには加えない。
 * 画面一覧・遷移図.md 3.5章「常時目に入る場所〔タブバー〕に置くと自発性を尊重する
 * 原則と矛盾するため、あえて1階層下のC8通帳からの導線とした」）。
 * 残存原資をゲージ表示、贈った・もらった記録をやさしい言葉で時系列表示する。
 * 連続記録・合計数のような競争的な数値は表示しない（10.3章決定）。
 */
type LoadState = "loading" | "error" | "ready";
type LogRow = { id: string; when: string; text: string };

export default function ChildGratitudeHubScreen() {
  const { state } = useAppData();
  const { client } = useSession();
  const myId = state.activeChildMemberId;

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [balance, setBalance] = useState(0);
  const [maxBalance, setMaxBalance] = useState(50);
  const [rows, setRows] = useState<LogRow[]>([]);

  const buildRows = (sent: GratitudePointWithCounterpart[], received: GratitudePointWithCounterpart[]): LogRow[] => {
    const sentRows: LogRow[] = sent
      .filter((g) => !g.revoked_at)
      .map((g) => ({
        id: `sent-${g.id}`,
        when: g.created_at,
        text: `💌 ${g.family_members?.display_name ?? "?"}に ${g.points}こ おくったよ`,
      }));
    const receivedRows: LogRow[] = received.map((g) => ({
      id: `received-${g.id}`,
      when: g.created_at,
      text: `💌 ${g.family_members?.display_name ?? "?"}から ${g.points}こ もらったよ`,
    }));
    return [...sentRows, ...receivedRows].sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
  };

  const load = useCallback(async () => {
    if (!myId) {
      // [2026-08-16修正・本部長] app/parent/gratitude.tsxと同じ理由・同じ修正
      // （AppDataProviderの全画面ローディングゲートを経てもactiveChildMemberIdが
      // 空のまま到達した場合に、無限スケルトンではなく再試行可能なエラー状態にする）。
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
    setRows(buildRows(sentRes.data, receivedRes.data));
    setLoadState("ready");
  }, [client, myId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 週次配布額（企画部案：週50pt、スキーマ設計.sql gratitude_weekly_allowance()）は
  // クライアントからは取得できない仕様（13e章「呼び出し本人の残存原資のみ返す」）ため、
  // ゲージの分母は「今回観測したbalanceの最大値」で近似する。厳密な満タン表現ではないが、
  // 「今週まだ贈れる分」の相対的な減り方が伝わればよいという10.3章の意図には沿う設計判断。
  useEffect(() => {
    setMaxBalance((prev) => Math.max(prev, balance));
  }, [balance]);

  const filledBars = Math.round((balance / Math.max(maxBalance, 1)) * 10);

  return (
    <Screen tone="child">
      <Text style={theme.typography.childBody}>💌 ありがとうポイント</Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={3} />
        </View>
      )}

      {loadState === "error" && (
        <ErrorState tone="child" title="つうしんがおやすみ中みたい" onRetry={load} />
      )}

      {loadState === "ready" && (
        <>
          <View style={styles.gaugeBox}>
            <Text style={theme.typography.childBody}>こんしゅう あと {balance}こ おくれるよ</Text>
            <Text style={styles.gaugeBar}>
              {"■".repeat(Math.max(filledBars, 0))}
              {"□".repeat(Math.max(10 - filledBars, 0))}
            </Text>
            <AppButton
              label="ありがとうを おくる"
              tone="child"
              fullWidth
              disabled={balance <= 0}
              style={{ marginTop: theme.spacing.s4 }}
              onPress={() => router.push("/child/gratitude-send")}
            />
          </View>

          <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s6 }]}>
            おくった・もらった きろく
          </Text>
          {rows.length === 0 ? (
            <EmptyState
              tone="child"
              emoji="💌"
              title="まだ おくった きろくは ないよ。きづいたことがあったら おくってみよう！"
            />
          ) : (
            <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
              {rows.map((r) => (
                <View key={r.id}>
                  <Text style={theme.typography.childBody}>{r.text}</Text>
                  <Text style={styles.dateLabel}>{formatDateShort(toJstDateString(r.when))}</Text>
                </View>
              ))}
            </View>
          )}

          {/* [2026-08-16修正・本部長] ユーザーの実操作で、ホーム(やることリスト)へ
              戻る手段がこの画面に無いことが判明した。C13/C14/C6等の既存画面と同じ
              「やることリストへもどる」パターンをそのまま踏襲した。 */}
          <AppButton
            label="やることリストへもどる"
            tone="child"
            fullWidth
            style={{ marginTop: theme.spacing.s6 }}
            onPress={() => router.replace("/child/home")}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gaugeBox: {
    marginTop: theme.spacing.s4,
    padding: theme.spacing.s4,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
  },
  gaugeBar: { marginTop: theme.spacing.s2, fontSize: 18, letterSpacing: 2, color: theme.colors.brandPrimaryStrong },
  dateLabel: { fontSize: 12, color: theme.colors.neutralTextSecondary },
});
