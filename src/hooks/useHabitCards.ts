/**
 * シール帳（習慣カード）とフィギュア（要件定義書07-28章2026-09-19全面改訂・
 * 決定25〜33、API仕様.md 17章、開発部/成果物/実装メモ.md 256章）向けの
 * データ取得・操作フック。
 * 参照: src/data/api.ts（fetchHabitFigureCatalog/fetchActiveHabitCard/
 * fetchCompletedHabitCards/fetchHabitCardChoreBreakdown/chooseHabitCardKind/
 * fetchHabitFigureGrantsForCards/decorateTreeWithHabitFigure/
 * moveTreeHabitFigure）。
 *
 * [load()の中心バンドルに追加しないこと・API仕様.md 17.9節] このファイルの
 * フックはいずれもシール帳の画面がマウントされたときにだけ個別に通信する。
 * `src/data/store.tsx`の`load()`には一切クエリを足していない（254章・
 * 56.4章と同じ申し送り）。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import {
  chooseHabitCardKind,
  decorateTreeWithHabitFigure,
  fetchActiveHabitCard,
  fetchCompletedHabitCards,
  fetchFamilyHabitFigureGrants,
  fetchHabitCardChoreBreakdown,
  fetchHabitFigureCatalog,
  fetchHabitFigureGrantsForCards,
  fetchLatestHabitFigureGrant,
  fetchMyHabitFigureGrants,
  moveTreeHabitFigure,
  type ApiError,
} from "@/data/api";
import type {
  HabitCard,
  HabitCardChoreBreakdownRow,
  HabitFigureCatalogItem,
  HabitFigureGrantWithCatalog,
  HabitFigureGrantWithPlacement,
} from "@/types/domain";

export type HabitCardLoadState = "loading" | "error" | "ready";

/** シール帳の絵柄一覧（絵柄選び直し画面用、家族共通の静的カタログ）。 */
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

/** kind_keyごとに4段階（銅/銀/金/クリスタル）をまとめた絵柄選択用の1グループ。 */
export interface HabitKindGroup {
  kindKey: string;
  kindDisplayName: string;
  /** 決定71（主要画面ワイヤーフレーム.md 49-B.15章）。子ども向けひらがな表記。NULL=未入力。 */
  kindDisplayNameChild: string | null;
  kindEmoji: string | null;
  isFree: boolean;
  tiers: HabitFigureCatalogItem[]; // bronze/silver/gold/crystalの順
}

const TIER_ORDER: Record<string, number> = { bronze: 1, silver: 2, gold: 3, crystal: 4 };

/** 決定43「1行1種類、4段階プレビュー」の表示用に、カタログをkind_keyでグルーピングする純関数。 */
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
        kindDisplayNameChild: item.kind_display_name_child,
        kindEmoji: item.kind_emoji,
        isFree: item.is_free,
        tiers: [item],
      });
    }
  }
  const groups = Array.from(map.values());
  for (const g of groups) g.tiers.sort((a, b) => (TIER_ORDER[a.tier] ?? 0) - (TIER_ORDER[b.tier] ?? 0));
  // sort_orderの昇順（同じkind_keyの4行は同じ値、57.2章）。
  groups.sort((a, b) => (a.tiers[0]?.sort_order ?? 0) - (b.tiers[0]?.sort_order ?? 0));
  return groups;
}

/**
 * 累計件数から「現在の段階（未到達ならnull）」「次の段階の閾値
 * （クリスタル達成済みならnull）」を導く純関数（スキーマ設計.sql 57.5章の
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
 * 自分（または家族の任意メンバー、決定12）の進行中のシール帳1冊＋その内訳
 * （API仕様.md 17.2節・17.3節）。帯（進み具合のみ）・タップ先（進行中の
 * 内訳）の両方がこの1回の取得結果を共用する（N+1にしない）。決定27
 * 「進行中の冊は常に1冊」により、`card`が`null`になるのは異常系のみ。
 *
 * 【2026-09-19差分修正・主要画面ワイヤーフレーム.md 49-B.5章開発部への実装
 * メモ】絵柄の選び直し可否（決定60）の判定用に、進行中の冊の`habit_figure_
 * grants`もあわせて取得する（`fetchHabitFigureGrantsForCards`を1件のIDで
 * 流用。N+1にはならない、この画面の1回の遷移につき常に1回だけ呼ぶ）。
 */
