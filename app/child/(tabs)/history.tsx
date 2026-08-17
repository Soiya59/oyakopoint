import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Screen from "@/components/Screen";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import { WeekBar, MonthCalendar } from "@/components/HistoryCalendar";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import {
  getJstToday,
  getPastWeekDates,
  shiftMonth,
  toJstDateString,
  formatDateChildJp,
} from "@/lib/calendarDates";

/**
 * C15 実施履歴カレンダー（子どもビュー）
 * 参照: 主要画面ワイヤーフレーム.md 8章、画面一覧・遷移図.md 3.8章
 *
 * [2026-08-15新規追加] 要件定義書07-3章「実施履歴カレンダー」に対応する新規画面。
 * family-todoのWeeklyStatus.tsxを参照実装とし、「①週間バー→②月間カレンダー→
 * ③日別実績」の段階的開示を実装する。データソースはchore_completion_daily_summary
 * View相当（週間・月間集計）とchore_completions（日別詳細）で、新規テーブルは無い
 * （API仕様.md 6a章）。
 *
 * 子どもビューは要件定義書07-3章5「比較を煽らない見せ方」に基づき、常に自分の
 * 実施履歴のみを表示する（きょうだいとの比較・切り替えUIは持たない。8.0決定3）。
 */
type LoadState = "loading" | "error" | "ready";

export default function ChildHistoryScreen() {
  const { state, dailySummary } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [expanded, setExpanded] = useState(false);

  const today = getJstToday();
  const [selectedDate, setSelectedDate] = useState(today);
  const [monthCursor, setMonthCursor] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { year: y, month: m };
  });

  useEffect(() => {
    const t = setTimeout(() => setLoadState("ready"), 450);
    return () => clearTimeout(t);
  }, []);

  const me = state.members.find((m) => m.id === state.activeChildMemberId)!;

  const weekDates = useMemo(() => getPastWeekDates(today), [today]);
  const weekByDate = useMemo(() => {
    const rows = dailySummary(weekDates[0], weekDates[6]).filter((s) => s.member_id === me.id);
    return new Map(rows.map((r) => [r.activity_date, r]));
  }, [dailySummary, weekDates, me.id]);

  const monthStart = `${monthCursor.year}-${String(monthCursor.month).padStart(2, "0")}-01`;
  const daysInMonth = new Date(Date.UTC(monthCursor.year, monthCursor.month, 0)).getUTCDate();
  const monthEnd = `${monthCursor.year}-${String(monthCursor.month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  const monthByDate = useMemo(() => {
    const rows = dailySummary(monthStart, monthEnd).filter((s) => s.member_id === me.id);
    return new Map(rows.map((r) => [r.activity_date, r]));
  }, [dailySummary, monthStart, monthEnd, me.id]);

  const dots = (date: string, source: Map<string, { completion_count: number }>) =>
    source.has(date) ? [{ key: me.id, color: me.avatar_color ?? theme.colors.neutralBorder }] : [];

  const dailyCompletions = useMemo(
    () =>
      state.completions
        .filter((c) => c.reported_by === me.id && toJstDateString(c.reported_at) === selectedDate)
        .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()),
    [state.completions, me.id, selectedDate]
  );

  const isWeekEmpty = weekByDate.size === 0;

  return (
    <Screen tone="child">
      <Text style={theme.typography.childBody}>📅 {me.display_name}の きろく</Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={2} />
        </View>
      )}

      {loadState === "error" && (
        <ErrorState tone="child" title="つうしんがおやすみ中みたい" onRetry={() => setLoadState("ready")} />
      )}

      {loadState === "ready" && isWeekEmpty && !expanded && (
        <EmptyState tone="child" emoji="📅" title="まだきろくがないよ。やることリストからはじめてみよう！" />
      )}

      {loadState === "ready" && (
        <>
          <WeekBar
            tone="child"
            weekDates={weekDates}
            totalPointsForDate={(d) => weekByDate.get(d)?.total_points ?? 0}
            dotsForDate={(d) => dots(d, weekByDate)}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            expanded={expanded}
            onToggleExpand={() => setExpanded((v) => !v)}
          />

          {expanded && (
            <MonthCalendar
              tone="child"
              year={monthCursor.year}
              month={monthCursor.month}
              onPrevMonth={() => setMonthCursor((c) => shiftMonth(c.year, c.month, -1))}
              onNextMonth={() => setMonthCursor((c) => shiftMonth(c.year, c.month, 1))}
              totalPointsForDate={(d) => monthByDate.get(d)?.total_points ?? 0}
              dotsForDate={(d) => dots(d, monthByDate)}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          )}

          <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s6 }]}>
            {formatDateChildJp(selectedDate)}の きろく
          </Text>
          {dailyCompletions.length === 0 ? (
            <Text style={[theme.typography.parentCaption, styles.emptyDayText]}>この日の実績はありません</Text>
          ) : (
            <View style={{ marginTop: theme.spacing.s2 }}>
              {dailyCompletions.map((c) => {
                const chore = state.chores.find((ch) => ch.id === c.chore_id);
                const isRoutine = !!chore?.is_repeatable;
                return (
                  <View key={c.id} style={styles.row}>
                    <Text style={theme.typography.childBody}>
                      {isRoutine ? "🔄 " : ""}
                      {c.chore_emoji} {c.chore_title}
                      {isRoutine ? "（つづけてる）" : ""}
                    </Text>
                    <Text style={{ flex: 1 }} />
                    <Text style={[theme.typography.childBody, { color: theme.colors.brandPrimaryStrong }]}>
                      +{c.points}pt
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing.s3,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutralBorder,
  },
  emptyDayText: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
});
