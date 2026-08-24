import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { ErrorState, SkeletonList } from "@/components/StatusViews";
import { TreeStageVisual, FamilyTreeBreakdownList } from "@/components/FamilyTree";
import theme from "@/theme/theme";
import { useFamilyTreeDetail } from "@/hooks/useFamilyTree";

/**
 * P26 家族の木（保護者ビュー・内訳）
 * 参照: 画面一覧・遷移図.md P26、主要画面ワイヤーフレーム.md 20.3章
 *
 * 07-9章「家族の木」・07-10章「色分けによる個人の可視化」に対応する。
 * 必須3条件（07-10章）: ソート・並び替え機能を持たせない、勝者演出を入れない、
 * 「家族みんなで」を基本の主語にしてきょうだい比較を誘発しない。
 * 内訳は`useFamilyTreeDetail`が返す配列の順序（member_created_at昇順）を
 * そのまま表示し、本画面側では一切ソートしない。
 */
export default function ParentFamilyTreeScreen() {
  const { loadState, season, breakdown, dots, lastSeason, reload } = useFamilyTreeDetail();
  const [showBreakdown, setShowBreakdown] = useState(false);

  const stage = season?.current_stage ?? 0;
  const count = season?.completion_count ?? 0;
  const next = theme.treeStages[stage + 1];
  const remaining = next ? next.threshold - count : null;

  return (
    <Screen tone="parent">
      <View style={styles.headerRow}>
        <Text style={theme.typography.parentTitle}>家族の木</Text>
        <Text style={{ flex: 1 }} />
        <Text style={theme.typography.parentCaption}>
          {new Date().toLocaleDateString("ja-JP", { month: "long" })}
        </Text>
      </View>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={2} />
        </View>
      )}
      {loadState === "error" && <ErrorState title="読み込みに失敗しました" onRetry={reload} />}

      {loadState === "ready" && (
        <Card style={{ marginTop: theme.spacing.s4, alignItems: "center" }}>
          <TreeStageVisual stage={stage} dots={dots} />
          {/* [2026-08-24改訂] 木の絵そのものをViewで描くようにしたため、段階の絵文字は
              木の代わりではなく段階名テキストに添える役割へ移した（FamilyTree.tsx参照）。 */}
          <Text style={theme.typography.parentBodyMedium}>
            いま「{theme.treeStages[stage].name}」です {theme.treeStages[stage].emoji}
          </Text>
          <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s1 }]}>
            今シーズン {count}回のきろく
          </Text>
          {remaining !== null && (
            <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1 }]}>
              つぎの「{next!.name}」まで あと{remaining}回
            </Text>
          )}

          <Pressable onPress={() => setShowBreakdown((v) => !v)} style={{ marginTop: theme.spacing.s3 }}>
            <Text style={styles.linkText}>内訳を見る {showBreakdown ? "▲" : "▼"}</Text>
          </Pressable>

          {showBreakdown && (
            <View style={{ width: "100%", marginTop: theme.spacing.s3 }}>
              <Text style={[theme.typography.parentBodyMedium, { marginBottom: theme.spacing.s2 }]}>
                今シーズン、みんなのきろく
              </Text>
              <FamilyTreeBreakdownList breakdown={breakdown} />
              <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
                登録した順に並んでいます
              </Text>
            </View>
          )}

          {lastSeason && (
            <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s4 }]}>
              先月の木：{theme.treeStages[lastSeason.current_stage].name} {theme.treeStages[lastSeason.current_stage].emoji}
            </Text>
          )}
        </Card>
      )}

      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center" },
  linkText: { color: theme.colors.brandPrimaryStrong },
});
