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
 * C20 かぞくの木（子どもビュー・内訳）
 * 参照: 画面一覧・遷移図.md C20、主要画面ワイヤーフレーム.md 20.4章
 *
 * P26と同じデータ（useFamilyTreeDetail）を、称える・楽しい子ども向けトーンで表示する。
 * 07-10章必須3条件（ソート禁止・勝者演出禁止・比較誘発コピー禁止）はP26と共通。
 */
export default function ChildFamilyTreeScreen() {
  const { loadState, season, breakdown, dots, lastSeason, reload } = useFamilyTreeDetail();
  const [showBreakdown, setShowBreakdown] = useState(false);

  const stage = season?.current_stage ?? 0;
  const count = season?.completion_count ?? 0;
  const next = theme.treeStages[stage + 1];
  const remaining = next ? next.threshold - count : null;

  return (
    <Screen tone="child">
      <Text style={theme.typography.childHeadline}>🌳 かぞくの木</Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={2} />
        </View>
      )}
      {loadState === "error" && (
        <ErrorState tone="child" title="つうしんがおやすみ中みたい" onRetry={reload} />
      )}

      {loadState === "ready" && (
        <Card tone="child" style={{ marginTop: theme.spacing.s4, alignItems: "center" }}>
          <TreeStageVisual stage={stage} dots={dots} />
          {/* [2026-08-24改訂] 木の絵そのものをViewで描くようにしたため、段階の絵文字は
              木の代わりではなく段階名テキストに添える役割へ移した（FamilyTree.tsx参照）。 */}
          <Text style={theme.typography.childBody}>
            いま「{theme.treeStages[stage].name}」だよ！{theme.treeStages[stage].emoji}
          </Text>
          <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s1 }]}>
            みんなで {count}かい がんばったよ
          </Text>
          {remaining !== null && (
            <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s1, color: theme.colors.brandPrimaryStrong }]}>
              もうすこしで「{next!.name}」になるよ{next!.emoji}
            </Text>
          )}

          <Pressable onPress={() => setShowBreakdown((v) => !v)} style={{ marginTop: theme.spacing.s3 }}>
            <Text style={[theme.typography.childBody, styles.linkText]}>
              だれが なんかい がんばったか みる {showBreakdown ? "▲" : "▼"}
            </Text>
          </Pressable>

          {showBreakdown && (
            <View style={{ width: "100%", marginTop: theme.spacing.s3 }}>
              <FamilyTreeBreakdownList breakdown={breakdown} countLabel="かい" />
              <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s3, textAlign: "center", color: theme.colors.neutralTextSecondary }]}>
                とうろくした じゅんに ならんでるよ
              </Text>
            </View>
          )}

          {lastSeason && (
            <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4, color: theme.colors.neutralTextSecondary }]}>
              せんげつの木：{theme.treeStages[lastSeason.current_stage].name} {theme.treeStages[lastSeason.current_stage].emoji}
            </Text>
          )}
        </Card>
      )}

      <AppButton
        label="やることリストへもどる"
        variant="secondary"
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => router.replace("/child/home")}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  linkText: { color: theme.colors.brandPrimaryStrong },
});
