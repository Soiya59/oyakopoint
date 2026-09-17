/**
 * お絵かき（要件定義書07-13-2章、デザイントークン.md 1.9節）の丸いキャンバス。
 * 参照: 開発部/成果物/実装メモ.md「描画方式の調査」章（react-native-svg採用の経緯）。
 *
 * [設計方針]
 * - 座標はスキーマ設計.sql 33b章の仕様どおり、0〜1000に正規化した整数のフラット配列
 *   （[x1,y1,x2,y2,...]）として扱う。キャンバスの実ピクセルサイズ（デザイントークン.md
 *   1.9節: 直径280pt）には依存しない。
 * - 「一定距離未満の移動では点を追加しない」簡易な間引きを行う（33b章コメント
 *   「開発部への実装メモ」対応）。典型的な1枚をDB上限（20KB）よりずっと小さく保つため。
 * - PanResponderで指/マウスの動きを取る。react-native-webはPanResponderをサポートして
 *   おり（node_modules/react-native-web/src/vendor/react-native/PanResponder確認済み）、
 *   Expo Web export（GitHub Pages配信）でもマウスドラッグでの描画が動作する。
 */
import React, { useEffect, useRef, useState } from "react";
import { PanResponder, Platform, StyleSheet, View, ViewStyle } from "react-native";
import Svg, { Circle, Polyline, Rect } from "react-native-svg";
import { simplifyPolyline } from "@/lib/simplifyPolyline";
import { nextGestureActiveState } from "@/lib/gestureActiveNotifier";
import theme from "@/theme/theme";
import type { FamilyDrawingLine, FamilyDrawingLineData } from "@/types/domain";

/**
 * [2026-09-04対応・実装メモ126章] Web版（GitHub Pagesをモバイルブラウザで開く運用）で、
 * キャンバス上で指を動かして線を引こうとすると、ブラウザが標準の縦スクロール操作だと
 * 解釈してしまい画面が動く不具合への対処。CSSの`touch-action: none`をキャンバスの
 * ルート要素に効かせ、ブラウザ側のタッチ→スクロール変換そのものを起こさせないようにする。
 * react-native-web自身がScrollViewのスクロール無効化に同じ手法を使っている
 * （node_modules/react-native-web/dist/exports/ScrollView/ScrollViewBase.js の
 * `scrollDisabled`スタイルで`touchAction: 'none'`を使用しており、実行時にreact-native-webが
 * このキーをそのままDOMのCSSへ渡すことを確認済み）ため、実行時の安全性は確認できている。
 * ただし`'react-native'`の`ViewStyle`型には`touchAction`が定義されておらず、そのまま
 * オブジェクトリテラルに書くとTSの型エラーになる。`as unknown as ViewStyle`で型だけを
 * 逃がす（`@ts-expect-error`より、値自体に説明コメントを添えられるこちらを選んだ）。
 * ネイティブ（iOS/Android実機。現状はWeb版運用のため未使用）ではこのキー自体が
 * 意味を持たないためPlatform.OS==="web"のときだけ付与する。
 */
const webTouchActionNoneStyle: ViewStyle =
  Platform.OS === "web" ? ({ touchAction: "none" } as unknown as ViewStyle) : {};

const MIN_POINT_DISTANCE_PX = 4;

/** [2026-09-11追加・要件定義書07-27章] MemberAvatarからも再利用するためexportする。 */
export function pointsToPolylineString(p: number[], size: number): string {
  const out: string[] = [];
  for (let i = 0; i < p.length - 1; i += 2) {
    const x = (p[i] / 1000) * size;
    const y = (p[i + 1] / 1000) * size;
    out.push(`${x},${y}`);
  }
  return out.join(" ");
}

/**
 * [2026-09-11追加・要件定義書07-27章決定18・主要画面ワイヤーフレーム.md 43.4節]
 * `backgroundColor`が既定値（`theme.colors.neutralSurface`、家族の絵の既存画面）以外に
 * 指定されているときだけ「アバター用途」とみなす。新しいboolean propを増やさず、
 * `backgroundColor`の値だけで判定できるようにする（43.4節決定18・19の指示どおり）。
 */
