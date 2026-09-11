/**
 * アバターを描く画面（C31／S26／P38）の「今のすがた」＋キャンバス部分の共通部品。
 * 参照: 要件定義書07-27章 決定1〜22、スキーマ設計.sql 54章、
 * 主要画面ワイヤーフレーム.md 43章。
 *
 * [DrawingBoardを流用しない理由・企画部決定19] `DrawingBoard`は未公開枚数管理・
 * 題名入力・編集モード（`edit_unpublished_drawing()`前提）を抱え込んだ複合部品で
 * あり、アバターにはそのいずれも存在しない（決定6〜8・決定16）。本コンポーネントは
 * `DrawingCanvas`・`DrawingPalette`・`DrawingStrokeWidthPicker`のみを組み合わせた
 * 新規の軽量な部品として作る（43.9節開発部への申し送り6）。
 *
 * [上限に当たったときに作業を失わせない・最重要] `DrawingCanvas`の内部ガード
 * （`theme.drawingLimits.maxLines`＝300）はアバターの上限150には効かない。
 * ここでは`theme.avatarDrawingLimits`（150本・3000点・20,480byte）で`atCapacity`を
 * 算出し、`disabled={saving || atCapacity}`を`DrawingCanvas`へ渡してキャンバスを
 * 完全にロックする（43.1節 決定1〜3。150本側のガードが300本側のガードより
 * 先に効く、43.9節開発部への申し送り4）。
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import AppButton from "./AppButton";
import MemberAvatar from "./MemberAvatar";
import DrawingCanvas from "./DrawingCanvas";
import DrawingPalette from "./DrawingPalette";
import DrawingStrokeWidthPicker from "./DrawingStrokeWidthPicker";
import theme from "@/theme/theme";
import { estimateLineDataBytes, MIN_DRAWING_LINE_BYTES } from "@/lib/drawingLineDataBytes";
import type { FamilyDrawingLine, FamilyDrawingLineData } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

interface AvatarDrawingPanelProps {
  tone: Tone;
  /** 代理操作か（決定12代理バナー・決定25文言の出し分けに使う。バナー自体は呼び出し画面側の責務）。 */
  isProxy: boolean;
  /** 対象メンバーの表示名（代理操作時の確認文言・「今のすがた」プレビューの頭文字用）。 */
  displayName: string;
  /** 対象メンバーの`avatar_color`。キャンバス・「今のすがた」プレビューの背景色に使う（決定17）。 */
  backgroundColor: string;
  /** 保存済みのアバター（`member_avatars`に行が無ければnull）。 */
  savedLineData: FamilyDrawingLineData | null;
  saving: boolean;
  errorMessage: string | null;
  /** 保存成功時に数秒だけ表示するメッセージ（表示・自動消去のタイミングは呼び出し画面側が管理する）。 */
  savedMessage: string | null;
  /** 保存（新規・なおすの両方、常に全置き換え）。成功したらtrueを返すこと（キャンバスをクリアするため）。 */
  onSave: (lineData: FamilyDrawingLineData) => Promise<boolean>;
  resetting: boolean;
  resetErrorMessage: string | null;
  resetSuccessMessage: string | null;
  /** 「色にもどす」の確定。成功したらtrueを返すこと（確認表示を閉じるため）。 */
  onReset: () => Promise<boolean>;
}

