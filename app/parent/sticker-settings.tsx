import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { fetchFamilyStickerPrices, resetStickerTier, setFamilyStickerPrices } from "@/data/api";
import { rarityLabel, shapeLabel } from "@/components/StickerShopPanel";
import { computeHighestEverPurchasedRarity, useFamilyStickerPurchasesForLock } from "@/hooks/useStickers";
import type { StickerShape } from "@/theme/theme";

/**
 * [2026-09-11新設・要件定義書07-25-1章決定10〜18、UIUXデザイン部/成果物/
 * 主要画面ワイヤーフレーム.md 41章決定14] 家族が一度も設定しなければ、
 * 現行の銅10／銀30／金50／クリスタル100のまま変わらない（決定14の既定値）。
 * 「もとの値段にもどす」（41.5節決定8）は下書きをこの値に書き換えるだけ。
 */
const DEFAULT_STICKER_PRICES: Record<"bronze" | "silver" | "gold" | "crystal", number> = {
  bronze: 10,
  silver: 30,
  gold: 50,
  crystal: 100,
};

/** レアリティの検証順（決定6: 銅→銀→金→クリスタルの固定順）。 */
const RARITY_ORDER: ("bronze" | "silver" | "gold" | "crystal")[] = ["bronze", "silver", "gold", "crystal"];

/**
 * メダル管理（保護者のみ）。
 *
 * [2026-09-11新設・統括指示「メダル管理はメダル管理として、ごほうび管理の下に
 * 追加してほしい」／本部長・軽微変更ルート] もともと UIUXデザイン部/成果物/
 * 主要画面ワイヤーフレーム.md 40章 決定1・41章 決定1 は「P14『設定』の中に
 * 『メダルの設定』区画を置く」としており、実装もそうなっていた（実装メモ200章）。
 * **統括の指摘により、この決定を取り下げてここへ移した。**
 *
 * 理由: クエストとごほうびは「クエスト管理」「ごほうび管理」という独立した
 * 管理画面を持つのに、メダルだけが設定の奥にあり不揃いだった。かんりタブの
 * 並びを クエスト管理 → ごほうび管理 → **メダル管理** とすることで、
 * 「家族の決めごとを管理する画面」が3つ並ぶ形になる。2026-09-11に
 * 「みまもり（参考）」を設定から出してかんりタブへ集約した（実装メモ191章）
 * のと同じ整理である。
 *
 * 中身（形ごとの段階リセット）は40章の決定1〜14をそのまま維持しており、
 * 移設にあたって挙動・文言は一切変えていない。
 *
 * [2026-09-11追加・要件定義書07-25-1章決定10〜18、UIUXデザイン部/成果物/
 * 主要画面ワイヤーフレーム.md 41章、設計部/成果物/スキーマ設計.sql 53章]
 * メダルの値段を家族ごとに編集できる区画「ねだんの設定」を追加した。41章は
 * 「P14『設定』の『メダルの設定』Card内」を前提に書かれているが、本部長の
 * 訂正（やること.md 2-35）により、その配置指示はすべて「この画面（メダル
 * 管理）の中」に読み替える。41章決定1が定めた「ねだんの設定を上、段階の
 * リセットを下（軽い操作→重い操作）」という順序と、区切り線で分ける構成は
 * そのまま踏襲した。
 */
