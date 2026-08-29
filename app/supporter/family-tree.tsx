import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { ErrorState, SkeletonList } from "@/components/StatusViews";
import { TreeStageVisual, FamilyTreeBreakdownList } from "@/components/FamilyTree";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { useFamilyTreeDetail } from "@/hooks/useFamilyTree";

/**
 * S14 家族の木（みまもりメンバービュー・内訳）
 * 参照: 画面一覧・遷移図.md S14、主要画面ワイヤーフレーム.md 20.5章
 *
 * P26と同一構成（現在の段階・今シーズンの完了報告数・次の段階までの目安・内訳）だが、
 * 見守り・寄り添うトーンの労いの一言を添える。演出量は保護者向けと同じ控えめさを保つ
 * （デザイントークン.md 1.7節）。内訳の並び順・0件メンバーの扱いはP26/C20と完全に同一。
 */
export default function SupporterFamilyTreeScreen() {
  const { loadState, season, breakdown, dots, lastSeason, reload } = useFamilyTreeDetail();
  const [showBreakdown, setShowBreakdown] = useState(false);

  const stage = season?.current_stage ?? 0;
  const count = season?.completion_count ?? 0;

  return (
    <Screen tone="supporter">
      <ScreenBackLink tone="supporter" onPress={() => router.replace("/supporter/home")} />
      <Text style={theme.typography.supporterTitle}>家族の木</Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={2} />
        </View>
      )}
      {loadState === "error" && <ErrorState title="読み込みに失敗しました" onRetry={reload} />}

      {loadState === "ready" && (
        <Card tone="supporter" style={{ marginTop: theme.spacing.s4, alignItems: "center" }}>
          <TreeStageVisual stage={stage} dots={dots} />
          {/* [2026-08-24改訂] 木の絵そのものをViewで描くようにしたため、段階の絵文字は
              木の代わりではなく段階名テキストに添える役割へ移した（FamilyTree.tsx参照）。 */}
          <Text style={theme.typography.supporterBodyMedium}>
            いま「{theme.treeStages[stage].name}」です。{theme.treeStages[stage].emoji}
          </Text>
          <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s1, textAlign: "center" }]}>
            今シーズンも、みんなで少しずつ育てています
          </Text>
          <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s1 }]}>
            今シーズン {count}回のきろく
          </Text>

          <Pressable onPress={() => setShowBreakdown((v) => !v)} style={{ marginTop: theme.spacing.s3 }}>
            <Text style={styles.linkText}>内訳を見る {showBreakdown ? "▲" : "▼"}</Text>
          </Pressable>

          {showBreakdown && (
            <View style={{ width: "100%", marginTop: theme.spacing.s3 }}>
              <FamilyTreeBreakdownList breakdown={breakdown} />
              <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
                登録した順に並んでいます
              </Text>
            </View>
          )}

          {lastSeason && (
            <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s4 }]}>
              先月の木：{theme.treeStages[lastSeason.current_stage].name} {theme.treeStages[lastSeason.current_stage].emoji}
            </Text>
          )}
        </Card>
      )}

      <AppButton label="ホームへ戻る" tone="supporter" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/supporter/home")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  linkText: { color: theme.colors.supporterAccent },
});
