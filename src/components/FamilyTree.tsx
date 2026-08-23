import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import theme from "@/theme/theme";
import type { FamilyTreeCompletionDot } from "@/data/api";
import type { FamilyTreeMemberBreakdown } from "@/types/domain";
import MemberAvatar from "./MemberAvatar";

/**
 * 家族の木の共通ビジュアル（P26/C20/S14の3画面から共有）。
 * 参照: 主要画面ワイヤーフレーム.md 20章、デザイントークン.md 1.8節。
 *
 * 決定1: 木の共有部分（土・幹・枝）は個人色に一切染めない（固定色）。
 * 決定2: 完了報告1件ごとの視覚要素は絵文字自体の着色ではなく、avatar_colorで
 *   塗った小さな色丸として表現する。
 * 決定3・4: 表示上限40スロット。上限到達後は新しい完了報告のたびに、
 *   完了報告のIDをシードにした決定論的な計算で既存スロットを置き換える
 *   （reservoir sampling。クライアント側の乱数は使わない）。
 */

const MAX_SLOTS = 40;

/** 文字列から決定論的な非負整数ハッシュを作る（FNV-1a風の簡易実装）。 */
function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 決定3・4のreservoir sampling実装。dotsは`reported_at`昇順であることを前提とする
 * （src/data/api.ts fetchFamilyTreeCompletionDots がその順で返す）。
 */
export function pickDisplaySlots(dots: FamilyTreeCompletionDot[]): (FamilyTreeCompletionDot | null)[] {
  const slots: (FamilyTreeCompletionDot | null)[] = Array.from({ length: MAX_SLOTS }, () => null);
  dots.forEach((dot, i) => {
    if (i < MAX_SLOTS) {
      slots[i] = dot;
      return;
    }
    const j = stableHash(dot.id) % (i + 1);
    if (j < MAX_SLOTS) slots[j] = dot;
  });
  return slots;
}

export function TreeStageVisual({ stage, dots }: { stage: number; dots: FamilyTreeCompletionDot[] }) {
  const slots = useMemo(() => pickDisplaySlots(dots).filter((d): d is FamilyTreeCompletionDot => d !== null), [dots]);
  const emoji = theme.treeStages[stage]?.emoji ?? theme.treeStages[0].emoji;
  return (
    <View style={styles.treeWrap}>
      <View style={[styles.foliage, { backgroundColor: stage >= 2 ? theme.treeColors.foliageBase : "transparent" }]}>
        <Text style={styles.treeEmoji}>{emoji}</Text>
      </View>
      <View style={styles.dotsWrap}>
        {slots.map((dot) => (
          <View key={dot.id} style={[styles.dot, { backgroundColor: dot.avatar_color ?? theme.colors.neutralBorder }]} />
        ))}
      </View>
      <View style={[styles.trunk, { backgroundColor: theme.treeColors.trunk }]} />
      <View style={[styles.soil, { backgroundColor: theme.treeColors.soil }]} />
    </View>
  );
}

/**
 * 詳細内訳（タップ表示）。07-10章必須3条件:
 * ①ソートしない（呼び出し元がmember_created_at昇順で渡す前提。本コンポーネントは
 *   受け取った配列の順序をそのまま表示するのみで、内部で再ソートしない）
 * ②勝者演出を入れない（強調枠・ハイライト・1位ラベル等を一切描画しない）
 * ③比較誘発コピーを使わない（呼び出し元の見出し文言側で担保）
 */
export function FamilyTreeBreakdownList({
  breakdown,
  countLabel = "回",
}: {
  breakdown: FamilyTreeMemberBreakdown[];
  countLabel?: string;
}) {
  return (
    <View style={{ gap: theme.spacing.s2 }}>
      {breakdown.map((row) => (
        <View key={row.member_id} style={styles.breakdownRow}>
          <MemberAvatar name={row.display_name} color={row.avatar_color} size={28} />
          <Text style={[theme.typography.parentBody, styles.breakdownName]}>{row.display_name}</Text>
          <Text style={theme.typography.parentBodyMedium}>
            {row.completion_count}
            {countLabel}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  treeWrap: { alignItems: "center", paddingVertical: theme.spacing.s4 },
  foliage: {
    width: 120,
    height: 90,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  treeEmoji: { fontSize: 56 },
  dotsWrap: {
    position: "absolute",
    top: 6,
    width: 140,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  trunk: { width: 10, height: 22, marginTop: -4 },
  soil: { width: 90, height: 10, borderRadius: 6, marginTop: 2 },
  breakdownRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  breakdownName: { flex: 1 },
});

export default TreeStageVisual;