export default function ParentStickerSettingsScreen() {
  const { state } = useAppData();
  const { client } = useSession();

  // ============================================================
  // [2026-09-11新設・要件定義書07-25-1章決定10〜18、UIUXデザイン部/成果物/
  // 主要画面ワイヤーフレーム.md 41章] メダルの値段を家族ごとに編集する
  // 「ねだんの設定」。41.1節決定1のとおり「ねだんの設定」を上、「段階の
  // リセット」を下に置く（軽い操作→重い操作）。
  // ============================================================
  type PriceLoadState = "loading" | "ready" | "error";
  const [priceLoadState, setPriceLoadState] = useState<PriceLoadState>("loading");
  const [bronzeText, setBronzeText] = useState("");
  const [silverText, setSilverText] = useState("");
  const [goldText, setGoldText] = useState("");
  const [crystalText, setCrystalText] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceSaved, setPriceSaved] = useState(false);

  const loadFamilyStickerPrices = async () => {
    if (!client) return;
    setPriceLoadState("loading");
    const res = await fetchFamilyStickerPrices(client);
    if (!res.ok) {
      setPriceLoadState("error");
      return;
    }
    const byRarity = new Map(res.data.map((r) => [r.rarity, r.points_cost]));
    setBronzeText(String(byRarity.get("bronze") ?? DEFAULT_STICKER_PRICES.bronze));
    setSilverText(String(byRarity.get("silver") ?? DEFAULT_STICKER_PRICES.silver));
    setGoldText(String(byRarity.get("gold") ?? DEFAULT_STICKER_PRICES.gold));
    setCrystalText(String(byRarity.get("crystal") ?? DEFAULT_STICKER_PRICES.crystal));
    setPriceLoadState("ready");
  };

  useEffect(() => {
    loadFamilyStickerPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  /** 「もとの値段にもどす」（決定8）: 下書き（テキスト入力）だけを書き換える。保存はしない。 */
  const resetPriceDraftToDefault = () => {
    setPriceError(null);
    setPriceSaved(false);
    setBronzeText(String(DEFAULT_STICKER_PRICES.bronze));
    setSilverText(String(DEFAULT_STICKER_PRICES.silver));
    setGoldText(String(DEFAULT_STICKER_PRICES.gold));
    setCrystalText(String(DEFAULT_STICKER_PRICES.crystal));
  };

  const priceTextByRarity: Record<"bronze" | "silver" | "gold" | "crystal", string> = {
    bronze: bronzeText,
    silver: silverText,
    gold: goldText,
    crystal: crystalText,
  };

  /**
   * 決定6: 保存ボタンを押した時点で検証する。
   * 1. 4つそれぞれが1以上の整数か（決定12「0pt禁止」）。銅→銀→金→クリスタルの
   *    固定順で最初に見つかった1項目のみを報告する。
   * 2. 上記を全て満たした場合のみ、銅→銀→金→クリスタルの隣接ペアを比較し、
   *    最初に見つかった違反ペアのみを「{上位}は{下位}以上にしてください」の
   *    形で報告する（同額は許容、逆転のみ禁止）。
   */
  const validatePrices = (): { error: string | null; values: Record<"bronze" | "silver" | "gold" | "crystal", number> | null } => {
    const values: Partial<Record<"bronze" | "silver" | "gold" | "crystal", number>> = {};
    for (const rarity of RARITY_ORDER) {
      const num = Number(priceTextByRarity[rarity]);
      if (!Number.isInteger(num) || num < 1) {
        return { error: `${rarityLabel[rarity].parent}の値段は1以上の整数で入力してください`, values: null };
      }
      values[rarity] = num;
    }
    const v = values as Record<"bronze" | "silver" | "gold" | "crystal", number>;
    for (let i = 1; i < RARITY_ORDER.length; i++) {
      const lower = RARITY_ORDER[i - 1];
      const upper = RARITY_ORDER[i];
      if (v[upper] < v[lower]) {
        return { error: `${rarityLabel[upper].parent}は${rarityLabel[lower].parent}以上にしてください`, values: null };
      }
    }
    return { error: null, values: v };
  };

  const savePrices = async () => {
    if (!client) return;
    const { error, values } = validatePrices();
    if (error || !values) {
      setPriceError(error);
      setPriceSaved(false);
      return;
    }
    setPriceSaving(true);
    setPriceError(null);
    setPriceSaved(false);
    const res = await setFamilyStickerPrices(client, values);
    setPriceSaving(false);
    if (!res.ok) {
      setPriceError(res.error.message);
      return;
    }
    setPriceSaved(true);
  };

  const onEditPriceText = (setter: (t: string) => void) => (t: string) => {
    setter(t.replace(/[^0-9]/g, ""));
    setPriceSaved(false);
  };

  // ============================================================
  // [2026-09-11新設・要件定義書07-25-1章決定20〜27、UIUXデザイン部/成果物/
  // 主要画面ワイヤーフレーム.md 40.1節] メダルの段階リセット「メダルの設定」。
  // 決定4・決定5の状態表示・非活性化判定には、家族の形ごとの生の購入実績
  // （reset_atを問わない）が必要（設計部/成果物/スキーマ設計.sql 52.6章）。
  // 既存の`useFamilyStickerPurchasesForLock`（買う画面の段階購入制と同じ
  // データ取得）をそのまま再利用し、新しいAPIは追加しない。
  // ============================================================
  type TierShapeSelection = StickerShape | "all";
  const {
    loadState: tierPurchasesLoadState,
    purchases: tierFamilyPurchases,
    reload: reloadTierFamilyPurchases,
  } = useFamilyStickerPurchasesForLock(state.family.id);
  const [selectedTierShape, setSelectedTierShape] = useState<TierShapeSelection | null>(null);
  const [confirmingTierReset, setConfirmingTierReset] = useState(false);
  const [tierResetting, setTierResetting] = useState(false);
  const [tierResetError, setTierResetError] = useState<string | null>(null);
  const [tierResetSuccessMessage, setTierResetSuccessMessage] = useState<string | null>(null);

  const selectTierShape = (shape: TierShapeSelection) => {
    setConfirmingTierReset(false);
    setTierResetError(null);
    setTierResetSuccessMessage(null);
    setSelectedTierShape((prev) => (prev === shape ? null : shape));
  };

  /** 決定4「いま『◯◯』は{現在の最高解放レアリティ}まで購入できる状態です。」 */
  const tierStatusLineFor = (shape: StickerShape): string => {
    const highest = computeHighestEverPurchasedRarity(tierFamilyPurchases, shape);
    return highest
      ? `いま「${shapeLabel[shape].parent}」は${rarityLabel[highest].parent}まで購入できる状態です。`
      : `「${shapeLabel[shape].parent}」はまだ何も購入されていません。リセットの必要はありません。`;
  };

  /** 決定4「ぜんぶ」選択時: 4形それぞれの状態を1行にまとめる。 */
  const tierAllStatusLine = (): string =>
    theme.stickerShapes
      .map((shape) => {
        const highest = computeHighestEverPurchasedRarity(tierFamilyPurchases, shape);
        return `${shapeLabel[shape].parent}:${highest ? `${rarityLabel[highest].parent}まで` : "まだ何も購入なし"}`;
      })
      .join("／");

  const tierHasAnyPurchase = (shape: StickerShape): boolean => computeHighestEverPurchasedRarity(tierFamilyPurchases, shape) !== null;

  /** 決定7の確認文言・1行目（単一の形／「ぜんぶ」で分岐）。 */
  const tierConfirmTitle = (): string => {
    if (!selectedTierShape) return "";
    if (selectedTierShape === "all") {
      return "「ぜんぶ」を選ぶと、カブトムシ・ちょうちょ・おはな・ドラゴンの4つすべてを同時にリセットします。";
    }
    return `「${shapeLabel[selectedTierShape].parent}」を、銅からもう一度集め直せるようにします。`;
  };

  /**
   * 決定6〜8: 二段階確認の「リセットする」タップ。決定21「ぜんぶ」は内部的には
   * 形の数だけ独立にreset_sticker_tier()を呼び出す（設計部決定52-5、配列引数の
   * 一括RPCは不採用）。途中で失敗した場合はそこで止め、それまでに成功した分は
   * 追記専用ログの性質上そのまま残る（取り消し不可、決定24と同じ整理）。
   */
  const confirmTierReset = async () => {
    if (!selectedTierShape) return;
    setTierResetting(true);
    setTierResetError(null);
    const shapesToReset: StickerShape[] = selectedTierShape === "all" ? [...theme.stickerShapes] : [selectedTierShape];
    for (const shape of shapesToReset) {
      const res = await resetStickerTier(client, shape);
      if (!res.ok) {
        setTierResetting(false);
        setTierResetError(
          shapesToReset.length > 1
            ? `「${shapeLabel[shape].parent}」のリセットに失敗しました：${res.error.message}`
            : res.error.message
        );
        return;
      }
    }
    setTierResetting(false);
    setConfirmingTierReset(false);
    const label = selectedTierShape === "all" ? "ぜんぶ" : shapeLabel[selectedTierShape].parent;
    setSelectedTierShape(null);
    setTierResetSuccessMessage(`「${label}」をリセットしました。銅からまた集められます。`);
    // 数秒だけ表示して自動的に消す（25.1節「保存成功」と同型、決定8）。
    setTimeout(() => setTierResetSuccessMessage(null), 4000);
  };

  // [2026-09-11] 家族データ・接続が揃う前の一瞬は見出しだけ出す。
  // **この判定はフックの呼び出しより後に置くこと。**Reactの規則で、フックは
  // どの描画でも同じ順序・同じ回数で呼ばれる必要があり、早期returnより前に
  // フックがあると順序が崩れる（実装メモ178章で導入したESLintの門番が検出する）。
  if (!state.family || !client) {
    return (
      <Screen tone="parent">
        <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/manage")} />
        <Text style={theme.typography.parentTitle}>🪙 メダル管理</Text>
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/manage")} />
      <Text style={theme.typography.parentTitle}>🪙 メダル管理</Text>


    {/* [2026-09-11新設・要件定義書07-25-1章決定20〜27、UIUXデザイン部/成果物/
        主要画面ワイヤーフレーム.md 40.1節決定1〜8] メダルの段階リセット
        「メダルの設定」。危険度の異なる操作（家族から抜ける・家族を削除する）
        とは列を分け、独立したCardとして家族名の直後に置く（決定1）。
        決定22・27のとおり購入履歴・木の配置・バッジは一切消えないため、
        ボタンは`secondary`のまま（`danger`にしない、決定6）。 */}
    <Card style={{ marginTop: theme.spacing.s6 }}>
      <Text style={theme.typography.parentBodyMedium}>メダルの設定</Text>

      {/* [2026-09-11新設・要件定義書07-25-1章決定10〜18、UIUXデザイン部/成果物/
          主要画面ワイヤーフレーム.md 41.1〜41.6節] 「ねだんの設定」区画。
          41.1節決定1のとおり、同じCard内で「段階のリセット」より上（軽い
          操作→重い操作）に置く。リアルタイム検証はせず、保存ボタンを
          押した時点で一括検証する（41.3節決定4、41.4節決定6）。 */}
      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s3 }]}>ねだんの設定</Text>
      <Text style={[theme.typography.parentBody, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
        レアリティごとに、メダルの値段を決められます。何も変えなければ、もとの値段のままです。
      </Text>

      {priceLoadState === "loading" && (
        <Text style={[theme.typography.parentBody, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s3 }]}>
          読み込み中…
        </Text>
      )}

      {priceLoadState === "error" && (
        <View style={{ marginTop: theme.spacing.s3 }}>
          <Text style={{ color: theme.colors.statusBlocking }}>読み込みに失敗しました</Text>
          <Pressable onPress={() => loadFamilyStickerPrices()}>
            <Text style={[theme.typography.parentBody, { textDecorationLine: "underline", marginTop: theme.spacing.s1 }]}>再試行</Text>
          </Pressable>
        </View>
      )}

      {priceLoadState === "ready" && (
        <>
          <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
            {RARITY_ORDER.map((rarity) => (
              <View key={rarity} style={styles.priceRow}>
                <Text style={[theme.typography.parentBody, styles.priceRowLabel]}>{rarityLabel[rarity].parent}</Text>
                <TextInput
                  value={priceTextByRarity[rarity]}
                  onChangeText={onEditPriceText(
                    rarity === "bronze" ? setBronzeText : rarity === "silver" ? setSilverText : rarity === "gold" ? setGoldText : setCrystalText
                  )}
                  keyboardType="number-pad"
                  style={[styles.input, styles.priceInput]}
                />
                <Text style={theme.typography.parentBody}>pt</Text>
              </View>
            ))}
          </View>

          {priceError && <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.statusBlocking }}>{priceError}</Text>}
          {priceSaved && !priceError && (
            <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.brandPrimaryStrong }}>変更しました</Text>
          )}

          <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s3 }}>
            <AppButton
              label={priceSaving ? "保存中…" : "保存する"}
              variant="secondary"
              onPress={savePrices}
              disabled={priceSaving}
            />
            <AppButton label="もとの値段にもどす" variant="ghost" onPress={resetPriceDraftToDefault} disabled={priceSaving} />
          </View>
        </>
      )}

      {/* [2026-09-11新設・41.2節決定3] 「ねだんの設定」と「段階のリセット」の
          境界に区切り線を挟む。`family.tsx`の`settingsDivider`と同じ値
          （borderTopWidth: 1・borderTopColor: neutralBorder）を使い、新しい
          線種・色トークンは追加しない。 */}
      <View style={styles.priceSectionDivider} />

      <Text style={[theme.typography.parentBody, { color: theme.colors.neutralTextSecondary }]}>
        形ごとに、もう一度 銅から集め直せるようにできます。
      </Text>
      <View style={styles.tierChipRow}>
        {theme.stickerShapes.map((shape) => (
          <Pressable
            key={shape}
            onPress={() => selectTierShape(shape)}
            style={[styles.tierChip, selectedTierShape === shape && styles.tierChipSelected]}
          >
            <Text style={theme.typography.parentBody}>{shapeLabel[shape].parent}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => selectTierShape("all")} style={[styles.tierChip, selectedTierShape === "all" && styles.tierChipSelected]}>
          <Text style={theme.typography.parentBody}>ぜんぶ</Text>
        </Pressable>
      </View>

      {selectedTierShape && !confirmingTierReset && (
        <View style={{ marginTop: theme.spacing.s3 }}>
          {tierPurchasesLoadState === "loading" ? (
            <Text style={[theme.typography.parentBody, { color: theme.colors.neutralTextSecondary }]}>確認中…</Text>
          ) : tierPurchasesLoadState === "error" ? (
            <>
              <Text style={{ color: theme.colors.statusBlocking }}>読み込みに失敗しました</Text>
              <Pressable onPress={() => reloadTierFamilyPurchases()}>
                <Text style={[theme.typography.parentBody, { textDecorationLine: "underline", marginTop: theme.spacing.s1 }]}>再試行</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={theme.typography.parentBody}>
                {selectedTierShape === "all" ? tierAllStatusLine() : tierStatusLineFor(selectedTierShape)}
              </Text>
              <AppButton
                label={selectedTierShape === "all" ? "「ぜんぶ」をリセットする" : `「${shapeLabel[selectedTierShape].parent}」をリセットする`}
                variant="secondary"
                style={{ marginTop: theme.spacing.s3 }}
                onPress={() => setConfirmingTierReset(true)}
                disabled={selectedTierShape !== "all" && !tierHasAnyPurchase(selectedTierShape)}
              />
            </>
          )}
        </View>
      )}

      {selectedTierShape && confirmingTierReset && (
        <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
          <Text style={theme.typography.parentBody}>{tierConfirmTitle()}</Text>
          <Text style={theme.typography.parentBody}>・今持っているメダルは減りません</Text>
          <Text style={theme.typography.parentBody}>・もう一度、銅から集め直すことになります</Text>
          <Text style={theme.typography.parentBody}>・あとから元に戻すことはできません</Text>
          {tierResetError && <Text style={{ color: theme.colors.statusBlocking }}>{tierResetError}</Text>}
          <AppButton
            label={tierResetting ? "リセットしています…" : "リセットする"}
            variant="secondary"
            onPress={confirmTierReset}
            disabled={tierResetting}
          />
          <AppButton
            label="やめておく"
            variant="ghost"
            onPress={() => {
              setConfirmingTierReset(false);
              setTierResetError(null);
            }}
            disabled={tierResetting}
          />
        </View>
      )}

      {tierResetSuccessMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.brandPrimaryStrong }}>{tierResetSuccessMessage}</Text>
      )}
    </Card>
    </Screen>
  );
}

/** [2026-09-11] `app/parent/family.tsx` から移設したメダル用のスタイル。
 *  移設前と同じ値をそのまま持ってきており、見た目は変えていない。 */
const styles = StyleSheet.create({
  tierChipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s3 },
  tierChip: {
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  tierChipSelected: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
  // [2026-09-11追加・要件定義書07-25-1章決定10〜18、UIUXデザイン部/成果物/
  // 主要画面ワイヤーフレーム.md 41.3節決定4] `app/parent/chore-edit.tsx`の
  // `styles.input`と同じ枠線・角丸・背景色（新しい入力デザインは作らない）。
  // 幅だけ`emojiInput`（96）と同様の固定値に絞った変種`priceInput`を追加する。
  input: {
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    padding: theme.spacing.s3,
    backgroundColor: theme.colors.neutralSurface,
  },
  priceInput: { width: 96 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  priceRowLabel: { width: 64 },
  // [2026-09-11追加・41.2節決定3] `family.tsx`の`settingsDivider`と同じ値。
  priceSectionDivider: {
    marginTop: theme.spacing.s6,
    marginBottom: theme.spacing.s3,
    borderTopWidth: 1,
    borderTopColor: theme.colors.neutralBorder,
  },
});
