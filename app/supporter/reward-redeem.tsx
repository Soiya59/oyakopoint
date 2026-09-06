import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { EmptyState } from "@/components/StatusViews";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * S10 ごほうびと交換（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S10、API仕様.md 7b章・7b-2章
 *
 * みまもり共通choreで貯めたポイント（家族共有choreへの参加分も合算、実装メモ.md参照）を
 * 使って、みまもりメンバー専用のごほうびカタログと交換できる。「みまもりメンバー専用」
 * であることを明示する注記を表示し、子ども向けごほうび交換画面との混同を防ぐ。
 *
 * [2026-09-06改訂・要件定義書07-18章決定6'-2・UIUXデザイン部30.7節決定17]
 * 対象データを「自分が作成した行（scope問わず）」に加えて「家族内の
 * `supporter_shared`行（作成者を問わず全員）」に拡張した。交換は各自の残高から
 * 各自の操作でのみ行う（代理交換は不可、DB側`reward_redemptions_insert_scoped`で
 * 担保）。
 */
export default function SupporterRewardRedeemScreen() {
  const { state, memberPoints } = useAppData();
  const params = useLocalSearchParams<{
    justRewardId?: string;
    justName?: string;
    justCost?: string;
    focusRewardId?: string;
  }>();
  const [snackbar, setSnackbar] = useState<{ rewardId: string; name: string; cost: string } | null>(null);
  // [2026-09-06追加・UIUXデザイン部30.7節決定20] S8下段からの遷移時、対象行を
  // 既存のhighlightedスタイルで一定時間ハイライトする（justRewardIdと同じ見た目を
  // 再利用しつつ、パラメータ名は混同を避けるため別名にする）。
  const [focusedRewardId, setFocusedRewardId] = useState<string | null>(null);

  useEffect(() => {
    if (params.justRewardId && params.justName && params.justCost) {
      setSnackbar({ rewardId: params.justRewardId, name: params.justName, cost: params.justCost });
      const t = setTimeout(() => setSnackbar(null), 1500);
      return () => clearTimeout(t);
    }
  }, [params.justRewardId, params.justName, params.justCost]);

  useEffect(() => {
    if (params.focusRewardId) {
      setFocusedRewardId(params.focusRewardId);
      const t = setTimeout(() => setFocusedRewardId(null), 2000);
      return () => clearTimeout(t);
    }
  }, [params.focusRewardId]);

  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const balance = me ? memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0 : 0;
  // [2026-09-06改訂・決定17] 自分の登録分（personal・supporter_shared問わず）＋
  // 家族内の他のみまもりメンバーが登録したsupporter_shared分。
  const myRewards = state.rewards.filter(
    (r) => r.is_active && (r.scope === "supporter_shared" || (r.scope === "personal" && r.created_by === me?.id))
  );
  const creatorOf = (id: string) => state.members.find((m) => m.id === id);

  return (
    <Screen tone="supporter">
      <ScreenBackLink tone="supporter" onPress={() => router.replace("/supporter/home")} />
      <Text style={theme.typography.supporterTitle}>ごほうびと交換</Text>
      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        みまもりメンバー専用のごほうびです（家族共有のごほうびとは別のカタログです）。それぞれ自分のポイントで交換します。
      </Text>
      <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s2 }]}>いま {balance}pt</Text>

      {snackbar && (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText}>こうかんしました -{snackbar.cost}pt</Text>
        </View>
      )}

      {myRewards.length === 0 && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <EmptyState emoji="🎁" title="まだごほうびが登録されていません" />
          <AppButton
            tone="supporter"
            label="ごほうびを登録する"
            variant="secondary"
            style={{ marginTop: theme.spacing.s2 }}
            onPress={() => router.push("/supporter/reward-edit")}
          />
        </View>
      )}

      {myRewards.length > 0 && (
        <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
          {myRewards.map((r) => {
            const canAfford = balance >= r.cost;
            const highlighted = snackbar?.rewardId === r.id || focusedRewardId === r.id;
            const isMine = r.created_by === me?.id;
            const creatorName = !isMine && r.created_by ? creatorOf(r.created_by)?.display_name : null;
            return (
              <Pressable
                key={r.id}
                disabled={!canAfford || !me}
                onPress={() => router.push({ pathname: "/supporter/reward-confirm", params: { rewardId: r.id } })}
              >
                <Card
                  tone="supporter"
                  style={
                    highlighted
                      ? { ...styles.row, backgroundColor: theme.colors.supporterAccentSoft, borderColor: theme.colors.supporterAccent }
                      : styles.row
                  }
                >
                  <Text style={{ fontSize: 20 }}>{r.emoji ?? "🎁"}</Text>
                  <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s3 }]}>
                    {/* [2026-09-06追加・決定19] 自分以外の登録分にのみ登録者名を軽量に併記する */}
                    {r.name}
                    {creatorName ? `（${creatorName}）` : ""}
                  </Text>
                  {canAfford ? (
                    <>
                      <Text style={theme.typography.supporterBodyMedium}>-{r.cost}pt</Text>
                      <Text style={styles.chevron}>›</Text>
                    </>
                  ) : (
                    <Text style={styles.notEnoughLabel}>あと{r.cost - balance}pt</Text>
                  )}
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}

      <AppButton tone="supporter" label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/supporter/home")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  notEnoughLabel: { color: theme.colors.statusPending },
  chevron: { color: theme.colors.neutralTextSecondary, marginLeft: theme.spacing.s2, fontSize: 18 },
  snackbar: {
    marginTop: theme.spacing.s3,
    backgroundColor: theme.colors.neutralTextPrimary,
    borderRadius: theme.radius.parentMd,
    paddingVertical: theme.spacing.s3,
    paddingHorizontal: theme.spacing.s4,
    alignItems: "center",
  },
  snackbarText: { color: "#FFFFFF", fontWeight: "600" },
});
