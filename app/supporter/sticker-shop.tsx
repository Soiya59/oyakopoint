import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import StickerShopPanel from "@/components/StickerShopPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { computeLockedCatalogIds, useFamilyStickerPurchasesForLock, useStickerCatalog, useStickerPurchaseAction } from "@/hooks/useStickers";

const SNACKBAR_DISPLAY_MS = 1400;

/**
 * S23 ステッカーを買う（みまもりメンバー、新規）
 * 参照: 画面一覧・遷移図.md S23、主要画面ワイヤーフレーム.md 32.1節
 *
 * P37と同一構成。コレクター棚の区画3（app/supporter/collector-shelf.tsx）から
 * 遷移する入口に加え、2026-09-07（実装メモ144章）からはじぶんのごほうび
 * （app/supporter/rewards.tsx、S8）からも遷移できる。
 */
export default function SupporterStickerShopScreen() {
  const { state, memberPoints } = useAppData();
  const myId = state.activeParentMemberId;
  const balance = memberPoints.find((m) => m.member_id === myId)?.current_points ?? 0;
  const { loadState: catalogLoadState, catalog, reload: reloadCatalog } = useStickerCatalog();
  const {
    loadState: familyPurchasesLoadState,
    purchases: familyPurchases,
    reload: reloadFamilyPurchases,
  } = useFamilyStickerPurchasesForLock(state.family.id);
  const { purchasing, purchase } = useStickerPurchaseAction();
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const loadState =
    catalogLoadState === "error" || familyPurchasesLoadState === "error"
      ? "error"
      : catalogLoadState === "loading" || familyPurchasesLoadState === "loading"
      ? "loading"
      : "ready";
  // [要件定義書07-19-14章「決定32・33」] 段階購入制。家族としてまだ解放されて
  // いないカタログIDを、カタログ一覧と家族全員の購入記録から導出する。
  const lockedCatalogIds = computeLockedCatalogIds(catalog, familyPurchases);

  const handleConfirmPurchase = async (catalogId: string) => {
    setPurchaseError(null);
    const res = await purchase(catalogId);
    if (!res.ok) {
      setPurchaseError(res.error.message);
      // [2026-09-09変更] 失敗時はfalseを返し、確認モーダルを開いたままにして
      // エラー文言を見せる（従来どおりの挙動）。
      return false;
    }
    const item = catalog.find((c) => c.id === catalogId);
    setSnackbar(`${item?.display_name ?? "メダル"}を購入しました。コレクションに追加されました`);
    void reloadFamilyPurchases();
    setTimeout(() => {
      setSnackbar(null);
      router.back();
    }, SNACKBAR_DISPLAY_MS);
    // [2026-09-09追加] 成功をパネルに伝えて確認モーダルを閉じさせる。閉じないと
    // スナックバーがモーダルの裏に隠れて見えず、しかも「買う」をもう一度押せてしまう。
    return true;
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
        lockedCatalogIds={lockedCatalogIds}
        purchasing={purchasing}
        purchaseErrorMessage={purchaseError}
        onRetry={() => {
          reloadCatalog();
          reloadFamilyPurchases();
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
