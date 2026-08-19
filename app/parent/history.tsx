import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import MemberAvatar from "@/components/MemberAvatar";
import AppButton from "@/components/AppButton";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import { WeekBar, MonthCalendar } from "@/components/HistoryCalendar";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { getJstToday, getPastWeekDates, shiftMonth, toJstDateString, formatDateJp } from "@/lib/calendarDates";
import type { DailySummaryEntry } from "@/types/domain";

/**
 * P18 実施履歴カレンダー（保護者ビュー）
 * 参照: 主要画面ワイヤーフレーム.md 8章、画面一覧・遷移図.md 3.8章
 *
 * [2026-08-15新規追加] 要件定義書07-3章「実施履歴カレンダー」に対応する新規画面。
 * データソースはchore_completion_daily_summary View相当（週間・月間集計）と
 * chore_completions（日別詳細）で、新規テーブルは無い（API仕様.md 6a章）。
 *
 * 保護者ビューは「家族全体」を既定表示とし、P16ポイント通帳と同じ「メンバー切替タブ」
 * UIで特定の子どもに絞り込める（8.0決定3）。ドットの色は`family_members.avatar_color`
 * をそのまま使い、保護者にも同じルールを適用する（8.0決定1）。
 */
type LoadState = "loading" | "error" | "ready";

