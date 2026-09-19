/**
 * 段階到達時の自動付与演出（要件定義書07-28章決定9・10、主要画面ワイヤーフレーム.md
 * 49.8章決定24〜26）。既存の完了報告成功演出に続けて表示する追加の一言。
 * 新しい全画面演出・新しい選択モーダルは作らない（決定24・25）。
 *
 * 「木に飾る→」「あとで（コレクションで見る）」の2択を置き、34章「メダル購入結果
 * ビュー」と同じ構成・遷移を流用する（決定26）。
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import theme from "@/theme/theme";
import { resolveChildFriendlyKindDisplayName } from "@/lib/habitCardDisplay";
import type { HabitFigureGrantWithCatalog } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

const TIER_LABEL: Record<string, { child: string; adult: string }> = {
  bronze: { child: "どう", adult: "銅" },
  silver: { child: "ぎん", adult: "銀" },
  gold: { child: "きん", adult: "金" },
  crystal: { child: "クリスタル", adult: "クリスタル" },
};

export interface HabitFigureGrantBannerProps {
  tone: Tone;
  grant: HabitFigureGrantWithCatalog;
  onPlaceOnTree: () => void;
  onLater: () => void;
}

export function HabitFigureGrantBanner({ tone, grant, onPlaceOnTree, onLater }: HabitFigureGrantBannerProps) {
  const isChild = tone === "child";
  const headlineStyle = isChild ? theme.typography.childHeadline : tone === "supporter" ? theme.typography.supporterBodyMedium : theme.typography.parentBodyMedium;
  const bodyStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  // [2026-09-20改訂・主要画面ワイヤーフレーム.md 49-B.15章決定71] 子ども向けは
  // ひらがな表記（kind_display_name_child、NULLなら漢字にフォールバック）。
  const kindName = grant.habit_figure_catalog
    ? isChild
      ? resolveChildFriendlyKindDisplayName(grant.habit_figure_catalog.kind_display_name, grant.habit_figure_catalog.kind_display_name_child)
      : grant.habit_figure_catalog.kind_display_name
    : "シール帳";
  const kindEmoji = grant.habit_figure_catalog?.kind_emoji ?? "🏳️";
  const tierLabel = (isChild ? TIER_LABEL[grant.tier]?.child : TIER_LABEL[grant.tier]?.adult) ?? grant.tier;

  return (
    <View style={styles.wrap}>
      <Text style={[headlineStyle, styles.centerText]}>
        {isChild ? `🎉 ${kindEmoji} ${kindName}が${tierLabel}に なったよ！` : `${kindEmoji} ${kindName}が${tierLabel}の段階になりました`}
      </Text>
      <Text style={[bodyStyle, styles.centerText, { marginTop: theme.spacing.s1 }]}>
        {isChild ? "フィギュアを もらったよ" : "フィギュアを獲得しました"}
      </Text>
      <View style={styles.buttonRow}>
        <AppButton tone={tone} label={isChild ? "きに かざる →" : "木に飾る →"} onPress={onPlaceOnTree} style={{ flex: 1, marginRight: theme.spacing.s2 }} />
        <AppButton tone={tone} label={isChild ? "あとで" : "あとで"} variant="secondary" onPress={onLater} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.spacing.s4, alignItems: "center" },
  centerText: { textAlign: "center" },
  buttonRow: { flexDirection: "row", marginTop: theme.spacing.s3, width: "100%" },
});

export default HabitFigureGrantBanner;
