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
      <Text style={theme.typography.childBody}>🎁 ごほうびこうかんじょ</Text>
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s1 }]}>いま {balance}pt もってるよ</Text>

      {/* [2026-09-07追加・本部長／実装メモ.md 144章] 統括の実機確認「ステッカーは購入できる
          場所がなくなったかも／ごほうびから飛べたらよいかも」対応。ごほうび交換画面（C9）から
          シール購入画面（C30）への導線を追加した。既存のコレクションだな経由の導線
          （じぶんのシールタブのみ表示）はそのまま残す（判断の理由は実装メモ参照）。 */}
      <Pressable onPress={() => router.push("/child/sticker-shop")} style={styles.stickerLink} hitSlop={8}>
        <Text style={theme.typography.childBody}>
          {/* [2026-09-08・統括指示] 絵文字は🧩→🏅→🪙と変えた。🏅は紐が付いた
              首から下げるメダルで、木に貼る丸いメダルの絵と合わないため。
              あわせて絵文字だけ一回り大きくする。 */}
          <Text style={{ fontSize: 22 }}>🪙</Text> メダルを かいに いく →
        </Text>
        <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1 }]}>
          ためた ぽいんとで、きに かざる メダルが かえるよ
        </Text>
      </Pressable>

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
          {rewards.map((r, index) => {
            const canAfford = balance >= r.cost;
            // [2026-09-08追加・本部長／実装メモ.md 155章] 1行おきの縞模様。
            // C9は区分が無い単一の一覧のため、リスト全体でのindexをそのまま使う
            // （home.tsxのように区分ごとにリセットする必要が無い）。
            const isOdd = index % 2 === 1;
            const rowStyle = [styles.row, isOdd && styles.rowStripe];
            const rowContent = (
              <>
                <Text style={styles.rowEmoji}>{r.emoji}</Text>
                <Text style={[theme.typography.childBody, styles.rowTitle]} numberOfLines={1} ellipsizeMode="tail">
                  {r.name}
                </Text>
                <Text style={[theme.typography.parentCaption, styles.costText]}>{r.cost}pt</Text>
                {canAfford ? (
                  // [2026-09-08修正] 従来は「こうかん」の緑ボタンだけがタップ対象だった。
                  // 行全体がタップ対象になったため、ボタン文言は無くし、home.tsxの
                  // pointLabel（+◯pt）と同様に「タップできる状態」であることを
                  // シェブロン（parent/my-chores.tsxのchevronと同じ既存パターン）で示す。
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
  // [2026-09-07追加] シール購入への導線カード（実装メモ144章）。既存のcardスタイルと
  // 同じ背景・角丸を使い、横幅いっぱいに広げただけ。
  stickerLink: {
    marginTop: theme.spacing.s4,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    padding: theme.spacing.s4,
    minHeight: theme.tapTarget.child,
  },
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
  // [2026-09-08追加・本部長／実装メモ.md 155章] 1行おきの縞模様。
  // home.tsxのrowStripeと同じ考え方・同じトークン（neutralBg）を使う。
  rowStripe: { backgroundColor: theme.colors.neutralBg },
  // 絵文字のfontSizeは変更前のcard内の値（32）をそのまま維持。
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
