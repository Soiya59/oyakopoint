/**
 * 習慣カード（台紙）とフィギュア（要件定義書07-28章、API仕様.md 15章）向けの
 * データ取得・操作フック。
 * 参照: src/data/api.ts（fetchHabitFigureCatalog/fetchHabitCards/
 * fetchHabitCardProgressCount/fetchHabitFigureGrantsForCard/endHabitCard/
 * decorateTreeWithHabitFigure/moveTreeHabitFigure）。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import {
  decorateTreeWithHabitFigure,
  endHabitCard,
  fetchFamilyHabitFigureGrants,
  fetchHabitCardProgressCount,
  fetchHabitCards,
  fetchHabitFigureCatalog,
  fetchHabitFigureGrantsForCard,
  fetchLatestHabitFigureGrant,
  fetchMyHabitFigureGrants,
  moveTreeHabitFigure,
  type ApiError,
} from "@/data/api";
import type {
  HabitCard,
  HabitFigureCatalogItem,
  HabitFigureGrantWithCatalog,
  HabitFigureGrantWithPlacement,
} from "@/types/domain";

export type HabitCardLoadState = "loading" | "error" | "ready";

/** 台紙の種類一覧（クエスト作成時の種類選択・見出し表示の両方で使う、家族共通の静的カタログ）。 */
export function useHabitFigureCatalog() {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<HabitCardLoadState>("loading");
  const [catalog, setCatalog] = useState<HabitFigureCatalogItem[]>([]);

  const load = useCallback(async () => {
    setLoadState("loading");
    const res = await fetchHabitFigureCatalog(client);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setCatalog(res.data);
    setLoadState("ready");
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, catalog, reload: load };
}

/** kind_keyごとに4段階（銅/銀/金/クリスタル）をまとめた種類選択用の1グループ。 */
export interface HabitKindGroup {
  kindKey: string;
  kindDisplayName: string;
  kindEmoji: string | null;
  tiers: HabitFigureCatalogItem[]; // bronze/silver/gold/crystalの順
}

const TIER_ORDER: Record<string, number> = { bronze: 1, silver: 2, gold: 3, crystal: 4 };

/** 決定5・6「1行1種類、4段階プレビュー」の表示用に、カタログをkind_keyでグルーピングする純関数。 */
export function groupHabitFigureCatalogByKind(catalog: HabitFigureCatalogItem[]): HabitKindGroup[] {
  const map = new Map<string, HabitKindGroup>();
  for (const item of catalog) {
    const existing = map.get(item.kind_key);
    if (existing) {
      existing.tiers.push(item);
    } else {
      map.set(item.kind_key, {
        kindKey: item.kind_key,
        kindDisplayName: item.kind_display_name,
        kindEmoji: item.kind_emoji,
        tiers: [item],
      });
    }
  }
  const groups = Array.from(map.values());
  for (const g of groups) g.tiers.sort((a, b) => (TIER_ORDER[a.tier] ?? 0) - (TIER_ORDER[b.tier] ?? 0));
  // sort_orderの昇順（同じkind_keyの4行は同じ値、55.2章）。
  groups.sort((a, b) => (a.tiers[0]?.sort_order ?? 0) - (b.tiers[0]?.sort_order ?? 0));
  return groups;
}

/** 1枚の台紙の累計・段階の表示に必要な情報（habit_cards 1行 + 累計件数）。 */
export interface HabitCardWithProgress {
  card: HabitCard;
  count: number;
}

/**
 * 累計件数から「現在の段階（未到達ならnull）」「次の段階の閾値
 * （クリスタル達成済みならnull）」を導く純関数（スキーマ設計.sql 55.5章の
 * `habit_card_progress_bump()`と全く同じ閾値・同じ判定順）。
 */
export function computeHabitCardTierInfo(count: number): {
  currentTier: "bronze" | "silver" | "gold" | "crystal" | null;
  nextThreshold: number | null;
} {
  if (count >= 100) return { currentTier: "crystal", nextThreshold: null };
  if (count >= 50) return { currentTier: "gold", nextThreshold: 100 };
  if (count >= 30) return { currentTier: "silver", nextThreshold: 50 };
  if (count >= 10) return { currentTier: "bronze", nextThreshold: 30 };
  return { currentTier: null, nextThreshold: 10 };
}

/**
 * 台紙一覧（じぶんタブの台紙カード・新設「台紙」画面の両方で使う）。
 * `memberId`には家族内の任意のメンバーIDを渡してよい（決定12、家族の誰でも
 * 他メンバーの台紙を閲覧できる）。
 */
export function useHabitCardsForMember(memberId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<HabitCardLoadState>("loading");
  const [activeCards, setActiveCards] = useState<HabitCardWithProgress[]>([]);
  const [archivedCards, setArchivedCards] = useState<HabitCard[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoadState("loading");
    const [activeRes, archivedRes] = await Promise.all([
      fetchHabitCards(client, memberId, "active"),
      fetchHabitCards(client, memberId, "archived"),
    ]);
    if (!activeRes.ok || !archivedRes.ok) {
      setLoadState("error");
      return;
    }
    const withProgress = await Promise.all(
      activeRes.data.map(async (card) => {
        const countRes = await fetchHabitCardProgressCount(client, card.chore_id, card.member_id, card.started_at);
        return { card, count: countRes.ok ? countRes.data : 0 };
      })
    );
    setActiveCards(withProgress);
    setArchivedCards(archivedRes.data);
    setLoadState("ready");
  }, [client, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, activeCards, archivedCards, reload: load };
}

/** 完成済み（アーカイブ済み）台紙1件の獲得フィギュア一覧（決定17「見る▼」展開時に取得）。 */
export function useHabitCardFigureGrants(habitCardId: string | null) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<HabitCardLoadState>("loading");
  const [grants, setGrants] = useState<HabitFigureGrantWithCatalog[]>([]);

  const load = useCallback(async () => {
    if (!habitCardId) return;
    setLoadState("loading");
    const res = await fetchHabitFigureGrantsForCard(client, habitCardId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setGrants(res.data);
    setLoadState("ready");
  }, [client, habitCardId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, grants, reload: load };
}

export type EndHabitCardActionResult = { ok: true; archivedAt: string } | { ok: false; error: ApiError };

/** 「おわりにする」操作（決定18・19）。 */
export function useEndHabitCardAction() {
  const { client } = useSession();
  const [ending, setEnding] = useState(false);

  const end = useCallback(
    async (habitCardId: string): Promise<EndHabitCardActionResult> => {
      setEnding(true);
      const res = await endHabitCard(client, habitCardId);
      setEnding(false);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, archivedAt: res.data };
    },
    [client]
  );

  return { ending, end };
}

export type DecorateHabitFigureActionResult = { ok: true; decorationId: string } | { ok: false; error: ApiError };

/** 獲得したフィギュアを木に飾る操作（決定21、既存メダルの導線を流用）。 */
export function useDecorateTreeWithHabitFigureAction() {
  const { client } = useSession();
  const [decorating, setDecorating] = useState(false);

  const decorate = useCallback(
    async (grantId: string, posX: number, posY: number): Promise<DecorateHabitFigureActionResult> => {
      setDecorating(true);
      const res = await decorateTreeWithHabitFigure(client, grantId, posX, posY);
      setDecorating(false);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, decorationId: res.data };
    },
    [client]
  );

  return { decorating, decorate };
}