export function isCustomDrawingBackground(backgroundColor: string): boolean {
  return backgroundColor !== theme.colors.neutralSurface;
}

/**
 * [2026-09-11追加・要件定義書07-27章決定19] `DrawingThumbnail`・`MemberAvatar`が
 * 共有する「表示サイズ帯ごとの線の太さ」ルール（主要画面ワイヤーフレーム.md 43.4節）。
 * `isCustom`（`isCustomDrawingBackground`の結果）がfalseのとき（家族の絵の既存画面）は
 * 呼び出し側で使わず、既存の固定2ptをそのまま使うこと。
 *   - 20〜28px: 1.5pt固定（line.wは無視）
 *   - 32〜40px: 2pt固定（line.wは無視）
 *   - 48px以上: line.w（無ければ4=ふつうへフォールバック、決定20）に応じて
 *     2→1.5pt・4→2pt・7→3pt
 */
export function avatarLineDisplayStrokeWidth(size: number, w: number | undefined): number {
  if (size <= 28) return 1.5;
  if (size <= 40) return 2;
  const effectiveW = w ?? theme.defaultDrawingStrokeWidth;
  if (effectiveW === 2) return 1.5;
  if (effectiveW === 7) return 3;
  return 2;
}

interface DrawingCanvasProps {
  /** 直径（pt）。デザイントークン.md 1.9節「直径280pt」がデフォルト。 */
  size?: number;
  /** 選択中の色（10色パレットのHEXコードのいずれか、2026-09-07に8色から拡張）。 */
  color: string;
  /**
   * [2026-09-05追加] 選択中の太さ（`2`/`4`/`7`のいずれか、デザイントークン.md
   * 「線の太さ（3段階）」・主要画面ワイヤーフレーム.md 21.5b節）。確定前のライブ
   * プレビューと、これから確定する線（`onStrokeEnd`に渡す`w`）の両方に使う。
   */
  strokeWidth: number;
  /** すでに確定済みの線（0〜1000正規化座標）。 */
  lines: FamilyDrawingLine[];
  /** 1本描き終える（指を離す）たびに呼ばれる。1点しか無いタップは呼ばれない。 */
  onStrokeEnd: (line: FamilyDrawingLine) => void;
  /** 上限到達時・保存中などにtrueにして新規ストロークの開始をブロックする。 */
  disabled?: boolean;
  /**
   * [2026-09-11追加・要件定義書07-27章決定17] 円の背景色。未指定時は現状どおり
   * `theme.colors.neutralSurface`（白固定）。アバター用の新規部品は対象メンバーの
   * `avatar_color`をこのpropへ渡す（既存の家族の絵の呼び出し元は無改修で今までどおり
   * 白背景のまま動作する）。
   */
  backgroundColor?: string;
  /**
   * [2026-09-17追加・主要画面ワイヤーフレーム.md 47.6節決定14] 円形の外枠線・
   * 円形クリップを持たせない。既定`false`（今までどおり自前で円の枠線・クリップを
   * 持つ）。`ZoomableDrawingCanvas.tsx`が「窓（基準直径）」側にのみ外周の枠線・
   * クリップを持たせ、内側の拡大キャンバスにはこの部品を`chromeless`で使うために
   * 新設した。既存の呼び出し元（`DrawingBoard.tsx`旧実装・`AvatarDrawingPanel.tsx`）は
   * このpropを渡さないため、今までどおりの見た目のまま変わらない。
   */
  chromeless?: boolean;
  /**
   * [2026-09-17追加・主要画面ワイヤーフレーム.md 47.3節決定9〜10] 2本指ドラッグを
   * 検出したときに呼ばれる（1本指のみのときは呼ばれない）。引数は前回の2本指の
   * 中心位置からの移動量（px、`size`基準の座標系）。このpropを渡さない既存の呼び出し元
   * （`AvatarDrawingPanel.tsx`等）には一切影響しない（下記`onPanResponderMove`参照）。
   */
  onPan?: (dx: number, dy: number) => void;
  /**
   * [2026-09-17追加・実装メモ243章、やること.md 4-41続き] 指がキャンバスに
   * 触れている間（ストローク中・2本指パン中の両方を含む）trueで呼ばれ、
   * 全ての指が離れる（または`PanResponder`がterminateされる）とfalseで呼ばれる。
   * 234章の`onPanResponderTerminationRequest: () => false`だけではiOSの
   * ScrollView自体のスクロールは止まらなかった（JS側の責任者交代を断っても、
   * ネイティブ側のUIScrollViewは別にスクロールしうるため）ための追加の手当て。
   * 呼び出し元（`ZoomableDrawingCanvas.tsx`経由）はこの値で`Screen`の
   * `scrollEnabled`を切り替える。このpropを渡さない既存の呼び出し元
   * （`AvatarDrawingPanel.tsx`）には一切影響しない。
   */
  onGestureActiveChange?: (active: boolean) => void;
}

