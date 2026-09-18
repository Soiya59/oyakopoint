/**
 * じぶんタブの台紙カード（要件定義書07-28章、主要画面ワイヤーフレーム.md 49.4章）。
 * 新しい画面・新しいタブは作らず、保護者・みまもりメンバー・子どものそれぞれの
 * 既存「じぶん」タブ入口に1枚追加するカード（決定9）。
 *
 * 台紙が2枚以上ある場合は横スクロールで切り替える（決定10）。1枚の中身は
 * 「種類の見出し」「段階の目盛り（銅・銀・金・クリスタル）」「いまの10マス」
 * 「数字（累計/次の段階・あと何件）」の4要素で構成する（決定11のハイブリッド案）。
 *
 * [2026-09-18改訂・49.4節決定33、開発部/成果物/実装メモ.md 247章] 決定9が定めた
 * 「対象クエストを1件も持たないメンバーには、このカード自体を表示しない」は撤回され、
 * **見出し＋案内1行だけを常に出す**形に変わった（統括指摘「シール台帳を作成して
 * いないときでも見出しはあってもよいかもね」）。進捗のマス目・段階の目盛りは
 * 0件のときは出さない。タップしても何も起きない（新しい導線は追加しない、
 * 49.4節決定33の「タップ時の挙動」）ため、0件時はPressableで包まない。
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import { ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";
import type { HabitCardWithProgress } from "@/hooks/useHabitCards";
import { computeHabitCardTierInfo } from "@/hooks/useHabitCards";
import { computeCurrentPageFilledCells, formatHabitCardProgressText, getHabitCardKindInfo } from "@/lib/habitCardDisplay";
import type { Chore, HabitFigureCatalogItem } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";

const TIER_LABEL: Record<"bronze" | "silver" | "gold" | "crystal", { child: string; adult: string }> = {
  bronze: { child: "どう", adult: "銅" },
  silver: { child: "ぎん", adult: "銀" },
  gold: { child: "きん", adult: "金" },
  crystal: { child: "クリスタル", adult: "クリスタル" },
};

export interface HabitCardStripProps {
  tone: Tone;
  /**
   * [2026-09-18追加・やること.md 4件目、開発部/成果物/実装メモ.md 246章]
   * `useHabitCardsForMember`自身の読み込み状態。**必須にした**（既定値を
   * 付けて省略可能にすると、呼び出し元が付け忘れたまま気づかず動いてしまう
   * ため）。理由は`cards.length === 0`直下のコメント参照。
   */
  loadState: LoadState;
  cards: HabitCardWithProgress[];
  chores: Chore[];
  catalog: HabitFigureCatalogItem[];
  onPressCard: (card: HabitCardWithProgress) => void;
  /**
   * [2026-09-18追加] `loadState === "error"`のときの再読み込み導線。
   * `useHabitCardsForMember`が返す`reload`をそのまま渡す想定。
   */
  onRetry: () => void;
}

/** 決定11-A「段階の目盛り」。銅(10)・銀(30)・金(50)・クリスタル(100)の4点を横一列に置く。 */
function TierGauge({ tone, count }: { tone: Tone; count: number }) {
  const { currentTier } = computeHabitCardTierInfo(count);
  const isChild = tone === "child";
  const order: ("bronze" | "silver" | "gold" | "crystal")[] = ["bronze", "silver", "gold", "crystal"];
  return (
    <View style={styles.gaugeRow}>
      {order.map((tier) => {
        const reached =
          currentTier != null &&
          order.indexOf(tier) <= order.indexOf(currentTier);
        return (
          <Text key={tier} style={[styles.gaugeItem, reached && styles.gaugeItemReached]}>
            {isChild ? TIER_LABEL[tier].child : TIER_LABEL[tier].adult}
          </Text>
        );
      })}
    </View>
  );
}

/** 決定11-B「いまの10マス」。5×2のマス目で表示する。 */
function TenCellsGrid({ filled }: { filled: number }) {
  const cells = Array.from({ length: 10 }, (_, i) => i < filled);
  return (
    <View style={styles.cellsWrap}>
      {cells.map((isFilled, i) => (
        <Text key={i} style={styles.cell}>
          {isFilled ? "⬤" : "◯"}
        </Text>
      ))}
    </View>
  );
}

function OneHabitCard({ tone, entry, chores, catalog }: { tone: Tone; entry: HabitCardWithProgress; chores: Chore[]; catalog: HabitFigureCatalogItem[] }) {
  const isChild = tone === "child";
  const bodyStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  const captionStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;
  const chore = chores.find((c) => c.id === entry.card.chore_id);
  const kindInfo = getHabitCardKindInfo(chore, catalog);
  const filled = computeCurrentPageFilledCells(entry.count);
  const progressText = formatHabitCardProgressText(entry.count, (tier) => (isChild ? TIER_LABEL[tier].child : TIER_LABEL[tier].adult));

  return (
    <View style={styles.cardInner}>
      <Text style={bodyStyle}>
        {kindInfo.kindEmoji ?? "🏳️"} {kindInfo.kindDisplayName}
      </Text>
      <TierGauge tone={tone} count={entry.count} />
      <TenCellsGrid filled={filled} />
      <Text style={[captionStyle, { marginTop: theme.spacing.s1 }]}>{progressText}</Text>
    </View>
  );
}

