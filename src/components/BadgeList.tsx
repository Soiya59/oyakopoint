/**
 * 累計到達バッジのリスト表示（P16/C8/S1で共通利用）。
 * 参照: 主要画面ワイヤーフレーム.md 32.4節・32.5節、デザイントークン.md 1.12節。
 *
 * バッジは新しい絵を増やさず、既存の絵文字1種＋到達値の数字併記のみで表現する
 * （決定13・決定28）。未達成のバッジも「あと◯」という進捗として常に表示し、
 * 「未獲得」「ロック中」等の欠落・制限を示す表現は使わない（0.1節）。
 *
 * [2026-09-08追加・主要画面ワイヤーフレーム.md 32.2a節「バッジ」区分・決定24]
 * コレクター棚「集めたもの」区画（個別メンバー選択時）にも達成済みバッジのみを
 * 複製表示する（通帳・S1の表示は変更しない。「移すのではなく両方に出す」）。
 * `achievedOnly`を指定すると、未達成の行を表示せず・進捗（あと◯）も出さない
 * 簡略表示になる。全件が未達成（＝達成済み0件）のときは呼び出し側が空状態文言を
 * 出す想定のため、本コンポーネント自体は何も描画しない（`rows`は空配列を渡すか、
 * 呼び出し側で0件判定してから使う）。
 */
import React from "react";
import { StyleSheet, Text, TextStyle, View } from "react-native";
import theme from "@/theme/theme";
import type { BadgeRow } from "@/hooks/useBadges";
import { SkeletonList } from "./StatusViews";

export interface BadgeListProps {
  isChild: boolean;
  loadState: "loading" | "error" | "ready";
  rows: BadgeRow[];
  headingStyle?: TextStyle;
  rowStyle?: TextStyle;
  /** [2026-09-08追加] trueなら達成済みのみを進捗なしで表示する（決定24、棚側の簡略表示）。 */
  achievedOnly?: boolean;
  /**
   * [2026-09-08追加] trueなら見出し「バッジ」を描画しない。コレクター棚
   * （主要画面ワイヤーフレーム.md 32.2a節）は3区分を通した共通レイアウトで見出しを
   * 呼び出し側が独自に出すため、読み込み中・0件時も含めて常に同じ位置に見出しが
   * 出るよう、本コンポーネント側の見出しは無効化できるようにした。
   */
  hideHeading?: boolean;
}

export function BadgeList({ isChild, loadState, rows, headingStyle, rowStyle, achievedOnly = false, hideHeading = false }: BadgeListProps) {
  if (loadState === "loading") return <SkeletonList count={2} />;
  // [32.4節状態一覧] 通信エラー: バッジ区画専用のエラー状態は設けず、呼び出し側
  // （通帳全体・S1カード全体・コレクター棚全体）のエラー表示に含める設計のため、
  // ここでは何も描画しない。
  if (loadState === "error") return null;

  const visibleRows = achievedOnly ? rows.filter((r) => r.achievedTier !== null) : rows;
  if (achievedOnly && visibleRows.length === 0) return null;

  return (
    <View>
      {!hideHeading && <Text style={[theme.typography.parentBody, styles.heading, headingStyle]}>バッジ</Text>}
      <View style={{ gap: theme.spacing.s1 }}>
        {visibleRows.map((row) => {
          const achieved = row.achievedTier !== null;
          const label = isChild ? row.nameChild : row.nameParent;
          const achievedLabel = isChild ? "たっせい！" : "達成";
          const progressLabel =
            !achievedOnly && row.remaining !== null
              ? isChild
                ? `あと${row.remaining}${row.key === "lifetime_points_earned" ? "pt" : "かい"}`
                : `あと${row.remaining}${row.key === "lifetime_points_earned" ? "pt" : "回"}`
              : null;
          return (
            <Text key={row.key} style={[theme.typography.parentBody, rowStyle]}>
              {row.emoji} {label}
              {achieved ? `${isChild ? " " : "（"}${achievedLabel}${isChild ? "" : "）"}` : ""}
              {progressLabel && row.nextTier !== null
                ? `（つぎの${isChild ? "" : "段階"}${row.nextTier}${row.key === "lifetime_points_earned" ? "pt" : isChild ? "かい" : "回"}まで ${progressLabel}）`
                : progressLabel
                ? `（${progressLabel}）`
                : ""}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { color: theme.colors.neutralTextSecondary, marginBottom: theme.spacing.s2 },
});

export default BadgeList;
