/**
 * メダル購入結果ビュー（P37/C30/S23、購入成功後の状態）本体の3ロール共通コンポーネント。
 * 参照: 主要画面ワイヤーフレーム.md 34章、画面一覧・遷移図.md P37/C30/S23行・3.17節。
 *
 * 本部長経由の統括の実機要望「メダルを購入した後に購入しました！という画面が欲しい。
 * その際、○○のコレクションにセット？されました、木に飾りますか？みたいな画面が
 * あればよい」を受け新設した（34.0節）。新しい画面番号・新しいルートは増やさず、
 * 購入画面（P37/C30/S23）内の状態切替として実装する（決定1、
 * `app/parent/tree-decorate.tsx`の`success`状態と同じ「全画面差し替え」パターン）。
 *
 * `GachaResultView`は流用しない（34.5節）。データの形（`kind`分岐）が合わず、
 * 二段階リビール等のガチャ専有ロジックを持ち、かつメダルは常に「木に飾る」
 * 「コレクションを見る」の両方のボタンを出す必要がありガチャの確定分岐（一方のみ）と
 * 前提が異なるため、別コンポーネントとして新設した。ただし視覚文法（見出し→拡大アイコン
 * →名前行→行動ボタンの縦並び）とボタン文言そのものは`GachaResultView`と完全に同一の
 * 文字列を流用する（34.2節）。
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import { StickerIcon } from "./StickerIcon";
import theme from "@/theme/theme";
import type { StickerCatalogItem } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

export interface StickerPurchaseResultViewProps {
  tone: Tone;
  /** 購入したカタログ項目（表示名・形・レアリティの導出に使う）。 */
  item: StickerCatalogItem;
  /** 「木に飾る →」（決定3、既存のP29/C23/S17へ遷移）。 */
  onDecorate: () => void;
  /** 「コレクションを見る →」（決定4、既存のP31/C26/S19へ`router.replace`）。 */
  onGoToShelf: () => void;
}

export function StickerPurchaseResultView({ tone, item, onDecorate, onGoToShelf }: StickerPurchaseResultViewProps) {
  const isChild = tone === "child";
  const headlineStyle = isChild ? theme.typography.childHeadline : tone === "supporter" ? theme.typography.supporterTitle : theme.typography.parentTitle;
  const bodyStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;

  // [34.2節] `GachaResultView.tsx`が定義する`decorateLabel`・`shelfLabel`と
  // 完全に同一の文字列。ガチャの結果画面と同じボタンに見えるようにするため、
  // 新しい言い回しは増やさない。
  const decorateLabel = isChild ? "きに かざる →" : "木に飾る →";
  const shelfLabel = isChild ? "コレクションだなを みる →" : "コレクションを見る →";

  return (
    <View style={styles.container}>
      <StickerIcon shape={item.shape} rarity={item.rarity} size={180} highRes />
      <Text style={headlineStyle}>{isChild ? "⭐ かったよ！" : "購入しました"}</Text>
      <Text style={[bodyStyle, styles.itemName]}>「{item.display_name}」</Text>
      <Text style={[bodyStyle, styles.shelfNote]}>
        {isChild ? "てにいれたよ！\nコレクションだなに はいったよ！" : "コレクションに追加されました"}
      </Text>
      <Text style={[bodyStyle, styles.question]}>{isChild ? "きに かざる？" : "木に飾りますか？"}</Text>
      {/* [決定2] どちらか一方を必ず選んでもらう構成。両方のボタンを常に提示し、
          自動で閉じる・自動遷移する挙動は設けない。 */}
      <AppButton label={decorateLabel} tone={tone} fullWidth style={styles.button} onPress={onDecorate} />
      <AppButton label={shelfLabel} tone={tone} variant="secondary" fullWidth style={styles.buttonSecondary} onPress={onGoToShelf} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", marginTop: theme.spacing.s8 },
  itemName: { marginTop: theme.spacing.s4, textAlign: "center" },
  shelfNote: { marginTop: theme.spacing.s2, textAlign: "center", color: theme.colors.neutralTextSecondary },
  question: { marginTop: theme.spacing.s4, textAlign: "center" },
  button: { marginTop: theme.spacing.s8 },
  buttonSecondary: { marginTop: theme.spacing.s3 },
});

export default StickerPurchaseResultView;
