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
  fetchStickerTierResets,
  moveTreeSticker,
  purchaseSticker,
  type ApiError,
  type PurchaseStickerResult,
} from "@/data/api";
import type { StickerCatalogItem, StickerPurchaseWithCatalog, StickerTierReset } from "@/types/domain";
import type { StickerRarity, StickerShape } from "@/theme/theme";

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
 * 段階購入制（要件定義書07-19-14章「決定32」）: あるレアリティを買うために
 * 家族の誰かが過去に購入している必要がある「ひとつ下のレアリティ」。銅は
 * 下の段が無いためnull（無条件で買える）。`StickerShopPanel.tsx`と同じ表。
 */
const requiredLowerRarity: Record<string, string | null> = {
  bronze: null,
  silver: "bronze",
  gold: "silver",
  // [2026-09-08改訂・本部長／実装メモ173章] 統括判断で「虹」から「クリスタル」に
  // 改称（StickerShopPanel.tsxと同じ表）。
  crystal: "gold",
};

/**
 * 購入画面（P37/C30/S23）用: カタログ12種のうち、家族としてまだ解放されて
 * いない（＝ひとつ下のレアリティを家族の誰も、直近のリセット以降に購入した
 * ことがない）カタログID一覧を計算する純関数。
 *
 * [2026-09-08新設・要件定義書07-19-14章「決定32・33・34」・
 * UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 32.0b節「開発部への申し送り」・
 * 開発部/成果物/実装メモ.md 161章]
 * 「持っている」の判定基準は現在の保有数ではなく過去の購入履歴（決定33）。
 * 判定範囲はfamily_id単位（購入者本人は問わない）。形ごとに完全に独立
 * （決定34）。新規テーブル・新規Viewは追加せず、既存の`fetchFamilyStickerPurchases`
 * が返す家族全員分の購入記録（`sticker_catalog`のshape/rarityを埋め込み済み）と
 * カタログ一覧から、画面側で導出する（企画部「新しい状態を別途持つ必要はない」
 * という判断を踏襲）。`purchase_sticker()`のRPC自体が最終的な検証（決定32〜34）を
 * 行うため、これは画面のボタン非活性表示・理由表示のためのUX的な事前判定に
 * すぎない（最終防衛線はDB側）。
 *
 * [2026-09-11改訂・要件定義書07-25-1章決定22、設計部/成果物/スキーマ設計.sql
 * 52.5章・52.6章、開発部/成果物/実装メモ.md 200章] メダルの段階リセットに伴い、
 * `resetAtByShape`（形ごとの直近リセット時刻。`computeLatestResetByShape`で
 * 導出する）を第3引数に追加した。判定条件はDB側`purchase_sticker()`の
 * `(v_reset_at IS NULL OR osp.purchased_at > v_reset_at)`と完全に同じ形で
 * 再現する。**`resetAt &&`のように早期に真偽判定してしまうと、一度もリセット
 * していない家族（＝現時点の全家族）まで巻き込んで全メダルが買えなくなる
 * 罠がある（52.5章が名指しで警告している三値論理の罠と同型）ため、
 * `!resetAt || ...`という順序を必ず守ること。** 第3引数を省略した場合は
 * 空オブジェクト（＝どの形もリセットされていない）として扱われ、従来どおり
 * 全期間を対象にする。
 */
export function computeLockedCatalogIds(
  catalog: StickerCatalogItem[],
  familyPurchases: Pick<StickerPurchaseWithCatalog, "sticker_catalog" | "purchased_at">[],
  resetAtByShape: Record<string, string> = {}
): string[] {
  return catalog
    .filter((item) => {
      const required = requiredLowerRarity[item.rarity];
      if (!required) return false; // 銅は無条件（下の段が無い）
      const resetAt = resetAtByShape[item.shape];
      const qualifies = familyPurchases.some((p) => {
        const c = p.sticker_catalog;
        if (!c || c.shape !== item.shape || c.rarity !== required) return false;
        // [三値論理の罠に対する回答] resetAtが無い（一度もリセットされて
        // いない）場合は無条件に全期間を対象にする。
        return !resetAt || new Date(p.purchased_at).getTime() > new Date(resetAt).getTime();
      });
      return !qualifies;
    })
    .map((item) => item.id);
}

