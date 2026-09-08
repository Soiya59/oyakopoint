/**
 * ステッカーを買う（P37／C30／S23、新規）本体の3ロール共通コンポーネント。
 * 参照: 主要画面ワイヤーフレーム.md 32.0節決定1・決定9・決定10・決定11、32.1節。
 *
 * 12種類（形3種×レアリティ4段）を常に同じ配置（形ごとに1行、レアリティ4段を
 * 列に固定）で表示する（決定9「どのインスタンスを使うか選ばせない」の前提として、
 * カタログ位置＝形×レアリティのみが選択対象）。購入確認は新しい画面を作らず、
 * 本コンポーネント内のインライン確認モーダルで行う（決定10）。
 *
 * [2026-09-08改訂・要件定義書07-19-14章「決定32〜38」・決定39・
 * UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 32.0b節・32.1節、
 * 開発部/成果物/実装メモ.md 161章]
 * メダルの段階購入制（形ごとに銅→銀→金→虹の順でしか買えない。解放条件は
 * 家族の誰かの過去購入実績、決定32・33）を導入した。あわせて統括判断（決定39）
 * により月次の購入上限は完全に撤廃されたため、旧`purchasedCatalogIdsThisMonth`
 * （2026-09-09改訂、143章）は廃止し、`lockedCatalogIds`（家族解放待ちの
 * カタログID一覧）に置き換えた。買えない理由は「①家族解放待ち」「②残高不足」の
 * 2つになり、優先順位は「家族解放待ち＞残高不足」（32.0b節決定29。貯めても
 * 解決しない条件を先に伝える）。段階の順序はグリッド上でセル間に矢印「→」を
 * 表示して明示する（32.0b節決定31）。「家族の誰が持っているか」は一切表示しない
 * （32.0b節決定30）。
 *
 * [2026-09-07改訂・本部長／実装メモ152章] 画面に出す呼び名は「メダル」に統一した
 * （統括判断）。DBの`sticker_key`・本コンポーネント名・コメント中の「シール」
 * 「ステッカー」はそのまま変更していない。
 *
 * [2026-09-08改訂・本部長（実機確認より）／実装メモ164章] 未開放マスに説明文
 * （旧・32.0b節決定28の3ロール文言テンプレート）を並べると同じ説明が縦に最大3つ
 * 並んで文字が過密になったため、未開放マスからは説明文を外し、絵とレアリティ名
 * だけにした（薄く表示するdimmingは維持）。代わりに形の行の下に1行だけ、その行で
 * 次に開くレアリティと必要なレアリティを差し込んだ説明を出す（矢印「→」が順序を
 * 既に示しているため、行に1つで足りるという判断）。行が全部開放済みならこの1行は
 * 出さない。開放済みマスの見た目（価格／「あと◯pt」）は変更していない。
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

/**
 * 段階購入制（要件定義書07-19-14章「決定32」）: このレアリティを買うために
 * 家族の誰かが過去に購入している必要がある「ひとつ下のレアリティ」。銅は
 * 下の段が無いためnull（無条件で買える）。
 */
const requiredLowerRarity: Record<StickerRarity, StickerRarity | null> = {
  bronze: null,
  silver: "bronze",
  gold: "silver",
  rainbow: "gold",
};

/**
 * [2026-09-08改訂・本部長／実装メモ164章] 未開放マスの説明文は行の下1行に集約した
 * （旧・32.0b節「決定28」の3ロール文言テンプレートは廃止。詳細は実装メモ164章）。
 * その行でまだ開いていない最初のレアリティ（＝次に開くもの）と、それを開くために
 * 必要な「ひとつ下のレアリティ」を差し込んだ1文を返す。行がすべて開放済みなら
 * `null`（＝1行ごと表示しない）。
 */
function nextUnlockMessage(tone: Tone, items: StickerCatalogItem[], lockedIdSet: Set<string>): string | null {
  const firstLocked = items.find((item) => lockedIdSet.has(item.id));
  if (!firstLocked) return null;
  const requiredRarity = requiredLowerRarity[firstLocked.rarity];
  if (!requiredRarity) return null;
  const isChild = tone === "child";
  const nextLabel = isChild ? rarityLabel[firstLocked.rarity].child : rarityLabel[firstLocked.rarity].parent;
  const requiredLabel = isChild ? rarityLabel[requiredRarity].child : rarityLabel[requiredRarity].parent;
  return isChild
    ? `${nextLabel}は、${requiredLabel}を だれかが かうと ひらくよ`
    : `${nextLabel}は、${requiredLabel}を家族の誰かが買うと、購入できるようになります`;
}

