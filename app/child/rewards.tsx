import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * C9 ごほうび交換（一覧）（主要5画面のひとつ）
 * 参照: 主要画面ワイヤーフレーム.md 5章
 * 残高で買えるものは行全体をタップして交換可、足りないものは「あと◯pt」表示（交換不可はボタンでなく前向きな不足表示に）。
 * [2026-09-08修正・実装メモ.md 154章] 2列カード→1件1行に変更。行のタップ対象は
 * 交換可のときのみ有効（あと◯pt表示の行はタップしても反応しない、従来どおり）。
 *
 * [2026-09-10移設・実装メモ.md 188章] 子ども下部タブ4区画化（UIUXデザイン部/成果物/
 * 主要画面ワイヤーフレーム.md 36章）に伴い、独立タブ`app/child/(tabs)/rewards.tsx`
 * から`(tabs)/`外（本ファイル）へ移設した。URL自体は`/child/rewards`のまま変わって
 * いない（`(tabs)`はexpo-routerのルートグループでURLセグメントを追加しないため）。
 * 「じぶん」タブのタイル、および「クエスト」タブの新設ウィジェットの2箇所から
 * `router.push`で到達する画面になったため、タブでなくなったことに伴い冒頭に
 * 「← もどる」（`router.back()`）を新設した（`app/child/drawing.tsx`・
 * `app/child/collector-shelf.tsx`と同じ既存パターン）。
 *
 * **「🪙 メダルを かいに いく →」導線（2026-09-07追加・実装メモ144章）は削除した。**
 * `app/child/(tabs)/self.tsx`の「じぶん」タブへ独立したタイルとして移設した
 * （統括指示「メダルもごほうびから出してほしい」、36.0節本部長訂正・36.2節）。
 * 遷移先URL（`/child/sticker-shop`）・画面自体は変更していない。
 */
type LoadState = "loading" | "error" | "ready";

export default function ChildRewardsScreen() {
  const { state, memberPoints } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    const t = setTimeout(() => setLoadState("ready"), 450);
    return () => clearTimeout(t);
  }, []);

  const me = state.members.find((m) => m.id === state.activeChildMemberId)!;
  const balance = memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0;
  // [2026-09-01修正・本部長] 保護者側（app/parent/my-rewards.tsx）と同じ不具合が
  // 子ども側にもあった。みまもりメンバーの自分専用ごほうびが交換一覧に混ざる。
  // 3ロールとも同時に直す（実装メモ106章）。
  // [2026-09-12追加] 担当者による絞り込み（要件定義書07-22章、API仕様.md 7d節、
  // 開発部/成果物/実装メモ.md 163章）。app/parent/my-rewards.tsxと同型。
  const rewards = state.rewards.filter(
    (r) => r.is_active && r.scope === "family" && (r.assigned_to === null || r.assigned_to === me.id)
  );

  return (
    <Screen tone="child">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.childBody}>← もどる</Text>
      </Pressable>

      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s3 }]}>🎁 ごほうびこうかんじょ</Text>
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s1 }]}>いま {balance}pt もってるよ</Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={4} />
        </View>
      )}
      {loadState === "error" && (
        <ErrorState tone="child" title="つうしんがおやすみ中みたい" onRetry={() => setLoadState("ready")} />
      )}
      {loadState === "ready" && rewards.length === 0 && (
        <EmptyState tone="child" emoji="🎁" title="まだごほうびがないよ。おうちの人にリクエストしてみよう" />
      )}
      {/* [2026-09-08修正・本部長／実装メモ.md 154章] 2列カード→1件1行に変更（home.tsxと
          同じ理由。詳細はhome.tsxのコメント参照）。C9にはトグルのような二つ目の
          当たり判定が無いため、行全体を1個のPressableにできる（home.tsxのように
          main用・トグル用を分ける必要が無い）。交換不可（残高不足）の行はPressable化
          しない（従来どおりタップしても何も起きない、あと◯pt表示のみ）。 */}
      {loadState === "ready" && rewards.length > 0 && (
        <View style={styles.list}>
          {rewards.map((r) => {
            const canAfford = balance >= r.cost;
            const rowStyle = [styles.row];
            const rowContent = (
              <>
                <Text style={styles.rowEmoji}>{r.emoji}</Text>
                <Text style={[theme.typography.childBody, styles.rowTitle]} numberOfLines={1} ellipsizeMode="tail">
                  {r.name}
                </Text>
                <Text style={[theme.typography.parentCaption, styles.costText]}>{r.cost}pt</Text>
                {canAfford ? (
                  <Text style={styles.chevron}>›</Text>
                ) : (
                  <View style={styles.notEnoughBox}>
                    <Text style={styles.notEnoughText} numberOfLines={1}>あと{r.cost - balance}pt</Text>
                  </View>
                )}
              </>
            );
            return canAfford ? (
              <Pressable
                key={r.id}
                onPress={() => router.push({ pathname: "/child/reward-confirm", params: { rewardId: r.id } })}
                style={rowStyle}
              >
                {rowContent}
              </Pressable>
            ) : (
              <View key={r.id} style={rowStyle}>
                {rowContent}
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // [2026-09-08変更・実装メモ.md 154章] 2列グリッド（grid）→1件1行の縦並び（list）。
  list: { gap: theme.spacing.s2, marginTop: theme.spacing.s4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: theme.tapTarget.childPrimary,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    paddingHorizontal: theme.spacing.s4,
    paddingVertical: theme.spacing.s2,
  },
  rowEmoji: { fontSize: 32 },
  rowTitle: { flex: 1, marginLeft: theme.spacing.s3 },
  costText: { marginLeft: theme.spacing.s2 },
  chevron: { marginLeft: theme.spacing.s2, fontSize: 18, color: theme.colors.neutralTextSecondary },
  notEnoughBox: {
    marginLeft: theme.spacing.s2,
    backgroundColor: theme.colors.statusPendingSoft,
    borderRadius: theme.radius.childXl,
    paddingHorizontal: theme.spacing.s4,
    paddingVertical: theme.spacing.s2,
  },
  notEnoughText: { color: theme.colors.statusPending, fontWeight: "700" },
});