/**
 * API仕様.md 15.4節「直近で新しく付与されたフィギュアが無いか確認する」。
 * 台紙型クエストの完了報告が成功した直後（`dispatch`が返す`reportedAt`を渡す）に
 * 呼ぶ。新しい付与が見つかれば演出用の情報を返し、無ければ`null`を返す。
 * クライアントが明示的に呼び出す通常のAPIは他に存在しない（サーバー側の
 * トリガーが完全に自動で行うため、これは「差分を検知する」ための後追いの
 * 確認クエリにすぎない）。
 */
export function useCheckNewHabitFigureGrant() {
  const { client } = useSession();
  const check = useCallback(
    async (memberId: string, reportedAtIso: string): Promise<HabitFigureGrantWithCatalog | null> => {
      const res = await fetchLatestHabitFigureGrant(client, memberId);
      if (!res.ok || !res.data) return null;
      const grant = res.data;
      const isNew = new Date(grant.granted_at).getTime() >= new Date(reportedAtIso).getTime();
      return isNew ? grant : null;
    },
    [client]
  );
  return { check };
}

export type MoveHabitFigureActionResult = { ok: true; decorationId: string } | { ok: false; error: ApiError };

/** 木に貼ったフィギュアを、その月のうちに動かす操作。 */
export function useMoveTreeHabitFigureAction() {
  const { client } = useSession();
  const [moving, setMoving] = useState(false);

  const move = useCallback(
    async (decorationId: string, posX: number, posY: number): Promise<MoveHabitFigureActionResult> => {
      setMoving(true);
      const res = await moveTreeHabitFigure(client, decorationId, posX, posY);
      setMoving(false);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, decorationId: res.data };
    },
    [client]
  );

  return { moving, move };
}

/**
 * コレクター棚「集めたもの」区画・フィギュア区分（個別メンバー選択時、決定23と
 * 同型）。`useMyStickerPurchases`と同じ形。
 */
export function useMyHabitFigureGrants(memberId: string, currentSeasonId: string | null) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<HabitCardLoadState>("loading");
  const [grants, setGrants] = useState<HabitFigureGrantWithPlacement[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoadState("loading");
    const res = await fetchMyHabitFigureGrants(client, memberId, currentSeasonId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setGrants(res.data);
    setLoadState("ready");
  }, [client, memberId, currentSeasonId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, grants, reload: load };
}

/** 「全員」選択時の「フィギュア」区分（`useFamilyStickerPurchases`と同じ形）。 */
export function useFamilyHabitFigureGrants(familyId: string, currentSeasonId: string | null) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<HabitCardLoadState>("loading");
  const [grants, setGrants] = useState<HabitFigureGrantWithPlacement[]>([]);

  const load = useCallback(async () => {
    if (!familyId) return;
    setLoadState("loading");
    const res = await fetchFamilyHabitFigureGrants(client, familyId, currentSeasonId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setGrants(res.data);
    setLoadState("ready");
  }, [client, familyId, currentSeasonId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, grants, reload: load };
}
