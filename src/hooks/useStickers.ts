/**
 * 木を飾るステッカー購入（要件定義書07-19-9a章、API仕様.md 14.1〜14.4章）向けの
 * データ取得・操作フック。
 * 参照: src/data/api.ts（fetchStickerCatalog/purchaseSticker/fetchMyStickerPurchases/
 * decorateTreeWithSticker）。
 *
 * バッジ（14.7章）は useBadges.ts に分離した（07-19-9b章はステッカーとは別の
 * 「ポイントを消費しない情報的フィードバック」という性質を持つため、実装単位も分ける）。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import {
  decorateTreeWithSticker,
  fetchFamilyStickerPurchases,
  fetchMyStickerPurchases,
  fetchStickerCatalog,
  moveTreeSticker,
  purchaseSticker,
  type ApiError,
  type PurchaseStickerResult,
} from "@/data/api";
import { toJstDateString } from "@/lib/calendarDates";
import type { StickerCatalogItem, StickerPurchaseWithCatalog } from "@/types/domain";

export type StickerLoadState = "loading" | "error" | "ready";

/** 購入画面（P37/C30/S23）用: カタログ12種を取得する。 */
export function useStickerCatalog() {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<StickerLoadState>("loading");
  const [catalog, setCatalog] = useState<StickerCatalogItem[]>([]);

  const load = useCallback(async () => {
    setLoadState("loading");
    const res = await fetchStickerCatalog(client);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setCatalog(res.data);
    setLoadState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, catalog, reload: load };
}

export type PurchaseActionResult = { ok: true; data: PurchaseStickerResult } | { ok: false; error: ApiError };

/** 購入確定操作（決定10「購入確認はインライン確認モーダル」）。 */
export function useStickerPurchaseAction() {
  const { client } = useSession();
  const [purchasing, setPurchasing] = useState(false);

  const purchase = useCallback(
    async (catalogId: string): Promise<PurchaseActionResult> => {
      setPurchasing(true);
      const res = await purchaseSticker(client, catalogId);
      setPurchasing(false);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, data: res.data };
    },
    [client]
  );

  return { purchasing, purchase };
}

/**
 * コレクター棚「集めたもの」区画・シール区分（主要画面ワイヤーフレーム.md 32.2a節。
 * 旧32.2節「区画3：自分のステッカー」は同節により統合・廃止された）。`memberId`には
 * 呼び出し本人だけでなく、メンバー選択チップで選ばれた任意の家族メンバーのIDを
 * 渡してよい（`ornament_sticker_purchases_select_same_family`により家族の誰でも
 * 他メンバーの購入記録を閲覧できる、決定7・決定23）。`currentSeasonId`（進行中
 * シーズンのid、家族の木の読み込み結果から渡す）を指定すると、各購入の配置状況
 * （`placement`、49章の自由配置後は「生涯に一度」なので配置は高々1件）を判定する。
 */
export function useMyStickerPurchases(memberId: string, currentSeasonId: string | null) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<StickerLoadState>("loading");
  const [purchases, setPurchases] = useState<StickerPurchaseWithCatalog[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoadState("loading");
    const res = await fetchMyStickerPurchases(client, memberId, currentSeasonId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setPurchases(res.data);
    setLoadState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, memberId, currentSeasonId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, purchases, reload: load };
}

/**
 * コレクター棚「集めたもの」区画・メンバー選択チップ「全員」選択時の「メダル」
 * 区分（実装メモ158章）。`useMyStickerPurchases`と同じ形の戻り値だが、`memberId`
 * ではなく`familyId`で家族全員分をまとめて取得する。
 */
export function useFamilyStickerPurchases(familyId: string, currentSeasonId: string | null) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<StickerLoadState>("loading");
  const [purchases, setPurchases] = useState<StickerPurchaseWithCatalog[]>([]);

  const load = useCallback(async () => {
    if (!familyId) return;
    setLoadState("loading");
    const res = await fetchFamilyStickerPurchases(client, familyId, currentSeasonId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setPurchases(res.data);
    setLoadState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, familyId, currentSeasonId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, purchases, reload: load };
}

export type DecorateStickerActionResult = { ok: true; decorationId: string } | { ok: false; error: ApiError };

/**
 * [2026-09-08改訂・スキーマ設計.sql 49章] 木への配置確定操作（`TreeStickerDragCanvas`
 * のドラッグ配置から呼ぶ）。統括要望「ステッカーは自分の好きなところに貼りたい」を
 * 受け、色丸（`completionId`）を選ぶ方式から座標（`posX`・`posY`、0〜1000の
 * キャンバス相対整数）を指定する自由配置方式に変わった。
 */
export function useDecorateTreeWithStickerAction() {
  const { client } = useSession();
  const [decorating, setDecorating] = useState(false);

  const decorate = useCallback(
    async (purchaseId: string, posX: number, posY: number): Promise<DecorateStickerActionResult> => {
      setDecorating(true);
      const res = await decorateTreeWithSticker(client, purchaseId, posX, posY);
      setDecorating(false);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, decorationId: res.data };
    },
    [client]
  );

  return { decorating, decorate };
}

export type MoveStickerActionResult = { ok: true; decorationId: string } | { ok: false; error: ApiError };

/**
 * [2026-09-08新設・スキーマ設計.sql 49.12章〜49.13章（統括判断）] すでに木に
 * 貼ったステッカーの座標を、その月のうちに変更する操作（`TreeStickerDragCanvas`の
 * 「動かす」モードから呼ぶ）。自分の配置・進行中シーズンの配置のみ対象。
 */
export function useMoveTreeStickerAction() {
  const { client } = useSession();
  const [moving, setMoving] = useState(false);

  const move = useCallback(
    async (decorationId: string, posX: number, posY: number): Promise<MoveStickerActionResult> => {
      setMoving(true);
      const res = await moveTreeSticker(client, decorationId, posX, posY);
      setMoving(false);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, decorationId: res.data };
    },
    [client]
  );

  return { moving, move };
}

/**
 * 購入画面（P37/C30/S23）用: 呼び出し本人が今月（JST暦月）すでに購入した
 * ステッカーの`sticker_catalog_id`一覧。
 *
 * [2026-09-09改訂・要件定義書07-19-9a章「決定31」] 決定15の読み取り誤りの訂正を
 * 受け、購入上限は「1人あたり月合計1個」ではなく「同じ種類（sticker_catalog_id）
 * につき1人あたり月1枚」になった。そのため画面側も「今月は購入済みか」という
 * 単一のboolean（`purchasedThisMonth`）ではなく、「今月すでに購入した種類の集合」を
 * 返す形に変える（違う種類はグレーアウトさせない）。`purchase_sticker()`のRPC自体が
 * 最終的な検証（決定31）を行うため、これは画面のボタン非活性表示のためのUX的な
 * 事前判定にすぎない（最終防衛線はDB側）。
 */
export function useMyStickerPurchasedCatalogIdsThisMonth(memberId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<StickerLoadState>("loading");
  const [purchasedCatalogIds, setPurchasedCatalogIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoadState("loading");
    const res = await fetchMyStickerPurchases(client, memberId, null);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    const thisMonth = toJstDateString(new Date()).slice(0, 7);
    setPurchasedCatalogIds(
      res.data.filter((p) => toJstDateString(p.purchased_at).slice(0, 7) === thisMonth).map((p) => p.sticker_catalog_id)
    );
    setLoadState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, purchasedCatalogIds, reload: load };
}
