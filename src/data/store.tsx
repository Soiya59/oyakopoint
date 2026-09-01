/**
 * アプリのデータ層（家族データ・完了報告・リアクション・ごほうび交換等）。
 *
 * [2026-08-15改訂] Supabase接続対応。`isSupabaseConfigured()` に応じて2つの実装を
 * 切り替える単一のContext（AppDataContext）として再構成した。
 * - 実接続あり（isSupabaseConfigured()===true。現在の既定）: `RealDataProviderImpl`。
 *   `src/data/api.ts` 経由で実際のSupabase（PostgREST/RPC）を呼ぶ。
 * - 実接続なし（.env未設定のレビュー環境等のフォールバック）: `MockDataProviderImpl`。
 *   旧来のin-memory reducerをそのまま維持する（このファイルの下半分、変更していない）。
 *
 * [設計判断/フォールバック維持の理由] 開発部CLAUDE.mdでは「モックデータ層は完全に
 * 削除せず残すか判断してよい」とされている。.envが無い/壊れている環境でも
 * `npx tsc --noEmit` や `npx expo export` 等の静的検証・デモ表示が引き続き可能である
 * ほうが開発体験上有利なため、フォールバックとして残すと判断した
 * （開発部/成果物/実装メモ.md 15章参照）。
 *
 * 両実装は同じ `DataContextValue` 型（state・dispatch・memberPoints等）を提供するため、
 * 画面側（`useAppData()` を呼ぶ側）はどちらの実装かを意識しない。
 * ただし実接続化に伴い `dispatch` は非同期（`Promise<DispatchResult>`）に、
 * `findChoreByTag` も非同期（`Promise<Chore | undefined>`）に変更した
 * （実際のDBトリガーエラー・RLS越しの0件応答を待ち受ける必要があるため）。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type {
  Chore,
  ChoreCompletion,
  ChoreReaction,
  DailySummaryEntry,
  FamilyBoardReactionWithPostBody,
  FamilyMember,
  GratitudePoint,
  LedgerEntry,
  MemberPoints,
  ReactionKind,
  Reward,
  RewardRedemption,
  StampKey,
} from "@/types/domain";
import {
  seedCategories,
  seedChores,
  seedCompletions,
  seedFamily,
  seedMembers,
  seedReactions,
  seedRedemptions,
  seedRewards,
} from "./seed";
import { toJstDateString } from "@/lib/calendarDates";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import * as api from "./api";
import type { ApiError } from "./api";
import theme from "@/theme/theme";

export interface State {
  family: typeof seedFamily;
  members: FamilyMember[];
  categories: typeof seedCategories;
  chores: Chore[];
  completions: ChoreCompletion[];
  reactions: ChoreReaction[];
  rewards: Reward[];
  redemptions: RewardRedemption[];
  /**
   * [2026-08-16追加] 感謝ポイント（gratitude_points、要件定義書07-5章）の家族全体ログ
   * （取消済みも含む）。API仕様.md 7a.3章「家族全体のログ（実施履歴カレンダー・
   * タイムライン等への統合表示用、任意）」に対応。ここでは主にP16/C8通帳への統合表示
   * （主要画面ワイヤーフレーム.md 4章）に使う。週次原資（giveable balance）は
   * 別会計・別RPC（my_gratitude_giveable_balance）のためこのstateには含まない
   * （ランキング防止の設計判断、スキーマ設計.sql 13章参照。呼び出し本人の残存原資は
   * 各画面がapi.fetchMyGratitudeGiveableBalance()を個別に呼ぶ）。
   */
  gratitude: GratitudePoint[];
  /**
   * [2026-09-01追加・実装メモ.md 104章] 家族の書き込みボードへのスタンプリアクション
   * （family_board_reactions、要件定義書07-14章）の家族全体ログ（対象投稿の本文・
   * 投稿者を埋め込み済み）。`InboxPanel`（「とどいたもの」）が、このうち
   * `family_board_posts.author_member_id === 自分` の行だけを抜き出して
   * 「掲示板の投稿に届いたリアクション」として表示する（主要画面ワイヤーフレーム.md
   * 22.2.2節）。gratitudeと同じ「家族全体を取得し、閲覧側がclient側でフィルタする」
   * パターン。
   */
  familyBoardReactions: FamilyBoardReactionWithPostBody[];
  /** 子ども向け画面で「いまログイン中」として扱うmember_id */
  activeChildMemberId: string;
  /** 保護者向け画面で「いま操作中」として扱うmember_id（リアクションのreacted_byに使う） */
  activeParentMemberId: string;
  /**
   * [2026-08-22追加] 「まいにち」個人設定（chore_daily_flags）。いまログイン中の
   * メンバー（子どもならactiveChildMemberId、保護者ならactiveParentMemberId）自身が
   * 「まいにち」に設定したchore.idの一覧。家族の他メンバーの設定は含まない
   * （個人設定のため、RLSも本人の行のみ返す設計）。
   */
  dailyFlaggedChoreIds: string[];
}

