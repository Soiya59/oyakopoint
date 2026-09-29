/**
 * 「まえのアバター」（アバターのストック3枚）の欄。`AvatarDrawingPanel`の「今のすがた」
 * カードの中に置く（新しい画面は作らない）。
 * 参照: 要件定義書07-44章、主要画面ワイヤーフレーム.md 69章、開発部/成果物/実装メモ.md 334章。
 *
 * [形（69.1〜69.2節）] 区切り線 → 見出し → 補足 → 3つの枠（56×56の丸、間隔16、左が新しい、
 * 空き枠は点線の丸）。枠をタップ＝選ぶだけ（何も変わらない）→ 枠の下にプレビュー（120）＋
 * 説明＋「これに もどす」「けす」。同じ枠をもう一度押すと閉じる。戻すのは確認なし
 * （今の絵が必ず左端に残る入れ替えで、取り返しがつく）、消すのだけその場の2段階確認
 * （取り返しがつかない）。`Alert.alert`は使わない。
 *
 * [文字が大きい端末・狭い画面（69.8節、328・329章の教訓）] 枠の中に文字は入れない
 * （合計幅は56×3＋16×2＝200で固定）。プレビューの2ボタンは`flex: 1`の等分＋
 * `numberOfLines={2}`＋`adjustsFontSizeToFit`（幅が決まっているので下限が効かなくても
 * 消えない）。見出し・補足・説明・確認の文は横幅いっぱいのTextで折り返しを許す。
 * 確認の「ほんとうに けす／やめる」は縦に積む（横に並べない）。
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import FailureRefText from "./FailureRefText";
import MemberAvatar from "./MemberAvatar";
import theme from "@/theme/theme";
import { buildStockSlots, keepSelectedStockId, type AvatarStockStatus } from "@/lib/avatarStock";
import type { AvatarStockText } from "@/lib/avatarStockText";
import type { MemberAvatarStockRow } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

interface AvatarStockSectionProps {
  tone: Tone;
  displayName: string;
  /** 持ち主の今のavatar_color。まえのアバターは色を持たないため、常にこの色の丸の上に描く（81.11章）。 */
  backgroundColor: string;
  text: AvatarStockText;
  stocks: MemberAvatarStockRow[];
  status: AvatarStockStatus;
  /** 今の絵があるか（あれば「これにもどす」の説明に2文目を足す。0枚の予告を出す条件にも使う）。 */
  hasCurrentAvatar: boolean;
  /** 保存・戻し・色にもどす直後の数秒だけ、左端の枠に「ここに入ったよ」の枠線を付ける。 */
  highlightNewest: boolean;
  /** 保存中・戻し中・消し中は枠を押せない。 */
  slotsDisabled: boolean;
  restoring: boolean;
  deleting: boolean;
  actionErrorMessage: string | null;
  actionErrorRef: string | null;
  onClearActionError: () => void;
  /** 枠を選ぶ直前に呼ぶ（「色にもどす」の確認表示を先に閉じるため。69.7節）。 */
  onBeforeSelect?: () => void;
  /** 「これに もどす」。プレビューを閉じてよいときtrue。 */
  onRestore: (stock: MemberAvatarStockRow) => Promise<boolean>;
  /** 消す（確認のあと）。プレビューを閉じてよいときtrue。 */
  onDelete: (stock: MemberAvatarStockRow) => Promise<boolean>;
  onRetry: () => void;
}

