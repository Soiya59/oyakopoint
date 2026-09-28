/**
 * お絵かき画面の拡大表示（主要画面ワイヤーフレーム.md 47章、開発部/成果物/実装メモ.md
 * 235章）。`DrawingBoard.tsx`が直接`DrawingCanvas`を描いていた箇所を、この部品に
 * 置き換える。`DrawingCanvas.tsx`本体・その座標正規化ロジックは変更していない
 * （47.3節決定8、47.4節決定12）。
 *
 * [仕組み]
 * - 外側の「窓」View（基準直径、円形の枠線・クリップを持つ）の中に、
 *   「基準直径×倍率」の大きさの`DrawingCanvas`（`chromeless`、枠無し）を
 *   `translate`で配置する。倍率1倍のときは窓と内側のサイズが一致し、
 *   translateは常に(0,0)になる＝本章適用前と見た目が完全に同一（47.3節決定8）。
 * - 基準直径は`Screen.tsx`のcontent幅（パディング済み）を`onLayout`で実測し、
 *   280〜360ptにクランプする（47.1節決定1・2、`src/lib/drawingZoomPan.ts`）。
 * - パン（移動）は2本指ドラッグのみ。`DrawingCanvas`の`onPan`（1本指描画中に
 *   2本目が触れたら描きかけの線を破棄して移動に切り替える。DrawingCanvas.tsx側で
 *   保証、47.3節決定9・10）から呼ばれる移動量を、`drawingZoomPan.ts`の
 *   `clampDrawingPan`で許容範囲内にクランプして反映する（47.3節決定11）。
 * - 倍率ボタンを押すたびにパン位置を中央へリセットする（決定11）。
 * - キャンバスが空になった瞬間（ぜんぶけす・保存成功・「ひとつ もどす」で0本化）、
 *   および編集開始（`startEdit`）の瞬間に、倍率・パン位置を1倍・中央へリセットする
 *   （47.6節決定15）。呼び出し元（`DrawingBoard.tsx`）から`lines`・`editingId`を
 *   そのまま受け取り、その変化を見て自律的にリセットする。
 *
 * [2026-09-18追加・やること.md 2-51、実装メモ.md 248章] `AvatarDrawingPanel.tsx`
 * （アバターを描く画面）からも同じ部品を使うようになった。アバターには
 * 「未公開の絵の編集」（`editingId`）・48章「まんなかに おおきく」ボタン
 * （`fitToCircleSignal`）のどちらの概念も無いため、両propを省略可能にし
 * （既定値は「一度も使われていない」状態と同じ値）、`DrawingBoard.tsx`の
 * 既存の呼び出し（両方を必ず明示的に渡す）は1行も変えていない。
 *
 * [2026-09-18追加・主要画面ワイヤーフレーム.md 52章、実装メモ.md 253章] 拡大中
 * （2倍・3倍）の「2本指で動かせる」案内。52.6節決定5改訂により、表示の
 * 出し引きは「見た」のライブな状態を直接見ない。マウント時（`memberId`が
 * 決まった時点）に一度だけ`hydrateIntroSeen`→`isIntroSeen`を読み、結果を
 * `hintAlreadySeenAtOpen`へ固定する。以後このセッション中は`handlePan`で
 * `markIntroSeen`を呼んでも`hintAlreadySeenAtOpen`は変えない（＝
 * `subscribeIntroSeen`は使わない）。理由は、パン中に案内が消えると直下の
 * 46-B見本・パレット・太さ選択の位置が詰まって画面が揺れるため（本部長差し戻し、
 * 47章・48章が守ってきた「指を動かしている最中は何も動かさない」原則と同じ）。
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import DrawingCanvas, { type DrawingCanvasHandle } from "./DrawingCanvas";
import DrawingZoomPicker from "./DrawingZoomPicker";
import theme from "@/theme/theme";
import {
  centerDrawingPan,
  clampBaseDiameter,
  clampDrawingPan,
  type DrawingZoomLevel,
} from "@/lib/drawingZoomPan";
import { hydrateIntroSeen, isIntroSeen, markIntroSeen } from "@/lib/introSeen";
import type { DrawingTool } from "@/lib/drawingShapes";
import type { FamilyDrawingLine } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

/**
 * [2026-09-18・主要画面ワイヤーフレーム.md 52.2節決定1] 3ロールの確定文言。
 * **統括が直接打った文言であり、1文字も変えないこと。** 子ども向けは分かち書き済みの
 * 確定版（本部長が空白挿入・「タッチし」→「タッチして」の活用形のみ変更した版）。
 * 保護者・みまもりメンバー向けはP30/S18で共用（21.5節決定4と同じくキャンバス周りの
 * 部品・文言をロールで分けない慣習）。
 */