export function HabitCardStrip({ tone, loadState, cards, chores, catalog, onPressCard, onRetry }: HabitCardStripProps) {
  const isChild = tone === "child";

  /**
   * [2026-09-18修正・本部長差し戻し・やること.md 4件目「台紙が画面から消える」]
   * 従来は`cards.length === 0`の1行だけで「対象クエストが無い」を判定していたが、
   * これは「まだ読み込み中で0件」「読み込みに失敗して0件のまま」「本当に0件」の
   * 3つを区別できていなかった。`useHabitCardsForMember`は失敗時に`activeCards`を
   * 空配列のまま据え置く（`src/hooks/useHabitCards.ts`のload()参照。エラー時に
   * 配列を上書きするコードは無い）ため、症状としては「エラーメッセージすら出ず、
   * 台紙のカードだけが画面から静かに消える」という形になっていた。
   *
   * [根拠] 統括が実機（Android build 9）で「台紙型クエストで2回目の『できた』が
   * 上限で止められたあと、台紙が画面から消えた」と報告。ローカルDBで同じ手順
   * （同日2回目のINSERTを`chore_completions_before_insert`トリガーで拒否）を再現し、
   * `habit_cards`行はrejectされた2回目のあとも無傷で残ることを確認済み
   * （実装メモ246章）。つまりDBデータは失われておらず、この画面側の分岐だけが
   * 原因だった。`app/child/(tabs)/self.tsx`・`app/parent/(tabs)/self.tsx`・
   * `app/supporter/(tabs)/self.tsx`はいずれも本コンポーネントの前段（タブの
   * 再マウント等）で`useHabitCardsForMember`を再実行する経路を持つため、
   * 一時的な読み込み中・通信エラーが「カード消失」に見えてしまっていた。
   *
   * `HabitCardBoard.tsx`（台紙専用画面・子ども向けモーダルの中身）は元から
   * `loadState`を見て読み込み中・エラーを描き分けていた（114〜117行目）ため、
   * 本コンポーネントもそれと同じ分岐に揃える。
   */
  if (loadState === "loading") return <SkeletonList count={1} />;
  if (loadState === "error") {
    return (
      <ErrorState
        tone={isChild ? "child" : "parent"}
        title={isChild ? "つうしんがおやすみ中みたい" : "台紙の読み込みに失敗しました"}
        onRetry={onRetry}
      />
    );
  }
  const headingStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBodyMedium : theme.typography.parentBodyMedium;

  // [2026-09-18追加・49.4節決定33、実装メモ.md 247章] 台紙対象クエストを1件も
  // 持たないメンバーにも、見出し＋案内1行だけは常に出す。進捗のマス目・段階の
  // 目盛りは出さない。タップしても何も起きないため、Card自体をPressableで
  // 包まない（新しい導線は追加しない、決定33「タップ時の挙動」）。
  if (cards.length === 0) {
    const captionStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;
    return (
      <View style={{ marginTop: theme.spacing.s3 }}>
        <Text style={[headingStyle, styles.heading]}>📔 台紙</Text>
        <Card tone={tone} style={styles.singleCard}>
          <Text style={captionStyle}>
            {isChild ? "クエストを 台紙に すると、ここに たまるよ" : "クエストを『台紙』にすると、ここに貯まっていきます"}
          </Text>
        </Card>
      </View>
    );
  }

  return (
    <View style={{ marginTop: theme.spacing.s3 }}>
      <Text style={[headingStyle, styles.heading]}>📔 台紙</Text>
      {cards.length === 1 ? (
        <Pressable onPress={() => onPressCard(cards[0])}>
          <Card tone={tone} style={styles.singleCard}>
            <OneHabitCard tone={tone} entry={cards[0]} chores={chores} catalog={catalog} />
          </Card>
        </Pressable>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
          {cards.map((entry) => (
            <Pressable key={entry.card.id} onPress={() => onPressCard(entry)}>
              <Card tone={tone} style={styles.scrollCard}>
                <OneHabitCard tone={tone} entry={entry} chores={chores} catalog={catalog} />
              </Card>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: theme.spacing.s2, color: theme.colors.brandPrimaryStrong },
  singleCard: { width: "100%" },
  scroll: { flexDirection: "row" },
  scrollCard: { width: 260, marginRight: theme.spacing.s3 },
  cardInner: { gap: theme.spacing.s1 },
  gaugeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: theme.spacing.s1 },
  gaugeItem: { fontSize: 11, color: theme.colors.neutralTextSecondary },
  gaugeItemReached: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  cellsWrap: { flexDirection: "row", flexWrap: "wrap", width: 110, marginTop: theme.spacing.s1 },
  cell: { fontSize: 16, width: 22 },
});

export default HabitCardStrip;
