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
 * S12 実施履歴カレンダー（みまもりメンバービュー）
 * 参照: 画面一覧・遷移図.md 2.5節S12、P18（app/parent/history.tsx）と同一構成
 *
 * P18を土台に、以下をみまもりメンバー向けに変更した。
 * - メンバー切替タブに"supporter"ロールのメンバーも含める（07-7章はみまもりメンバーも
 *   完了報告の当事者になるため、家族全体ビューの一員として扱う）
 *
 * [2026-08-23改訂] 要件定義書07-7章4回目のスコープ変更により、みまもりメンバーは
 * 家族共有choreへの参加機能自体を持たなくなり、自分専用choreの可視性トグルも撤回された
 * （自分専用のお手伝いは常に非公開・例外なし）。これに伴い🤝／🎯バッジ・🔒表示
 * （旧デザイントークン.md 1.7節）を廃止した。
 */
type LoadState = "loading" | "error" | "ready";

export default function SupporterHistoryScreen() {
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
    <Screen tone="supporter">
      <Text style={theme.typography.supporterTitle}>きろく</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: theme.spacing.s3 }}>
        <View style={{ flexDirection: "row", gap: theme.spacing.s2 }}>
          {members
            .filter((m) => m.role === "child" || m.role === "parent" || m.role === "supporter")
            .map((m) => (
              <Pressable
                key={m.id}
                onPress={() => setSelectedMemberId(m.id)}
                style={[
                  styles.tab,
                  {
                    backgroundColor: selectedMemberId === m.id ? theme.colors.supporterAccent : theme.colors.neutralSurface,
                    borderColor: selectedMemberId === m.id ? theme.colors.supporterAccent : theme.colors.neutralBorder,
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
                backgroundColor: selectedMemberId === null ? theme.colors.supporterAccent : theme.colors.neutralSurface,
                borderColor: selectedMemberId === null ? theme.colors.supporterAccent : theme.colors.neutralBorder,
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

          <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s6 }]}>
            {formatDateJp(selectedDate)}の実績
          </Text>
          {dailyCompletions.length === 0 && dailyRedemptions.length === 0 ? (
            <Text style={[theme.typography.supporterCaption, styles.emptyDayText]}>この日の実績はありません</Text>
          ) : (
            <View style={{ marginTop: theme.spacing.s2 }}>
              {dailyCompletions.map((c) => {
                const member = state.members.find((m) => m.id === c.reported_by);
                return (
                  <View key={c.id} style={styles.row}>
                    <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={24} />
                    <Text style={[theme.typography.supporterBody, { marginLeft: theme.spacing.s2 }]}>
                      {member?.display_name}
                    </Text>
                    <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s2 }]}>
                      {c.chore_emoji} {c.chore_title}
                    </Text>
                    <Text style={theme.typography.supporterBodyMedium}>+{c.points}pt</Text>
                  </View>
                );
              })}
              {dailyRedemptions.map((r) => {
                const member = state.members.find((m) => m.id === r.member_id);
                const emoji = state.rewards.find((rw) => rw.id === r.reward_id)?.emoji ?? "🎁";
                return (
                  <View key={r.id} style={styles.row}>
                    <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={24} />
                    <Text style={[theme.typography.supporterBody, { marginLeft: theme.spacing.s2 }]}>
                      {member?.display_name}
                    </Text>
                    <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s2 }]}>
                      {emoji} {r.reward_name}
                    </Text>
                    <Text style={theme.typography.supporterBodyMedium}>-{r.cost}pt</Text>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}

      <AppButton
        tone="supporter"
        label="ホームへ戻る"
        variant="ghost"
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => router.back()}
      />
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