const PAN_INTRO_TEXT: Record<Tone, string> = {
  child: "ゆびを どうじに えに タッチして うごかすと、かきたい ぶぶんに えを うごかす ことが できるよ",
  parent: "絵は2本指でドラッグでき、描きたい部分に動かせます",
  supporter: "絵は2本指でドラッグでき、描きたい部分に動かせます",
};

/**
 * [2026-09-27追加・実装メモ.md 316章、本部長依頼・軽微変更ルート「Aで！」]
 * 回転ボタン（↻）のaccessibilityLabel。`DrawingToolPicker.tsx`の
 * `TOOL_ACCESSIBILITY_LABELS`（うごかす／動かす）と同じ考え方で、子ども向けは
 * 平仮名、保護者・みまもりメンバー向けは漢字（この2ロールは常に同一文言）。
 * 画面には記号（↻）のみを表示し、文字ラベルは出さない（依頼文「子ども向けは
 * 記号だけ」）。
 */
const ROTATE_BUTTON_LABEL: Record<Tone, string> = {
  child: "まわす",
  parent: "回す",
  supporter: "回す",
};

/**
 * [2026-09-29追加・実装メモ.md 327章、本部長依頼・軽微変更ルート、統括承認済み]
 * 🗑（選んだものを消す）ボタンのaccessibilityLabel。依頼文が「えらんだものを けす」
 * という単一の表記を明示しており、↻の`ROTATE_BUTTON_LABEL`と違い3ロールで
 * 書き分けない（子ども向けの平仮名表記がそのまま大人にも自然に読めるため）。
 * 画面には記号（🗑️）のみを表示し、文字ラベルは出さない（↻と同じ扱い）。
 */
const DELETE_SELECTED_BUTTON_LABEL = "えらんだものを けす";

