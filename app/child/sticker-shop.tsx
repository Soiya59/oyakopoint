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
 * C30 シールを かう（子ども、新規）
 * 参照: 画面一覧・遷移図.md C30、主要画面ワイヤーフレーム.md 32.1節
 *
 * コレクションだなの「じぶんのシール」（app/child/collector-shelf.tsx）から遷移する
 * 入口に加え、2026-09-07（実装メモ144章）からはごほうびこうかんじょ
 * （app/child/(tabs)/rewards.tsx、C9）からも遷移できる。木を飾るシール（12種）を
 * ポイントで買う。買う前の確認はStickerShopPanel内のインライン確認モーダルで行う
 * （決定10）。買った後はC26じぶんのシールへのスナックバー表示のみ（router.back()で
 * 呼び出し元へ戻る仕組みのため、遷移元がC9でも自然に戻る）。
 */
export default function ChildStickerShopScreen() {
  const { state, memberPoints } = useAppData();
  const myId = state.activeChildMemberId;
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
    setSnackbar(`⭐ ${item?.display_name ?? "シール"}を てにいれたよ！コレクターだなに しまってあるよ`);
    void reloadPurchased();
    setTimeout(() => {
      setSnackbar(null);
      router.back();
    }, SNACKBAR_DISPLAY_MS);
  };

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
          <Text style={theme.typography.childBody}>{snackbar}</Text>
        </View>
      )}
    </Screen>
  );
}
