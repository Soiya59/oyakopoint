import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import StickerShopPanel from "@/components/StickerShopPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useMyStickerMonthlyStatus, useStickerCatalog, useStickerPurchaseAction } from "@/hooks/useStickers";

const SNACKBAR_DISPLAY_MS = 1400;

/**
 * S23 ステッカーを買う（みまもりメンバー、新規）
 * 参照: 画面一覧・遷移図.md S23、主要画面ワイヤーフレーム.md 32.1節
 *
 * P37と同一構成。コレクター棚の区画3（app/supporter/collector-shelf.tsx）から
 * 遷移する唯一の入口。
 */
export default function SupporterStickerShopScreen() {
  const { state, memberPoints } = useAppData();
  const myId = state.activeParentMemberId;
  const balance = memberPoints.find((m) => m.member_id === myId)?.current_points ?? 0;
  const { loadState: catalogLoadState, catalog, reload: reloadCatalog } = useStickerCatalog();
  const { loadState: monthlyLoadState, purchasedThisMonth, reload: reloadMonthly } = useMyStickerMonthlyStatus(myId);
  const { purchasing, purchase } = useStickerPurchaseAction();
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const loadState = catalogLoadState === "error" || monthlyLoadState === "error" ? "error" : catalogLoadState === "loading" || monthlyLoadState === "loading" ? "loading" : "ready";

  const handleConfirmPurchase = async (catalogId: string) => {
    setPurchaseError(null);
    const res = await purchase(catalogId);
    if (!res.ok) {
      setPurchaseError(res.error.message);
      return;
    }
    const item = catalog.find((c) => c.id === catalogId);
    setSnackbar(`${item?.display_name ?? "ステッカー"}を購入しました。コレクター棚に追加されました`);
    void reloadMonthly();
    setTimeout(() => {
      setSnackbar(null);
      router.back();
    }, SNACKBAR_DISPLAY_MS);
  };

  return (
    <Screen tone="supporter">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.supporterBody}>← もどる</Text>
      </Pressable>

      <StickerShopPanel
        tone="supporter"
        loadState={loadState}
        catalog={catalog}
        balance={balance}
        monthlyLimitReached={purchasedThisMonth}
        purchasing={purchasing}
        purchaseErrorMessage={purchaseError}
        onRetry={() => {
          reloadCatalog();
          reloadMonthly();
        }}
        onConfirmPurchase={handleConfirmPurchase}
      />

      {snackbar && (
        <View style={{ marginTop: theme.spacing.s4, alignItems: "center" }}>
          <Text style={theme.typography.supporterBody}>{snackbar}</Text>
        </View>
      )}
    </Screen>
  );
}
