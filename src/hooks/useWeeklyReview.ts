/**
 * 「先週のふりかえり」（要件定義書07-35章「振り返る機会」、API仕様.md 29章、
 * 主要画面ワイヤーフレーム.md 60章）向けのデータ取得フック。
 * P8「かぞく」タブ入口・S2・子どもの「かぞく」タブ入口から遷移する専用画面
 * （P43/S29）、子どもは軽量モーダル（60.4節）が共通してこのフックを使う。
 *
 * [load()の中心バンドルに追加しないこと・API仕様.md 17.9節と同じ申し送り]
 * `src/data/store.tsx`の`load()`には一切クエリを足していない。この画面/
 * モーダルがマウントされたときにだけ個別に通信する。
 *
 * [先週のみを対象にする・07-35章4節] `lastWeekStart`は常に「現在の週の
 * 開始日から7日前」で固定し、呼び出し側に週を選ばせるUIは持たせない
 * （当日進行中の週のweek_startでは絶対に問い合わせない、29.4章申し送り）。
 *
 * [2026-09-22改訂・実装メモ278章] 統括判断により項目構成が変わった。
 * 「あなたは先週◯回」「あなたがよく行ったクエスト」（項目3「その週によく
 * 行われたクエストの上位」の主語を自分自身に変更）を軸に据え、旧項目
 * 「家族全体の完了報告数」は07-9章「週ごとの記録」と二重だったため削除した
 * （`fetchFamilyTreeWeeklyCompletionCountForWeek`の呼び出しごと削除）。
 * 「あなたは先週◯回」・「あなたがよく行ったクエスト」はいずれも
 * `fetchChoreWeeklyCompletionCounts`を`member_id`（自分）で絞った同じ1回の
 * 結果から算出する（72.4章）。
 *
 * [2026-09-22改訂・実装メモ279章・本部長差し戻し対応] 項目3「シール帳完成の
 * 内訳」も、要件定義書07-35章4節・主要画面ワイヤーフレーム.md 60.4節の
 * 2026-09-22追記どおり「閲覧者自身の冊」に限定した（`fetchMemberCompletedHabitCardsInRange`
 * を`member_id`で絞って呼ぶ。旧`fetchFamilyCompletedHabitCardsInRange`は
 * 家族全体を返しており、実装だけが設計と食い違っていた）。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { useAppData } from "@/data/store";
import { useBackgroundAutoRefresh } from "./useBackgroundAutoRefresh";
import {
  fetchChoreWeeklyCompletionCounts,
  fetchMemberCompletedHabitCardsInRange,
  fetchFamilyTreeSeasonHistory,
  fetchFamilyTreeWeeklyCompletionCounts,
  fetchHabitCardChoreBreakdown,
} from "@/data/api";
import type { HabitCard, HabitCardChoreBreakdownRow } from "@/types/domain";
import { addDaysToDateString, getCurrentJstWeekStart, getJstWeekStartDate, toJstDateString } from "@/lib/calendarDates";
import {
  findSeasonForWeek,
  hasAtLeastOneConfirmedPastWeek,
  stageIndexForCount,
  sumCompletionCountsThroughWeek,
  sumWeeklyChoreCounts,
  summarizeWeeklyChoreCounts,
  type WeeklyChoreSummaryEntry,
} from "@/lib/weeklyReviewDisplay";

export type WeeklyReviewLoadState = "loading" | "error" | "ready";

export interface WeeklyReviewData {
  /** 先週の開始日（JST月曜0:00、"YYYY-MM-DD"）。画面見出しの元データにも使う。 */
  weekStart: string;
  /**
   * 項目1「あなたは先週◯回」（60.4a節決定11、自分自身の週間完了報告数）。
   * 0件を含む正常系。呼び出し側は0のとき項目自体を出さない（決定11）。
   */
  yourWeeklyTotal: number;
  /**
   * 項目2「あなたがよく行ったクエスト」（60.4a節決定12: 決定7の上位5件＋
   * ほか◯件を自分の分だけに絞ったもの）。自分が1回もやっていないクエストは
   * 候補に含まれない（元データ自体が実施回数1件以上の行のみのため）。
   */
  topChores: { top: WeeklyChoreSummaryEntry[]; otherCount: number; otherTotal: number };
  /** 項目3: その週に完成したシール帳（無ければ空配列。決定9(c)「該当データが無いものは項目ごと非表示」）。 */
  completedHabitCards: HabitCard[];
  /** 項目3の内訳（habit_card_id単位、完成した冊ぶんをまとめて1回で取得。N+1にしない）。 */
  completedHabitCardBreakdown: HabitCardChoreBreakdownRow[];
  /** 項目4: 先週時点の家族の木の段階（0=種〜4=実）。判定不能な場合のみnull（家族作成直後の異常系の保険）。 */
  treeStageIndex: number | null;
}

