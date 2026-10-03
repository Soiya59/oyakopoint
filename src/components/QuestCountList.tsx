/**
 * 「きろく」の「クエストごとの回数」（P18保護者・C15子ども・S12みまもり共通）。
 * 参照: 要件定義書07-46章、UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 72章（F1〜F10）、
 * 設計部/成果物/API仕様.md 40章、開発部/成果物/実装メモ.md 353章。
 *
 * 「これまでの回数」（`BadgeList`）の直後に置く、**閉じた枠1つ**。閉じているあいだは見出し1行だけで、
 * 行数・回数は出さない（決定6）。見出しの行を押すと開き、そのとき初めて**1人ぶん**を読む
 * （`useMemberChoreNameCounts`。アプリ起動時の読み込みには載せない。決定11）。
 *
 * 守ること（72.3節・72.7節。07-10章の必須3条件）:
 *  - 行は全部同じ見た目（太さ・色・大きさ・背景を変えない）。**押せない**（`Pressable`にしない）。
 *  - **並べ替えの操作は作らない。**並びは取得した順のまま（回数の多い順→最近やった順→名前。2026-10-03変更・355章。DBの取り方が決める）。
 *    ここで並べ直さない・回数で`sort`しない。合計・件数・順位・「いちばん」の印を出さない。
 *  - 件数は切らない（全件）。枠の中でスクロールさせず、画面全体のスクロールに乗せる。
 *    名前は折り返し、省略しない（`numberOfLines`を付けない）。
 *  - 0行は見出しだけで、文を置かない。いまあるクエストと消したクエストを見た目で見分けない。
 *  - 開閉は覚えない。**呼び出し側は`key={memberId}`を付ける**（メンバーを切り替えたとき、部品が
 *    作り直されて閉じた状態に戻り、前の人の結果・読み込みの返事が残らない。72.4節）。
 *
 * `memberId`は必須。みまもりS12・子どもC15は**自分のIDだけ**を渡す（他人のIDでは0行になる）。
 * 保護者P18は選んだメンバーのID（「＋家族全体」のときはこの部品を置かない）。
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import theme from "@/theme/theme";
import { useMemberChoreNameCounts } from "@/hooks/useMemberChoreNameCounts";
import {
  questCountErrorTitle,
  questCountHeading,
  questCountRowLabel,
  questCountToggleHint,
  questCountUnit,
  type QuestCountTone,
} from "@/lib/questCount";
import { ErrorState, SkeletonBlock } from "./StatusViews";

export interface QuestCountListProps {
  tone: QuestCountTone;
  memberId: string;
}

const SKELETON_COUNT = 3;

export function QuestCountList({ tone, memberId }: QuestCountListProps) {
  const [expanded, setExpanded] = useState(false);
  // 閉じているあいだは読まない。開いたとき（enabledが真になったとき）に1回読む。
  const { loadState, rows, failure, reload } = useMemberChoreNameCounts(memberId, expanded);

  const isChild = tone === "child";
  const textStyle =
    tone === "child"
      ? theme.typography.childBody
      : tone === "supporter"
        ? theme.typography.supporterBody
        : theme.typography.parentBody;
  const headerMinHeight =
    tone === "child" ? theme.tapTarget.child : tone === "supporter" ? theme.tapTarget.supporterPrimary : theme.tapTarget.parent;
  const rowPaddingV = isChild ? theme.spacing.s3 : theme.spacing.s2;
  const skeletonHeight = isChild ? theme.tapTarget.child : theme.tapTarget.parent;
  const unit = questCountUnit(tone);
  const heading = questCountHeading(tone);

  return (
    <View
      style={[
        styles.frame,
        { borderRadius: isChild ? theme.radius.childXl : theme.radius.parentMd },
      ]}
    >
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={[styles.header, { minHeight: headerMinHeight }]}
        accessibilityRole="button"
        accessibilityLabel={heading}
        accessibilityState={{ expanded }}
        // react-native-webは`accessibilityState`を`aria-expanded`に変換しないため、同じ値を`aria-expanded`でも渡す
        // （ネイティブでは同じ意味。TalkBack・VoiceOverが「開いている／閉じている」と読む）。
        aria-expanded={expanded}
        accessibilityHint={questCountToggleHint(tone, expanded)}
      >
        <Text style={[textStyle, styles.headerText]}>{heading}</Text>
        <Text
          style={[textStyle, styles.chevron]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {expanded ? "▲" : "▼"}
        </Text>
      </Pressable>

      {expanded && (loadState === "idle" || loadState === "loading") && (
        // 読み込み中は文言なし（スケルトン3つ。72.4節）。
        <View style={[styles.divider, styles.skeletonWrap]}>
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <SkeletonBlock key={i} height={skeletonHeight} />
          ))}
        </View>
      )}

      {expanded && loadState === "error" && (
        // 失敗はこの枠の中だけ（週のバー・「◯日の実績」には影響しない）。赤は使わない（ErrorStateのまま）。
        <View style={styles.divider}>
          <ErrorState
            tone={isChild ? "child" : "parent"}
            title={questCountErrorTitle(tone)}
            failure={failure}
            onRetry={() => void reload()}
          />
        </View>
      )}

      {expanded &&
        loadState === "ready" &&
        // 0行のときは、見出しだけで下は空（文も区切り線も置かない）。
        rows.map((row, i) => (
          <View
            key={`${i}:${row.name}`}
            style={[styles.row, styles.divider, { paddingVertical: rowPaddingV }]}
            accessible
            accessibilityLabel={questCountRowLabel(tone, row.name, row.count)}
          >
            <Text style={[textStyle, styles.rowName]}>
              {row.emoji} {row.name}
            </Text>
            <Text style={[textStyle, styles.rowCount]}>
              {row.count}
              {unit}
            </Text>
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    marginTop: theme.spacing.s3,
    backgroundColor: theme.colors.neutralSurface,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.s3,
  },
  headerText: { flex: 1, color: theme.colors.neutralTextPrimary },
  chevron: { marginLeft: theme.spacing.s3, color: theme.colors.neutralTextSecondary },
  divider: { borderTopWidth: 1, borderTopColor: theme.colors.neutralBorder },
  skeletonWrap: { padding: theme.spacing.s3, gap: theme.spacing.s2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.s3,
  },
  // 名前は折り返し可・省略しない（numberOfLinesを付けない）。
  rowName: { flex: 1, color: theme.colors.neutralTextPrimary },
  // 回数は右端・折り返さない・名前と同じ太さと色。
  rowCount: { flexShrink: 0, marginLeft: theme.spacing.s3, color: theme.colors.neutralTextPrimary },
});

export default QuestCountList;