interface ZoomableDrawingCanvasProps {
  tone: Tone;
  color: string;
  strokeWidth: number;
  lines: FamilyDrawingLine[];
  onStrokeEnd: (line: FamilyDrawingLine) => void;
  /** キャンバス自体（描画）の無効化。保存中・上限到達時（`saving || atCapacity`）を渡す。 */
  disabled?: boolean;
  /**
   * [47.2節本文「3つのボタンの実装」] 倍率ボタンの無効化。`disabled={saving}`のみとし、
   * `atCapacity`（上限到達）では無効化しない（既に描いた絵を拡大して見返す・
   * 「ひとつ もどす」の後に続きを描くために拡大したままにしておく、といった操作を
   * 妨げないため）。`disabled`（キャンバス自体の無効化）とは意図的に別のpropにしている。
   */
  zoomPickerDisabled?: boolean;
  /**
   * 47.6節決定15: nullから非nullへ変わった瞬間（未公開の絵の編集を開始した瞬間）に
   * 1倍・中央へリセットする。`DrawingBoard.tsx`の`editingId`をそのまま渡す。
   * [2026-09-18追加・やること.md 2-51、実装メモ.md 248章] `AvatarDrawingPanel.tsx`
   * には「未公開の絵の編集」という概念自体が無いため、省略可能にした（既定`null`）。
   * 既定値が家族の絵の「編集していない」状態と同じ値のため、`DrawingBoard.tsx`
   * （常に明示的に渡している）の挙動は一切変わらない。
   */
  editingId?: string | null;
  /**
   * [2026-09-17追加・主要画面ワイヤーフレーム.md 48.5節決定17、実装メモ.md 236章]
   * 48章「まんなかに おおきく」ボタンで座標変換が成功するたびに1ずつ増える値。
   * `DrawingBoard.tsx`側でボタン押下・変換成功のたびにインクリメントして渡す。
   * 47.6節決定15の一覧（キャンバスが空になった瞬間・編集開始の瞬間）に、
   * 「48章のボタンを押した瞬間」を1行追記する形で1倍・中央へリセットする。
   * [2026-09-18追加・やること.md 2-51、実装メモ.md 248章] アバターには48章の
   * ボタン自体を足さないため省略可能にした（既定`0`＝一度も押されていない状態と
   * 同じ値。変化しないため`useEffect`は一度も発火しない）。`DrawingBoard.tsx`は
   * 常に明示的に渡しているため挙動は変わらない。
   */
  fitToCircleSignal?: number;
  /**
   * [2026-09-17追加・実装メモ243章] `DrawingCanvas`の`onGestureActiveChange`を
   * そのまま上（`DrawingBoard.tsx`）へ橋渡しする。ここでは何も加工しない
   * （2本指パン自体は`handlePan`で別途処理しており、この値は「画面のスクロールを
   * 止めるべきか」だけを伝えるためのもの）。
   */
  onGestureActiveChange?: (active: boolean) => void;
  /**
   * [2026-09-18追加・やること.md 2-51、実装メモ.md 248章] 円の背景色。
   * `DrawingCanvas.tsx`の同名propをそのまま橋渡しする。未指定時は`DrawingCanvas`
   * 自身の既定値（`theme.colors.neutralSurface`、家族の絵の白背景）と同じに
   * するため、ここでも既定値を明示的に揃えておく（`DrawingBoard.tsx`は
   * このpropを渡さないため今までどおり白背景のまま。`AvatarDrawingPanel.tsx`は
   * 対象メンバーの`avatar_color`を渡す）。
   */
  backgroundColor?: string;
  /**
   * [2026-09-18追加・主要画面ワイヤーフレーム.md 52.4節・52.6節決定7] 「今その端末を
   * 操作している本人」のmemberId。代理操作中（`AvatarDrawingPanel.tsx`のP38経由）でも、
   * 操作対象（描いてもらう相手）ではなく、操作している側（ログイン中の保護者自身）の
   * memberIdを渡すこと。「見た」の記録（`src/lib/introSeen.ts`）に使うキーの一部になる。
   */
  memberId: string;
  /**
   * [2026-09-26追加・実装メモ.md 309章、本部長依頼・軽微変更ルート] `DrawingCanvas`の
   * 同名propをそのまま橋渡しする。未指定時は既定値`"pen"`（今までどおり自由な線のみ、
   * `DrawingBoard.tsx`・`AvatarDrawingPanel.tsx`のどちらも呼び出し側で道具ピッカーを
   * 足すまでは実質未使用）。
   */
  tool?: DrawingTool;
  /**
   * [2026-09-27追加・実装メモ.md 313章、本部長依頼・軽微変更ルート] `DrawingCanvas`の
   * 同名propをそのまま橋渡しする。未指定時は既定値`false`（今までどおり塗らない）。
   */
  filled?: boolean;
  /**
   * [2026-09-27追加・実装メモ.md 315章、本部長依頼・軽微変更ルート「うごかす」]
   * `DrawingCanvas`の同名propをそのまま橋渡しする。ここでは何も加工しない
   * （拡大表示中の座標変換は`DrawingCanvas`側の`chromeless`内側キャンバスが
   * 常に担っており、`tool`・`filled`と同じ橋渡しの扱いでよい）。
   * [2026-09-27追記・実装メモ.md 316章]「選んで回す」（↻ボタン、下記参照）の確定も
   * このコールバックを同じく使う（`DrawingCanvas.tsx`側の説明参照）。
   */
  onLineMove?: (index: number, points: number[]) => void;
  /**
   * [2026-09-29追加・実装メモ.md 326章、本部長依頼・軽微変更ルート「これをけす」]
   * `DrawingCanvas`の同名propをそのまま橋渡しする。呼び出し元
   * （`DrawingBoard.tsx`・`AvatarDrawingPanel.tsx`）はこのコールバックの中で
   * `lines`配列から該当indexを取り除く（`removeLineAtIndex`、
   * `src/lib/drawingLineMove.ts`）。
   *
   * [2026-09-29変更・実装メモ.md 327章] 削除ボタン（🗑）自体は326章時点の
   * 「呼び出し元のactionRow」からこのファイル内部（↻と対になる窓の左上）へ
   * 移った。このpropの役割（削除indexを実際の`lines`配列操作へつなぐ）自体は
   * 変わっていない。
   */
  onDeleteSelected?: (index: number) => void;
}