export function AvatarDrawingPanel({
  tone,
  isProxy,
  displayName,
  backgroundColor,
  savedLineData,
  saving,
  errorMessage,
  savedMessage,
  onSave,
  resetting,
  resetErrorMessage,
  resetSuccessMessage,
  onReset,
}: AvatarDrawingPanelProps) {
  // [決定28] 「なおす」の場合、画面を開いた時点で既存の絵をキャンバスへ読み込んだ
  // 状態にする。以後はprops(savedLineData)の変化に追従させない（「色にもどす」は
  // 描画中のキャンバスの内容には触れない、43.6節状態一覧の申し送りどおり）。
  const [lines, setLines] = useState<FamilyDrawingLine[]>(() => savedLineData?.lines ?? []);
  const [color, setColor] = useState<string>(theme.avatarDrawingPalette[0].value);
  const [strokeWidth, setStrokeWidth] = useState<number>(theme.defaultDrawingStrokeWidth);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);

  const isChildTone = tone === "child";
  const bodyStyle = isChildTone ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  const captionStyle = isChildTone ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;

  // [43.1節 決定2] 家族の絵（DrawingBoard）と同じ考え方で、参照する定数だけを
  // theme.avatarDrawingLimitsに差し替える。
  const totalPoints = lines.reduce((sum, l) => sum + l.p.length / 2, 0);
  const approxBytes = estimateLineDataBytes(lines);
  const linesRemaining = theme.avatarDrawingLimits.maxLines - lines.length;
  const pointsRemaining = theme.avatarDrawingLimits.maxTotalPoints - totalPoints;
  const bytesRemaining = theme.avatarDrawingLimits.maxBytes - approxBytes;
  const atMaxLines = linesRemaining <= 0;
  const atMaxPoints = pointsRemaining <= 0;
  const atMaxBytes = bytesRemaining < MIN_DRAWING_LINE_BYTES;
  const atCapacity = atMaxLines || atMaxPoints || atMaxBytes;
  // [決定2] 各上限の残りが10%未満（線数<15・点数<300・バイト数<2048）。
  const nearCapacity =
    linesRemaining < theme.avatarDrawingLimits.maxLines * 0.1 ||
    pointsRemaining < theme.avatarDrawingLimits.maxTotalPoints * 0.1 ||
    bytesRemaining < theme.avatarDrawingLimits.maxBytes * 0.1;

  // [43.1節 決定4〜6] 数字は出さない。家族の絵の既存文言方針をそのまま踏襲する。
  const atCapacityText = isChildTone
    ? "じょうずに かけたね！これ いじょうは かけないよ。「これにする」を おすか、「ひとつ もどす」で すこし けせば まだ かけるよ"
    : "たくさん描けました。これ以上は描き足せません。そのまま保存するか、「ひとつ戻す」で少し消せば続けて描けます";
  const nearCapacityText = isChildTone
    ? "もうすこしで かけなく なるよ。おなじところに かさねて ぬると、はやく いっぱいに なるよ"
    : "もうすぐ描き足せなくなります。同じ場所に重ねて塗ると上限に早く近づくため、区切りのよいところで保存すると安心です";

  // [43.5節 決定23・26]
  const saveLabel = isChildTone ? "これにする" : "保存する";
  const undoLabel = isChildTone ? "ひとつ もどす" : "ひとつ戻す";
  const clearLabel = isChildTone ? "ぜんぶ けす" : "ぜんぶけす";
  const resetLabel = isChildTone ? "いろに もどす" : "色にもどす";
  // [43.5節 決定25]
  const resetConfirmText = isChildTone
    ? "ほんとうに いろに もどす？　かいた えは きえて、まえの いろと もじに もどるよ"
    : isProxy
    ? `${displayName}さんの絵を消して、色にもどしますか？もどすと、この絵は消えます`
    : "絵を消して、色にもどしますか？もどすと、この絵は消えます";
  const resetConfirmActionLabel = isChildTone ? "もどす" : "色にもどす";
  const resetCancelLabel = "やめる";

  const handleStrokeEnd = (line: FamilyDrawingLine) => {
    setLines((prev) => {
      if (prev.length >= theme.avatarDrawingLimits.maxLines) return prev;
      const newTotalPoints = prev.reduce((sum, l) => sum + l.p.length / 2, 0) + line.p.length / 2;
      if (newTotalPoints > theme.avatarDrawingLimits.maxTotalPoints) return prev;
      const candidate = [...prev, line];
      if (estimateLineDataBytes(candidate) > theme.avatarDrawingLimits.maxBytes) return prev;
      return candidate;
    });
  };

  const clearAll = () => setLines([]);
  const undoLastStroke = () => setLines((prev) => prev.slice(0, -1));

  const handleSave = async () => {
    if (lines.length === 0) return;
    const ok = await onSave({ v: 1, lines });
    // [43.6節 状態一覧「保存成功」] キャンバスは空になり、「今のすがた」カードは
    // 呼び出し画面側がsavedLineDataを更新することで反映される。
    if (ok) setLines([]);
  };

  const requestReset = () => setIsConfirmingReset(true);
  const cancelReset = () => setIsConfirmingReset(false);
  const confirmReset = async () => {
    const ok = await onReset();
    if (ok) setIsConfirmingReset(false);
  };

  const hasSavedAvatar = savedLineData !== null && savedLineData.lines.length > 0;

  return (
    <View>
      <Text style={[bodyStyle, styles.sectionLabel]}>今のすがた</Text>
      <Card tone={tone} style={styles.currentCard}>
        <MemberAvatar name={displayName} color={backgroundColor} size={64} lineData={savedLineData} />

        {savedMessage && <Text style={[bodyStyle, styles.successText]}>{savedMessage}</Text>}
        {resetSuccessMessage && <Text style={[bodyStyle, styles.successText]}>{resetSuccessMessage}</Text>}

        {/* [43.5節 決定24] 「色にもどす」はこのカードの中にのみ置き、キャンバス直下の
            操作列（ひとつ戻す・ぜんぶけす・保存する）には置かない。 */}
        {hasSavedAvatar && !isConfirmingReset && (
          <Pressable onPress={requestReset} disabled={resetting} hitSlop={8}>
            <Text style={[bodyStyle, styles.resetLinkText]}>{resetLabel}</Text>
          </Pressable>
        )}

        {isConfirmingReset && (
          <View style={styles.resetConfirmBlock}>
            <Text style={bodyStyle}>{resetConfirmText}</Text>
            {resetErrorMessage && <Text style={styles.error}>{resetErrorMessage}</Text>}
            <View style={styles.confirmRow}>
              <Pressable onPress={confirmReset} disabled={resetting} hitSlop={8}>
                <Text style={[bodyStyle, styles.resetConfirmActionText]}>
                  {resetting ? "もどしています…" : resetConfirmActionLabel}
                </Text>
              </Pressable>
              <Pressable onPress={cancelReset} disabled={resetting} hitSlop={8}>
                <Text style={[bodyStyle, styles.resetLinkText]}>{resetCancelLabel}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Card>

      <DrawingCanvas
        backgroundColor={backgroundColor}
        color={color}
        strokeWidth={strokeWidth}
        lines={lines}
        onStrokeEnd={handleStrokeEnd}
        disabled={saving || atCapacity}
      />

      <View style={styles.paletteWrap}>
        <DrawingPalette selected={color} onSelect={setColor} disabled={saving} />
      </View>

      <View style={styles.strokeWidthWrap}>
        <DrawingStrokeWidthPicker selected={strokeWidth} onSelect={setStrokeWidth} disabled={saving} />
      </View>

      {errorMessage ? (
        <Text style={styles.error}>{errorMessage}</Text>
      ) : atCapacity ? (
        <Text style={[bodyStyle, styles.atCapacity]}>{atCapacityText}</Text>
      ) : nearCapacity ? (
        <Text style={[captionStyle, styles.nearCapacity]}>{nearCapacityText}</Text>
      ) : null}

      <View style={styles.actionRow}>
        <AppButton
          label={undoLabel}
          tone={tone}
          variant="secondary"
          onPress={undoLastStroke}
          disabled={saving || lines.length === 0}
        />
        <AppButton
          label={clearLabel}
          tone={tone}
          variant="secondary"
          onPress={clearAll}
          disabled={saving || lines.length === 0}
        />
        <AppButton
          label={saveLabel}
          tone={tone}
          loading={saving}
          disabled={saving || lines.length === 0}
          onPress={handleSave}
          style={styles.saveButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { marginBottom: theme.spacing.s2 },
  currentCard: { alignItems: "center", gap: theme.spacing.s2, marginBottom: theme.spacing.s4 },
  successText: { color: theme.colors.brandPrimaryStrong },
  resetLinkText: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  resetConfirmBlock: { alignItems: "center", gap: theme.spacing.s2 },
  resetConfirmActionText: { color: theme.colors.statusBlocking, textDecorationLine: "underline" },
  confirmRow: { flexDirection: "row", gap: theme.spacing.s4 },
  paletteWrap: { marginTop: theme.spacing.s4, alignItems: "center" },
  strokeWidthWrap: { marginTop: theme.spacing.s4, alignItems: "center" },
  actionRow: { flexDirection: "row", marginTop: theme.spacing.s4, gap: theme.spacing.s3 },
  saveButton: { flex: 1 },
  error: { marginTop: theme.spacing.s3, color: theme.colors.statusBlocking, textAlign: "center" },
  atCapacity: {
    marginTop: theme.spacing.s3,
    color: theme.colors.brandPrimary,
    fontWeight: "600",
    textAlign: "center",
  },
  nearCapacity: {
    marginTop: theme.spacing.s3,
    color: theme.colors.statusPending,
    fontWeight: "400",
    textAlign: "center",
  },
});

export default AvatarDrawingPanel;
