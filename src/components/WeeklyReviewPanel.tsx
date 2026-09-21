/**
 * 「先週のふりかえり」の中身（要件定義書07-35章「振り返る機会」、主要画面
 * ワイヤーフレーム.md 60章 決定6〜9）。P43（保護者）・S29（みまもりメンバー）・
 * 子どもの軽量モーダル（60.4節）が共通して使う。
 *
 * [決定6「1画面にまとめる」] タブ・アコーディオンによる出し分けはせず、
 * 上から順に4項目を並べる。
 * [決定9「該当データが無いものは項目ごと非表示」] 項目4（シール帳完成）は
 * 該当が無い週は表示しない。項目1・2・3は0件であっても通常表示のまま出す
 * （欠落として隠さない）。
 * [必須3条件（07-9章・07-10章）] 増減の矢印・色分け・順位表示・メンバー別
 * 比較は一切使わない（60.5節）。
 *
 * [文言について] カードの具体的な文言はUIUXデザイン部の判断に委ねられている
 * （要件定義書07-35章7節）。本コンポーネントの文言は開発部の仮置きであり、
 * 本部長の画面確認を経て調整の余地がある（開発部/成果物/実装メモ.md参照）。
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import { ErrorState, SkeletonList } from "./StatusViews";
import { getHabitCardKindInfo, summarizeHabitCardBreakdown, computeHabitCardDurationDays } from "@/lib/habitCardDisplay";
import theme, { treeStageEmoji, treeStageName } from "@/theme/theme";
import { toJstDateString } from "@/lib/calendarDates";
import type { WeeklyReviewData, WeeklyReviewLoadState } from "@/hooks/useWeeklyReview";
import type { Chore, HabitFigureCatalogItem } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

const TIER_LABEL_ADULT: Record<string, string> = { bronze: "銅", silver: "銀", gold: "金", crystal: "クリスタル" };
const TIER_LABEL_CHILD: Record<string, string> = { bronze: "どう", silver: "ぎん", gold: "きん", crystal: "クリスタル" };

function bodyStyleFor(tone: Tone) {
  return tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
}
function bodyMediumStyleFor(tone: Tone) {
  return tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBodyMedium : theme.typography.parentBodyMedium;
}
function captionStyleFor(tone: Tone) {
  return tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;
}

export interface WeeklyReviewPanelProps {
  tone: Tone;
  loadState: WeeklyReviewLoadState;
  data: WeeklyReviewData | null;
  chores: Chore[];
  habitFigureCatalog: HabitFigureCatalogItem[];
  onRetry: () => void;
}

export function WeeklyReviewPanel({ tone, loadState, data, chores, habitFigureCatalog, onRetry }: WeeklyReviewPanelProps) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const countLabel = isChild ? "かい" : "回";

  if (loadState === "loading") return <SkeletonList count={4} />;
  if (loadState === "error") {
    return (
      <ErrorState
        tone={isChild ? "child" : "parent"}
        title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"}
        onRetry={onRetry}
      />
    );
  }
  if (!data) return null;

  const stageName = data.treeStageIndex != null ? treeStageName(data.treeStageIndex) : null;
  const stageEmoji = data.treeStageIndex != null ? treeStageEmoji(data.treeStageIndex) : null;
  const tierLabel = isChild ? TIER_LABEL_CHILD : TIER_LABEL_ADULT;

  return (
    <View style={{ gap: theme.spacing.s4 }}>
      {/* 項目1: 先週の家族全体の完了報告数（07-35章4節、20.1a節の既存表現を流用）。 */}
      <Card tone={tone}>
        <Text style={bodyStyle}>
          {isChild
            ? `かぞくみんなで ${data.familyCompletionCount}かい、かんりょうほうこくが あったよ`
            : `家族みんなで ${data.familyCompletionCount}回、完了報告がありました`}
        </Text>
      </Card>

      {/* 項目2: 先週時点の家族の木の段階（既存の段階名・絵文字表現をそのまま転記）。 */}
      <Card tone={tone}>
        <Text style={bodyStyle}>
          {stageName == null
            ? isChild
              ? "かぞくの きの ようすは まだ わからないよ"
              : "家族の木の様子はまだわかりません"
            : isChild
            ? `かぞくの きは「${stageName}」だったよ ${stageEmoji ?? ""}`
            : `家族の木は「${stageName}」でした ${stageEmoji ?? ""}`}
        </Text>
      </Card>

      {/* 項目3: その週によく行われたクエストの上位（決定7: 上位5件＋ほか◯件）。 */}
      <Card tone={tone}>
        <Text style={bodyMediumStyle}>{isChild ? "よく やった クエスト" : "よく行われたクエスト"}</Text>
        {data.topChores.top.length === 0 ? (
          <Text style={[captionStyle, { marginTop: theme.spacing.s2 }]}>
            {isChild ? "せんしゅうは きろくが なかったよ" : "先週は記録がありませんでした"}
          </Text>
        ) : (
          <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s1 }}>
            {data.topChores.top.map((entry) => {
              const chore = chores.find((c) => c.id === entry.choreId);
              return (
                <View key={entry.choreId} style={styles.row}>
                  <Text style={bodyStyle} numberOfLines={1}>
                    {chore?.emoji ?? "📝"} {chore?.title ?? (isChild ? "けされたクエスト" : "削除されたクエスト")}
                  </Text>
                  <Text style={captionStyle}>
                    {entry.count}
                    {countLabel}
                  </Text>
                </View>
              );
            })}
            {data.topChores.otherCount > 0 && (
              <Text style={captionStyle}>
                {isChild ? `ほか${data.topChores.otherCount}けん` : `ほか${data.topChores.otherCount}件`}
              </Text>
            )}
          </View>
        )}
      </Card>

      {/* 項目4: その週にシール帳が1冊完成した場合のみ表示（決定9）。 */}
      {data.completedHabitCards.map((card) => {
        const kindInfo = getHabitCardKindInfo(card, habitFigureCatalog, isChild);
        const cardBreakdown = data.completedHabitCardBreakdown.filter((b) => b.habit_card_id === card.id);
        const summary = summarizeHabitCardBreakdown(cardBreakdown, chores, 5);
        const days = computeHabitCardDurationDays(card.started_at, card.completed_at);
        const period = `${toJstDateString(card.started_at).replace(/-/g, "/")}〜${
          card.completed_at ? toJstDateString(card.completed_at).replace(/-/g, "/") : ""
        }（${days}${isChild ? "にちかん" : "日間"}）`;
        return (
          <Card key={card.id} tone={tone}>
            <Text style={bodyMediumStyle}>
              {isChild ? "シールちょうが できあがったよ" : "シール帳が1冊できあがりました"}
            </Text>
            <Text style={[bodyStyle, { marginTop: theme.spacing.s2 }]} numberOfLines={1}>
              {kindInfo.kindEmoji ?? "🏳️"} {kindInfo.kindDisplayName}（{tierLabel.crystal}）
            </Text>
            <Text style={[captionStyle, { marginTop: theme.spacing.s1 }]}>{period}</Text>
            <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s1 }}>
              {summary.top.map((entry) => (
                <View key={entry.choreId ?? entry.title} style={styles.row}>
                  <Text style={bodyStyle} numberOfLines={1}>
                    {entry.emoji ?? "📝"} {entry.title}
                  </Text>
                  <Text style={captionStyle}>
                    {entry.count}
                    {countLabel}
                  </Text>
                </View>
              ))}
              {summary.otherCount > 0 && (
                <Text style={captionStyle}>{isChild ? `ほか${summary.otherCount}けん` : `ほか${summary.otherCount}件`}</Text>
              )}
            </View>
          </Card>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});

export default WeeklyReviewPanel;