export interface StickerShopPanelProps {
  tone: Tone;
  loadState: LoadState;
  catalog: StickerCatalogItem[];
  balance: number;
  /**
   * [2026-09-08新設・要件定義書07-19-14章「決定32・33」・実装メモ161章]
   * 家族としてまだ解放されていない（＝ひとつ下のレアリティを家族の誰も過去に
   * 購入したことがない）カタログID一覧。旧`purchasedCatalogIdsThisMonth`
   * （143章、月次購入上限の表示用）は決定39（月次購入上限の完全撤廃）により
   * 廃止し、本propに置き換えた。
   */
  lockedCatalogIds: string[];
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
  lockedCatalogIds,
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
  const lockedIdSet = new Set(lockedCatalogIds);

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
        <Text style={bodyMediumStyle}>{isChild ? "メダルを かう" : "メダルを買う"}</Text>
        <Text style={bodyMediumStyle}>🌟{balance}pt</Text>
      </View>

      <View style={{ marginTop: theme.spacing.s4, gap: theme.spacing.s4 }}>
        {byShape.map(({ shape, items }) => (
          <View key={shape}>
            <Text style={[captionStyle, styles.shapeHeading]}>{isChild ? shapeLabel[shape].child : shapeLabel[shape].parent}</Text>
            <View style={styles.row}>
              {items.map((item, index) => {
                const affordable = balance >= item.points_cost;
                const locked = lockedIdSet.has(item.id);
                // [32.0b節決定29] 優先順位「家族解放待ち＞残高不足」。貯めても
                // 解決しない条件（家族解放待ち）を優先して伝える。
                const disabled = locked || !affordable;
                return (
                  <React.Fragment key={item.id}>
                    {/* [32.0b節決定31] 段階の順序（銅→銀→金→虹）をセル間の矢印で明示する。
                        ナビゲーション目的ではなく順序の可視化のみのため、
                        スクリーンリーダーには読み上げさせない。 */}
                    {index > 0 && (
                      <Text style={[captionStyle, styles.arrow]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                        →
                      </Text>
                    )}
                    <Pressable
                      disabled={disabled}
                      onPress={() => setSelected(item)}
                      style={[styles.cell, tone === "child" && styles.cellChild, disabled && styles.cellDisabled]}
                      accessibilityRole="button"
                    >
                      <StickerIcon shape={item.shape} rarity={item.rarity} size={32} />
                      <Text style={[captionStyle, styles.cellRarity]}>
                        {isChild ? rarityLabel[item.rarity].child : rarityLabel[item.rarity].parent}
                      </Text>
                      {/* [2026-09-08改訂・実装メモ164章] 未開放マスには説明文・「あと◯pt」を
                          出さない（絵とレアリティ名だけ）。次に開く条件は行の下1行に集約した。 */}
                      {!locked && (
                        <Text style={[captionStyle, !affordable && styles.insufficientText]}>
                          {affordable ? `${item.points_cost}pt` : `あと${item.points_cost - balance}pt`}
                        </Text>
                      )}
                    </Pressable>
                  </React.Fragment>
                );
              })}
            </View>
            {/* [2026-09-08改訂・実装メモ164章] 行の下に1行だけ、その行で次に開くものを説明する。
                行が全部開放済みなら何も出さない。 */}
            {(() => {
              const message = nextUnlockMessage(tone, items, lockedIdSet);
              return message ? <Text style={[captionStyle, styles.rowUnlockHint]}>{message}</Text> : null;
            })()}
          </View>
        ))}
      </View>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={styles.backdrop}>
          <Card tone={tone} style={styles.modalCard}>
            {selected && (
              <>
                <View style={{ alignItems: "center" }}>
                  {/* [149章] 購入確認モーダルはこのコンポーネントの中で唯一ステッカーを
                      拡大表示する箇所のため、`highRes`で512px画像を強制する。 */}
                  <StickerIcon shape={selected.shape} rarity={selected.rarity} size={180} highRes />
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
  shapeHeading: { color: theme.colors.neutralTextSecondary, marginBottom: theme.spacing.s2 },
  row: { flexDirection: "row", gap: theme.spacing.s2 },
  arrow: { color: theme.colors.neutralTextSecondary, alignSelf: "center" },
  rowUnlockHint: { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s2 },
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