/**
 * [2026-09-29追加・実装メモ.md 326章、本部長依頼・軽微変更ルート「これをけす」]
 * `forwardRef`で公開する命令的API。
 *
 * [2026-09-29変更・実装メモ.md 327章] 削除ボタン（🗑）が呼び出し元の
 * actionRowからこのファイル内部（窓の左上、↻と対称）へ移ったため、
 * `deleteSelected`（326章で追加した中継メソッド）は使う側が無くなり削除した。
 * 今このファイルが呼び出し元へ公開している命令的APIは`clearSelection`のみ
 * （絵を読み込む・切り替える・保存する・ぜんぶけすの直前に、選択状態を
 * 強制的に外すために`DrawingBoard.tsx`・`AvatarDrawingPanel.tsx`が呼ぶ、
 * 326.6章対応）。
 */
export interface ZoomableDrawingCanvasHandle {
  /**
   * ✋で選択中の状態を外部から強制的に外す（`DrawingCanvasHandle.clearSelection`
   * への中継のみ）。呼び出し元が、絵を読み込む・切り替える・保存する・
   * ぜんぶけすの直前に呼ぶ。
   */
  clearSelection: () => void;
}

export const ZoomableDrawingCanvas = forwardRef<ZoomableDrawingCanvasHandle, ZoomableDrawingCanvasProps>(
  function ZoomableDrawingCanvas(
    {
      tone,
      color,
      strokeWidth,
      lines,
      onStrokeEnd,
      disabled = false,
      zoomPickerDisabled = false,
      editingId = null,
      fitToCircleSignal = 0,
      onGestureActiveChange,
      backgroundColor = theme.colors.neutralSurface,
      memberId,
      tool = "pen",
      filled = false,
      onLineMove,
      onDeleteSelected,
    }: ZoomableDrawingCanvasProps,
    ref
  ) {
  // 47.1節決定1: Screen.tsxのcontent幅（パディング済み）をonLayoutで実測する。
  // `Dimensions.get('window')`は使わない。初回描画前は旧来の固定直径280ptを仮置きする
  // （280は下限と同値のため、実測後にクランプしても値が飛ばない）。
  const [measuredWidth, setMeasuredWidth] = useState<number>(theme.drawingLimits.canvasDiameter);
  const baseDiameter = clampBaseDiameter(measuredWidth);

  const [zoom, setZoom] = useState<DrawingZoomLevel>(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  /**
   * [2026-09-27追加・実装メモ.md 316章、本部長依頼・軽微変更ルート「Aで！」]
   * ↻ボタン（回転）は、拡大・パンの影響を受けない「窓」側（このファイル）に
   * 描く必要があるが、実際に線を回す処理（選択状態・回転の基準）は
   * `DrawingCanvas.tsx`の内部にある（`findLineIndexAtPoint`等、`lines`を直接見る
   * 既存の実装に相乗りするため）。`ref`で`DrawingCanvasHandle.rotateSelected`を
   * 呼び出せるようにし、選択の有無は`onSelectionChange`で受け取る。
   */
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const [hasSelection, setHasSelection] = useState(false);
  /**
   * [2026-09-29変更・実装メモ.md 327章] 326章では`onSelectionChange`で親へも
   * 橋渡ししていたが、削除ボタン（🗑）がこのファイル内部（↻と同じ窓の隅）へ
   * 移り、親（`DrawingBoard.tsx`・`AvatarDrawingPanel.tsx`）は選択の有無を
   * 知る必要が無くなったため、橋渡しをやめて元の（316章時点の）単純な
   * `setHasSelection`に戻した。「選択の決め方」自体は316章から一切変えていない。
   */
  useImperativeHandle(
    ref,
    () => ({
      clearSelection: () => {
        canvasRef.current?.clearSelection();
      },
    }),
    []
  );

  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // 47.6節決定15: 「ぜんぶけす」・保存成功・「ひとつ もどす」でキャンバスが
  // 0本になった瞬間に1倍・中央へ戻す。最初から0本（初期状態）ではリセットしない
  // （>0 → ===0 の遷移のときだけ発火させる）。
  const prevLinesLengthRef = useRef(lines.length);
  useEffect(() => {
    if (prevLinesLengthRef.current > 0 && lines.length === 0) {
      resetZoom();
    }
    prevLinesLengthRef.current = lines.length;
  }, [lines.length]);

  // 47.6節決定15: 編集開始（startEdit、editingIdがnull以外になった瞬間）は、
  // 読み込む絵の線の本数に関わらず常に1倍・中央から見せる。
  useEffect(() => {
    if (editingId !== null) {
      resetZoom();
    }
    // editingIdの変化だけを見る（他の依存はresetZoom自体が参照する最新stateで十分）。
  }, [editingId]);

  // 48.5節決定17: 48章の「まんなかに おおきく」ボタンで座標変換が成功するたびに
  // （2倍・3倍で拡大中であっても）1倍・中央へリセットする。初回マウント時は
  // 値が変化していない（前回値と同じ）ため発火しない（lines.length監視と同じ方式）。
  const prevFitToCircleSignalRef = useRef(fitToCircleSignal);
  useEffect(() => {
    if (prevFitToCircleSignalRef.current !== fitToCircleSignal) {
      resetZoom();
    }
    prevFitToCircleSignalRef.current = fitToCircleSignal;
  }, [fitToCircleSignal]);

  const handleLayout = (e: LayoutChangeEvent) => {
    setMeasuredWidth(e.nativeEvent.layout.width);
  };

  /**
   * [2026-09-18・主要画面ワイヤーフレーム.md 52.6節決定5改訂、52.12節実装メモ3]
   * 「見た」かどうかは画面を開いた時点（マウント・`memberId`が決まった時点）で
   * 一度だけ判定し、ローカルstateへ固定する。既定値`true`＝読み込み中は非表示
   * （50.3節と同じフリッカー防止）。**`subscribeIntroSeen`は使わない**。
   * `handlePan`内の`markIntroSeen`（下記）による更新を受けて再描画すると、
   * パン中に案内が消えて直下の要素が詰まる「揺れ」が再発するため
   * （本部長差し戻し2026-09-18）。次にこの部品が新しくマウントされたときに限り、
   * このuseEffectが再実行され、更新済みの記録が反映される。
   */
  const [hintAlreadySeenAtOpen, setHintAlreadySeenAtOpen] = useState(true);
  /**
   * [2026-09-18・本部長差し戻し反映、実装メモ253章] `handlePan`で`markIntroSeen`を
   * 呼んだかどうかのフラグ。`handlePan`は2本指ドラッグ中、指が動くたびに（1回の
   * ドラッグで数十〜百回以上）呼ばれるため、ここで「まだ呼んでいなければ呼ぶ」の
   * 一度きりに絞る（下記`handlePan`のコメント参照）。`memberId`が変わったら
   * （＝別の人が操作し始めたら）`hintAlreadySeenAtOpen`と同じタイミングでfalseへ
   * 戻す。**この判定は表示（`hintAlreadySeenAtOpen`）とは完全に別に保つ**（52.6節
   * 決定5改訂の要点。既読の人に付け直しても無害だが、逆に「案内が出ていないときは
   * 記録しない」形にすると、案内を見ずにパンを覚えた人の記録が付かなくなる）。
   */
  const hasMarkedIntroSeenRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    hasMarkedIntroSeenRef.current = false;
    const surface = { kind: "drawingZoomPan" as const };
    void hydrateIntroSeen(surface, memberId).then(() => {
      if (!cancelled) setHintAlreadySeenAtOpen(isIntroSeen(surface, memberId));
    });
    return () => {
      cancelled = true;
    };
    // memberIdが決まった時点（＝この部品が新しくマウントされた時点）でのみ
    // 再評価する。意図的な一度きりの判定のため依存はmemberIdのみ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  const handleSelectZoom = (next: DrawingZoomLevel) => {
    setZoom(next);
    // 47.3節決定11: 倍率を切り替えるたびに、パン位置を中央へ戻す
    // （ピンチのような「今見ている位置を中心に拡大する」動きはしない）。
    const center = centerDrawingPan(baseDiameter, next);
    setPan({ x: center, y: center });
  };

  // 47.3節決定9・10: 2本指ドラッグでのみ呼ばれる（DrawingCanvas.tsx側で保証、
  // 同ファイルのonPanResponderMove参照）。移動量をクランプ範囲内に収めて反映する。
  const handlePan = (dx: number, dy: number) => {
    // [2026-09-18・52.6節決定5改訂、52.12節実装メモ4、本部長差し戻し反映]
    // 「見た」の記録自体はここで付ける。ただし`hintAlreadySeenAtOpen`は更新しない
    // （今回開いている画面の表示・非表示はその場では切り替えない、揺れ防止）。
    // 次にこの部品が新しくマウントされたときの上のuseEffectで初めて反映される。
    //
    // [本部長差し戻し2026-09-18] `handlePan`は2本指ドラッグ中、指が動くたびに
    // （1回のドラッグで数十〜百回以上）呼ばれる。`markIntroSeen`を無条件で
    // 毎回呼ぶと、(1)`emit()`により`subscribeIntroSeen`で購読している
    // `TabIntroBubble`等が毎フレーム再描画される、(2)`AsyncStorage.setItem`への
    // 書き込みが毎フレーム走る（Androidでは毎回ブリッジを渡る）。パン中に画面を
    // 重くしないために52.6節決定5を改訂したのに、この経路で同じ重さを起こして
    // しまう。`markIntroSeen`は冪等（何度呼んでも記録は変わらない）ため、
    // この部品が生きている間に1回だけ呼べば記録としては十分。
    // **`hintAlreadySeenAtOpen`（表示の判定）はここでは参照しない。** 既読の人
    // （表示していない人）でも記録の付け直しは無害である一方、「案内が出ていない
    // ときは記録しない」形にしてしまうと、案内を見ずにパンを覚えた人の記録が
    // 付かなくなる（表示の判定と記録を付けるかの判定は別に保つ、52.6節決定5改訂の
    // 要点）。
    if (!hasMarkedIntroSeenRef.current) {
      hasMarkedIntroSeenRef.current = true;
      void markIntroSeen({ kind: "drawingZoomPan" }, memberId);
    }
    setPan((prev) => ({
      x: clampDrawingPan(prev.x + dx, baseDiameter, zoom),
      y: clampDrawingPan(prev.y + dy, baseDiameter, zoom),
    }));
  };

  const innerSize = baseDiameter * zoom;

  // [2026-09-18・52.5節決定4] 子どもロールは専用のcaptionトークンが無く
  // `childBody`を流用する既存慣習（`DrawingBoard.tsx`のtreeMiniatureTextと同じ）。
  const panIntroTextStyle =
    tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;

  return (
    <View style={styles.measureWrap} onLayout={handleLayout}>
      <DrawingZoomPicker tone={tone} selected={zoom} onSelect={handleSelectZoom} disabled={zoomPickerDisabled} />

      {/* [2026-09-27追加・実装メモ.md 316章]「窓」と↻ボタンをまとめて相対配置の
          コンテナに包む。↻ボタンは「窓」（拡大・パンの影響を受けない、常に
          基準直径のまま固定される側）の隅に重ねる。窓の内側（`innerSize`・
          `pan`で動く拡大キャンバス）に描くと、拡大・パン中にボタンごと画面外へ
          出てしまうため、あえて窓の外側（このファイル）に置いた。 */}
      <View style={styles.windowWrap}>
        {/* 47.6節決定14: 外周の円形枠線・クリップは「窓」側にのみ持たせる。
            窓のサイズは基準直径のまま固定し、中の拡大キャンバスだけが動く。 */}
        <View
          style={[
            styles.window,
            { width: baseDiameter, height: baseDiameter, borderRadius: baseDiameter / 2 },
          ]}
        >
          <View
            style={{
              width: innerSize,
              height: innerSize,
              transform: [{ translateX: pan.x }, { translateY: pan.y }],
            }}
          >
            <DrawingCanvas
              ref={canvasRef}
              size={innerSize}
              color={color}
              strokeWidth={strokeWidth}
              lines={lines}
              onStrokeEnd={onStrokeEnd}
              disabled={disabled}
              backgroundColor={backgroundColor}
              chromeless
              onPan={handlePan}
              onGestureActiveChange={onGestureActiveChange}
              tool={tool}
              filled={filled}
              onLineMove={onLineMove}
              onSelectionChange={setHasSelection}
              onDeleteSelected={onDeleteSelected}
            />
          </View>
        </View>

        {/* [2026-09-27追加・実装メモ.md 316章、本部長依頼・軽微変更ルート「Aで！」]
            ↻（回す）ボタン。✋で線・形を選んでいる間だけ、窓の右上の隅に重ねて
            出す（依頼文「レイアウトを押し下げない」。絶対配置のため行は増えない）。
            押すたびに選択中の線を15度（時計回り）回す（`DrawingCanvas.tsx`の
            `rotateSelected`を`ref`経由で呼ぶだけ）。既存の道具ボタンと同じ56dp前後
            のタップ領域（`theme.drawingLimits.swatchSize`）にする。 */}
        {tool === "move" && hasSelection && (
          <Pressable
            onPress={() => canvasRef.current?.rotateSelected()}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={ROTATE_BUTTON_LABEL[tone]}
            hitSlop={8}
            style={[styles.rotateButton, disabled && styles.rotateButtonDisabled]}
          >
            <Text style={styles.rotateButtonSymbol}>↻</Text>
          </Pressable>
        )}

        {/* [2026-09-29追加・実装メモ.md 327章、本部長依頼・軽微変更ルート、統括承認済み]
            🗑（選んだものを消す）ボタン。統括の実機報告「『これをけす』はボタンが
            下にあって遠い」を受け、↻ボタンと左右対称（窓の左上）に置く。同じ大きさ・
            同じ丸い見た目（`rotateButton`と共通のstyleを再利用し、位置とborderColorだけ
            差し替える）。押すと選択中の線を1本削除する（`DrawingCanvas.tsx`の
            `deleteSelected`を`ref`経由で呼ぶだけ。↻の`rotateSelected`呼び出しと
            全く同じ役割分担）。 */}
        {tool === "move" && hasSelection && (
          <Pressable
            onPress={() => canvasRef.current?.deleteSelected()}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={DELETE_SELECTED_BUTTON_LABEL}
            hitSlop={8}
            style={[styles.deleteSelectedButton, disabled && styles.rotateButtonDisabled]}
          >
            <Text style={styles.deleteSelectedButtonSymbol}>🗑️</Text>
          </Pressable>
        )}
      </View>

      {/* [2026-09-18追加・主要画面ワイヤーフレーム.md 52.3節決定2・52.4節決定3]
          円形キャンバス（窓）の直下に、「2本指で動かせる」案内を置く。倍率が
          2倍・3倍のときのみ、かつ今回の画面を開いた時点で未読だったときのみ表示する
          （52.6節決定5改訂、`hintAlreadySeenAtOpen`はこの画面が開いている間固定）。
          `numberOfLines`は指定せず、幅は円の直径ではなく`measureWrap`の実測幅
          いっぱいを使う（52.4節・52.5節追記、子ども向け文言は3行程度になる見込み）。 */}
      {zoom > 1 && !hintAlreadySeenAtOpen && (
        <Text style={[panIntroTextStyle, styles.panIntroText]}>{PAN_INTRO_TEXT[tone]}</Text>
      )}
    </View>
  );
  }
);

