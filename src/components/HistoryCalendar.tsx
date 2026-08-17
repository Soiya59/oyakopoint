import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import theme, { pointsTierBackground } from "@/theme/theme";
import {
  WEEKDAY_LABELS_JA,
  WEEKDAY_LABELS_JA_KANA,
  getMonthGrid,
  getWeekdayMonFirst,
} from "@/lib/calendarDates";

/**
 * 実施履歴カレンダー（P18保護者ビュー／C15子どもビュー）共通の表示部品。
 * 参照: 主要画面ワイヤーフレーム.md 8章、要件定義書07-3章
 *
 * family-todoのWeeklyStatus.tsxを参照実装とし、「①週間バー→②月間カレンダー→
 * ③日別実績」の段階的開示のうち①②を担当する（③日別実績のリストは呼び出し側
 * 画面ごとに情報量・トーンが異なるため、この共通部品には含めない）。
 * ドットの色分け（`family_members.avatar_color`）・日別セルの濃淡（3段階、
 * ストリーク数値は表示しない）は8.0決定1・決定2に対応する。
 */
export interface DayDot {
  key: string;
  color: string;
}

interface CommonProps {
  tone: "parent" | "child";
  totalPointsForDate: (date: string) => number;
  dotsForDate: (date: string) => DayDot[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
}

interface WeekBarProps extends CommonProps {
  weekDates: string[]; // 古い順、7件
  expanded: boolean;
  onToggleExpand: () => void;
}

export function WeekBar({
  tone,
  weekDates,
  totalPointsForDate,
  dotsForDate,
  selectedDate,
  onSelectDate,
  expanded,
  onToggleExpand,
}: WeekBarProps) {
  const isChild = tone === "child";
  const weekdayLabels = isChild ? WEEKDAY_LABELS_JA_KANA : WEEKDAY_LABELS_JA;
  return (
    <View>
      <View style={styles.weekRow}>
        {weekDates.map((date) => {
          const weekdayIdx = getWeekdayMonFirst(date);
          const dayNum = Number(date.split("-")[2]);
          const points = totalPointsForDate(date);
          const dots = dotsForDate(date);
          const isSelected = date === selectedDate;
          return (
            <Pressable
              key={date}
              onPress={() => onSelectDate(date)}
              style={[
                styles.dayCell,
                { backgroundColor: pointsTierBackground(points) },
                isSelected && styles.dayCellSelected,
              ]}
            >
              <Text style={[isChild ? theme.typography.parentCaption : theme.typography.parentCaption, styles.weekdayLabel]}>
                {weekdayLabels[weekdayIdx]}
              </Text>
              <Text style={[theme.typography.parentBodyMedium, styles.dayNum]}>{dayNum}</Text>
              <DotRow dots={dots} />
              <Text style={styles.pointLabel}>{points > 0 ? `+${points}` : "・"}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable onPress={onToggleExpand} style={styles.expandToggle}>
        <Text style={styles.expandToggleText}>
          {expanded ? "▲ とじる" : isChild ? "▼ タップで もっと見る" : "▼ タップで月間表示"}
        </Text>
      </Pressable>
    </View>
  );
}

interface MonthCalendarProps extends CommonProps {
  year: number;
  month: number; // 1-12
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

export function MonthCalendar({
  tone,
  year,
  month,
  onPrevMonth,
  onNextMonth,
  totalPointsForDate,
  dotsForDate,
  selectedDate,
  onSelectDate,
}: MonthCalendarProps) {
  const isChild = tone === "child";
  const weekdayLabels = isChild ? WEEKDAY_LABELS_JA_KANA : WEEKDAY_LABELS_JA;
  const weeks = getMonthGrid(year, month);

  return (
    <View style={styles.monthBox}>
      <View style={styles.monthHeader}>
        <Pressable onPress={onPrevMonth} hitSlop={8}>
          <Text style={styles.monthNav}>＜</Text>
        </Pressable>
        <Text style={theme.typography.parentBodyMedium}>
          {isChild ? `${month}がつ` : `${year}年${month}月`}
        </Text>
        <Pressable onPress={onNextMonth} hitSlop={8}>
          <Text style={styles.monthNav}>＞</Text>
        </Pressable>
      </View>

      <View style={styles.weekdayHeaderRow}>
        {weekdayLabels.map((label) => (
          <Text key={label} style={styles.weekdayHeaderCell}>
            {label}
          </Text>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={wi} style={styles.monthWeekRow}>
          {week.map((date, di) => {
            if (!date) return <View key={di} style={styles.monthCellBlank} />;
            const dayNum = Number(date.split("-")[2]);
            const points = totalPointsForDate(date);
            const dots = dotsForDate(date);
            const isSelected = date === selectedDate;
            return (
              <Pressable
                key={date}
                onPress={() => onSelectDate(date)}
                style={[
                  styles.monthCell,
                  { backgroundColor: pointsTierBackground(points) },
                  isSelected && styles.dayCellSelected,
                ]}
              >
                <Text style={styles.monthCellNum}>{dayNum}</Text>
                <DotRow dots={dots} small />
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function DotRow({ dots, small }: { dots: DayDot[]; small?: boolean }) {
  if (dots.length === 0) return <View style={{ height: small ? 6 : 8 }} />;
  return (
    <View style={styles.dotRow}>
      {dots.slice(0, 4).map((d) => (
        <View
          key={d.key}
          style={[
            styles.dot,
            { backgroundColor: d.color, width: small ? 5 : 7, height: small ? 5 : 7, borderRadius: small ? 2.5 : 3.5 },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  weekRow: { flexDirection: "row", gap: theme.spacing.s1, marginTop: theme.spacing.s2 },
  dayCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
  },
  dayCellSelected: {
    borderWidth: 2,
    borderColor: theme.colors.brandPrimary,
  },
  weekdayLabel: { color: theme.colors.neutralTextSecondary, fontSize: 11 },
  dayNum: { marginTop: 2 },
  dotRow: { flexDirection: "row", gap: 2, marginTop: 4, minHeight: 8, justifyContent: "center" },
  dot: { borderRadius: 3.5 },
  pointLabel: { marginTop: 2, fontSize: 11, color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  expandToggle: { alignItems: "center", marginTop: theme.spacing.s2 },
  expandToggleText: { color: theme.colors.neutralTextSecondary, fontSize: 12 },
  monthBox: { marginTop: theme.spacing.s3 },
  monthHeader: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing.s4 },
  monthNav: { fontSize: 18, color: theme.colors.brandPrimaryStrong, paddingHorizontal: theme.spacing.s2 },
  weekdayHeaderRow: { flexDirection: "row", marginTop: theme.spacing.s3 },
  weekdayHeaderCell: {
    flex: 1,
    textAlign: "center",
    fontSize: 11,
    color: theme.colors.neutralTextSecondary,
  },
  monthWeekRow: { flexDirection: "row", marginTop: theme.spacing.s1 },
  // [変更] aspectRatioはreact-native-web上でflexDirection:"row"の兄弟要素間で
  // 高さがそろわない場合があったため、固定heightに変更した（動作確認で発見・修正）。
  monthCell: {
    flex: 1,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.parentMd,
    marginHorizontal: 1,
  },
  monthCellBlank: { flex: 1, height: 44, marginHorizontal: 1 },
  monthCellNum: { fontSize: 12, color: theme.colors.neutralTextPrimary },
});
