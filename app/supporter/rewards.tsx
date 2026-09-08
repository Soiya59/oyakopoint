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
 * S8 ごほうび一覧（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S8、API仕様.md 7b章・7b-2章
 *
 * 自分が登録したごほうび（scope='personal'（既存分のみ）または'supporter_shared'、
 * created_by=自分）を一覧し、新規登録・編集（→S9）、交換（→S11）への入口にする。
 * 新規登録は常に'supporter_shared'になる（要件定義書07-18章決定6'）。
 *
 * [2026-09-06追加・要件定義書07-18章決定6'-4・UIUXデザイン部30.5節決定13]
 * S5と同型の2区分構造（上段＝わたしが登録したごほうび、下段＝かぞくのほかの
 * みまもりメンバーのごほうび）を新設した。
 *
 * [2026-09-08改訂・要件定義書07-18章決定6'-4改訂・UIUXデザイン部33章]
 * 統括の実機確認指摘「みまもりのごほうびについて、クエストと同じく、ご褒美を
 * 開いたら、すぐにご褒美を交換できる画面にしてほしい」を受け、中間一覧だった
 * S10（旧ルート、削除済み）を廃止し、S8の対象行（上段＝全行、
 * 下段＝`scope='supporter_shared'`行のみ）をタップすると直接S11「交換確認」へ
 * 進む構成に変更した（33.2決定1・2）。S10が持っていた残高判定（決定3）、交換
 * 成功後のスナックバー＋該当行ハイライト（決定6）、専用カタログ注記（決定8）を
 * 本画面へ移植した。他者登録分の登録者名併記・`focusRewardId`によるハイライトは
 * 不要と判断し廃棄した（決定5、下段は既に登録者名でグループ化されているため）。
 * 画面下部の「ごほうびと交換する」ボタンは削除した（決定9）。
 */
export default function SupporterRewardsScreen() {
  const { state, memberPoints } = useAppData();
  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const balance = me ? memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0 : 0;
  // [2026-09-06改訂・07-18章] 'personal'（既存分）に加え'supporter_shared'（新規分）も
  // 対象にする（UIUXデザイン部30.0節「指摘0」）。
  const sharedRewards = state.rewards.filter(
    (r) => r.is_active && (r.scope === "personal" || r.scope === "supporter_shared")
  );
  const myRewards = sharedRewards.filter((r) => r.created_by === me?.id);
  const othersRewards = sharedRewards.filter((r) => r.created_by && r.created_by !== me?.id);

  const othersByCreator = othersRewards.reduce<Record<string, typeof othersRewards>>((acc, r) => {
    const key = r.created_by as string;
    (acc[key] ??= []).push(r);
    return acc;
  }, {});
  const creatorOf = (id: string) => state.members.find((m) => m.id === id);

  // [2026-09-08追加・UIUXデザイン部33.2節決定6] S11から戻ってきた直後の
  // スナックバー＋該当行ハイライト。保護者`my-rewards.tsx`・旧S10と同型の受信ロジック。
  const params = useLocalSearchParams<{ justRewardId?: string; justName?: string; justCost?: string }>();
  const [snackbar, setSnackbar] = useState<{ rewardId: string; name: string; cost: string } | null>(null);

  useEffect(() => {
    if (params.justRewardId && params.justName && params.justCost) {
      setSnackbar({ rewardId: params.justRewardId, name: params.justName, cost: params.justCost });
      const t = setTimeout(() => setSnackbar(null), 1500);
      return () => clearTimeout(t);
    }
  }, [params.justRewardId, params.justName, params.justCost]);

  // [2026-09-07追加・要件定義書07-20章決定2] 「かぞくのほかのみまもりメンバーの
  // ごほうび」の折りたたみ。app/parent/chores.tsxの「終わった単発のクエスト」と
  // 同じ仕組み（Pressableトグル・▾/▸・件数表示・画面固有useState・永続化しない）
  // をそのまま流用する。既定は「開いている」（07-20章決定2）。折りたたみは区分の
  // 開閉だけで、中の交換への入口には触らない（07-20章決定3）。
  const [othersOpen, setOthersOpen] = useState(true);

  return (
    <Screen tone="supporter">
      <ScreenBackLink tone="supporter" onPress={() => router.replace("/supporter/home")} />
      <View style={styles.header}>
        <Text style={theme.typography.supporterTitle}>じぶんのごほうび</Text>
        <AppButton tone="supporter" label="＋ 新規" variant="secondary" onPress={() => router.push("/supporter/reward-edit")} />
      </View>
      {/* [2026-09-08追加・UIUXデザイン部33.2節決定8] 旧S10にあった専用カタログの注記。
          直行画面になることで初めて必要になる前提情報のため、見出し直下・残高表示の前に置く。 */}
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
        </View>
      )}

      {myRewards.length > 0 && (
        <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
          {/* [2026-09-06追加・UIUXデザイン部30.5節決定13] 下段の見出しと対にする */}
          <Text style={theme.typography.supporterBodyMedium}>わたしが登録したごほうび</Text>
          {myRewards.map((r) => {
            // [2026-09-08追加・UIUXデザイン部33.2節決定2・3] 上段は常に自分にとって
            // 交換可能（現行の絞り込み条件により）。残高判定を追加し、タップで直接[S11]へ。
            const canAfford = balance >= r.cost;
            return (
              <Card key={r.id} tone="supporter" style={{ backgroundColor: theme.colors.supporterAccentSoft, borderColor: theme.colors.supporterAccent }}>
                {/* [2026-09-08追加・UIUXデザイン部33.2節決定4] S5（my-chores.tsx）と
                    同じrowMainパターン。タップ領域と「編集する」リンクを分離する。 */}
                <Pressable
                  disabled={!canAfford || !me}
                  onPress={() => router.push({ pathname: "/supporter/reward-confirm", params: { rewardId: r.id } })}
                  style={styles.rowMain}
                >
                  <Text style={{ fontSize: 20 }}>{r.emoji ?? "🎁"}</Text>
                  <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s3 }]}>{r.name}</Text>
                  {canAfford ? (
                    <>
                      <Text style={theme.typography.supporterBodyMedium}>-{r.cost}pt</Text>
                      <Text style={styles.chevron}>›</Text>
                    </>
                  ) : (
                    <Text style={styles.notEnoughLabel}>あと{r.cost - balance}pt</Text>
                  )}
                </Pressable>
                <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s2, alignItems: "center" }}>
                  {/* [2026-09-06追加・UIUXデザイン部30.9節決定22] 既存のscope='personal'
                      （レガシー）行にのみ、じぶんだけが交換できる旨を書き添える。 */}
                  {r.scope === "personal" && (
                    <Text style={styles.publicLabel}>じぶんだけが交換できます</Text>
                  )}
                  <Text style={{ flex: 1 }} />
                  <Pressable onPress={() => router.push({ pathname: "/supporter/reward-edit", params: { id: r.id } })}>
                    <Text style={styles.editLink}>編集する</Text>
                  </Pressable>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {Object.keys(othersByCreator).length > 0 && (
        <>
          {/* [2026-09-06追加・UIUXデザイン部30.5節決定13] S5と同型の下段セクション新設 */}
          {/* [2026-09-07追加・要件定義書07-20章] 折りたたみ。既定は開いている
              （決定2）。中の交換への入口（scope='supporter_shared'行）には触らない
              （決定3）。 */}
          <Pressable onPress={() => setOthersOpen((v) => !v)} style={{ marginTop: theme.spacing.s6 }} hitSlop={8}>
            <Text style={theme.typography.supporterBodyMedium}>
              {othersOpen ? "▾" : "▸"} かぞくのほかのみまもりメンバーのごほうび（{othersRewards.length}）
            </Text>
          </Pressable>
          {othersOpen && (
          <>
          <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
            みんなの参考にどうぞ。
          </Text>
          <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
            {Object.entries(othersByCreator).map(([creatorId, rewards]) => {
              const creator = creatorOf(creatorId);
              return (
                <Card key={creatorId} tone="supporter" style={styles.refRow}>
                  <Text style={theme.typography.supporterBodyMedium}>{creator?.display_name ?? "みまもりメンバー"}</Text>
                  <View style={{ marginTop: theme.spacing.s1, gap: theme.spacing.s1 }}>
                    {rewards.map((r) => {
                      // [2026-09-08改訂・UIUXデザイン部33.2節決定2] supporter_shared行のみ
                      // タップで直接[S11 交換確認]へ（決定3の残高判定つき）。
                      // personal（レガシー）行は非タップの参考表示のまま。
                      if (r.scope === "supporter_shared") {
                        const canAfford = balance >= r.cost;
                        const highlighted = snackbar?.rewardId === r.id;
                        return (
                          <Pressable
                            key={r.id}
                            disabled={!canAfford || !me}
                            onPress={() => router.push({ pathname: "/supporter/reward-confirm", params: { rewardId: r.id } })}
                            style={highlighted ? styles.refItemHighlighted : styles.refItem}
                          >
                            <Text style={{ fontSize: 16 }}>{r.emoji ?? "🎁"}</Text>
                            <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s2 }]}>{r.name}</Text>
                            {canAfford ? (
                              <Text style={theme.typography.supporterCaption}>{r.cost}pt 交換する ›</Text>
                            ) : (
                              <Text style={styles.notEnoughLabel}>あと{r.cost - balance}pt</Text>
                            )}
                          </Pressable>
                        );
                      }
                      return (
                        <View key={r.id} style={styles.refItem}>
                          <Text style={{ fontSize: 16 }}>{r.emoji ?? "🎁"}</Text>
                          <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s2 }]}>{r.name}</Text>
                          <Text style={theme.typography.supporterCaption}>{r.cost}pt</Text>
                        </View>
                      );
                    })}
                  </View>
                </Card>
              );
            })}
          </View>
          </>
          )}
        </>
      )}

      {/* [2026-09-07追加・本部長／実装メモ.md 144章] 統括の実機確認「ステッカーは購入できる
          場所がなくなったかも／ごほうびから飛べたらよいかも」対応。ごほうび一覧（S8）から
          ステッカー購入（S23）への導線を追加した。みまもりメンバーもロールを問わず購入できる
          （要件定義書07-19章、みまもりを除外する記述は無い）。既存のコレクター棚経由の導線
          （自分のステッカータブのみ表示）はそのまま残す（判断の理由は実装メモ参照）。 */}
      <Pressable onPress={() => router.push("/supporter/sticker-shop")} style={{ marginTop: theme.spacing.s6 }} hitSlop={8}>
        <Card tone="supporter">
          <Text style={theme.typography.supporterBodyMedium}>
            <Text style={{ fontSize: 22 }}>🪙</Text> メダルを買いに行く →
          </Text>
          <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1 }]}>
            貯めたポイントで、木を飾るメダルを買えます。
          </Text>
        </Card>
      </Pressable>

      <AppButton tone="supporter" label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.replace("/supporter/home")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowMain: { flexDirection: "row", alignItems: "center" },
  editLink: { color: theme.colors.supporterAccent, fontWeight: "700" },
  publicLabel: { color: theme.colors.neutralTextSecondary, fontSize: 12 },
  notEnoughLabel: { color: theme.colors.statusPending },
  chevron: { color: theme.colors.neutralTextSecondary, marginLeft: theme.spacing.s2, fontSize: 18 },
  refRow: { backgroundColor: theme.colors.neutralSurface },
  refItem: { flexDirection: "row", alignItems: "center" },
  refItemHighlighted: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.supporterAccentSoft,
    borderColor: theme.colors.supporterAccent,
    borderWidth: 1,
    borderRadius: theme.radius.parentMd,
    padding: theme.spacing.s2,
  },
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
