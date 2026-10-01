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
 *
 * [2026-09-18追加・やること.md 2-51、実装メモ.md 248章] `DrawingCanvas`を直接
 * 使っていた箇所を`ZoomableDrawingCanvas`（主要画面ワイヤーフレーム.md 47章、
 * 実装メモ.md 235・245章）に置き換え、拡大表示（ふつう／おおきく／もっとおおきく）
 * を追加した。48章「まんなかに おおきく」ボタンはアバターには足さない
 * （`fitToCircleSignal`を渡さず既定値のまま使う）。
 *
 * [2026-09-30追加・要件定義書07-44章、主要画面ワイヤーフレーム.md 69章、実装メモ.md 334章]
 * 「まえのアバター」（ストック3枚）を「今のすがた」カードの中に足した（欄そのものは
 * `AvatarStockSection`）。保存・「色にもどす」・ストックの状態と通信は
 * `useAvatarEditing`（`editing`prop）が持ち、この部品は画面の組み立てと、キャンバスの
 * 扱い（決定7・13）だけを担う。3枚いっぱいのときは、保存ボタンを無効にして理由のカードを
 * 出す（決定13）。**キャンバスの線は一切変えない・消さない**（描きかけを守る）。
 */
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import AppButton from "./AppButton";
import FailureRefText from "./FailureRefText";
import MemberAvatar from "./MemberAvatar";
import ZoomableDrawingCanvas, { type ZoomableDrawingCanvasHandle } from "./ZoomableDrawingCanvas";
import DrawingPalette from "./DrawingPalette";
import DrawingStrokeWidthPicker from "./DrawingStrokeWidthPicker";
import DrawingToolPicker from "./DrawingToolPicker";
import AvatarStockSection from "./AvatarStockSection";
import theme from "@/theme/theme";
import { useFlashMessage } from "@/hooks/useFlashMessage";
import type { AvatarEditing } from "@/hooks/useAvatarEditing";
import {
  isAvatarResetBlocked,
  isAvatarSaveBlocked,
  isCanvasSameAsSaved,
  shouldNoteDraftKept,
  shouldReplaceCanvasAfterRestore,
  shouldShowStockSection,
} from "@/lib/avatarStock";
import { estimateLineDataBytes, MIN_DRAWING_LINE_BYTES } from "@/lib/drawingLineDataBytes";
import { removeLineAtIndex } from "@/lib/drawingLineMove";
import type { DrawingTool } from "@/lib/drawingShapes";
import type { FamilyDrawingLine, FamilyDrawingLineData, MemberAvatarStockRow } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

interface AvatarDrawingPanelProps {
  tone: Tone;
  /**
   * [2026-09-18追加・主要画面ワイヤーフレーム.md 52.4節・52.6節決定7、実装メモ.md
   * 253章] 「今その端末を操作している本人」のmemberId。代理操作中（`isProxy`）でも、
   * 操作対象（描いてもらう相手）ではなく、操作している側（ログイン中の保護者自身）の
   * memberIdを渡すこと。`ZoomableDrawingCanvas`へそのまま橋渡しし、拡大中の
   * 「2本指で動かせる」案内の既読記録に使う。
   */
  memberId: string;
  /** 代理操作か（決定12代理バナー・決定25文言の出し分けに使う。バナー自体は呼び出し画面側の責務）。 */
  isProxy: boolean;
  /** 対象メンバーの表示名（代理操作時の確認文言・「今のすがた」プレビューの頭文字用）。 */
  displayName: string;
  /** 対象メンバーの`avatar_color`。キャンバス・「今のすがた」プレビューの背景色に使う（決定17）。 */
  backgroundColor: string;
  /** 保存済みのアバター（`member_avatars`に行が無ければnull）。 */
  savedLineData: FamilyDrawingLineData | null;
  /**
   * [2026-09-30追加・実装メモ.md 334章] 保存・「色にもどす」・「まえのアバター」の状態と
   * 通信（`useAvatarEditing`の戻り値をそのまま渡す）。従来の`saving`・`errorMessage`・
   * `onSave`・`resetting`・`onReset`等の個別propは、3画面で同じコードを3回書かないよう
   * ここに集めた（意味は変えていない）。
   */
  editing: AvatarEditing;
  /**
   * [2026-09-18追加・やること.md 2-51、実装メモ.md 248章・243章] キャンバスに
   * 指が触れている間（ストローク中・2本指パン中の両方）trueで呼ばれる。
   * `DrawingBoard.tsx`の`onCanvasGestureActiveChange`と同じ考え方で、呼び出し画面側
   * （`app/{child,parent,supporter}/*-avatar.tsx`）が`Screen`の`scrollEnabled`へ
   * `!値`を渡し、描いている間だけ画面のスクロールを止める。
   */
  onGestureActiveChange?: (active: boolean) => void;
}

