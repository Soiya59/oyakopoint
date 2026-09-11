import React, { useState } from "react";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import StickerShopPanel from "@/components/StickerShopPanel";
import StickerPurchaseResultView from "@/components/StickerPurchaseResultView";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import {
  computeEverPurchasedShapeRarities,
  computeLatestResetByShape,
  computeLockedCatalogIds,
  useFamilyStickerPurchasesForLock,
  useFamilyStickerTierResets,
  useStickerCatalog,
  useStickerPurchaseAction,
} from "@/hooks/useStickers";
import type { StickerCatalogItem } from "@/types/domain";

/**
 * P37 ステッカーを買う（保護者、新規）
 * 参照: 画面一覧・遷移図.md P37、主要画面ワイヤーフレーム.md 32.1節・34章
 *
 * コレクター棚の区画3（app/parent/collector-shelf.tsx）から遷移する入口
 * （32.0節決定1）に加え、2026-09-07（実装メモ144章）からはごほうび管理
 * （app/parent/rewards.tsx、P12）からも遷移できる。木を飾るステッカー（12種）を
 * ポイントで購入する。購入確認はStickerShopPanel内のインライン確認モーダルで行い、
 * 新しい画面は作らない（決定10）。
 *
 * [2026-09-09改訂・主要画面ワイヤーフレーム.md 34章] 購入成功後は同一画面内の
 * 状態を「メダル一覧（StickerShopPanel）」から「購入結果ビュー
 * （StickerPurchaseResultView）」へ切り替える。新しい画面番号・新しいルートは
 * 増やさない（決定1、`app/parent/tree-decorate.tsx`の`success`状態と同じ
 * 「全画面差し替え」パターン）。旧「専用の完了演出画面は設けない」という記述は
 * 32.1節状態一覧のものであり、32.0節決定1（購入の入口をコレクター棚に一本化する、
 * 入口についての決定）とは無関係だった（34.0節、コード側コメントの誤引用の訂正）。
 * 旧スナックバー表示（`router.back()`で遷移元へ戻る仕組み）は本改訂により廃止した。
 */
export default function ParentStickerShopScreen() {
  const { state, memberPoints } = useAppData();
  const myId = state.activeParentMemberId;
  const balance = memberPoints.find((m) => m.member_id === myId)?.current_points ?? 0;
  const { loadState: catalogLoadState, catalog, reload: reloadCatalog } = useStickerCatalog();
  const {
    loadState: familyPurchasesLoadState,
    purchases: familyPurchases,
    reload: reloadFamilyPurchases,
  } = useFamilyStickerPurchasesForLock(state.family.id);
  // [2026-09-11新設・要件定義書07-25-1章決定20〜29、設計部/成果物/スキーマ設計.sql
  // 52章] メダルの段階リセット。買う画面は「一度も買ったことがない」と
  // 「リセットにより未達に戻った」を見分ける必要がある（決定9）ため、
  // sticker_tier_resetsの生データも取得する。
  const {
    loadState: tierResetsLoadState,
    resets: tierResets,
    reload: reloadTierResets,
  } = useFamilyStickerTierResets(state.family.id);
  const { purchasing, purchase } = useStickerPurchaseAction();
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  // [2026-09-09新設・34章] 購入結果ビューに切り替えるための状態。購入APIの戻り値
  // （`purchase_id`）とカタログ項目（`shape`・`rarity`・`display_name`の導出元）を
  // 保持する。nullの間は従来どおりメダル一覧を表示する。
  const [purchaseResult, setPurchaseResult] = useState<{ item: StickerCatalogItem; purchaseId: string } | null>(null);

  const loadState =
    catalogLoadState === "error" || familyPurchasesLoadState === "error" || tierResetsLoadState === "error"
      ? "error"
      : catalogLoadState === "loading" || familyPurchasesLoadState === "loading" || tierResetsLoadState === "loading"
      ? "loading"
      : "ready";
  // [2026-09-11改訂・決定22] 形ごとの直近リセット時刻を求め、段階購入制の
  // EXISTS判定にそのまま加味する（DB側purchase_sticker()と同じ条件式）。
  const resetAtByShape = computeLatestResetByShape(tierResets);
  // [要件定義書07-19-14章「決定32・33」] 段階購入制。家族としてまだ解放されて
  // いないカタログIDを、カタログ一覧と家族全員の購入記録から導出する。
  const lockedCatalogIds = computeLockedCatalogIds(catalog, familyPurchases, resetAtByShape);
  // [2026-09-11新設・決定28、40.2節決定9] 「一度も買ったことがない」と
  // 「リセットで未達に戻った」を見分けるための、reset_atを問わない生の購入実績。
  const everPurchasedShapeRarities = computeEverPurchasedShapeRarities(familyPurchases);

  const handleConfirmPurchase = async (catalogId: string) => {
    setPurchaseError(null);
    const res = await purchase(catalogId);
    if (!res.ok) {
      setPurchaseError(res.error.message);
      // [2026-09-09変更] 失敗時はfalseを返し、確認モーダルを開いたままにして
      // エラー文言を見せる（従来どおりの挙動）。
      return false;
    }
    void reloadFamilyPurchases();
    // [2026-09-09改訂・34章] `catalog`から購入したカタログ項目を導出し、購入結果
    // ビューへ切り替える。カタログはこの画面が既に保持しており（決定3・決定4の
    // 前提）、通常操作の範囲では必ず見つかる。万一見つからなくても、購入自体は
    // 成立しているため画面が進まない状態を避け、カタログIDのみのフォールバック値で
    // 結果ビューへ進める（「購入は成立したのに進めない」を避けるための保険）。
    const item = catalog.find((c) => c.id === catalogId) ?? {
      id: catalogId,
      shape: "beetle" as const,
      rarity: "bronze" as const,
      sticker_key: "",
      display_name: "メダル",
      points_cost: 0,
      is_active: true,
      created_at: "",
    };
    setPurchaseResult({ item, purchaseId: res.data.purchase_id });
    // [2026-09-09追加] 成功をパネルに伝えて確認モーダルを閉じさせる。閉じないと
    // 購入結果ビューがモーダルの裏に隠れて見えない。
    return true;
  };

  if (purchaseResult) {
    return (
      <Screen tone="parent">
        <StickerPurchaseResultView
          tone="parent"
          item={purchaseResult.item}
          onDecorate={() =>
            router.push({
              pathname: "/parent/tree-decorate",
              params: { purchaseId: purchaseResult.purchaseId, shape: purchaseResult.item.shape, rarity: purchaseResult.item.rarity },
            })
          }
          onGoToShelf={() => router.replace("/parent/collector-shelf")}
        />
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.parentBody}>← もどる</Text>
      </Pressable>

      <StickerShopPanel
        tone="parent"
        loadState={loadState}
        catalog={catalog}
        balance={balance}
        lockedCatalogIds={lockedCatalogIds}
        everPurchasedShapeRarities={everPurchasedShapeRarities}
        resetAtByShape={resetAtByShape}
        purchasing={purchasing}
        purchaseErrorMessage={purchaseError}
        onRetry={() => {
          reloadCatalog();
          reloadFamilyPurchases();
          reloadTierResets();
        }}
        onConfirmPurchase={handleConfirmPurchase}
      />
    </Screen>
  );
}