/** 決定5「家族が作成されてから最初の暦週がまだ終わっていない間は表示しない」。 */
export function useWeeklyReviewCardVisible(): boolean {
  const { state } = useAppData();
  const familyCreatedAt = state.family.created_at;
  if (!familyCreatedAt) return false;
  const familyCreationWeekStart = getJstWeekStartDate(toJstDateString(familyCreatedAt));
  const lastWeekStart = addDaysToDateString(getCurrentJstWeekStart(), -7);
  return hasAtLeastOneConfirmedPastWeek(familyCreationWeekStart, lastWeekStart);
}

export function useWeeklyReview() {
  const { client } = useSession();
  const { state } = useAppData();
  const familyId = state.family.id;
  // [2026-09-22追加] 「あなたは先週◯回」「あなたがよく行ったクエスト」は自分の
  // 行だけに絞って取得する（72.4章）。子どもなら`activeChildMemberId`、保護者・
  // みまもりメンバーなら`activeParentMemberId`（`src/data/store.tsx`
  // `activeMemberId`と同じ解決パターン、508行目コメント参照）。
  const myMemberId = state.activeChildMemberId || state.activeParentMemberId;
  const [loadState, setLoadState] = useState<WeeklyReviewLoadState>("loading");
  const [data, setData] = useState<WeeklyReviewData | null>(null);

  const load = useCallback(
    async (options?: { background?: boolean }) => {
      if (!familyId || !myMemberId) return;
      const background = options?.background ?? false;
      if (!background) setLoadState("loading");

      const lastWeekStart = addDaysToDateString(getCurrentJstWeekStart(), -7);
      // JST週境界（月曜0:00〜翌週月曜0:00の手前）のISO日時（41章・useFamilyTree.tsと同じ変換）。
      const weekStartIso = new Date(`${lastWeekStart}T00:00:00+09:00`).toISOString();
      const weekEndIso = new Date(`${addDaysToDateString(lastWeekStart, 7)}T00:00:00+09:00`).toISOString();

      // [2026-09-22改訂] 旧項目1（家族全体の完了報告数）の取得は削除した
      // （07-9章「週ごとの記録」と二重だったため、統括判断）。choreResは
      // 自分（myMemberId）の先週分に絞って取得し、「あなたは先週◯回」・
      // 「あなたがよく行ったクエスト」の両方を同じ結果から算出する（72.4章）。
      const [seasonsRes, choreRes, cardsRes] = await Promise.all([
        fetchFamilyTreeSeasonHistory(client, familyId),
        fetchChoreWeeklyCompletionCounts(client, familyId, myMemberId, lastWeekStart),
        fetchMemberCompletedHabitCardsInRange(client, familyId, myMemberId, weekStartIso, weekEndIso),
      ]);
      if (!seasonsRes.ok || !choreRes.ok || !cardsRes.ok) {
        if (!background) setLoadState("error");
        return;
      }

      // 項目4: 先週が属するシーズンを特定し、そのシーズンが進行中か閉じているかで
      // 求め方を分ける（src/lib/weeklyReviewDisplay.ts コメント参照）。
      const season = findSeasonForWeek(seasonsRes.data, lastWeekStart);
      let treeStageIndex: number | null = null;
      if (season) {
        if (season.season_end === null) {
          const weeklyRes = await fetchFamilyTreeWeeklyCompletionCounts(client, season.id);
          if (!weeklyRes.ok) {
            if (!background) setLoadState("error");
            return;
          }
          const cumulative = sumCompletionCountsThroughWeek(weeklyRes.data, lastWeekStart);
          treeStageIndex = stageIndexForCount(cumulative);
        } else {
          // 閉じたシーズンは値が確定済み（current_stageはこれ以上変わらない）。
          treeStageIndex = season.current_stage;
        }
      }

      // 項目3: 完成した冊があれば内訳をまとめて1回で取得する（N+1にしない）。
      const completedHabitCards = cardsRes.data;
      let completedHabitCardBreakdown: HabitCardChoreBreakdownRow[] = [];
      if (completedHabitCards.length > 0) {
        const breakdownRes = await fetchHabitCardChoreBreakdown(
          client,
          completedHabitCards.map((c) => c.id)
        );
        if (!breakdownRes.ok) {
          if (!background) setLoadState("error");
          return;
        }
        completedHabitCardBreakdown = breakdownRes.data;
      }

      setData({
        weekStart: lastWeekStart,
        yourWeeklyTotal: sumWeeklyChoreCounts(choreRes.data),
        topChores: summarizeWeeklyChoreCounts(choreRes.data, 5),
        completedHabitCards,
        completedHabitCardBreakdown,
        treeStageIndex,
      });
      setLoadState("ready");
    },
    [client, familyId, myMemberId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useBackgroundAutoRefresh(
    () => {
      void load({ background: true });
    },
    { enabled: Boolean(familyId) && Boolean(myMemberId) }
  );

  return { loadState, data, reload: load };
}
