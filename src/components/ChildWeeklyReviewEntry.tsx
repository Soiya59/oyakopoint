/**
 * 保護者・みまもりが子どもの「先週のふりかえり」を見るための入口
 * （本部長依頼2026-09-29・軽微変更ルート・統括承認済み、開発部/成果物/実装メモ.md
 * 325章）。要件定義書07-35章「振り返る機会」・主要画面ワイヤーフレーム.md 60章の
 * 追記。
 *
 * 置き場所は`app/parent/weekly-review.tsx`（P43）・`app/supporter/weekly-review.tsx`
 * （S29）の画面下。「きょうだいを並べない」方針（要件定義書07-3章5節「比較を
 * 煽らない」と同じ考え方）のため、子どもを一覧に並べて比べる表示は作らない。
 * 子どもが1人だけの家族では選ぶ手順自体を省き、押した瞬間にその子の分を出す。
 *
 * 見える中身は子ども自身が見ているふりかえりと完全に同じ項目・同じ数字
 * （`WeeklyReviewPanel`・`useWeeklyReview`を子どものmemberIdで呼ぶだけで、
 * 親だけに見える数字は一切足さない）。文言だけは大人が読んでも不自然でない
 * よう「あなたは」を「◯◯さんは」に差し替える（`WeeklyReviewPanel.tsx`の
 * `subjectName`props、数字・項目は不変）。
 *
 * 入口を出す条件は`useWeeklyReviewCardVisible()`と同じに、「子どもが0人の
 * 家族では出さない」を足したもの。
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import WeeklyReviewPanel from "./WeeklyReviewPanel";
import { useAppData } from "@/data/store";
import { useWeeklyReview, useWeeklyReviewCardVisible } from "@/hooks/useWeeklyReview";
import theme from "@/theme/theme";
import type { Chore, HabitFigureCatalogItem } from "@/types/domain";

type Tone = "parent" | "supporter";

function titleStyleFor(tone: Tone) {
  return tone === "supporter" ? theme.typography.supporterBodyMedium : theme.typography.parentBodyMedium;
}
function bodyStyleFor(tone: Tone) {
  return tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
}

interface ResultProps {
  tone: Tone;
  memberId: string;
  memberName: string;
  chores: Chore[];
  habitFigureCatalog: HabitFigureCatalogItem[];
}

/**
 * 選ばれた子どもぶんだけを取得・表示する（`memberId`を`useWeeklyReview`に渡す）。
 * 入口が押されて子どもが確定するまでこのコンポーネント自体をマウントしないため、
 * 押されるまで通信は発生しない（`load()`の中心バンドルに追加しない方針と同じ、
 * `useWeeklyReview.ts`冒頭コメント参照）。
 */
function ChildWeeklyReviewResult({ tone, memberId, memberName, chores, habitFigureCatalog }: ResultProps) {
  const { loadState, data, reload } = useWeeklyReview(memberId);
  const titleStyle = titleStyleFor(tone);

  return (
    <View style={{ marginTop: theme.spacing.s4 }}>
      <Text style={titleStyle}>{memberName}さんの先週</Text>
      <View style={{ marginTop: theme.spacing.s2 }}>
        <WeeklyReviewPanel
          tone={tone}
          loadState={loadState}
          data={data}
          chores={chores}
          habitFigureCatalog={habitFigureCatalog}
          onRetry={reload}
          subjectName={memberName}
        />
      </View>
    </View>
  );
}

export interface ChildWeeklyReviewEntryProps {
  tone: Tone;
  chores: Chore[];
  habitFigureCatalog: HabitFigureCatalogItem[];
}

export function ChildWeeklyReviewEntry({ tone, chores, habitFigureCatalog }: ChildWeeklyReviewEntryProps) {
  const { state } = useAppData();
  // [決定5と同じ判定を流用] 家族作成から最初の暦週がまだ終わっていない間は、
  // 自分の分のカードと同じ理由で子ども分の入口も出さない。
  const cardVisible = useWeeklyReviewCardVisible();
  const children = state.members.filter((m) => m.is_active && m.role === "child");
  const [opened, setOpened] = useState(false);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  if (!cardVisible || children.length === 0) return null;

  const activeChild = children.find((m) => m.id === selectedChildId) ?? children[0];
  const bodyStyle = bodyStyleFor(tone);

  return (
    <View style={{ marginTop: theme.spacing.s6 }}>
      {!opened && (
        <Pressable onPress={() => setOpened(true)}>
          <Card tone={tone} style={styles.entryCard}>
            <View style={styles.row}>
              <Text style={bodyStyle}>👦 子どものふりかえりを見る</Text>
              <Text style={bodyStyle}>›</Text>
            </View>
          </Card>
        </Pressable>
      )}

      {opened && (
        <>
          {/* きょうだいが2人以上いる家族だけ、子どもを選ぶタブを出す（P18実施履歴・
              P16ポイント通帳と同じメンバー切替タブのパターン）。1人だけの家族は
              このタブ自体を出さず、押した瞬間にその子の分を表示する。 */}
          {children.length > 1 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginBottom: theme.spacing.s2 }}>
              {children.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setSelectedChildId(m.id)}
                  style={[
                    styles.tab,
                    {
                      backgroundColor: activeChild.id === m.id ? theme.colors.brandPrimary : theme.colors.neutralSurface,
                      borderColor: activeChild.id === m.id ? theme.colors.brandPrimary : theme.colors.neutralBorder,
                    },
                  ]}
                >
                  <Text style={{ color: activeChild.id === m.id ? "#FFFFFF" : theme.colors.neutralTextPrimary }}>
                    {m.display_name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <ChildWeeklyReviewResult
            tone={tone}
            memberId={activeChild.id}
            memberName={activeChild.display_name}
            chores={chores}
            habitFigureCatalog={habitFigureCatalog}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  entryCard: { paddingVertical: theme.spacing.s3 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tab: {
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
  },
});

export default ChildWeeklyReviewEntry;
