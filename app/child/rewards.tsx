import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * C9 ごほうび交換（一覧）（主要5画面のひとつ）
 * 参照: 主要画面ワイヤーフレーム.md 5章・37章
 * 残高で買えるものはカード全体をタップして交換可、足りないものは「あと◯pt」表示（交換不可はボタンでなく前向きな不足表示に）。
 *
 * [2026-09-11変更・主要画面ワイヤーフレーム.md 37章・実装メモ.md 194章] 1件1行の
 * 縦並び（154章）から、2026-09-08より前と同じ2列カードグリッドへ戻した。理由は
 * home.tsx（C5）と同じ（並べ替え機能を作らないことが決まり、1列でなければならない
 * 理由が消滅したため。37.0節）。交換可カードは引き続き単一のPressableとし、下端に
 * 「こうかん」ラベルを装飾として置く（独立したPressableにはしない、37.6節決定6）。
 * 交換不可（残高不足）カードは従来どおりタップ不可のViewのまま。
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
      {/* [2026-09-11変更・実装メモ.md 194章] 1件1行（154章）から2列カードグリッドへ
          戻した。C9にはC5のトグルのような二つ目の当たり判定が無いため、カード全体を
          1個のPressable（交換可の場合）にできる（37.2節決定2）。交換不可（残高不足）の
          カードはPressable化しない（従来どおりタップしても何も起きない、あと◯pt表示
          のみ）。cardMain（View、flex:1）がカード内の余白を吸収し、下端の「こうかん」
          ラベル／あと◯pt表示は同じ行のカードどうしで縦位置がそろう
          （37.3a節と同じ考え方、37.13節2.）。 */}
      {loadState === "ready" && rewards.length > 0 && (
        <View style={styles.grid}>
          {rewards.map((r) => {
            const canAfford = balance >= r.cost;
            const cardContent = (
              <>
                <View style={styles.cardMain}>
                  <Text style={styles.cardEmoji}>{r.emoji}</Text>
                  <Text
                    style={[theme.typography.childBody, styles.cardTitle]}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {r.name}
                  </Text>
                  <Text style={[theme.typography.parentCaption, styles.costText]}>{r.cost}pt</Text>
                </View>
                {canAfford ? (
                  // [37.6節決定6] 独立したPressableにはしない装飾ラベル。旧2列カード
                  // （2026-09-08より前）のexchangeBtnと同じ見た目（brandPrimary背景・
                  // 白文字・角丸、いずれも既存トークン）を復元した。
                  <View style={styles.exchangeLabel}>
                    <Text style={styles.exchangeLabelText}>こうかん</Text>
                  </View>
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
                style={styles.card}
              >
                {cardContent}
              </Pressable>
            ) : (
              <View key={r.id} style={styles.card}>
                {cardContent}
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // [2026-09-11変更・主要画面ワイヤーフレーム.md 37章・実装メモ.md 194章] 1件1行の
  // 縦並び（list/row、154章）から、2026-09-08より前と同じ2列カードグリッド
  // （grid/card）へ戻した。値はhome.tsx（C5）と同一のトークン。
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s3, marginTop: theme.spacing.s4 },
  card: {
    width: "47%",
    minHeight: theme.tapTarget.childPrimary,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    alignItems: "center",
    padding: theme.spacing.s4,
  },
  // [37.3a節] gridはalignItemsを指定していないため既定値"stretch"になり、同じ行
  // （flexWrapの1ライン）のカードは最も背の高いカードに高さが揃う。cardMainの
  // flex:1がその余白を吸収し、下端の「こうかん」ラベル／あと◯pt表示を常にカード
  // 下端に固定する。
  cardMain: { flex: 1, alignItems: "center", justifyContent: "center" },
  cardEmoji: { fontSize: 32 },
  // [37.3節決定3] numberOfLines={1}→{2}。2行でも収まらなければ末尾を省略する。
  // 文字サイズ（theme.typography.childBody）は変更しない。
  cardTitle: { marginTop: theme.spacing.s1, textAlign: "center" },
  costText: { marginTop: theme.spacing.s1 },
  // [37.6節決定6] 旧2列カード（2026-09-08より前）のexchangeBtnと同じ見た目
  // （brandPrimary背景・白文字・角丸）。独立したPressableではなく装飾として置く。
  exchangeLabel: {
    marginTop: theme.spacing.s2,
    backgroundColor: theme.colors.brandPrimary,
    borderRadius: theme.radius.childXl,
    paddingHorizontal: theme.spacing.s4,
    paddingVertical: theme.spacing.s2,
    alignItems: "center",
    justifyContent: "center",
  },
  exchangeLabelText: { color: "#FFFFFF", fontWeight: "700" },
  notEnoughBox: {
    marginTop: theme.spacing.s2,
    backgroundColor: theme.colors.statusPendingSoft,
    borderRadius: theme.radius.childXl,
    paddingHorizontal: theme.spacing.s4,
    paddingVertical: theme.spacing.s2,
  },
  notEnoughText: { color: theme.colors.statusPending, fontWeight: "700" },
});
