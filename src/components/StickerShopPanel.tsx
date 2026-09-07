/**
 * ステッカーを買う（P37／C30／S23、新規）本体の3ロール共通コンポーネント。
 * 参照: 主要画面ワイヤーフレーム.md 32.0節決定1・決定9・決定10・決定11、32.1節。
 *
 * 12種類（形3種×レアリティ4段）を常に同じ配置（形ごとに1行、レアリティ4段を
 * 列に固定）で表示する（決定9「どのインスタンスを使うか選ばせない」の前提として、
 * カタログ位置＝形×レアリティのみが選択対象）。購入確認は新しい画面を作らず、
 * 本コンポーネント内のインライン確認モーダルで行う（決定10）。
 */
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import Card from "./Card";
import { StickerIcon } from "./StickerIcon";
import { ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";
import type { StickerShape, StickerRarity } from "@/theme/theme";
import type { StickerCatalogItem } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";

const shapeLabel: Record<StickerShape, { child: string; parent: string }> = {
  beetle: { child: "カブトムシ", parent: "カブトムシ" },
  butterfly: { child: "ちょうちょ", parent: "ちょうちょ" },
  flower: { child: "はな", parent: "小さな花" },
};

const rarityLabel: Record<StickerRarity, { child: string; parent: string }> = {
  bronze: { child: "どう", parent: "銅" },
  silver: { child: "ぎん", parent: "銀" },
  gold: { child: "きん", parent: "金" },
  rainbow: { child: "にじ", parent: "虹" },
};

export interface StickerShopPanelProps {
  tone: Tone;
  loadState: LoadState;
  catalog: StickerCatalogItem[];
  balance: number;
  /** 今月すでに1個購入済みか（1人あたり月1個まで、決定15）。 */
  monthlyLimitReached: boolean;
  purchasing: boolean;
  purchaseErrorMessage: string | null;
  onRetry: () => void;
  onConfirmPurchase: (catalogId: string) => void;
}

const bodyStyleFor = (tone: Tone) =>
  tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
const bodyMediumStyleFor = (tone: Tone) =>
  tone === "child"
    ? theme.typography.childBody
    : tone === "supporter"
    ? theme.typography.supporterBodyMedium
    : theme.typography.parentBodyMedium;
const captionStyleFor = (tone: Tone) =>
  tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;

export function StickerShopPanel({
  tone,
  loadState,
  catalog,
  balance,
  monthlyLimitReached,
  purchasing,
  purchaseErrorMessage,
  onRetry,
  onConfirmPurchase,
}: StickerShopPanelProps) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const [selected, setSelected] = useState<StickerCatalogItem | null>(null);

  if (loadState === "loading") return <SkeletonList count={3} />;
  if (loadState === "error") {
    return (
      <ErrorState tone={isChild ? "child" : "parent"} title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"} onRetry={onRetry} />
    );
  }

  const byShape = theme.stickerShapes.map((shape) => ({
    shape,
    items: theme.stickerRarities
      .map((rarity) => catalog.find((c) => c.shape === shape && c.rarity === rarity))
      .filter((c): c is StickerCatalogItem => !!c),
  }));

  const handleConfirm = () => {
    if (!selected) return;
    onConfirmPurchase(selected.id);
  };

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={bodyMediumStyle}>{isChild ? "シールを かう" : "ステッカーを買う"}</Text>
        <Text style={bodyMediumStyle}>🌟{balance}pt</Text>
      </View>

      {monthlyLimitReached && (
        <Card tone={tone} style={styles.limitCard}>
          <Text style={bodyStyle}>
            {isChild
              ? "こんげつは もう シールを かったよ。\nらいげつも たのしみに していてね"
              : "今月はステッカーを1つ購入済みです。来月また購入できます"}
          </Text>
        </Card>
      )}

      <View style={{ marginTop: theme.spacing.s4, gap: theme.spacing.s4 }}>
        {byShape.map(({ shape, items }) => (
          <View key={shape}>
            <Text style={[captionStyle, styles.shapeHeading]}>{isChild ? shapeLabel[shape].child : shapeLabel[shape].parent}</Text>
            <View style={styles.row}>
              {items.map((item) => {
                const affordable = balance >= item.points_cost;
                const disabled = monthlyLimitReached || !affordable;
                return (
                  <Pressable
                    key={item.id}
                    disabled={disabled}
                    onPress={() => setSelected(item)}
                    style={[styles.cell, tone === "child" && styles.cellChild, disabled && styles.cellDisabled]}
                    accessibilityRole="button"
                  >
                    <StickerIcon shape={item.shape} rarity={item.rarity} size={32} uid={item.id} />
                    <Text style={[captionStyle, styles.cellRarity]}>
                      {isChild ? rarityLabel[item.rarity].child : rarityLabel[item.rarity].parent}
                    </Text>
                    <Text style={[captionStyle, !affordable && styles.insufficientText]}>
                      {affordable ? `${item.points_cost}pt` : `あと${item.points_cost - balance}pt`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </View>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={styles.backdrop}>
          <Card tone={tone} style={styles.modalCard}>
            {selected && (
              <>
                <View style={{ alignItems: "center" }}>
                  <StickerIcon shape={selected.shape} rarity={selected.rarity} size={56} uid={`confirm-${selected.id}`} />
                </View>
                <Text style={[bodyMediumStyle, styles.modalTitle]}>{selected.display_name}</Text>
                <Text style={[bodyStyle, styles.modalBody]}>
                  {isChild
                    ? `${selected.points_cost}pt で かうよ。いいかな？`
                    : `${selected.points_cost}ptで購入します。よろしいですか？`}
                </Text>
                {purchaseErrorMessage && <Text style={styles.errorText}>{purchaseErrorMessage}</Text>}
                <View style={styles.modalButtonRow}>
                  <AppButton
                    label={isChild ? "かう" : "買う"}
                    tone={tone}
                    loading={purchasing}
                    disabled={purchasing}
                    onPress={handleConfirm}
                    style={{ flex: 1 }}
                  />
                  <AppButton
                    label={isChild ? "やめておく" : "やめておく"}
                    tone={tone}
                    variant="ghost"
                    disabled={purchasing}
                    onPress={() => setSelected(null)}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            )}
          </Card>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  limitCard: { marginTop: theme.spacing.s4 },
  shapeHeading: { color: theme.colors.neutralTextSecondary, marginBottom: theme.spacing.s2 },
  row: { flexDirection: "row", gap: theme.spacing.s2 },
  cell: {
    flex: 1,
    alignItems: "center",
    gap: theme.spacing.s1,
    paddingVertical: theme.spacing.s2,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentLg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    minHeight: 88,
  },
  cellChild: { borderRadius: theme.radius.childXl, minHeight: 96 },
  cellDisabled: { opacity: 0.45 },
  cellRarity: { marginTop: theme.spacing.s1 },
  insufficientText: { color: theme.colors.neutralTextSecondary },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  modalCard: { width: "84%", maxWidth: 360 },
  modalTitle: { textAlign: "center", marginTop: theme.spacing.s3 },
  modalBody: { textAlign: "center", marginTop: theme.spacing.s2 },
  modalButtonRow: { flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s4 },
  errorText: { color: theme.colors.statusBlocking, textAlign: "center", marginTop: theme.spacing.s2 },
});

export default StickerShopPanel;