export function AvatarDrawingPanel({
  tone,
  memberId,
  isProxy,
  displayName,
  backgroundColor,
  savedLineData,
  editing,
  onGestureActiveChange,
}: AvatarDrawingPanelProps) {
  const {
    text,
    saving,
    errorMessage,
    errorRef,
    savedMessage,
    saveRefusedFull,
    onSave,
    resetting,
    resetErrorMessage,
    resetErrorRef,
    resetSuccessMessage,
    onReset,
    stocks,
    stocksStatus,
    retryStocks,
    highlightNewest,
    restoring,
    deleting,
    stockActionErrorMessage,
    stockActionErrorRef,
    stockActionMessage,
    clearStockActionError,
    onRestoreStock,
    onDeleteStock,
  } = editing;
  // [決定28] 「なおす」の場合、画面を開いた時点で既存の絵をキャンバスへ読み込んだ
  // 状態にする。以後はprops(savedLineData)の変化に追従させない（「色にもどす」は
  // 描画中のキャンバスの内容には触れない、43.6節状態一覧の申し送りどおり）。
  // [2026-10-01変更・実装メモ343章、統括「候補が3つないときは…からの状態を映してほしい」]
  // 開いた時点のキャンバスは空にする。「まえのアバター」に空きがあれば、新しく描いて保存すると
  // 今の絵はストックへ移るので、今の絵を読み込んでおく必要がない。今の絵を直したいときは
  // 「今のすがた」の「この絵をなおす」で読み込む。3枚いっぱいのときだけ、一覧を読めた時点で
  // 今の絵を読み込む（下のuseEffect。いっぱいのときは今の絵を直すことしかできないため）。
  const [lines, setLines] = useState<FamilyDrawingLine[]>([]);
  const [color, setColor] = useState<string>(theme.avatarDrawingPalette[0].value);
  const [strokeWidth, setStrokeWidth] = useState<number>(theme.defaultDrawingStrokeWidth);
  /**
   * [2026-09-26追加・実装メモ.md 309章、本部長依頼・軽微変更ルート] 家族の絵
   * （`DrawingBoard.tsx`）と同じ道具切り替え（ペン／〇／△／□）をアバターにも
   * 出す（依頼文4.「同じ部品を使っていれば、自然に出る」への回答：本画面は
   * `DrawingBoard`を再利用せず`DrawingPalette`・`DrawingStrokeWidthPicker`を
   * 直接呼ぶ独自構成のため自動では出ない。しかし色・太さの選択はこの画面にも
   * 既にあり、同じ並びに道具ピッカーが無いと家族の絵と一貫しないため、
   * `DrawingBoard.tsx`と同じ考え方で明示的に追加した）。
   */
  const [tool, setTool] = useState<DrawingTool>("pen");
  /**
   * [2026-09-27追加・実装メモ.md 313章、本部長依頼・軽微変更ルート] 家族の絵
   * （`DrawingBoard.tsx`）と同じ塗り切り替えをアバターにも出す。
   */
  const [filled, setFilled] = useState<boolean>(false);
  /**
   * [2026-09-27追加・実装メモ.md 315章、本部長依頼・軽微変更ルート「うごかす」]
   * ✋で線を動かす直前の`lines`を1つだけ保持する。`DrawingBoard.tsx`の
   * `preMoveLinesRef`と同じ「1回だけ使える巻き戻し」パターン（この画面には
   * 48章「まんなかに おおきく」＝`preFitLinesRef`が無いため、"move"用のみを持つ）。
   */
  const preMoveLinesRef = useRef<FamilyDrawingLine[] | null>(null);
  /**
   * [2026-09-29追加・実装メモ.md 326章、本部長依頼・軽微変更ルート「これをけす」]
   * `DrawingBoard.tsx`の`zoomableCanvasRef`と全く同じ考え方（コメント参照）。
   * `clearCanvasSelection()`（絵を読み込む・保存する・ぜんぶけすの直前に選択を
   * 外す、326.6章対応）で使う。
   */
  const zoomableCanvasRef = useRef<ZoomableDrawingCanvasHandle>(null);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  /** 「色にもどす」がいっぱいで止まっているときに、リンクを押すと4秒出る理由の1行（決定16）。 */
  const [resetBlockedNotice, flashResetBlocked] = useFlashMessage();
  /** 戻したあと、描きかけのキャンバスを守ったことを知らせる一文（決定7）。 */
  const [draftNote, flashDraftNote] = useFlashMessage();
  // 戻す通信の間にキャンバスが変わっていないかを確かめるため、最新の`lines`を持つ。
  const linesRef = useRef<FamilyDrawingLine[]>(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);
  // [2026-10-01追加・343章] 3枚いっぱいで今の絵があるときだけ、一覧を読めた最初の1回に
  // 今の絵をキャンバスへ読み込む（まだ何も描いていないときに限る）。
  const autoLoadDecidedRef = useRef(false);
  useEffect(() => {
    if (autoLoadDecidedRef.current || stocksStatus !== "ready") return;
    autoLoadDecidedRef.current = true;
    const full = stocks.length >= theme.avatarStock.maxSlots;
    if (full && savedLineData && savedLineData.lines.length > 0 && linesRef.current.length === 0) {
      setLines(savedLineData.lines);
    }
  }, [stocksStatus, stocks.length, savedLineData]);

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
  const clearLabel = isChildTone ? "ぜんぶ けす" : "全部消す";
  // [2026-10-01変更・343章] 「色にもどす」→「絵をはずす」（統括「色に戻すがわかりにくい」）。
  // 押すと絵が外れ、名前の最初の1文字の色の丸に戻る（今の絵は「まえのアバター」に残る）。
  const resetLabel = isChildTone ? "えを はずす" : "絵をはずす";
  // [2026-09-30変更・69.5節 決定16] 確認・成功は「まえのアバターに残る」前提の文言（`text.resetConfirm`）。
  const resetConfirmActionLabel = isChildTone ? "はずす" : "絵をはずす";
  const resettingLabel = "はずしています…";
  // [2026-10-01追加・343章] 今の絵をキャンバスへ読み込む入口（キャンバスを空で始めるようにしたため）。
  const editCurrentLabel = isChildTone ? "この えを なおす" : "この絵をなおす";
  const resetCancelLabel = "やめる";

  const handleStrokeEnd = (line: FamilyDrawingLine) => {
    // [2026-09-27追加・実装メモ.md 315章] 新しい線を描いたら「うごかす」の
    // 一括復元の権利は失効する（DrawingBoard.tsxのhandleStrokeEndと同じ扱い）。
    preMoveLinesRef.current = null;
    setLines((prev) => {
      if (prev.length >= theme.avatarDrawingLimits.maxLines) return prev;
      const newTotalPoints = prev.reduce((sum, l) => sum + l.p.length / 2, 0) + line.p.length / 2;
      if (newTotalPoints > theme.avatarDrawingLimits.maxTotalPoints) return prev;
      const candidate = [...prev, line];
      if (estimateLineDataBytes(candidate) > theme.avatarDrawingLimits.maxBytes) return prev;
      return candidate;
    });
  };

  /**
   * [2026-09-29追加・実装メモ.md 326.6章対応、本部長差し戻し反映]
   * `DrawingBoard.tsx`の`clearCanvasSelection`と全く同じ考え方（コメント参照）。
   */
  const clearCanvasSelection = () => {
    zoomableCanvasRef.current?.clearSelection();
  };

  const clearAll = () => {
    preMoveLinesRef.current = null;
    // [2026-09-29追加・326.6章対応] ✋の選択も外す。
    clearCanvasSelection();
    setLines([]);
  };

  /**
   * [2026-09-29追加・実装メモ.md 326章、本部長依頼・軽微変更ルート「これをけす」]
   * `DrawingBoard.tsx`の`handleDeleteSelected`と全く同じ考え方（コメント参照）。
   * 削除前の`lines`を`preMoveLinesRef`へ丸ごと保持してから1本を取り除くため、
   * 「ひとつ もどす」を押すと元の位置（重なり順も同じ）へ戻る。
   */
  const handleDeleteSelected = (index: number) => {
    preMoveLinesRef.current = lines;
    setLines((prev) => removeLineAtIndex(prev, index));
  };

  const undoLastStroke = () => {
    // [2026-09-27追加・315章]「うごかす」直後は、動かす前の位置へ一括で戻す
    // （DrawingBoard.tsxのundoLastStrokeと同じ「1回だけ使える巻き戻し」）。
    if (preMoveLinesRef.current !== null) {
      const restored = preMoveLinesRef.current;
      preMoveLinesRef.current = null;
      setLines(restored);
      return;
    }
    setLines((prev) => prev.slice(0, -1));
  };

  /**
   * [2026-09-27追加・実装メモ.md 315章、本部長依頼・軽微変更ルート「うごかす」]
   * `DrawingBoard.tsx`の`onLineMove`と同じ考え方（コメント参照）。この画面には
   * 編集モード・「まんなかに おおきく」が無い分、単純な作りにできる。
   */
  const onLineMove = (index: number, translatedPoints: number[]) => {
    preMoveLinesRef.current = lines;
    setLines((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.slice();
      next[index] = { ...next[index], p: translatedPoints };
      return next;
    });
  };

  const hasSavedAvatar = savedLineData !== null && savedLineData.lines.length > 0;
  // 一覧を読めているときだけ枚数で判断する（読み込み中・失敗のときは止めない。DBが最終防衛線）。
  const stockCount = stocksStatus === "ready" ? stocks.length : null;
  const sameAsSaved = isCanvasSameAsSaved(lines, savedLineData);
  // [69.3節 決定13] 3枚いっぱいで、今の絵があり、キャンバスに線があり、今の絵と違うとき、保存を止める。
  const saveBlocked = isAvatarSaveBlocked({
    stockCount,
    maxSlots: theme.avatarStock.maxSlots,
    hasSavedAvatar,
    lineCount: lines.length,
    sameAsSaved,
  });
  // DBが保存を断った（別の端末で先に3枚になっていた）ときも、同じ理由カードを出す。
  const showFullCard = saveBlocked || saveRefusedFull;
  // [69.3節 決定16] 3枚いっぱいで今の絵があるとき、「色にもどす」も止める。
  const resetBlocked = isAvatarResetBlocked({ stockCount, maxSlots: theme.avatarStock.maxSlots, hasSavedAvatar });
  const showStockSection = shouldShowStockSection({ hasSavedAvatar, stockCount: stocks.length, status: stocksStatus });

  const handleSave = async () => {
    if (lines.length === 0 || saveBlocked) return;
    const ok = await onSave({ v: 1, lines });
    // [43.6節 状態一覧「保存成功」] キャンバスは空になり、「今のすがた」カードは
    // 呼び出し画面側がsavedLineDataを更新することで反映される。
    if (ok) {
      preMoveLinesRef.current = null;
      // [2026-09-29追加・326.6章対応] 保存成功でキャンバスが空になるため選択も外す。
      clearCanvasSelection();
      setLines([]);
    }
  };

  /**
   * [2026-10-01追加・343章]「この絵をなおす」。今の絵をキャンバスへ読み込む。描きかけがあれば
   * `preMoveLinesRef`に残すので、「ひとつ戻す」で描きかけへ戻れる（✋の「うごかす」と同じ
   * 1回だけ使える巻き戻し）。描きかけを黙って消さないため。
   */
  const loadCurrentToCanvas = () => {
    if (!savedLineData) return;
    clearCanvasSelection();
    preMoveLinesRef.current = lines.length > 0 ? lines : null;
    setLines(savedLineData.lines);
  };

  const requestReset = () => {
    if (resetBlocked) {
      // 確認ではなく理由を出す（何も変わらない）。
      flashResetBlocked(text.fullReasonReset);
      return;
    }
    setIsConfirmingReset(true);
  };
  const cancelReset = () => setIsConfirmingReset(false);
  const confirmReset = async () => {
    const outcome = await onReset();
    if (outcome === "done") {
      setIsConfirmingReset(false);
    } else if (outcome === "full") {
      // 別の端末で先に3枚になっていた。確認を閉じて、理由を出す（一覧は取り直し済み）。
      setIsConfirmingReset(false);
      flashResetBlocked(text.fullReasonReset);
    }
  };

  /**
   * 「これに もどす」（決定5・7）。キャンバスが今の絵のまま触っていない（線があり、今の絵と
   * 同じ）ときだけ、戻した絵に差し替える。描き足した・消した、または空のときは触らない
   * （描きかけは絶対に消さない）。触らなかった場合で線があれば、そのことを一文で知らせる。
   * 戻す通信の間にキャンバスが変わっていたら、それも「触った」として差し替えない。
   */
  const handleRestoreStock = async (stock: MemberAvatarStockRow): Promise<boolean> => {
    const linesBefore = lines;
    const canReplace = shouldReplaceCanvasAfterRestore(lines, savedLineData);
    const outcome = await onRestoreStock(stock);
    if (outcome === "failed") return false;
    if (outcome === "stale") return true;
    const replaced = canReplace && linesRef.current === linesBefore;
    if (replaced) {
      preMoveLinesRef.current = null;
      clearCanvasSelection();
      setLines(stock.line_data.lines);
    } else if (shouldNoteDraftKept(linesRef.current, false)) {
      flashDraftNote(text.draftKept);
    }
    return true;
  };

  return (
    <View>
      <Text style={[bodyStyle, styles.sectionLabel]}>今のすがた</Text>
      <Card tone={tone} style={styles.currentCard}>
        <MemberAvatar name={displayName} color={backgroundColor} size={64} lineData={savedLineData} expandOnTap />

        {savedMessage && <Text style={[bodyStyle, styles.successText]}>{savedMessage}</Text>}
        {resetSuccessMessage && <Text style={[bodyStyle, styles.successText]}>{resetSuccessMessage}</Text>}
        {stockActionMessage && <Text style={[bodyStyle, styles.successText]}>{stockActionMessage}</Text>}
        {draftNote && <Text style={[bodyStyle, styles.successText]}>{draftNote}</Text>}

        {/* [43.5節 決定24] 「色にもどす」はこのカードの中にのみ置き、キャンバス直下の
            操作列（ひとつ戻す・ぜんぶけす・保存する）には置かない。 */}
        {hasSavedAvatar && !isConfirmingReset && (
          <View style={styles.currentActionRow}>
            {/* [2026-10-01追加・343章] キャンバスが今の絵と同じときは出さない（読み込む意味がない）。 */}
            {!sameAsSaved && (
              <Pressable onPress={loadCurrentToCanvas} disabled={saving || resetting} hitSlop={8}>
                <Text style={[bodyStyle, styles.resetLinkText, (saving || resetting) && styles.linkTextDisabled]}>
                  {editCurrentLabel}
                </Text>
              </Pressable>
            )}
            <Pressable onPress={requestReset} disabled={resetting} hitSlop={8}>
              <Text style={[bodyStyle, styles.resetLinkText, resetBlocked && styles.linkTextDisabled]}>{resetLabel}</Text>
            </Pressable>
          </View>
        )}
        {resetBlockedNotice && !isConfirmingReset && <Text style={[bodyStyle, styles.centerText]}>{resetBlockedNotice}</Text>}

        {isConfirmingReset && (
          <View style={styles.resetConfirmBlock}>
            <Text style={[bodyStyle, styles.centerText]}>{text.resetConfirm}</Text>
            {resetErrorMessage && <Text style={styles.error}>{resetErrorMessage}</Text>}
            {resetErrorMessage && <FailureRefText value={resetErrorRef} tone={tone} />}
            <View style={styles.confirmRow}>
              <Pressable onPress={confirmReset} disabled={resetting} hitSlop={8}>
                <Text style={[bodyStyle, styles.resetConfirmActionText]}>
                  {resetting ? resettingLabel : resetConfirmActionLabel}
                </Text>
              </Pressable>
              <Pressable onPress={cancelReset} disabled={resetting} hitSlop={8}>
                <Text style={[bodyStyle, styles.resetLinkText]}>{resetCancelLabel}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* [2026-09-30追加・69章] 「まえのアバター」。今の絵がある、または1枚以上あるときだけ出す（決定4）。 */}
        {showStockSection && (
          <AvatarStockSection
            tone={tone}
            displayName={displayName}
            backgroundColor={backgroundColor}
            text={text}
            stocks={stocks}
            status={stocksStatus}
            hasCurrentAvatar={hasSavedAvatar}
            highlightNewest={highlightNewest}
            slotsDisabled={saving}
            restoring={restoring}
            deleting={deleting}
            actionErrorMessage={stockActionErrorMessage}
            actionErrorRef={stockActionErrorRef}
            onClearActionError={clearStockActionError}
            onBeforeSelect={cancelReset}
            onRestore={handleRestoreStock}
            onDelete={onDeleteStock}
            onRetry={retryStocks}
          />
        )}
      </Card>

      {/* [2026-09-18変更・やること.md 2-51、実装メモ.md 248章] `DrawingCanvas`直接呼び出しから
          `ZoomableDrawingCanvas`（47章拡大表示）へ置き換え。48章「まんなかに おおきく」用の
          `editingId`・`fitToCircleSignal`は渡さず既定値のまま（アバターには無い概念、48章参照）。
          倍率ボタンの無効化は`DrawingBoard.tsx`と同じく`saving`のみ（`atCapacity`では無効化
          しない。拡大して見返す・「ひとつ もどす」後に続きを描く操作を妨げないため）。 */}
      <ZoomableDrawingCanvas
        ref={zoomableCanvasRef}
        tone={tone}
        memberId={memberId}
        backgroundColor={backgroundColor}
        color={color}
        strokeWidth={strokeWidth}
        lines={lines}
        onStrokeEnd={handleStrokeEnd}
        disabled={saving || atCapacity}
        zoomPickerDisabled={saving}
        onGestureActiveChange={onGestureActiveChange}
        tool={tool}
        filled={filled}
        onLineMove={onLineMove}
        // [2026-09-29追加・実装メモ.md 326章、本部長依頼・軽微変更ルート「これをけす」]
        onDeleteSelected={handleDeleteSelected}
      />

      {/* [2026-09-26追加・実装メモ.md 309章] 家族の絵（DrawingBoard.tsx）と同じ並び
          （道具→色→太さ）にする。
          [2026-09-27変更・実装メモ.md 314章] `color`・`memberId`を追加で渡す
          （DrawingBoard.tsxと同じ理由）。 */}
      <View style={styles.toolWrap}>
        <DrawingToolPicker
          tone={tone}
          selected={tool}
          onSelect={setTool}
          filled={filled}
          onToggleFilled={() => setFilled((prev) => !prev)}
          color={color}
          memberId={memberId}
          disabled={saving}
        />
      </View>

      <View style={styles.paletteWrap}>
        <DrawingPalette selected={color} onSelect={setColor} disabled={saving} />
      </View>

      <View style={styles.strokeWidthWrap}>
        <DrawingStrokeWidthPicker selected={strokeWidth} onSelect={setStrokeWidth} disabled={saving} />
      </View>

      {errorMessage ? (
        <>
          <Text style={styles.error}>{errorMessage}</Text>
          <FailureRefText value={errorRef} tone={tone} />
        </>
      ) : atCapacity ? (
        <Text style={[bodyStyle, styles.atCapacity]}>{atCapacityText}</Text>
      ) : nearCapacity ? (
        <Text style={[captionStyle, styles.nearCapacity]}>{nearCapacityText}</Text>
      ) : null}

      {/* [2026-09-30追加・69.3節 決定13] 3枚いっぱいで保存できない理由。お絵かきの上限到達
          （DrawingBoardのlimitCard）と同じ穏やかな見た目（赤・失敗トーンは使わない）。上限の案内と
          同時に出るときは、その下（両方読める）。キャンバスは隠さない・触らない。 */}
      {showFullCard && (
        <Card tone={tone} style={styles.limitCard}>
          <Text style={[bodyStyle, styles.centerText]}>{text.fullReasonSave}</Text>
        </Card>
      )}

      <View style={styles.actionRow}>
        <AppButton
          label={undoLabel}
          tone={tone}
          variant="secondary"
          onPress={undoLastStroke}
          disabled={saving || lines.length === 0}
          style={styles.actionButtonEqual}
          numberOfLines={2}
          adjustsFontSizeToFit
        />
        {/* [2026-09-29変更・実装メモ.md 327章] 326章の差し替えをやめ、常に
            「ぜんぶけす」のまま（`DrawingBoard.tsx`と同じ）。削除の入口は
            🗑ボタン（`ZoomableDrawingCanvas`内部、窓の左上）へ移した。 */}
        <AppButton
          label={clearLabel}
          tone={tone}
          variant="secondary"
          onPress={clearAll}
          disabled={saving || lines.length === 0}
          style={styles.actionButtonEqual}
          numberOfLines={2}
          adjustsFontSizeToFit
        />
        <AppButton
          label={saveLabel}
          tone={tone}
          loading={saving}
          disabled={saving || lines.length === 0 || saveBlocked}
          onPress={handleSave}
          style={styles.actionButtonEqual}
          numberOfLines={2}
          adjustsFontSizeToFit
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { marginBottom: theme.spacing.s2 },
  currentCard: { alignItems: "center", gap: theme.spacing.s2, marginBottom: theme.spacing.s4 },
  successText: { color: theme.colors.brandPrimaryStrong, textAlign: "center" },
  centerText: { textAlign: "center" },
  // 「色にもどす」が止まっているとき（薄く表示。DrawingBoardのlinkTextDisabledと同じ）。
  linkTextDisabled: { opacity: 0.4 },
  // 3枚いっぱいで保存できない理由のカード（DrawingBoardのlimitCardと同じ見た目）。
  limitCard: {
    alignItems: "center",
    marginTop: theme.spacing.s3,
    backgroundColor: theme.colors.brandPrimarySoft,
    borderColor: theme.colors.brandPrimary,
  },
  resetLinkText: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  resetConfirmBlock: { alignItems: "center", gap: theme.spacing.s2 },
  resetConfirmActionText: { color: theme.colors.statusBlocking, textDecorationLine: "underline" },
  confirmRow: { flexDirection: "row", gap: theme.spacing.s4 },
  // [2026-10-01追加・343章]「この絵をなおす」「絵をはずす」を横に並べる（文字が大きい端末では折り返す）。
  currentActionRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: theme.spacing.s4 },
  // [2026-09-26追加・実装メモ.md 309章] 道具切り替え（ペン／〇／△／□）。
  toolWrap: { marginTop: theme.spacing.s4, alignItems: "center" },
  paletteWrap: { marginTop: theme.spacing.s4, alignItems: "center" },
  strokeWidthWrap: { marginTop: theme.spacing.s4, alignItems: "center" },
  actionRow: { flexDirection: "row", marginTop: theme.spacing.s4, gap: theme.spacing.s3 },
  // [2026-09-29・実装メモ.md 329章] 3ボタンを等分する（旧`saveButton`＝保存だけflex:1）。
  // 文字の大きい端末で「ひとつ もどす」「ぜんぶけす」が幅を取りきり、保存ボタンが
  // 潰れて文字が見えなくなるのを防ぐ（`DrawingBoard.tsx`と同じ直し方）。
  actionButtonEqual: { flex: 1 },
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