export function DrawingCanvas({
  size = theme.drawingLimits.canvasDiameter,
  color,
  strokeWidth,
  lines,
  onStrokeEnd,
  disabled = false,
  backgroundColor = theme.colors.neutralSurface,
  chromeless = false,
  onPan,
  onGestureActiveChange,
}: DrawingCanvasProps) {
  const isCustomBackground = isCustomDrawingBackground(backgroundColor);
  const [livePoints, setLivePoints] = useState<number[]>([]);
  const colorRef = useRef(color);
  colorRef.current = color;
  // [2026-09-05追加] colorRefと同じ理由（下記PanResponderのコメント参照）で、
  // 選択中の太さも最新値をrefで参照する。
  const widthRef = useRef(strokeWidth);
  widthRef.current = strokeWidth;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const linesCountRef = useRef(lines.length);
  linesCountRef.current = lines.length;
  const currentPointsRef = useRef<number[]>([]);
  // [2026-09-17追加・47.3節決定9〜10] 最新のonPanをrefで参照する（colorRefと同じ理由）。
  const onPanRef = useRef(onPan);
  onPanRef.current = onPan;
  // 2本指ドラッグ中かどうか（決定10「全ての指が離れるまで移動モードを維持し、
  // 残った1本の指では描画を再開しない」の実現に使う）。
  const isPanningRef = useRef(false);
  // 直前フレームの2本指の中心位置（pageX/pageY基準）。次のmoveとの差分がパン量になる。
  const panCenterRef = useRef<{ x: number; y: number } | null>(null);
  // [2026-09-17追加・実装メモ243章] 最新のonGestureActiveChangeをrefで参照する
  // （colorRef・onPanRefと同じ理由）。
  const onGestureActiveChangeRef = useRef(onGestureActiveChange);
  onGestureActiveChangeRef.current = onGestureActiveChange;
  // 直近に通知した「指が触れている」状態。二重通知を避け、アンマウント時に
  // trueのまま終わっていないかを判定するためにも使う（下のuseEffect参照）。
  // 通知すべきかどうかの判定自体は`gestureActiveNotifier.ts`の純粋関数に切り出し、
  // node単体実行で検証している（`gestureActiveNotifier.verify.ts`）。
  const gestureActiveRef = useRef(false);
  const setGestureActive = (active: boolean) => {
    const result = nextGestureActiveState(gestureActiveRef.current, active);
    if (!result.shouldNotify) return;
    gestureActiveRef.current = result.active;
    onGestureActiveChangeRef.current?.(result.active);
  };
  // [2026-09-17追加・実装メモ243章] 234.5節の申し送り「ジェスチャーが途中で
  // 終わっても・アンマウント時も必ずtrueに戻る」の保険。この部品自体が
  // （`showCanvas`の条件変化等で）指を触れたまま消えることがあっても、
  // 消える瞬間にfalseを1回だけ通知する。
  useEffect(() => {
    return () => {
      setGestureActive(false);
    };
  }, []);

  const toNormalized = (px: number, py: number): [number, number] => {
    const nx = Math.max(0, Math.min(1000, Math.round((px / size) * 1000)));
    const ny = Math.max(0, Math.min(1000, Math.round((py / size) * 1000)));
    return [nx, ny];
  };

  const finishStroke = () => {
    const pts = currentPointsRef.current;
    currentPointsRef.current = [];
    setLivePoints([]);
    // DB側chk_family_drawings_line_data（33b章）はp配列2要素以上を要求する。
    // 1点だけのタップ（指を置いてすぐ離した）は線として保存しない。
    if (pts.length < 2) return;
    // [2026-09-07追加・実装メモ137章] 線が確定した瞬間にだけDouglas-Peucker型の
    // ポリライン簡略化をかける。描画中のライブプレビュー（livePoints・上の
    // onPanResponderMove）には一切適用しない（描き味を変えないため）。保存済みの
    // 絵（DB上の既存データ）にも適用しない。詳細はsrc/lib/simplifyPolyline.ts参照。
    const simplified = simplifyPolyline(pts, theme.drawingSimplifyTolerance);
    onStrokeEnd({ c: colorRef.current, p: simplified, w: widthRef.current });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        !disabledRef.current && linesCountRef.current < theme.drawingLimits.maxLines,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderGrant: (evt) => {
        // [2026-09-17追加・実装メモ243章] Grantはこのキャンバスが responder に
        // なった瞬間（＝指がキャンバス上にある間）にのみ呼ばれる
        // （onStartShouldSetPanResponderがtrueを返したとき。disabled・上限到達
        // 時はそもそもここへ来ない）。無条件でtrueを通知してよい。
        setGestureActive(true);
        // Web版でのスクロール抑止の保険（主たる防御はwebTouchActionNoneStyle）。
        // react-native-webの responder システムは document に touchstart/touchmove
        // リスナーを{passive: true}指定無しで登録している
        // （node_modules/react-native-web/dist/modules/useResponderEvents/ResponderSystem.js
        // のattachListeners内`document.addEventListener(eventType, eventListener)`）が、
        // Chrome等のブラウザはwindow/document直下のtouchstart/touchmoveリスナーを
        // 既定でpassive扱いする仕様介入を持つため、実際にpreventDefault()が効くかは
        // ブラウザ実装依存。効かせられなくても実害は無く（`touch-action: none`が
        // 別途スクロールを止める）、これ以上は深追いしない方針とした。
        evt.preventDefault?.();
        // [2026-09-17追加・47.3節決定9〜10] 新しいジェスチャーの開始時は必ず
        // 「移動モード」をクリアしておく（前回のジェスチャーの状態を持ち越さない）。
        isPanningRef.current = false;
        panCenterRef.current = null;
        if (disabledRef.current || linesCountRef.current >= theme.drawingLimits.maxLines) return;
        const { locationX, locationY } = evt.nativeEvent;
        const [nx, ny] = toNormalized(locationX, locationY);
        currentPointsRef.current = [nx, ny];
        setLivePoints([nx, ny]);
      },
      onPanResponderMove: (evt) => {
        evt.preventDefault?.();
        if (disabledRef.current) return;
        // [2026-09-17追加・主要画面ワイヤーフレーム.md 47.3節決定9〜10]
        // 2本目の指が触れたら「描く」から「移動」へ切り替える。
        // - 描きかけの線は保存せず破棄する（決定10、B案「確定して残す」は不採用）。
        //   `currentPointsRef`・`livePoints`を空に戻すだけで、`onStrokeEnd`は呼ばない。
        // - `isPanningRef`をtrueにしたら、この指が1本に減っても（相方が先に離れても）
        //   trueのまま維持し、以後の分岐（このmoveハンドラの下側）で新しい描画を
        //   再開させない。全ての指が離れて次のonPanResponderGrantが呼ばれて
        //   初めてfalseに戻る（上のonPanResponderGrant参照）。
        const touches = evt.nativeEvent.touches;
        if (touches && touches.length >= 2) {
          if (currentPointsRef.current.length > 0) {
            currentPointsRef.current = [];
            setLivePoints([]);
          }
          isPanningRef.current = true;
          const cx = (touches[0].pageX + touches[1].pageX) / 2;
          const cy = (touches[0].pageY + touches[1].pageY) / 2;
          if (panCenterRef.current) {
            onPanRef.current?.(cx - panCenterRef.current.x, cy - panCenterRef.current.y);
          }
          panCenterRef.current = { x: cx, y: cy };
          return;
        }
        if (isPanningRef.current) {
          // 2本→1本に減った（相方が先に離れた）。決定10のとおり、残った1本では
          // 描画を再開しない（このジェスチャーが終わるまで何もしない）。
          return;
        }
        const pts = currentPointsRef.current;
        if (pts.length === 0) return;
        // 1本あたりの座標点数上限（DB側は300点=p配列600要素、33b章）に達したら、
        // このストロークではこれ以上点を追加しない（指を動かしても線が伸びなくなる）。
        if (pts.length / 2 >= theme.drawingLimits.maxPointsPerLine) return;
        const { locationX, locationY } = evt.nativeEvent;
        const [nx, ny] = toNormalized(locationX, locationY);
        const lastX = pts[pts.length - 2];
        const lastY = pts[pts.length - 1];
        // 「一定距離未満の移動では点を追加しない」簡略化（33b章コメント対応）。
        // 正規化後(0-1000)スケールでの距離判定に、size基準のpxしきい値を変換して使う。
        const thresholdNormalized = (MIN_POINT_DISTANCE_PX / size) * 1000;
        const dx = nx - lastX;
        const dy = ny - lastY;
        if (dx * dx + dy * dy < thresholdNormalized * thresholdNormalized) return;
        const next = [...pts, nx, ny];
        currentPointsRef.current = next;
        setLivePoints(next);
      },
      // [2026-09-17追加・実装メモ243章] 全ての指が離れた（Release）・強制的に
      // 責任者を失った（Terminate）のどちらでも「指が触れていない」に戻す。
      // finishStrokeより先にfalseを通知しておく（呼び出し元がすぐscrollEnabled
      // をtrueへ戻せるように。finishStroke自体はscrollの状態に関与しない）。
      onPanResponderRelease: () => {
        setGestureActive(false);
        finishStroke();
      },
      onPanResponderTerminate: () => {
        setGestureActive(false);
        finishStroke();
      },
      // [2026-09-17追加・やること.md 4-41・実装メモ234章] iOS実機で「長い線が描けない」
      // （線が短く途切れる）不具合への対処。キャンバスは`Screen`（scroll=true）の
      // ScrollViewの中にあり、指を動かし始めるとScrollViewが「自分がスクロールする」と
      // 責任者の交代を要求してくる。既定ではこの要求に応じてしまい、その瞬間に
      // `onPanResponderTerminate`→`finishStroke`で線が打ち切られていた。iOSの
      // UIScrollViewは指が数pt動いただけで要求を出すため、線がどれも同じくらい短く
      // 切れる。Androidは要求が緩く、切れる前に描き終わるので気づかなかった。
      // 線を描いている間は交代要求を断る（falseを返す）。描き終えて指を離せば
      // 責任者は解放されるので、通常のスクロールには影響しない。
      onPanResponderTerminationRequest: () => false,
      // Android側の保険: ネイティブ側の部品（ScrollView等）がタッチを横取りするのを
      // 明示的に止める（既定値もtrueだが、上の対処と対で意図を明示しておく）。
      onShouldBlockNativeResponder: () => true,
    })
  ).current;

  return (
    <View
      style={[
        // [2026-09-17変更・47.6節決定14] `chromeless`のときは円形の外枠線・クリップを
        // 持たせない（`ZoomableDrawingCanvas.tsx`の「窓」側にだけ持たせるため）。
        // 既定`false`の呼び出し元（今までどおりの全部）は`styles.circle`のみが
        // 適用され、見た目は一切変わらない。
        chromeless ? styles.chromeless : styles.circle,
        { width: size, height: size, borderRadius: chromeless ? 0 : size / 2 },
        // キャンバスの矩形の上でだけスクロールを止める。この`View`の外
        // （題名入力欄・パレット・保存ボタン・過去の絵の一覧）にはこのスタイルを
        // 付けないため、画面全体のスクロール（Screenのscroll=true）は従来どおり働く。
        webTouchActionNoneStyle,
      ]}
      {...panResponder.panHandlers}
    >
      <Svg width={size} height={size}>
        {/* [2026-09-17追加・47.6節決定14「コーナー部分の白抜け対策」] `chromeless`で
            円形クリップが外れると、正方形の四隅（元々は透明で、外側Viewの円形
            クリップに隠れていた部分）から背景色が透けて見えてしまう。円を描く前に
            size×size全面を同じ背景色で塗っておく。`chromeless=false`（既存の
            全呼び出し元）では外側Viewの円形クリップがそのまま効くため、この矩形が
            増えても見た目には一切影響しない。 */}
        {chromeless && <Rect x={0} y={0} width={size} height={size} fill={backgroundColor} />}
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={backgroundColor} />
        {lines.map((line, idx) => {
          const displayStrokeWidth = line.w ?? theme.defaultDrawingStrokeWidth;
          // [2026-09-11追加・要件定義書07-27章決定18] 白い線のふち取りは、背景色が
          // 既定（白）以外のときだけ付ける（既存の家族の絵の見た目は変えない）。
          const needsWhiteOutline = isCustomBackground && line.c === "#FFFFFF";
          return (
            <React.Fragment key={idx}>
              {needsWhiteOutline && (
                <Polyline
                  points={pointsToPolylineString(line.p, size)}
                  fill="none"
                  stroke={theme.colors.neutralTextPrimary}
                  strokeWidth={displayStrokeWidth + 1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              <Polyline
                points={pointsToPolylineString(line.p, size)}
                fill="none"
                stroke={line.c}
                // [2026-09-05変更] `line.w`（無ければ決定25のとおり4=ふつうへフォールバック）
                // を使う。以前は固定4pt。
                strokeWidth={displayStrokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </React.Fragment>
          );
        })}
        {livePoints.length >= 2 && (
          <>
            {isCustomBackground && color === "#FFFFFF" && (
              <Polyline
                points={pointsToPolylineString(livePoints, size)}
                fill="none"
                stroke={theme.colors.neutralTextPrimary}
                strokeWidth={strokeWidth + 1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            <Polyline
              points={pointsToPolylineString(livePoints, size)}
              fill="none"
              stroke={color}
              // [2026-09-05変更] 描画中のライブプレビューも選択中の太さを反映する。
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}
      </Svg>
    </View>
  );
}

/**
 * コレクター棚等での小さい静止プレビュー用（非インタラクティブ）。上限到達時の自分の絵一覧に使う。
 * [2026-09-11変更・要件定義書07-27章決定17〜19] `backgroundColor`propを追加。未指定時は
 * 現状どおり`theme.colors.neutralSurface`（白固定）。`backgroundColor`が既定値以外
 * （＝アバター表示用途）のときに限り、白い線のふち取り（決定18）と表示サイズ帯別の太さ
 * （決定19、`avatarLineDisplayStrokeWidth`）を適用する。既定背景（白、家族の絵の既存画面）の
 * ときは`strokeWidth={2}`固定のまま変更しない。
 */
export function DrawingThumbnail({
  lineData,
  size = 72,
  backgroundColor = theme.colors.neutralSurface,
}: {
  lineData: FamilyDrawingLineData;
  size?: number;
  backgroundColor?: string;
}) {
  const isCustomBackground = isCustomDrawingBackground(backgroundColor);
  return (
    <View style={[styles.circle, styles.thumbnail, { width: size, height: size, borderRadius: size / 2 }]}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={backgroundColor} />
        {lineData.lines.map((line, idx) => {
          const displayStrokeWidth = isCustomBackground ? avatarLineDisplayStrokeWidth(size, line.w) : 2;
          const needsWhiteOutline = isCustomBackground && line.c === "#FFFFFF";
          return (
            <React.Fragment key={idx}>
              {needsWhiteOutline && (
                <Polyline
                  points={pointsToPolylineString(line.p, size)}
                  fill="none"
                  stroke={theme.colors.neutralTextPrimary}
                  strokeWidth={displayStrokeWidth + 1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              <Polyline
                points={pointsToPolylineString(line.p, size)}
                fill="none"
                stroke={line.c}
                strokeWidth={displayStrokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderWidth: 2,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
    overflow: "hidden",
    alignSelf: "center",
  },
  // [2026-09-17追加・47.6節決定14] `chromeless=true`のときに使う。枠線・円形クリップを
  // 持たない、ただの土台View（拡大中の内側キャンバス用）。
  chromeless: {
    alignSelf: "center",
  },
  thumbnail: {
    borderWidth: 1,
  },
});

export default DrawingCanvas;
