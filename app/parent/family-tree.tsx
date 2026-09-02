import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { ErrorState, SkeletonList } from "@/components/StatusViews";
import { TreeStageVisual, FamilyTreeBreakdownList, FamilyTreeWeeklyList, buildFamilyTreeWeeklyItems } from "@/components/FamilyTree";
import ScreenBackLink from "@/components/ScreenBackLink";
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
  const { loadState, season, breakdown, dots, weeklyCounts, lastSeason, reload } = useFamilyTreeDetail();
  const [showBreakdown, setShowBreakdown] = useState(false);

  const stage = season?.current_stage ?? 0;
  const count = season?.completion_count ?? 0;
  const next = theme.treeStages[stage + 1];
  const remaining = next ? next.threshold - count : null;

  // [2026-09-02追加] 週ごとの記録（要件定義書07-9章新設節、20.0節決定8・9、20.1a節）。
  // 常時表示・折りたたみなし。「内訳を見る」アコーディオンより手前に置く（決定8）。
  const weeklyItems = season
    ? buildFamilyTreeWeeklyItems({
        weeklyCounts,
        seasonStart: season.season_start,
        seasonEnd: season.season_end,
        isChild: false,
        useRelativeLabels: true,
      })
    : [];

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/home")} />
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

          {weeklyItems.length > 0 && (
            <View style={{ width: "100%", marginTop: theme.spacing.s4 }}>
              <Text style={[theme.typography.parentBodyMedium, { marginBottom: theme.spacing.s2 }]}>
                週ごとのきろく
              </Text>
              <FamilyTreeWeeklyList items={weeklyItems} countLabel="回" />
            </View>
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
          {/* [2026-09-02追加・本部長] 主要画面ワイヤーフレーム.md 20章（2026-08-25追記）が
              定めていた「→ コレクター棚で見る」導線が未実装だった（2026-09-01の文書照合で
              発見、統括決定で実装。実装メモ110章）。過去の木を見る唯一の入口案内。 */}
          {lastSeason && (
            <Pressable onPress={() => router.push("/parent/collector-shelf")} hitSlop={8}>
              <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1, color: theme.colors.brandPrimaryStrong }]}>
                → コレクター棚で見る
              </Text>
            </Pressable>
          )}
        </Card>
      )}

      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/parent/home")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center" },
  linkText: { color: theme.colors.brandPrimaryStrong },
});