export default function ParentHistoryScreen() {
  const { state, dailySummary } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [expanded, setExpanded] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null); // null = 家族全体

  const today = getJstToday();
  const [selectedDate, setSelectedDate] = useState(today);
  const [monthCursor, setMonthCursor] = useState(() => {
    const [y, m] = today.split("-").map(Number);
    return { year: y, month: m };
  });

  useEffect(() => {
    const t = setTimeout(() => setLoadState("ready"), 400);
    return () => clearTimeout(t);
  }, []);

  const members = state.members.filter((m) => m.is_active);
  const memberColor = (memberId: string) =>
    members.find((m) => m.id === memberId)?.avatar_color ?? theme.colors.neutralBorder;

  const filterRows = (rows: DailySummaryEntry[]) =>
    selectedMemberId ? rows.filter((r) => r.member_id === selectedMemberId) : rows;

  const weekDates = useMemo(() => getPastWeekDates(today), [today]);
  const weekRows = useMemo(
    () => filterRows(dailySummary(weekDates[0], weekDates[6])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dailySummary, weekDates, selectedMemberId]
  );

  const monthStart = `${monthCursor.year}-${String(monthCursor.month).padStart(2, "0")}-01`;
  const daysInMonth = new Date(Date.UTC(monthCursor.year, monthCursor.month, 0)).getUTCDate();
  const monthEnd = `${monthCursor.year}-${String(monthCursor.month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  const monthRows = useMemo(
    () => filterRows(dailySummary(monthStart, monthEnd)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dailySummary, monthStart, monthEnd, selectedMemberId]
  );

  const totalPointsForDate = (date: string, rows: DailySummaryEntry[]) =>
    rows.filter((r) => r.activity_date === date).reduce((sum, r) => sum + r.total_points, 0);

  const dotsForDate = (date: string, rows: DailySummaryEntry[]) =>
    rows
      .filter((r) => r.activity_date === date)
      .map((r) => ({ key: r.member_id, color: memberColor(r.member_id) }));

  const dailyCompletions = useMemo(
    () =>
      state.completions
        .filter(
          (c) =>
            toJstDateString(c.reported_at) === selectedDate &&
            (selectedMemberId ? c.reported_by === selectedMemberId : true)
        )
        .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()),
    [state.completions, selectedDate, selectedMemberId]
  );

  // [2026-08-18追加・本部長] 「きろく」はchore_completion_daily_summary相当
  // （お手伝い実施）専用のデータソースだったため、ごほうび交換が一切反映されて
  // いなかった。ユーザーの依頼により、日別実績リストにのみごほうび交換も追加する
  // （週間バー・月間カレンダーのドット・ポイント合計は「お手伝いをがんばった記録」の
  // 意味合いを保つため、意図的にお手伝い実施のままにしている）。emoji等の
  // フォールバック方針はsrc/data/store.tsxのspendLedger()と同一にする。
  const dailyRedemptions = useMemo(
    () =>
      state.redemptions
        .filter(
          (r) =>
            toJstDateString(r.created_at) === selectedDate &&
            (selectedMemberId ? r.member_id === selectedMemberId : true)
        )
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [state.redemptions, selectedDate, selectedMemberId]
  );

  const isWeekEmpty = weekRows.length === 0;

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>きろく</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: theme.spacing.s3 }}>
        <View style={{ flexDirection: "row", gap: theme.spacing.s2 }}>
          {members
            .filter((m) => m.role === "child" || m.role === "parent")
            .map((m) => (
              <Pressable
                key={m.id}
                onPress={() => setSelectedMemberId(m.id)}
                style={[
                  styles.tab,
                  {
                    backgroundColor: selectedMemberId === m.id ? theme.colors.brandPrimary : theme.colors.neutralSurface,
                    borderColor: selectedMemberId === m.id ? theme.colors.brandPrimary : theme.colors.neutralBorder,
                  },
                ]}
              >
                <Text style={{ color: selectedMemberId === m.id ? "#FFFFFF" : theme.colors.neutralTextPrimary }}>
                  {m.display_name}
                </Text>
              </Pressable>
            ))}
          <Pressable
            onPress={() => setSelectedMemberId(null)}
            style={[
              styles.tab,
              {
                backgroundColor: selectedMemberId === null ? theme.colors.brandPrimary : theme.colors.neutralSurface,
                borderColor: selectedMemberId === null ? theme.colors.brandPrimary : theme.colors.neutralBorder,
              },
            ]}
          >
            <Text style={{ color: selectedMemberId === null ? "#FFFFFF" : theme.colors.neutralTextPrimary }}>
              ＋家族全体
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={2} />
        </View>
      )}

      {loadState === "error" && (
        <ErrorState title="読み込みに失敗しました" onRetry={() => setLoadState("ready")} />
      )}

      {loadState === "ready" && isWeekEmpty && !expanded && (
        <EmptyState emoji="📅" title="この1週間はまだ記録がありません" />
      )}

      {loadState === "ready" && (
        <>
          <WeekBar
            tone="parent"
            weekDates={weekDates}
            totalPointsForDate={(d) => totalPointsForDate(d, weekRows)}
            dotsForDate={(d) => dotsForDate(d, weekRows)}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            expanded={expanded}
            onToggleExpand={() => setExpanded((v) => !v)}
          />

          {expanded && (
            <MonthCalendar
              tone="parent"
              year={monthCursor.year}
              month={monthCursor.month}
              onPrevMonth={() => setMonthCursor((c) => shiftMonth(c.year, c.month, -1))}
              onNextMonth={() => setMonthCursor((c) => shiftMonth(c.year, c.month, 1))}
              totalPointsForDate={(d) => totalPointsForDate(d, monthRows)}
              dotsForDate={(d) => dotsForDate(d, monthRows)}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          )}

          <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>
            {formatDateJp(selectedDate)}の実績
          </Text>
          {dailyCompletions.length === 0 && dailyRedemptions.length === 0 ? (
            <Text style={[theme.typography.parentCaption, styles.emptyDayText]}>この日の実績はありません</Text>
          ) : (
            <View style={{ marginTop: theme.spacing.s2 }}>
              {dailyCompletions.map((c) => {
                const member = state.members.find((m) => m.id === c.reported_by);
                const chore = state.chores.find((ch) => ch.id === c.chore_id);
                const isRoutine = !!chore?.is_repeatable;
                return (
                  <View key={c.id} style={styles.row}>
                    <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={24} />
                    <Text style={[theme.typography.parentBody, { marginLeft: theme.spacing.s2 }]}>
                      {member?.display_name}
                    </Text>
                    <Text style={[theme.typography.parentBody, { flex: 1, marginLeft: theme.spacing.s2 }]}>
                      {isRoutine ? "🔄 " : ""}
                      {c.chore_emoji} {c.chore_title}
                      {isRoutine ? "(ルーチン)" : ""}
                    </Text>
                    <Text style={theme.typography.parentBodyMedium}>+{c.points}pt</Text>
                  </View>
                );
              })}
              {dailyRedemptions.map((r) => {
                const member = state.members.find((m) => m.id === r.member_id);
                const emoji = state.rewards.find((rw) => rw.id === r.reward_id)?.emoji ?? "🎁";
                return (
                  <View key={r.id} style={styles.row}>
                    <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={24} />
                    <Text style={[theme.typography.parentBody, { marginLeft: theme.spacing.s2 }]}>
                      {member?.display_name}
                    </Text>
                    <Text style={[theme.typography.parentBody, { flex: 1, marginLeft: theme.spacing.s2 }]}>
                      {emoji} {r.reward_name}
                    </Text>
                    <Text style={theme.typography.parentBodyMedium}>-{r.cost}pt</Text>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}

      {/* [2026-08-16修正・本部長] P16・P8と同じ理由でホームへ戻るボタンを追加した。 */}
      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tab: {
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing.s2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutralBorder,
  },
  emptyDayText: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
});