export type Action =
  | { type: "SWITCH_ACTIVE_CHILD"; memberId: string }
  | {
      type: "REPORT_COMPLETION";
      choreId: string;
      reportedBy: string;
      note: string | null;
    }
  | {
      type: "ADD_REACTION";
      completionId: string;
      reactedBy: string;
      kind: ReactionKind;
      stampKey?: StampKey;
      commentBody?: string;
    }
  | { type: "REDEEM_REWARD"; rewardId: string; memberId: string }
  | { type: "SET_CHORE_NFC_TAG"; choreId: string; tagValue: string }
  | { type: "SET_DAILY_FLAG"; memberId: string; choreId: string; flagged: boolean };

export type DispatchResult = { ok: true } | { ok: false; error: ApiError };

export interface DataContextValue {
  state: State;
  /** 初回データ読み込み中かどうか（実接続時のみ意味を持つ。モック実装では常にfalse）。 */
  loading: boolean;
  /** 直近の読み込みで発生した通信エラー（実接続時のみ）。 */
  loadError: string | null;
  /** 家族データ一式を再取得する。書き込み系アクション成功後にも自動で呼ばれる。 */
  refresh: () => Promise<void>;
  dispatch: (action: Action) => Promise<DispatchResult>;
  memberPoints: MemberPoints[];
  isChoreLimitReached: (chore: Chore, memberId: string) => boolean;
  /** 単発（is_repeatable=false）のお手伝いが実施済みで役目を終えているか。isOneOffFinishedFor参照。 */
  isOneOffFinished: (chore: Chore) => boolean;
  earnLedger: (memberId: string) => LedgerEntry[];
  spendLedger: (memberId: string) => LedgerEntry[];
  fullLedger: (memberId: string) => LedgerEntry[];
  /** API仕様.md 4a章手順2「トークンからchoreを特定」相当。 */
  findChoreByTag: (tagValue: string) => Promise<Chore | undefined>;
  /** ある完了報告に届いたリアクション一覧（時系列）。API仕様.md 5章「リアクション一覧取得」相当。 */
  reactionsForCompletion: (completionId: string) => ChoreReaction[];
  /** 自分（reactedBy）がその完了報告に既にそのstamp_keyを送信済みか */
  hasReactedWithStamp: (completionId: string, reactedBy: string, stampKey: StampKey) => boolean;
  /** 実施履歴カレンダー（API仕様.md 6a章）向け。chore_completion_daily_summary View 相当。 */
  dailySummary: (fromDate: string, toDate: string) => DailySummaryEntry[];
}

const AppDataContext = createContext<DataContextValue | null>(null);

export function useAppData(): DataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}

// ============================================================
// 共通ヘルパー（両実装で使う純粋関数）
// ============================================================