/**
 * [2026-09-11新設・要件定義書07-25-1章決定22、設計部/成果物/スキーマ設計.sql
 * 52.7章] `sticker_tier_resets`の生データ（家族全体）から、形ごとの直近の
 * リセット時刻（reset_atの最大値）を求める純関数。リセットされたことが
 * 一度も無い形はキー自体を持たない（＝`resetAtByShape[shape]`は`undefined`）。
 */
export function computeLatestResetByShape(resets: Pick<StickerTierReset, "shape" | "reset_at">[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of resets) {
    const current = map[r.shape];
    if (!current || new Date(r.reset_at).getTime() > new Date(current).getTime()) {
      map[r.shape] = r.reset_at;
    }
  }
  return map;
}

/**
 * [2026-09-11新設・UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 40.2節
 * 決定9、設計部/成果物/スキーマ設計.sql 52.6章] 「一度も買ったことがない」
 * （通常の家族解放待ち）と「リセットにより未達に戻った」を見分けるための
 * 判定材料。`reset_at`を一切問わない、家族の生の購入実績（shape:rarity）の
 * 集合を返す。決定22によりリセットはornament_sticker_purchasesを一切
 * 書き換えないため、この集合はリセットの前後で変化しない。
 */
export function computeEverPurchasedShapeRarities(
  familyPurchases: Pick<StickerPurchaseWithCatalog, "sticker_catalog">[]
): string[] {
  const set = new Set<string>();
  for (const p of familyPurchases) {
    const c = p.sticker_catalog;
    if (c) set.add(`${c.shape}:${c.rarity}`);
  }
  return Array.from(set);
}

const rarityOrder: Record<StickerRarity, number> = { bronze: 1, silver: 2, gold: 3, crystal: 4 };

/**
 * [2026-09-11新設・UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 40.1節
 * 決定4] P14「メダルの設定」の状態表示用: 指定した形について、家族の誰かが
 * 過去に購入した最上位のレアリティを返す（`reset_at`を問わない、生の購入
 * 実績）。1件も購入が無ければ`null`（決定5の非活性化判定に使う）。
 */
export function computeHighestEverPurchasedRarity(
  familyPurchases: Pick<StickerPurchaseWithCatalog, "sticker_catalog">[],
  shape: StickerShape
): StickerRarity | null {
  let max: StickerRarity | null = null;
  for (const p of familyPurchases) {
    const c = p.sticker_catalog;
    if (!c || c.shape !== shape) continue;
    if (!max || rarityOrder[c.rarity] > rarityOrder[max]) max = c.rarity;
  }
  return max;
}

/**
 * [2026-09-11新設・要件定義書07-25-1章決定20〜27、設計部/成果物/スキーマ設計.sql
 * 52.3章] `sticker_tier_resets`の家族全体の生データ取得。P14「メダルの設定」・
 * 買う画面（P37/C30/S23）の両方が使う。`useFamilyStickerPurchasesForLock`と
 * 同じ「集計はクライアント側」の設計方針（52.1章(D)）を踏襲する。
 */
export function useFamilyStickerTierResets(familyId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<StickerLoadState>("loading");
  const [resets, setResets] = useState<StickerTierReset[]>([]);

  const load = useCallback(async () => {
    if (!familyId) return;
    setLoadState("loading");
    const res = await fetchStickerTierResets(client, familyId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setResets(res.data);
    setLoadState("ready");
  }, [client, familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, resets, reload: load };
}

/**
 * 購入画面（P37/C30/S23）用: 家族全員の購入記録を取得する。段階購入制の
 * 判定には季節・配置情報が不要なため`currentSeasonId`は`null`固定で渡す。
 * 既存の`useFamilyStickerPurchases`（コレクター棚「集めたもの」区画・32.2a節用に
 * 新設済み）をそのまま呼ぶだけの薄いラッパーで、新規のAPI関数・DB問い合わせは
 * 追加していない。呼び出し側で`computeLockedCatalogIds(catalog, purchases)`と
 * 組み合わせて`lockedCatalogIds`を導出する。
 */
export function useFamilyStickerPurchasesForLock(familyId: string) {
  return useFamilyStickerPurchases(familyId, null);
}