export function useActiveHabitCard(memberId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<HabitCardLoadState>("loading");
  const [card, setCard] = useState<HabitCard | null>(null);
  const [breakdown, setBreakdown] = useState<HabitCardChoreBreakdownRow[]>([]);
  const [grants, setGrants] = useState<HabitFigureGrantWithCatalog[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoadState("loading");
    const cardRes = await fetchActiveHabitCard(client, memberId);
    if (!cardRes.ok) {
      setLoadState("error");
      return;
    }
    setCard(cardRes.data);
    if (!cardRes.data) {
      setBreakdown([]);
      setGrants([]);
      setLoadState("ready");
      return;
    }
    const [breakdownRes, grantsRes] = await Promise.all([
      fetchHabitCardChoreBreakdown(client, [cardRes.data.id]),
      fetchHabitFigureGrantsForCards(client, [cardRes.data.id]),
    ]);
    if (!breakdownRes.ok || !grantsRes.ok) {
      setLoadState("error");
      return;
    }
    setBreakdown(breakdownRes.data);
    setGrants(grantsRes.data);
    setLoadState("ready");
  }, [client, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 帯に出す進み具合（n/100）。API仕様.md 17.2節「completion_countをクライアント
  // 側で合計する」。
  const totalCount = breakdown.reduce((sum, row) => sum + row.completion_count, 0);

  return { loadState, card, breakdown, totalCount, grants, reload: load };
}

/** 完成済み（コレクション）のシール帳一覧＋内訳＋獲得フィギュア（API仕様.md 17.4節）。 */
export function useCompletedHabitCards(memberId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<HabitCardLoadState>("loading");
  const [cards, setCards] = useState<HabitCard[]>([]);
  const [breakdown, setBreakdown] = useState<HabitCardChoreBreakdownRow[]>([]);
  const [grants, setGrants] = useState<HabitFigureGrantWithCatalog[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoadState("loading");
    const cardsRes = await fetchCompletedHabitCards(client, memberId);
    if (!cardsRes.ok) {
      setLoadState("error");
      return;
    }
    setCards(cardsRes.data);
    const ids = cardsRes.data.map((c) => c.id);
    // [N+1にしない・49-B.6節開発部への実装メモ] 冊の枚数ぶん個別に呼ばない。
    const [breakdownRes, grantsRes] = await Promise.all([
      fetchHabitCardChoreBreakdown(client, ids),
      fetchHabitFigureGrantsForCards(client, ids),
    ]);
    if (!breakdownRes.ok || !grantsRes.ok) {
      setLoadState("error");
      return;
    }
    setBreakdown(breakdownRes.data);
    setGrants(grantsRes.data);
    setLoadState("ready");
  }, [client, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, cards, breakdown, grants, reload: load };
}

export type ChooseHabitCardKindActionResult = { ok: true; habitCardId: string } | { ok: false; error: ApiError };

/** 絵柄の選び直し（決定29・42、57.6章。累計0件のときのみ成功する）。 */
export function useChooseHabitCardKindAction() {
  const { client } = useSession();
  const [choosing, setChoosing] = useState(false);

  const choose = useCallback(
    async (habitCardId: string, kindKey: string): Promise<ChooseHabitCardKindActionResult> => {
      setChoosing(true);
      const res = await chooseHabitCardKind(client, habitCardId, kindKey);
      setChoosing(false);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, habitCardId: res.data };
    },
    [client]
  );

  return { choosing, choose };
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
 * API仕様.md 17.7節「直近で新しく付与されたフィギュアが無いか確認する」。
 * 完了報告が成功した直後（`dispatch`が返す`reportedAt`を渡す）に呼ぶ。
 * 新しい付与が見つかれば演出用の情報を返し、無ければ`null`を返す。
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
