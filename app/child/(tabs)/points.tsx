import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * C8 じぶんの通帳（主要5画面のひとつ。P16と共通仕様）
 * 参照: 主要画面ワイヤーフレーム.md 4章
 * 大きな残高表示＋ひらがな中心の履歴（絵文字＋pt）。消費履歴も赤字にしない。
 *
 * [2026-08-15改訂] 承認フロー廃止に伴い「承認済み」等のstatusLabelは廃止した。
 * 代わりに、各履歴行に届いた保護者リアクション（スタンプ／コメント）をチップとして
 * 併記する（主要画面ワイヤーフレーム.md 4章「届いたスタンプを絵文字で併記」）。
 */
type LoadState = "loading" | "error" | "ready";

export default function ChildPointsScreen() {
  const { state, memberPoints, fullLedger } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    const t = setTimeout(() => setLoadState("ready"), 450);
    return () => clearTimeout(t);
  }, []);

  const me = state.members.find((m) => m.id === state.activeChildMemberId)!;
  const balance = memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0;
  const ledger = fullLedger(me.id);

  return (
    <Screen tone="child">
      <View style={styles.headerRow}>
        <Text style={theme.typography.childBody}>🌟 {me.display_name}の つうちょう</Text>
        {/* [2026-08-16追加] 主要画面ワイヤーフレーム.md 4章ワイヤーフレーム（子どもビューC8）
            「[💌ありがとうをおくる] ← 感謝ポイントを贈る導線（C16へ）」対応。
            画面一覧・遷移図.md 3.5章のとおり下部タブには置かず、C8からの導線とする。 */}
        <Pressable onPress={() => router.push("/child/gratitude")}>
          <Text style={styles.linkText}>💌おくる</Text>
        </Pressable>
      </View>

      <View style={styles.balanceBox}>
        <Text style={theme.typography.childHeadline}>いま {balance}pt</Text>
      </View>

      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s6 }]}>さいきんの きろく</Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s3 }}>
          <SkeletonList count={4} />
        </View>
      )}
      {loadState === "error" && (
        <ErrorState tone="child" title="つうしんがおやすみ中みたい" onRetry={() => setLoadState("ready")} />
      )}
      {loadState === "ready" && ledger.length === 0 && (
        <EmptyState tone="child" emoji="📔" title="まだきろくがないよ。やることリストからチャレンジしてみよう！" />
      )}
      {loadState === "ready" && ledger.length > 0 && (
        <View style={{ marginTop: theme.spacing.s2 }}>
          {ledger.map((entry) => (
            <View key={entry.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <Text style={theme.typography.childBody}>
                    {entry.emoji} {entry.label}
                  </Text>
                  <Text style={{ flex: 1 }} />
                  <Text style={[theme.typography.childBody, { color: theme.colors.brandPrimaryStrong }]}>
                    {/* [2026-08-16改訂] "gratitude"（感謝ポイント受領分）もearnと同じ+表示にする */}
                    {entry.kind === "spend" ? "-" : "+"}
                    {entry.points}pt
                  </Text>
                  <Text style={[theme.typography.parentCaption, { marginLeft: theme.spacing.s2 }]}>
                    {new Date(entry.occurredAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}
                  </Text>
                </View>
                {/* [2026-08-16追加] 感謝ポイントの自由記述メモをそのまま表示する
                    （主要画面ワイヤーフレーム.md 4章）。 */}
                {entry.kind === "gratitude" && entry.note && (
                  <Text style={theme.typography.parentCaption} numberOfLines={2}>
                    「{entry.note}」
                  </Text>
                )}
                {/* 届いたリアクション（スタンプ／コメント）をチップとして併記。空なら何も出さない
                    （主要画面ワイヤーフレーム.md 4章「リアクションが1件も無い履歴行は何も表示しない」） */}
                {entry.reactions.length > 0 && (
                  <View style={styles.reactionRow}>
                    {entry.reactions.map((r) => {
                      const reactor = state.members.find((m) => m.id === r.reacted_by);
                      const stampDef = theme.stampDefinitions.find((s) => s.key === r.stamp_key);
                      return (
                        <Text key={r.id} style={styles.reactionChip}>
                          {r.kind === "stamp" ? stampDef?.emoji : "💬"}
                          {reactor?.display_name}
                          {r.kind === "comment" ? `「${r.comment_body}」` : ""}
                        </Text>
                      );
                    })}
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  linkText: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  balanceBox: {
    alignItems: "center",
    marginTop: theme.spacing.s6,
    padding: theme.spacing.s6,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing.s3,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutralBorder,
  },
  rowTop: { flexDirection: "row", alignItems: "center" },
  reactionRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s1 },
  reactionChip: {
    fontSize: 12,
    color: theme.colors.brandPrimaryStrong,
    backgroundColor: theme.colors.brandPrimarySoft,
    paddingHorizontal: theme.spacing.s2,
    paddingVertical: 2,
    borderRadius: theme.radius.parentMd,
  },
});
