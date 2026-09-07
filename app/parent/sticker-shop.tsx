import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import StickerShopPanel from "@/components/StickerShopPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useMyStickerPurchasedCatalogIdsThisMonth, useStickerCatalog, useStickerPurchaseAction } from "@/hooks/useStickers";

const SNACKBAR_DISPLAY_MS = 1400;

/**
 * P37 ステッカーを買う（保護者、新規）
 * 参照: 画面一覧・遷移図.md P37、主要画面ワイヤーフレーム.md 32.1節
 *
 * コレクター棚の区画3（app/parent/collector-shelf.tsx）から遷移する入口
 * （32.0節決定1）に加え、2026-09-07（実装メモ144章）からはごほうび管理
 * （app/parent/rewards.tsx、P12）からも遷移できる。木を飾るステッカー（12種）を
 * ポイントで購入する。購入確認はStickerShopPanel内のインライン確認モーダルで行い、
 * 新しい画面は作らない（決定10）。購入成功後は呼び出し元へのスナックバー表示のみで、
 * 専用の完了演出画面は設けない（決定1・「購入成功」状態一覧。router.back()で戻る
 * 仕組みのため、遷移元がP12でも自然に戻る）。
 */
export default function ParentStickerShopScreen() {
  const { state, memberPoints } = useAppData();
  const myId = state.activeParentMemberId;
  const balance = memberPoints.find((m) => m.member_id === myId)?.current_points ?? 0;
  const { loadState: catalogLoadState, catalog, reload: reloadCatalog } = useStickerCatalog();
  const {
    loadState: purchasedLoadState,
    purchasedCatalogIds,
    reload: reloadPurchased,
  } = useMyStickerPurchasedCatalogIdsThisMonth(myId);
  const { purchasing, purchase } = useStickerPurchaseAction();
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const loadState = catalogLoadState === "error" || purchasedLoadState === "error" ? "error" : catalogLoadState === "loading" || purchasedLoadState === "loading" ? "loading" : "ready";

  const handleConfirmPurchase = async (catalogId: string) => {
    setPurchaseError(null);
    const res = await purchase(catalogId);
    if (!res.ok) {
      setPurchaseError(res.error.message);
      return;
    }
    const item = catalog.find((c) => c.id === catalogId);
    setSnackbar(`${item?.display_name ?? "ステッカー"}を購入しました。コレクター棚に追加されました`);
    void reloadPurchased();
    setTimeout(() => {
      setSnackbar(null);
      router.back();
    }, SNACKBAR_DISPLAY_MS);
  };

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
        purchasedCatalogIdsThisMonth={purchasedCatalogIds}
        purchasing={purchasing}
        purchaseErrorMessage={purchaseError}
        onRetry={() => {
          reloadCatalog();
          reloadPurchased();
        }}
        onConfirmPurchase={handleConfirmPurchase}
      />

      {snackbar && (
        <View style={{ marginTop: theme.spacing.s4, alignItems: "center" }}>
          <Text style={theme.typography.parentBody}>{snackbar}</Text>
        </View>
      )}
    </Screen>
  );
}
