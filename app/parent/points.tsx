import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * P16 ポイント通帳（保護者ビュー）（主要5画面のひとつ）
 * 参照: 主要画面ワイヤーフレーム.md 4章
 * メンバー切替タブ・残高・獲得/消費履歴（表形式、消費も赤字にしない）を実装。
 *
 * [2026-08-15改訂] 履歴行の末尾にあった「承認済」表示を削除した。承認フロー廃止により
 * 全ての完了報告は送信時点で確定済みであり、「承認済」というラベル自体が意味を失った
 * ため（スキーマ設計.sql v2.0 5章参照）。代わりに、届いたリアクション（スタンプ／コメント）
 * を併記する。
 */
type LoadState = "loading" | "error" | "ready";

export default function ParentPointsScreen() {
  const { state, memberPoints, fullLedger } = useAppData();
  const memberName = (id: string) => state.members.find((m) => m.id === id)?.display_name ?? "?";
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setLoadState("ready"), 400);
    return () => clearTimeout(t);
  }, []);

  const members = state.members.filter((m) => m.is_active);
  const activeMemberId = selectedMemberId ?? members[0]?.id ?? null;
  const activeBalance = memberPoints.find((m) => m.member_id === activeMemberId)?.current_points ?? 0;
  const ledger = activeMemberId ? fullLedger(activeMemberId) : [];

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/home")} />
      <View style={styles.headerRow}>
        <Text style={theme.typography.parentTitle}>ポイント通帳</Text>
        {/* [2026-08-16追加] 主要画面ワイヤーフレーム.md 4章ワイヤーフレーム（保護者ビューP16）
            「[💌感謝ポイント] ← 感謝ポイントハブへの導線」対応。 */}
        <Pressable onPress={() => router.push("/parent/gratitude")}>
          <Text style={styles.linkText}>💌感謝ポイント</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: theme.spacing.s4 }}>
        <View style={{ flexDirection: "row", gap: theme.spacing.s2 }}>
          {members.map((m) => (
            <Pressable
              key={m.id}
              onPress={() => setSelectedMemberId(m.id)}
              style={[
                styles.tab,
                {
                  backgroundColor: activeMemberId === m.id ? theme.colors.brandPrimary : theme.colors.neutralSurface,
                  borderColor: activeMemberId === m.id ? theme.colors.brandPrimary : theme.colors.neutralBorder,
                },
              ]}
            >
              <Text style={{ color: activeMemberId === m.id ? "#FFFFFF" : theme.colors.neutralTextPrimary }}>
                {m.display_name}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={4} />
        </View>
      )}

      {loadState === "error" && (
        <ErrorState title="読み込みに失敗しました" onRetry={() => setLoadState("ready")} />
      )}

      {loadState === "ready" && (
        <>
          <Card style={styles.balanceCard}>
            <Text style={theme.typography.parentBody}>
              {members.find((m) => m.id === activeMemberId)?.display_name}: {activeBalance}pt
            </Text>
          </Card>

          {ledger.length === 0 ? (
            <EmptyState emoji="📔" title="まだ履歴がありません" />
          ) : (
            <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s1 }}>
              {ledger.map((entry) => (
                <View key={entry.id} style={styles.rowWrap}>
                  <View style={styles.row}>
                    <Text style={theme.typography.parentCaption}>
                      {new Date(entry.occurredAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}{" "}
                      {new Date(entry.occurredAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                    <Text style={[theme.typography.parentBody, { flex: 1, marginLeft: theme.spacing.s3 }]}>
                      {entry.emoji} {entry.label}
                    </Text>
                    <Text style={theme.typography.parentBodyMedium}>
                      {/* [2026-08-16改訂] "gratitude"（感謝ポイント受領分）もearnと同じ+表示にする
                          （member_pointsに合算される「増えた」履歴のため。スキーマ設計.sql 14章）。 */}
                      {entry.kind === "spend" ? "-" : "+"}
                      {entry.points}pt
                    </Text>
                  </View>
                  {/* [2026-08-16追加] 感謝ポイントの自由記述メモ（主要画面ワイヤーフレーム.md 4章
                      「送信者がそのまま書いた文章を編集・要約せずに表示する」）。 */}
                  {entry.kind === "gratitude" && entry.note && (
                    <Text style={[theme.typography.parentCaption, styles.reactionLine]} numberOfLines={2}>
                      「{entry.note}」
                    </Text>
                  )}
                  {/* 届いたリアクション（スタンプ／コメント）を併記。無ければ何も表示しない
                      （主要画面ワイヤーフレーム.md 4章「リアクションが1件も無い履歴行は何も表示しない」） */}
                  {entry.reactions.length > 0 && (
                    <Text style={[theme.typography.parentCaption, styles.reactionLine]}>
                      {entry.reactions
                        .map((r) => {
                          const stampDef = theme.stampDefinitions.find((s) => s.key === r.stamp_key);
                          const who = memberName(r.reacted_by);
                          return r.kind === "stamp"
                            ? `${stampDef?.emoji}${who}`
                            : `💬${who}「${r.comment_body}」`;
                        })
                        .join("  ")}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* [2026-08-16修正・本部長] ユーザーの実操作で、この画面（P16）にホームへ戻る手段が
          無いことが判明した（P8・P18にも同じ抜けがあり、あわせて修正した）。
          P10・P12・P14等の既存画面と同じ「ホームへ戻る」パターンを踏襲した。 */}
      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/parent/home")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  linkText: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  tab: {
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
  },
  balanceCard: { marginTop: theme.spacing.s4, backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  rowWrap: {
    paddingVertical: theme.spacing.s2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutralBorder,
  },
  row: { flexDirection: "row", alignItems: "center" },
  reactionLine: { marginTop: theme.spacing.s1, color: theme.colors.brandPrimaryStrong },
});