/**
 * [2026-08-27追加・本部長] 「単発」（is_repeatable=false）のお手伝いが、誰かに1回実施された
 * ことで役目を終えているかどうか。
 *
 * 単発のchoreには「終わり」という状態が無く、実施後も is_active=true のまま一覧に残り続けて
 * いた（本番でも4件すべてが完了済みのまま最長12日間並んでいた）。ユーザーから
 * 「単発が同じ感じで残り続けるので見にくい」との指摘を受けて追加した判定。
 *
 * DBは変更していない。chore_completionsは追記専用ログなので、この判定は「完了記録が1件でも
 * あるか」だけで決まり、記録を消さない限り勝手に元へ戻ることはない。
 * なお state.completions は期間で絞らず全件取得している（api.fetchCompletionsをsinceIso無しで
 * 呼んでいる）ため、何日前に完了したものでも正しく判定できる。
 */
function isOneOffFinishedFor(completions: ChoreCompletion[], chore: Chore): boolean {
  if (chore.is_repeatable) return false;
  return completions.some((c) => c.chore_id === chore.id);
}

function isChoreLimitReachedFor(completions: ChoreCompletion[], chore: Chore, memberId: string): boolean {
  // chore_completions_before_insertトリガー（daily_limit判定）のクライアント側事前チェック
  // （API仕様.md 3章「クライアントは上限超過時に返るエラーをハンドリングするだけでよい」）。
  // 最終防衛線はDB側であり、この関数はUXのための事前判定に過ぎない。
  if (!chore.is_repeatable) {
    return isOneOffFinishedFor(completions, chore);
  }
  if (chore.daily_limit == null) return false;
  const today = new Date().toDateString();
  const count = completions.filter(
    (c) => c.chore_id === chore.id && c.reported_by === memberId && new Date(c.reported_at).toDateString() === today
  ).length;
  return count >= chore.daily_limit;
}

function buildLedgers(state: State) {
  const reactionsForCompletion = (completionId: string): ChoreReaction[] =>
    state.reactions
      .filter((r) => r.completion_id === completionId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const earnLedger = (memberId: string): LedgerEntry[] =>
    state.completions
      .filter((c) => c.reported_by === memberId)
      .map((c) => ({
        id: c.id,
        kind: "earn" as const,
        label: c.chore_title,
        emoji: c.chore_emoji,
        points: c.points,
        occurredAt: c.reported_at,
        reactions: reactionsForCompletion(c.id),
      }));

  // reward_redemptions は reward_emoji のスナップショットを持たない設計
  // （実装メモ.md 6.1章対応）。ごほうび削除等でreward_idがnullになった場合は🎁をフォールバック。
  const spendLedger = (memberId: string): LedgerEntry[] =>
    state.redemptions
      .filter((r) => r.member_id === memberId)
      .map((r) => ({
        id: r.id,
        kind: "spend" as const,
        label: r.reward_name,
        emoji: state.rewards.find((rw) => rw.id === r.reward_id)?.emoji ?? "🎁",
        points: r.cost,
        occurredAt: r.created_at,
        reactions: [],
      }));

  // [2026-08-16追加] 感謝ポイント受領分（主要画面ワイヤーフレーム.md 4章「感謝ポイントの
  // 通帳への統合表示」）。取消済み（revoked_at IS NOT NULL）は除外する
  // （member_pointsの残高計算〔スキーマ設計.sql 14章〕と表示内容を一致させるため）。
  // ラベルは「◯◯から」、絵文字は💌固定（🎁はごほうび交換の消費履歴で既に使用しているため）。
  const gratitudeReceivedLedger = (memberId: string): LedgerEntry[] =>
    state.gratitude
      .filter((g) => g.recipient_id === memberId && !g.revoked_at)
      .map((g) => {
        const sender = state.members.find((m) => m.id === g.sender_id);
        return {
          id: g.id,
          kind: "gratitude" as const,
          label: `${sender?.display_name ?? "?"}から`,
          emoji: "💌",
          points: g.points,
          occurredAt: g.created_at,
          reactions: [],
          note: g.note,
        };
      });

  const fullLedger = (memberId: string): LedgerEntry[] =>
    [...earnLedger(memberId), ...spendLedger(memberId), ...gratitudeReceivedLedger(memberId)].sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    );

  return { reactionsForCompletion, earnLedger, spendLedger, fullLedger };
}

function LoadingScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.neutralBg }}>
      <ActivityIndicator size="large" color={theme.colors.brandPrimary} />
    </View>
  );
}

// ============================================================
// 実データ実装（Supabase接続）
// ============================================================

const EMPTY_STATE: State = {
  family: { id: "", name: "", invite_code: "", created_at: "", updated_at: "" },
  members: [],
  categories: [],
  chores: [],
  completions: [],
  reactions: [],
  rewards: [],
  redemptions: [],
  gratitude: [],
  familyBoardReactions: [],
  activeChildMemberId: "",
  activeParentMemberId: "",
  dailyFlaggedChoreIds: [],
};

function RealDataProviderImpl({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const [state, setState] = useState<State>(EMPTY_STATE);
  const [memberPoints, setMemberPoints] = useState<MemberPoints[]>([]);
  const [dailySummaryRows, setDailySummaryRows] = useState<DailySummaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  // [2026-08-22変更] みまもりメンバー（session.status === "supporter"）対応。
  // 認証方式・family_membersの持ち方が保護者と全く同じ（06章・07-7章）ため、
  // データ読み込み・activeParentMemberIdの解決ロジックも「parent」と全く同じ扱いで
  // 済む（画面側は state.activeParentMemberId を通じて自分のmember_idを得る）。
  const familyId =
    session.status === "parent" || session.status === "supporter"
      ? session.parentMember?.family_id ?? null
      : session.status === "child"
      ? session.childSession?.member.family_id ?? null
      : null;

  const activeChildMemberId = session.status === "child" ? session.childSession?.member.member_id ?? "" : "";
  const activeParentMemberId =
    session.status === "parent" || session.status === "supporter" ? session.parentMember?.id ?? "" : "";

  const load = useCallback(async () => {
    if (!familyId) return;
    setLoading(true);
    setLoadError(null);
    const client = session.client;

    const bundleRes = await api.fetchFamilyBundle(client, familyId);
    if (!bundleRes.ok) {
      setLoadError(bundleRes.error.message);
      setLoading(false);
      return;
    }

    const today = toJstDateString(new Date());
    // 実施履歴カレンダー（週間バー・月間カレンダー）が過去〜今日までの任意の範囲を
    // クライアント側でナビゲーションできるよう、広めの窓（過去400日〜当日）を
    // 一括取得してキャッシュし、dailySummary()はこのキャッシュを同期フィルタする
    // （既存画面のdailySummary()呼び出しが同期関数である前提を崩さないための設計判断。
    // 実装メモ.md参照。データ量の多い実運用では期間ごとの都度フェッチへの見直しが必要）。
    const windowStart = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 400);
      return toJstDateString(d);
    })();

    // [2026-08-22追加] 「まいにち」個人設定はいまログイン中の本人の行のみを見る
    // （chore_daily_flagsのRLSも本人の行のみ許可。activeChildMemberId/
    // activeParentMemberIdのどちらか一方だけが非空になる設計、上記参照）。
    const activeMemberId = activeChildMemberId || activeParentMemberId;

    const [
      completionsRes,
      reactionsRes,
      redemptionsRes,
      memberPointsRes,
      gratitudeRes,
      familyBoardReactionsRes,
      dailySummaryRes,
      dailyFlagsRes,
    ] = await Promise.all([
      api.fetchCompletions(client, familyId),
      api.fetchReactions(client, familyId),
      api.fetchRedemptions(client, familyId),
      api.fetchMemberPoints(client, familyId),
      // [2026-08-16追加] 感謝ポイント家族全体ログ（P16/C8通帳への統合表示用、
      // buildLedgers()のgratitudeReceivedLedger参照）。member_points View自体は
      // 既にgratitude_points受領分を合算済み（スキーマ設計.sql 14章）のため、
      // ここで再取得するのは通帳の履歴行表示用のみ。
      api.fetchGratitudeLog(client, familyId),
      // [2026-09-01追加・実装メモ.md 104章] 家族の書き込みボードへのリアクション
      // 家族全体ログ（InboxPanel「とどいたもの」への合流用）。
      api.fetchFamilyBoardReactionsLog(client, familyId),
      client
        .from("chore_completion_daily_summary")
        .select("*")
        .eq("family_id", familyId)
        .gte("activity_date", windowStart)
        .lte("activity_date", today),
      api.fetchMyDailyFlaggedChoreIds(client, activeMemberId),
    ]);

    if (!completionsRes.ok) {
      setLoadError(completionsRes.error.message);
      setLoading(false);
      return;
    }
    if (!reactionsRes.ok) {
      setLoadError(reactionsRes.error.message);
      setLoading(false);
      return;
    }
    if (!redemptionsRes.ok) {
      setLoadError(redemptionsRes.error.message);
      setLoading(false);
      return;
    }
    if (!memberPointsRes.ok) {
      setLoadError(memberPointsRes.error.message);
      setLoading(false);
      return;
    }
    if (!gratitudeRes.ok) {
      setLoadError(gratitudeRes.error.message);
      setLoading(false);
      return;
    }
    if (!familyBoardReactionsRes.ok) {
      setLoadError(familyBoardReactionsRes.error.message);
      setLoading(false);
      return;
    }
    if (dailySummaryRes.error) {
      setLoadError(dailySummaryRes.error.message);
      setLoading(false);
      return;
    }
    if (!dailyFlagsRes.ok) {
      setLoadError(dailyFlagsRes.error.message);
      setLoading(false);
      return;
    }

    setState({
      family: bundleRes.data.family,
      members: bundleRes.data.members,
      categories: bundleRes.data.categories,
      chores: bundleRes.data.chores,
      completions: completionsRes.data,
      reactions: reactionsRes.data,
      rewards: bundleRes.data.rewards,
      redemptions: redemptionsRes.data,
      gratitude: gratitudeRes.data,
      familyBoardReactions: familyBoardReactionsRes.data,
      activeChildMemberId,
      activeParentMemberId,
      dailyFlaggedChoreIds: dailyFlagsRes.data,
    });
    setMemberPoints(memberPointsRes.data);
    setDailySummaryRows((dailySummaryRes.data ?? []) as DailySummaryEntry[]);
    setLoading(false);
    setLoadedOnce(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, session.client, activeChildMemberId, activeParentMemberId]);

  // [2026-08-16修正・本部長] 実機で保護者→子どもへログインを切り替えた際、
  // "Cannot read properties of undefined (reading 'display_name')" というクラッシュを
  // 発見した。原因は2つ重なっていた。
  // (1) このuseEffectの依存配列がfamilyIdのみだったため、同じ家族内で保護者から
  //     子どもへ（またはその逆）ログイン主体が切り替わった場合（familyId自体は
  //     同じ値のまま）、load()が再実行されず、state.activeChildMemberId等の
  //     フィールドが古いセッションの値（空文字列）のまま更新されなかった。
  // (2) 下記「familyIdが確定していて未読み込みの間はスピナーのみを表示する」ゲートが
  //     loadedOnceを見ているが、loadedOnceは一度trueになると二度とfalseに戻らない
  //     設計だったため、(1)の再読み込みが完了するまでの一瞬の間もスピナーに
  //     切り替わらず、古いstateのままC5等の画面が描画されてしまっていた。
  // 対策として、依存配列にactiveChildMemberId/activeParentMemberIdを追加してload()の
  // 再実行条件を広げ、あわせてセッション識別子（保護者/子どもの別＋メンバーID）が
  // 変化するたびにloadedOnceをfalseに戻す（下記useEffect）ことで、新しいセッションの
  // データが揃うまで確実にローディングゲートが働くようにした。
  useEffect(() => {
    if (familyId) {
      void load();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, session.status, activeChildMemberId, activeParentMemberId]);

  const sessionIdentityKey = `${session.status}:${activeChildMemberId}:${activeParentMemberId}`;
  useEffect(() => {
    setLoadedOnce(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdentityKey]);

  const dispatch = useCallback(
    async (action: Action): Promise<DispatchResult> => {
      const client = session.client;
      switch (action.type) {
        case "SWITCH_ACTIVE_CHILD":
          // 実接続時は「ログイン中の子ども」がactiveChildMemberIdを決めるため、
          // このアクションは対象外（呼び出し元をC1〜C4/C12の再ログイン導線に置き換え済み）。
          return { ok: true };

        case "REPORT_COMPLETION": {
          const res = await api.reportCompletion(client, {
            chore_id: action.choreId,
            reported_by: action.reportedBy,
            note: action.note,
          });
          if (!res.ok) return { ok: false, error: res.error };
          await load();
          return { ok: true };
        }

        case "ADD_REACTION": {
          const res = await api.addReaction(client, {
            completion_id: action.completionId,
            reacted_by: action.reactedBy,
            kind: action.kind,
            stamp_key: action.stampKey,
            comment_body: action.commentBody,
          });
          if (!res.ok) {
            // uq_chore_reactions_stamp_dedup（同一スタンプの連打）はunique_violationとして
            // 返るが、UI側はボタン無効化で未然に防いでいるため、UIに例外扱いさせず
            // 成功扱いに丸める（API仕様.md 9章「クライアントはunique_violationを無視してよい」）。
            if (res.error.code === api.PG_ERRCODE.uniqueViolation) return { ok: true };
            return { ok: false, error: res.error };
          }
          await load();
          return { ok: true };
        }

        case "REDEEM_REWARD": {
          const res = await api.redeemReward(client, { reward_id: action.rewardId, member_id: action.memberId });
          if (!res.ok) return { ok: false, error: res.error };
          await load();
          return { ok: true };
        }

        case "SET_CHORE_NFC_TAG": {
          const res = await api.setChoreNfcTag(client, action.choreId, action.tagValue);
          if (!res.ok) return { ok: false, error: res.error };
          await load();
          return { ok: true };
        }

        case "SET_DAILY_FLAG": {
          if (!familyId) return { ok: false, error: { code: "no_family", message: "家族が確定していません" } };
          const res = await api.setChoreDailyFlag(client, familyId, action.memberId, action.choreId, action.flagged);
          if (!res.ok) return { ok: false, error: res.error };
          await load();
          return { ok: true };
        }

        default:
          return { ok: true };
      }
    },
    [session.client, load]
  );

  const findChoreByTag = useCallback(
    async (tagValue: string): Promise<Chore | undefined> => {
      const res = await api.findChoreByTag(session.client, tagValue);
      if (!res.ok || !res.data) return undefined;
      return res.data;
    },
    [session.client]
  );

  const ledgers = useMemo(() => buildLedgers(state), [state]);

  const value = useMemo<DataContextValue>(
    () => ({
      state,
      loading,
      loadError,
      refresh: load,
      dispatch,
      memberPoints,
      isChoreLimitReached: (chore, memberId) => isChoreLimitReachedFor(state.completions, chore, memberId),
      isOneOffFinished: (chore) => isOneOffFinishedFor(state.completions, chore),
      ...ledgers,
      findChoreByTag,
      hasReactedWithStamp: (completionId, reactedBy, stampKey) =>
        state.reactions.some(
          (r) => r.completion_id === completionId && r.reacted_by === reactedBy && r.kind === "stamp" && r.stamp_key === stampKey
        ),
      dailySummary: (fromDate, toDate) =>
        dailySummaryRows.filter((r) => r.activity_date >= fromDate && r.activity_date <= toDate),
    }),
    [state, loading, loadError, load, dispatch, memberPoints, ledgers, findChoreByTag, dailySummaryRows]
  );

  // familyIdが確定していて未読み込みの間はスピナーのみを表示する。
  // state.members等が空配列のままonboarding後の画面（P7/C5等）が描画されると
  // `.find(...)!` の非nullアサーションが実行時エラーになるため（既存画面側の実装が
  // 「データは既にある」前提で書かれているため、ここで安全側に倒す）。
  // [設計上の補完・主要画面ワイヤーフレーム.mdに全画面共通の「起動時読み込み」状態の
  // 明記は無いため、既存のSkeletonList等とは別に、シンプルな全画面スピナーを採用した。
  // [2026-08-16修正・本部長] 31章「続報」参照。上記ゲートは`familyId`が確定して
  // いる場合のみ有効だったが、`session.status === "loading"`（SessionProvider起動時、
  // SecureStore/AsyncStorageからのセッション復元がまだ完了していない一瞬）の間は
  // `familyId`もnullのままのため、このゲートを素通りしていた。通常はこの一瞬に
  // 子ども向け画面が直接描画されることは無いが、ログイン成功直後に`/child/home`へ
  // ハード遷移（ページ全体の再読み込み）するケースでは、着地直後・セッション復元完了前の
  // 一瞬に`ChildHomeScreen`が空のEMPTY_STATEのまま描画され、
  // `Cannot read properties of undefined (reading 'display_name')`のクラッシュに
  // つながっていた（実機テストで複数回再現・デバッグログで確認）。
  // セッション状態が確定するまでは常にスピナーを表示するようにする。
  if (session.status === "loading" || (familyId && !loadedOnce)) {
    return <LoadingScreen />;
  }

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

// ============================================================
// モック実装（Supabase未接続時のフォールバック。ロジックは変更していない）
// ============================================================

const initialState: State = {
  family: seedFamily,
  members: seedMembers,
  categories: seedCategories,
  chores: seedChores,
  completions: seedCompletions,
  reactions: seedReactions,
  rewards: seedRewards,
  redemptions: seedRedemptions,
  // [2026-08-16追加] モック実装ではgratitude_pointsの初期シードは用意していない
  // （空配列。感謝ポイント関連画面はSupabase未接続時、常に「まだ贈った/もらった記録は
  // ありません」の空状態から始まる。7a章APIはRPC/PostgREST直呼びのためモック実装
  // 〔dispatch経由〕には組み込んでいない。実装メモ.md参照）。
  gratitude: [],
  // [2026-09-01追加・実装メモ.md 104章] gratitudeと同じ理由でモック実装では空配列。
  familyBoardReactions: [],
  activeChildMemberId: "member-child-1",
  activeParentMemberId: "member-parent-1",
  dailyFlaggedChoreIds: [],
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SWITCH_ACTIVE_CHILD":
      return { ...state, activeChildMemberId: action.memberId };

    case "REPORT_COMPLETION": {
      const chore = state.chores.find((c) => c.id === action.choreId);
      if (!chore) return state;
      const now = new Date().toISOString();
      const completion: ChoreCompletion = {
        id: `completion-${Date.now()}`,
        family_id: state.family.id,
        chore_id: chore.id,
        chore_title: chore.title,
        chore_emoji: chore.emoji,
        reported_by: action.reportedBy,
        points: chore.points,
        photo_url: null,
        note: action.note,
        reported_at: now,
      };
      return { ...state, completions: [completion, ...state.completions] };
    }

    case "ADD_REACTION": {
      if (action.kind === "stamp") {
        const alreadyReacted = state.reactions.some(
          (r) =>
            r.completion_id === action.completionId &&
            r.reacted_by === action.reactedBy &&
            r.kind === "stamp" &&
            r.stamp_key === action.stampKey
        );
        if (alreadyReacted) return state;
      }
      const reaction: ChoreReaction = {
        id: `reaction-${Date.now()}`,
        family_id: state.family.id,
        completion_id: action.completionId,
        reacted_by: action.reactedBy,
        kind: action.kind,
        stamp_key: action.kind === "stamp" ? action.stampKey ?? null : null,
        comment_body: action.kind === "comment" ? action.commentBody ?? null : null,
        created_at: new Date().toISOString(),
      };
      return { ...state, reactions: [...state.reactions, reaction] };
    }

    case "REDEEM_REWARD": {
      const reward = state.rewards.find((r) => r.id === action.rewardId);
      if (!reward) return state;
      const balance =
        computeMemberPoints(state).find((m) => m.member_id === action.memberId)?.current_points ?? 0;
      if (balance < reward.cost) {
        return state;
      }
      const redemption: RewardRedemption = {
        id: `redemption-${Date.now()}`,
        family_id: state.family.id,
        reward_id: reward.id,
        reward_name: reward.name,
        member_id: action.memberId,
        cost: reward.cost,
        status: "approved",
        created_at: new Date().toISOString(),
      };
      return { ...state, redemptions: [redemption, ...state.redemptions] };
    }

    case "SET_CHORE_NFC_TAG": {
      return {
        ...state,
        chores: state.chores.map((c) => (c.id === action.choreId ? { ...c, nfc_tag_id: action.tagValue } : c)),
      };
    }

    case "SET_DAILY_FLAG": {
      const flagged = new Set(state.dailyFlaggedChoreIds);
      if (action.flagged) flagged.add(action.choreId);
      else flagged.delete(action.choreId);
      return { ...state, dailyFlaggedChoreIds: [...flagged] };
    }

    default:
      return state;
  }
}

function findChoreByTagValue(state: State, tagValue: string): Chore | undefined {
  return state.chores.find((c) => c.nfc_tag_id === tagValue && c.is_active);
}

function computeMemberPoints(state: State): MemberPoints[] {
  return state.members
    .filter((m) => m.is_active)
    .map((m) => {
      const earned = state.completions.filter((c) => c.reported_by === m.id).reduce((sum, c) => sum + c.points, 0);
      const spent = state.redemptions
        .filter((r) => r.member_id === m.id && r.status === "approved")
        .reduce((sum, r) => sum + r.cost, 0);
      return { member_id: m.id, family_id: m.family_id, display_name: m.display_name, current_points: earned - spent };
    });
}

function computeDailySummary(state: State, fromDate: string, toDate: string): DailySummaryEntry[] {
  const map = new Map<string, DailySummaryEntry>();
  for (const c of state.completions) {
    const activityDate = toJstDateString(c.reported_at);
    if (activityDate < fromDate || activityDate > toDate) continue;
    const key = `${activityDate}__${c.reported_by}`;
    const existing = map.get(key);
    if (existing) {
      existing.completion_count += 1;
      existing.total_points += c.points;
    } else {
      map.set(key, { activity_date: activityDate, member_id: c.reported_by, family_id: c.family_id, completion_count: 1, total_points: c.points });
    }
  }
  return Array.from(map.values());
}

function MockDataProviderImpl({ children }: { children: React.ReactNode }) {
  const [state, dispatchRaw] = useReducer(reducer, initialState);

  const dispatch = useCallback(async (action: Action): Promise<DispatchResult> => {
    dispatchRaw(action);
    return { ok: true };
  }, []);

  const findChoreByTag = useCallback(async (tagValue: string) => findChoreByTagValue(state, tagValue), [state]);

  const ledgers = useMemo(() => buildLedgers(state), [state]);

  const value = useMemo<DataContextValue>(
    () => ({
      state,
      loading: false,
      loadError: null,
      refresh: async () => {},
      dispatch,
      memberPoints: computeMemberPoints(state),
      isChoreLimitReached: (chore, memberId) => isChoreLimitReachedFor(state.completions, chore, memberId),
      isOneOffFinished: (chore) => isOneOffFinishedFor(state.completions, chore),
      ...ledgers,
      findChoreByTag,
      hasReactedWithStamp: (completionId, reactedBy, stampKey) =>
        state.reactions.some(
          (r) => r.completion_id === completionId && r.reacted_by === reactedBy && r.kind === "stamp" && r.stamp_key === stampKey
        ),
      dailySummary: (fromDate, toDate) => computeDailySummary(state, fromDate, toDate),
    }),
    [state, dispatch, ledgers, findChoreByTag]
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

// ============================================================
// エクスポート（実装の切り替え）
// ============================================================

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return <MockDataProviderImpl>{children}</MockDataProviderImpl>;
  }
  return <RealDataProviderImpl>{children}</RealDataProviderImpl>;
}
