import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { ErrorState, SkeletonList } from "@/components/StatusViews";
import { TreeStageVisual, FamilyTreeBreakdownList, FamilyTreeWeeklyList, buildFamilyTreeWeeklyItems } from "@/components/FamilyTree";
import ScreenBackLink from "@/components/ScreenBackLink";
import TabIntroBubble from "@/components/TabIntroBubble";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
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
  const { state } = useAppData();
  const { loadState, season, breakdown, dots, stickerPlacements, weeklyCounts, lastSeason, reload } = useFamilyTreeDetail();
  const [showBreakdown, setShowBreakdown] = useState(false);

  const stage = season?.current_stage ?? 0;
  const count = season?.completion_count ?? 0;

  // [2026-09-02追加] 週ごとの記録。P26/C20と同じデータ・同じ配置ルール（20.0節決定8・9）。
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
    <Screen tone="supporter">
      <ScreenBackLink tone="supporter" onPress={() => router.replace("/supporter/family")} />
      <Text style={theme.typography.supporterTitle}>家族の木</Text>
      {/* [2026-09-18追加・主要画面ワイヤーフレーム.md 50.2.1節決定17、実装メモ.md 247章。
          #3と同一文言（#7）。共通ヘッダー部品が無いため、タイトル直下・他のどの
          要素よりも上に置く（決定6）。 */}
      <TabIntroBubble
        tabKey="supporter.tree"
        tone="supporter"
        memberId={state.activeParentMemberId}
        text="👋 クエストをがんばるたびに育つ、家族みんなの木です。ガチャで当たった飾りやメダルは、タップすると大きく見られます。"
      />
      {/* [2026-09-16追加・主要画面ワイヤーフレーム.md 45.7.6a節、実装メモ.md 227章]
          保護者側（app/parent/family-tree.tsx）と同一文言を流用する。 */}
      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        クエストの完了報告が積み重なるたびに、少しずつ育っていく、家族みんなの木です。
      </Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={2} />
        </View>
      )}
      {loadState === "error" && <ErrorState title="読み込みに失敗しました" onRetry={reload} />}

      {loadState === "ready" && (
        <Card tone="supporter" style={{ marginTop: theme.spacing.s4, alignItems: "center" }}>
          {/* [2026-09-17追加・主要画面ワイヤーフレーム.md 46.5節 決定10] 「見る」画面
              （S14）でのみ、景品・ステッカーのタップ拡大表示を有効化する。 */}
          <TreeStageVisual
            stage={stage}
            dots={dots}
            stickerPlacements={stickerPlacements}
            enableTapExpand
            tone="supporter"
          />
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

          {weeklyItems.length > 0 && (
            <View style={{ width: "100%", marginTop: theme.spacing.s4 }}>
              <Text style={[theme.typography.supporterBodyMedium, { marginBottom: theme.spacing.s2 }]}>
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
          {/* [2026-09-02追加・本部長] P26と同じ導線を3ロールに（実装メモ110章）。 */}
          {lastSeason && (
            <Pressable onPress={() => router.push("/supporter/collector-shelf")} hitSlop={8}>
              <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.brandPrimaryStrong }]}>
                → コレクションで見る
              </Text>
            </Pressable>
          )}
        </Card>
      )}

      <AppButton label="ホームへ戻る" tone="supporter" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/supporter/family")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  linkText: { color: theme.colors.supporterAccent },
});
