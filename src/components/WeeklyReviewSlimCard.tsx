/**
 * 「じぶん」タブの「じぶんのポイント」カードのすぐ下に置く、細い1行の
 * 「先週のふりかえり」カード（要件定義書07-35章「振り返る機会」、本部長依頼
 * 2026-09-29、開発部/成果物/実装メモ.md 321章）。
 *
 * 子ども・保護者・みまもりメンバーの3ロール共通部品（`WeeklyReviewPanel.tsx`と
 * 同じ`tone`分岐の考え方）。カードを出すかどうかの判定
 * （`useWeeklyReviewCardVisible`）・回数の取得（`useWeeklyReview`の
 * `yourWeeklyTotal`）は呼び出し側が行い、本コンポーネントは表示専用。
 *
 * 押した先は呼び出し側が決める（`onPress`）。子どもは軽量モーダル
 * （`ChildWeeklyReviewModal`）、保護者・みまもりメンバーは専用画面
 * （`/parent/weekly-review`・`/supporter/weekly-review`）へ。
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import theme from "@/theme/theme";
import { weeklyReviewCardCountLabel } from "@/lib/weeklyReviewDisplay";

type Tone = "parent" | "child" | "supporter";

function bodyStyleFor(tone: Tone) {
  return tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
}

export interface WeeklyReviewSlimCardProps {
  tone: Tone;
  /** 「あなたは先週◯回」と同じ値（`useWeeklyReview`の`data?.yourWeeklyTotal`）。読み込み中・未取得はnull（0回と同じ表示になる）。 */
  count: number | null;
  onPress: () => void;
}

export function WeeklyReviewSlimCard({ tone, count, onPress }: WeeklyReviewSlimCardProps) {
  const bodyStyle = bodyStyleFor(tone);
  const label = weeklyReviewCardCountLabel(count ?? 0, tone === "child" ? "child" : "adult");
  return (
    <Pressable onPress={onPress}>
      <Card tone={tone} style={styles.card}>
        <View style={styles.row}>
          <Text style={bodyStyle}>📅 {label}</Text>
          <Text style={bodyStyle}>›</Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: theme.spacing.s3 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});

export default WeeklyReviewSlimCard;