export function AvatarStockSection({
  tone,
  displayName,
  backgroundColor,
  text,
  stocks,
  status,
  hasCurrentAvatar,
  highlightNewest,
  slotsDisabled,
  restoring,
  deleting,
  actionErrorMessage,
  actionErrorRef,
  onClearActionError,
  onBeforeSelect,
  onRestore,
  onDelete,
  onRetry,
}: AvatarStockSectionProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const isChildTone = tone === "child";
  const bodyStyle = isChildTone ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  const captionStyle = isChildTone ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;

  // 一覧が変わったあと（入れ替えでidが変わる・別の端末で先に消された）、選んでいた絵が
  // 無くなっていたら選択とプレビューを閉じる。
  useEffect(() => {
    if (selectedId !== null && keepSelectedStockId(selectedId, stocks) === null) {
      setSelectedId(null);
      setIsConfirmingDelete(false);
    }
  }, [stocks, selectedId]);

  const slots = buildStockSlots(stocks, theme.avatarStock.maxSlots);
  const selected = selectedId === null ? null : stocks.find((s) => s.id === selectedId) ?? null;
  const busy = restoring || deleting;

  const toggleSelect = (id: string) => {
    if (slotsDisabled || busy) return;
    onClearActionError();
    onBeforeSelect?.();
    setIsConfirmingDelete(false);
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const handleRestore = async () => {
    if (!selected) return;
    const closeIt = await onRestore(selected);
    if (closeIt) {
      setSelectedId(null);
      setIsConfirmingDelete(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    const closeIt = await onDelete(selected);
    if (closeIt) {
      setSelectedId(null);
      setIsConfirmingDelete(false);
    }
  };

  const renderSlots = () => {
    if (status === "loading") {
      // 読み込み中: 3つの枠をグレーの丸で出す（点線にしない）。スピナーは出さない（ちらつきを増やさない）。
      return slots.map((_, i) => <View key={i} style={[styles.slotBase, styles.slotLoading]} />);
    }
    return slots.map((stock, i) => {
      if (stock === null) {
        return (
          <View
            key={`empty-${i}`}
            accessible
            accessibilityLabel={text.emptySlotLabel}
            style={[styles.slotBase, styles.slotEmpty]}
          />
        );
      }
      const isSelected = stock.id === selectedId;
      const showFrame = isSelected || (i === 0 && highlightNewest);
      return (
        <Pressable
          key={stock.id}
          onPress={() => toggleSelect(stock.id)}
          disabled={slotsDisabled || busy}
          accessibilityRole="button"
          accessibilityLabel={text.slotLabel(i + 1)}
          accessibilityState={{ selected: isSelected }}
          style={styles.slotBase}
        >
          <MemberAvatar name={displayName} color={backgroundColor} size={theme.avatarStock.slotSize} lineData={stock.line_data} />
          <View pointerEvents="none" style={[styles.slotFrame, showFrame && styles.slotFrameOn]} />
        </Pressable>
      );
    });
  };

  return (
    <View style={styles.section}>
      <View style={styles.divider} />
      <Text style={[bodyStyle, styles.heading]}>{text.heading}</Text>
      <Text style={[captionStyle, styles.note]}>{text.note}</Text>

      {status === "error" ? (
        <View style={styles.loadFailedBlock}>
          <Text style={[bodyStyle, styles.centerText]}>{text.loadFailed}</Text>
          <Pressable onPress={onRetry} hitSlop={8}>
            <Text style={[bodyStyle, styles.linkText]}>{text.retryLabel}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {status === "ready" && stocks.length === 0 && hasCurrentAvatar && (
            <Text style={[captionStyle, styles.note]}>{text.emptyHint}</Text>
          )}
          <View style={styles.slotRow}>{renderSlots()}</View>

          {selected && (
            <View style={styles.preview}>
              <MemberAvatar name={displayName} color={backgroundColor} size={theme.avatarStock.previewSize} lineData={selected.line_data} />
              {isConfirmingDelete ? (
                <>
                  <Text style={[bodyStyle, styles.centerText]}>{text.deleteConfirm}</Text>
                  {actionErrorMessage && <Text style={styles.error}>{actionErrorMessage}</Text>}
                  {actionErrorMessage && <FailureRefText value={actionErrorRef} tone={tone} />}
                  <View style={styles.confirmColumn}>
                    <Pressable onPress={handleDelete} disabled={deleting} hitSlop={8}>
                      <Text style={[bodyStyle, styles.deleteConfirmText]}>
                        {deleting ? text.deleting : text.deleteConfirmActionLabel}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => setIsConfirmingDelete(false)} disabled={deleting} hitSlop={8}>
                      <Text style={[bodyStyle, styles.linkText]}>{text.deleteCancelLabel}</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={[bodyStyle, styles.centerText]}>
                    {hasCurrentAvatar ? text.previewText : text.previewTextNoCurrent}
                  </Text>
                  {actionErrorMessage && <Text style={styles.error}>{actionErrorMessage}</Text>}
                  {actionErrorMessage && <FailureRefText value={actionErrorRef} tone={tone} />}
                  <View style={styles.previewButtons}>
                    <AppButton
                      label={restoring ? text.restoring : text.restoreLabel}
                      tone={tone}
                      onPress={handleRestore}
                      disabled={busy}
                      style={styles.previewButton}
                      numberOfLines={2}
                      adjustsFontSizeToFit
                    />
                    <AppButton
                      label={text.deleteLabel}
                      tone={tone}
                      variant="secondary"
                      onPress={() => {
                        onClearActionError();
                        setIsConfirmingDelete(true);
                      }}
                      disabled={busy}
                      style={styles.previewButton}
                      numberOfLines={2}
                      adjustsFontSizeToFit
                    />
                  </View>
                </>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const SLOT = theme.avatarStock.slotSize;

const styles = StyleSheet.create({
  section: { alignSelf: "stretch", alignItems: "center", gap: theme.spacing.s2 },
  divider: { alignSelf: "stretch", height: 1, backgroundColor: theme.colors.neutralBorder, marginVertical: theme.spacing.s1 },
  heading: { fontWeight: "600", textAlign: "center" },
  note: { color: theme.colors.neutralTextSecondary, textAlign: "center", fontWeight: "400" },
  centerText: { textAlign: "center" },
  // 3つの枠は文字を持たず、合計幅は56×3＋16×2＝200で固定（文字の大きさに影響されない）。
  slotRow: { flexDirection: "row", justifyContent: "center", gap: theme.avatarStock.slotGap },
  slotBase: { width: SLOT, height: SLOT, borderRadius: SLOT / 2 },
  slotLoading: { backgroundColor: theme.colors.neutralBorder },
  slotEmpty: { borderWidth: 2, borderStyle: "dashed", borderColor: theme.colors.neutralBorder },
  // 選択・「ここに入ったよ」の枠線（DrawingPaletteの選択と同じ表現＝brandPrimary・3px）。
  // 丸の外側に重ねる（絵の大きさ・配置を変えない）。
  slotFrame: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: SLOT / 2, borderWidth: 3, borderColor: "transparent" },
  slotFrameOn: { borderColor: theme.colors.brandPrimary },
  preview: { alignSelf: "stretch", alignItems: "center", gap: theme.spacing.s2, marginTop: theme.spacing.s2 },
  // 横並びの2ボタンは等分（flex: 1。329章の教訓＝「残りの幅を受け取る」にしない）。
  previewButtons: { flexDirection: "row", alignSelf: "stretch", gap: theme.spacing.s3 },
  previewButton: { flex: 1 },
  confirmColumn: { alignItems: "center", gap: theme.spacing.s2 },
  deleteConfirmText: { color: theme.colors.statusBlocking, textDecorationLine: "underline" },
  linkText: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  loadFailedBlock: { alignItems: "center", gap: theme.spacing.s2 },
  error: { color: theme.colors.statusBlocking, textAlign: "center" },
});

export default AvatarStockSection;
