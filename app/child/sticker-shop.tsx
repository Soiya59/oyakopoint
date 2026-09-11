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
 * C30 シールを かう（子ども、新規）
 * 参照: 画面一覧・遷移図.md C30、主要画面ワイヤーフレーム.md 32.1節・34章
 *
 * コレクションだなの「じぶんのシール」（app/child/collector-shelf.tsx）から遷移する
 * 入口に加え、「じぶん」タブの「メダル」タイル（app/child/(tabs)/self.tsx、
 * 2026-09-10・実装メモ188章で移設）からも遷移できる。木を飾るシール（12種）を
 * ポイントで買う。買う前の確認はStickerShopPanel内のインライン確認モーダルで行う
 * （決定10）。
 *
 * [2026-09-09改訂・主要画面ワイヤーフレーム.md 34章] 買った後は同一画面内の状態を
 * 「シール一覧（StickerShopPanel）」から「購入結果ビュー
 * （StickerPurchaseResultView）」へ切り替える。新しい画面番号・新しいルートは
 * 増やさない（決定1、`app/parent/tree-decorate.tsx`の`success`状態と同じ
 * 「全画面差し替え」パターン）。旧スナックバー表示（`router.back()`で呼び出し元へ
 * 戻る仕組み）は本改訂により廃止した。
 */
export default function ChildStickerShopScreen() {
  const { state, memberPoints } = useAppData();
  const myId = state.activeChildMemberId;
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
  // 保持する。nullの間は従来どおりシール一覧を表示する。
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
    // [2026-09-09改訂・34章] `catalog`から買ったカタログ項目を導出し、購入結果
    // ビューへ切り替える。カタログはこの画面が既に保持しており、通常操作の範囲では
    // 必ず見つかる。万一見つからなくても、購入自体は成立しているため画面が進まない
    // 状態を避け、カタログIDのみのフォールバック値で結果ビューへ進める。
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
      <Screen tone="child">
        <StickerPurchaseResultView
          tone="child"
          item={purchaseResult.item}
          onDecorate={() =>
            router.push({
              pathname: "/child/tree-decorate",
              params: { purchaseId: purchaseResult.purchaseId, shape: purchaseResult.item.shape, rarity: purchaseResult.item.rarity },
            })
          }
          onGoToShelf={() => router.replace("/child/collector-shelf")}
        />
      </Screen>
    );
  }

  return (
    <Screen tone="child">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.childBody}>← もどる</Text>
      </Pressable>

      <StickerShopPanel
        tone="child"
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