const styles = StyleSheet.create({
  // width:"100%"にすることで、onLayoutの実測値がScreen.tsxのcontent幅
  // （パディングs4×2を引いた後の幅）とそのまま一致する（47.1節決定1）。
  measureWrap: { width: "100%", alignItems: "center" },
  // [2026-09-27追加・実装メモ.md 316章] 「窓」と↻ボタンの絶対配置の基準になる
  // コンテナ。`window`（`marginTop`込み）1つだけがふつうの配置の子のため、
  // このViewの大きさ自体は`window`にそのまま揃う（ボタンは絶対配置のため
  // 大きさに関与しない）。
  windowWrap: { position: "relative", alignSelf: "center" },
  window: {
    marginTop: theme.spacing.s4,
    borderWidth: 2,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
    overflow: "hidden",
    alignSelf: "center",
  },
  // [2026-09-27追加・実装メモ.md 316章] ↻（回す）ボタン。`window`の右上の隅に
  // 重ねる（`top`は`window`の`marginTop`と同じ値にして窓の上端に揃え、`right:0`で
  // 窓の右端に揃える。円形キャンバスの角＝視覚的には円の外に半分はみ出す位置に
  // なるが、「絵の上の隅に重ねて出す」という依頼文どおりのバッジ的な配置）。
  // 既存の道具ボタン（`DrawingToolPicker.tsx`の`tap`）と同じ56dp四方のタップ領域。
  rotateButton: {
    position: "absolute",
    top: theme.spacing.s4,
    right: 0,
    width: theme.drawingLimits.swatchSize,
    height: theme.drawingLimits.swatchSize,
    borderRadius: theme.drawingLimits.swatchSize / 2,
    borderWidth: 2,
    borderColor: theme.colors.brandPrimary,
    backgroundColor: theme.colors.neutralSurface,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    elevation: 10,
  },
  rotateButtonDisabled: { opacity: 0.4 },
  // 子ども向けは記号のみ（依頼文どおり）。文字ラベルは持たせずaccessibilityLabelのみで補う。
  rotateButtonSymbol: {
    fontSize: 26,
    lineHeight: 30,
    color: theme.colors.brandPrimaryStrong,
  },
  // [2026-09-29追加・実装メモ.md 327章] 🗑（選んだものを消す）ボタン。`rotateButton`と
  // 同じ大きさ・同じ丸い見た目で、`right:0`を`left:0`に変えただけの左右対称配置。
  // 縁の色だけ既存のdangerトークン（`AppButton.tsx`の`variant="danger"`と同じ
  // `theme.colors.statusBlocking`）にして「消す操作」と分かるようにする。
  deleteSelectedButton: {
    position: "absolute",
    top: theme.spacing.s4,
    left: 0,
    width: theme.drawingLimits.swatchSize,
    height: theme.drawingLimits.swatchSize,
    borderRadius: theme.drawingLimits.swatchSize / 2,
    borderWidth: 2,
    borderColor: theme.colors.statusBlocking,
    backgroundColor: theme.colors.neutralSurface,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    elevation: 10,
  },
  deleteSelectedButtonSymbol: {
    fontSize: 22,
    lineHeight: 26,
    color: theme.colors.statusBlocking,
  },
  // [2026-09-18追加・52.5節決定4] 新しい視覚要素は増やさない。`DrawingBoard.tsx`の
  // treeMiniatureText・sectionHintと同じ扱い（captionStyle相当・neutralTextSecondary・
  // 中央寄せ）。固定height・numberOfLinesは持たせない（52.5節追記）。widthは
  // 円の直径ではなく親（measureWrap、実測幅そのまま）いっぱいを使う（52.4節追記）。
  panIntroText: {
    width: "100%",
    marginTop: theme.spacing.s2,
    textAlign: "center",
    color: theme.colors.neutralTextSecondary,
  },
});

export default ZoomableDrawingCanvas;
