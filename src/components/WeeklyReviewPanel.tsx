/**
 * 「先週のふりかえり」の中身（要件定義書07-35章「振り返る機会」、主要画面
 * ワイヤーフレーム.md 60章 決定6〜9・60.4a節決定10〜15）。P43（保護者）・
 * S29（みまもりメンバー）・子どもの軽量モーダル（60.4節）が共通して使う。
 *
 * [2026-09-22改訂・実装メモ278章] 統括判断「回数は自分のもの、家族のことは
 * 木の段階だけ」（60.4a節）により、項目構成・並び順を作り直した。
 * - 旧項目「家族みんなで◯回」は廃止（07-9章「週ごとの記録」と二重だったため）。
 * - 「あなたは先週◯回」（自分の週間完了報告数、0回なら項目自体を出さない）を新設。
 * - 「よく行われたクエスト」の主語を家族全体から自分自身に変更（見出しも変更）。
 * - 並び順は「①あなたは先週◯回 → ②あなたがよく行ったクエスト →
 *   ③シール帳完成の内訳（あれば） → ④家族の木の段階」（決定13）。
 * [決定6「1画面にまとめる」] タブ・アコーディオンによる出し分けはせず、
 * 上から順に項目を並べる。
 * [決定9・60.4a節決定11・12「該当データが無いものは項目ごと非表示」]
 * 項目①②③は0件・完成なしのとき、その項目自体を出さない（欠落を強調する
 * 文言は追加しない、決定15）。項目④（家族の木の段階）には0件に相当する状態が
 * 無いため常に表示する。①②③のいずれも無い週（先週の記録が何も無い週）は、
 * 項目④だけを表示する（決定15。「今週は記録がありませんでした」のような
 * 不在を強調する文言は追加しない）。
 * [必須3条件（07-9章・07-10章）] 増減の矢印・色分け・順位表示・メンバー別
 * 比較は一切使わない（60.5節。自分の数字を自分だけが見る表示は比較に当たらない）。
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
      {/* 項目1: あなたは先週◯回（60.4a節決定11）。0回の週は項目自体を出さない
          （既存の「シール帳が完成しなかった週は本項目自体を出さない」と同じ扱い）。 */}
      {data.yourWeeklyTotal > 0 && (
        <Card tone={tone}>
          <Text style={bodyStyle}>
            {isChild
              ? `せんしゅう ${data.yourWeeklyTotal}かい やったよ`
              : `あなたは先週${data.yourWeeklyTotal}回、完了報告をしました`}
          </Text>
        </Card>
      )}

      {/* 項目2: あなたがよく行ったクエスト（60.4a節決定12、主語を家族全体から
          自分自身に変更）。0件（先週、自分の完了報告が1件も無い）のときは
          項目自体を出さない。自分が1回もやっていないクエストは候補に含まれない
          （元データ自体が実施回数1件以上の行のみのため）。 */}
      {data.topChores.top.length > 0 && (
        <Card tone={tone}>
          <Text style={bodyMediumStyle}>{isChild ? "じぶんが よく やった クエスト" : "あなたがよく行ったクエスト"}</Text>
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
        </Card>
      )}

      {/* 項目3: その週にシール帳が1冊完成した場合のみ表示（決定9(c)、無改訂）。 */}
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

      {/* 項目4: 家族の木の段階（60.4a節決定13により最後に配置。中身は無改訂）。
          決定15: 項目1〜3がすべて非該当（先週の記録が何も無い週）でも、この
          項目だけは常に表示する。欠落を説明する文言は追加しない。 */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});

export default WeeklyReviewPanel;
