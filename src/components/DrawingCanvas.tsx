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
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { PanResponder, Platform, StyleSheet, View, ViewStyle } from "react-native";
import Svg, { Circle, Polygon, Polyline, Rect } from "react-native-svg";
import { simplifyPolyline } from "@/lib/simplifyPolyline";
import { nextGestureActiveState } from "@/lib/gestureActiveNotifier";
import { normalizeDrawingPoint, denormalizeDrawingPoint } from "@/lib/drawingCanvasCoords";
import { isDrawingShapeTool, shapeToPolyline, type DrawingTool } from "@/lib/drawingShapes";
import {
  findLineIndexAtPoint,
  translateLinePoints,
  rotateLinePoints,
  type HitTestLine,
} from "@/lib/drawingLineMove";
import theme from "@/theme/theme";
import type { FamilyDrawingLine, FamilyDrawingLineData } from "@/types/domain";

/**
 * [2026-09-27追加・実装メモ.md 315章、本部長依頼・軽微変更ルート「うごかす」]
 * ✋（`"move"`）道具。描いた線・形（塗った形も含む）を指1本でつまんで動かす。
 * 309章（形ツール）・313章（塗り）と同じ`tool`propの分岐に相乗りするが、性質が
 * 大きく異なるため実装は別立てにした:
 * - ペン・形ツールは「これから新しい1本の線を作る」操作で、確定は`onStrokeEnd`
 *   （配列へ追加）。
 * - "move"は「既に確定済みの`lines[i]`を書き換える」操作のため、新しい
 *   `onLineMove(index, translatedPoints)`コールバックを設け、`lines`配列の
 *   どの行を・どう書き換えるかは呼び出し元（`DrawingBoard.tsx`・
 *   `AvatarDrawingPanel.tsx`）に委ねる（`onStrokeEnd`の「新しい行を渡す」形と
 *   非対称になるが、既存の行を特定のindexで上書きする操作を無理に
 *   `onStrokeEnd`へ寄せるより素直なため）。
 * - どの線をつかむか（`findLineIndexAtPoint`）・平行移動の計算（`translateLinePoints`）
 *   はUIに依存しない純粋関数として`src/lib/drawingLineMove.ts`へ切り出し、
 *   `drawingShapes.ts`・`drawingCanvasCoords.ts`と同じ方針でnode単体検証している
 *   （`drawingLineMove.verify.ts`）。
 * - 座標の変換（実ピクセル⇔0〜1000正規化）は、ペン・形と全く同じ
 *   `normalizeDrawingPoint`／`toNormalized`をそのまま使う（依頼文「座標の変換は、
 *   線を描くときと同じ計算を使う」）。
 * - 指2本操作（`ZoomableDrawingCanvas.tsx`のパン）とはぶつからない: 2本目の指が
 *   触れた瞬間、既存のパン判定（下記`touches.length >= 2`分岐）が“move”の
 *   つかみかけも他の道具の描きかけと同列に破棄する。
 *
 * [2026-09-27追加・実装メモ.md 316章、本部長依頼・軽微変更ルート「Aで！」承認済み]
 * ✋に「選んで回す」を足す。
 * - **選ぶ（タップ）と動かす（ドラッグ）は同じGrant/Releaseの中で区別する**:
 *   指を置いた瞬間（Grant）にどの線をつかんだかは315章と同じ`findLineIndexAtPoint`で
 *   決めるが、指を動かさずに離した（Release時に`moveCurrentPointsRef`が
 *   `grab.origPoints`と1つも変わっていない）場合だけ、その線を「選択状態」にする
 *   （`selectedIndex` state）。実際に動かした（ドラッグ）場合は315章までと同じ
 *   平行移動のみ行い、選択状態は変えない（依頼文「軽くタップ（動かさずに離す）
 *   すると…選ばれた状態になる」の「動かさずに」を素直に反映した）。
 * - **選択を外す条件（依頼文の3つ）**: (1)何もない場所をつかむ・(2)道具を切り替える
 *   （`tool !== "move"`になるuseEffect）・(3)別の線をつかむ、のいずれも
 *   `onPanResponderGrant`の時点（つかんだ瞬間）で即座に選択を外す。「別の線を
 *   ドラッグして動かす」ときも、つかんだ瞬間に前の選択は外れる。
 * - **回転専用ボタン（↻）はこのファイルの外（`ZoomableDrawingCanvas.tsx`）が描く**:
 *   拡大・パン中でも常にキャンバスの「窓」の隅に固定表示するため（内側の
 *   拡大キャンバスの角に描くと、拡大・パン時にボタンごと視界の外へ出てしまう）。
 *   このファイルは`forwardRef`で`rotateSelected()`を公開し（`DrawingCanvasHandle`）、
 *   選択の有無は`onSelectionChange`で親へ通知するだけにする。
 * - **丸め誤差を積み重ねない（依頼文の決定）**: 選んだ瞬間の座標を`rotateBaseRef`に
 *   固定して保持し、↻を押すたびに角度を15度ずつ増やして「その固定座標から
 *   毎回回し直す」（`rotateLinePoints`のファイル冒頭コメント参照）。選んだ線を
 *   ドラッグで動かした場合は、動かした後の座標へ`rotateBaseRef`を張り直す
 *   （動かす前の位置に戻って回り始めるのを防ぐ）。
 * - **「ひとつ もどす」は1回分ずつ戻る**: 回転も315章の`onLineMove`をそのまま
 *   呼ぶため、`DrawingBoard.tsx`・`AvatarDrawingPanel.tsx`の`preMoveLinesRef`
 *   （「直前の`lines`を1つだけ保持する」実装、315章から無変更）が押すたびに
 *   上書きされる。そのため↻を3回押して「ひとつ もどす」を押すと、3回分まとめて
 *   ではなく直前の1回（15度）分だけ戻る。315章の1回のドラッグ移動と同じ
 *   「1操作＝1回分」の粒度に自然にそろうため、`preMoveLinesRef`側は変更しなかった
 *   （依頼文「既存の巻き戻しの作りに合う方を選ぶ」への回答）。
 */
const MOVE_HIT_EXTRA_TOLERANCE_PX = 16;
/** [2026-09-27追加・316章] ↻を1回押すたびに回す角度（統括決定「15度ずつ」）。 */
const ROTATE_STEP_DEG = 15;

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
    // [2026-09-18変更・実装メモ245章] 式自体は変えず、src/lib/drawingCanvasCoords.ts
    // （node単体検証あり）へ切り出した同じ式を呼ぶだけにした。
    const [x, y] = denormalizeDrawingPoint(p[i], p[i + 1], size);
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

/**
 * [2026-09-27追加・実装メモ.md 313章、本部長依頼・軽微変更ルート] 1本の線を描くSVG要素。
 * `line.f`（塗った形かどうか）で`<Polygon>`（塗り）と`<Polyline>`（線のみ、従来どおり）を
 * 切り替える。`DrawingCanvas`本体・`DrawingThumbnail`・`MemberAvatar.tsx`の3箇所が
 * ほぼ同じ描画ロジックを持っていた（`needsWhiteOutline`の重複実装）ため、ここへ1箇所に
 * まとめる（`MemberAvatar.tsx`が既に`avatarLineDisplayStrokeWidth`・
 * `pointsToPolylineString`をこのファイルから読み込んでいるのと同じ理由）。
 *
 * [線の太さ(w)の扱い・313章決定] 塗った形の縁には、選択中の太さ(`strokeWidth`)を
 * そのまま使う。塗り色と縁の色が同じときは縁が見えないだけで実害は無く、
 * 白色（`needsWhiteOutline`）のときだけ縁の色を`neutralTextPrimary`に変えて視認できる
 * ようにする。これは既存の「白い線には縁取りを付ける」ロジック（`needsWhiteOutline`、
 * 2026-09-11追加）と同じ考え方を、線1本の`<Polygon>`の`stroke`属性だけで実現したもの
 * （`<Polyline>`版のような2重描画は不要）。
 */
export function DrawingLineShape({
  color,
  points,
  strokeWidth,
  filled,
  needsWhiteOutline,
  highlighted,
}: {
  color: string;
  points: string;
  strokeWidth: number;
  filled?: boolean;
  needsWhiteOutline: boolean;
  /**
   * [2026-09-27追加・実装メモ.md 315章] ✋（うごかす）でつかんでいる間、その線を
   * 少し目立たせる（依頼文「つかんでいる間は、その線を少し目立たせる（例: 薄い影や
   * 縁）」）。線・塗りの色や形に関わらず同じ見た目にするため、実際の線の下へ
   * 半透明で少し太いPolylineを1本重ねるだけの実装にした（`needsWhiteOutline`の
   * 「実線の縁取り」とは別物。色を問わず常に薄い暗色の影として見せたいため、
   * 白選択時の縁取り色と共用せず独立した見た目にする）。
   */
  highlighted?: boolean;
}) {
  const halo = highlighted ? (
    <Polyline
      points={points}
      fill="none"
      stroke={theme.colors.neutralTextPrimary}
      strokeOpacity={0.28}
      strokeWidth={strokeWidth + 8}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ) : null;
  if (filled) {
    return (
      <>
        {halo}
        <Polygon
          points={points}
          fill={color}
          stroke={needsWhiteOutline ? theme.colors.neutralTextPrimary : color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      </>
    );
  }
  return (
    <>
      {halo}
      {needsWhiteOutline && (
        <Polyline
          points={points}
          fill="none"
          stroke={theme.colors.neutralTextPrimary}
          strokeWidth={strokeWidth + 1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <Polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  );
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
  /**
   * [2026-09-26追加・実装メモ.md 309章、本部長依頼・軽微変更ルート] 現在選択中の
   * 道具。既定`"pen"`（自由な線、従来どおり）。`"circle"`／`"triangle"`／`"rect"`の
   * ときは、なぞった始点・終点が作るバウンディングボックスの中に、その形の輪郭
   * だけ（中は塗らない）を閉じた1本のポリラインとして描く（`src/lib/drawingShapes.ts`
   * 参照）。指を動かしている間は`livePoints`を都度組み直してライブプレビューする
   * （下記PanResponder参照）。**`simplifyPolyline`は形には適用しない**（間引くと
   * 角が崩れるため、依頼文の指示どおり）。既存の呼び出し元（このpropを渡さない
   * `DrawingBoard.tsx`旧来分・`AvatarDrawingPanel.tsx`）は既定値`"pen"`のまま、
   * 見た目・挙動は一切変わらない。
   * [2026-09-27追加・実装メモ.md 315章]`"move"`のときは、つかんだ既存の線を
   * 平行移動する（下記`onLineMove`参照）。新しい線は作らないため`onStrokeEnd`は
   * 呼ばれない。
   */
  tool?: DrawingTool;
  /**
   * [2026-09-27追加・実装メモ.md 313章、本部長依頼・軽微変更ルート] `tool`が形
   * （`"pen"`以外）のときに、その形の中を塗るかどうか。既定`false`（線だけ、従来
   * どおり）。`tool==="pen"`のときは無視される（ペンには塗りの概念が無い）。
   * ライブプレビュー（下記`livePoints`の描画）・確定した線（`onStrokeEnd`に渡す
   * `FamilyDrawingLine.f`）の両方に使う。既存の呼び出し元（このpropを渡さない
   * `DrawingBoard.tsx`旧来分・`AvatarDrawingPanel.tsx`旧来分）は既定値`false`のまま、
   * 見た目・挙動は一切変わらない。`tool==="move"`のときも無視される。
   */
  filled?: boolean;
  /**
   * [2026-09-27追加・実装メモ.md 315章、本部長依頼・軽微変更ルート「うごかす」]
   * `tool==="move"`のとき、指を離した瞬間（つかんだ線を実際に動かせたときのみ）に
   * 呼ばれる。`index`は`lines`配列内での位置、`points`は移動後の0〜1000正規化座標
   * （`FamilyDrawingLine.p`と同じ形）。呼び出し元は`lines[index].p`をこの値へ
   * 差し替えること（`c`・`w`・`f`は変えない）。何もつかめなかった・つかんだが
   * 指を動かさなかった（実質移動していない）ときは呼ばれない。このpropを渡さない
   * 既存の呼び出し元には一切影響しない（`tool`が`"move"`にならない限り使われない）。
   * [2026-09-27追加・実装メモ.md 316章]「選んで回す」の確定（↻ボタン、
   * `DrawingCanvasHandle.rotateSelected`経由）も、平行移動と全く同じこの
   * コールバックを呼ぶ（`p`を書き換えるだけの操作という点で同じため。呼び出し元
   * 〈`DrawingBoard.tsx`・`AvatarDrawingPanel.tsx`〉の`onLineMove`実装は無改修）。
   */
  onLineMove?: (index: number, points: number[]) => void;
  /**
   * [2026-09-27追加・実装メモ.md 316章、本部長依頼・軽微変更ルート「Aで！」]
   * ✋で選択中の線があるかどうかが変わるたびに呼ばれる（`true`＝選択あり・
   * `false`＝選択なし）。呼び出し元（`ZoomableDrawingCanvas.tsx`）はこの値で
   * ↻ボタンの表示・非表示を切り替える。このpropを渡さない呼び出し元には
   * 一切影響しない。
   */
  onSelectionChange?: (hasSelection: boolean) => void;
}

/**
 * [2026-09-27追加・実装メモ.md 316章] `forwardRef`で公開する命令的API。
 * 回転専用ボタン（↻）は拡大・パン時にも位置がずれないよう`ZoomableDrawingCanvas.tsx`
 * 側（内側の拡大キャンバスの外）に描くため、実際に線を回す処理（選択状態・
 * `rotateBaseRef`を持つこのファイルの内部）を親から呼び出せるようにする。
 */
export interface DrawingCanvasHandle {
  /** ✋で選択中の線を15度（時計回り）回す。何も選択していなければ何もしない。 */
  rotateSelected: () => void;
}

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(function DrawingCanvas({
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
  tool = "pen",
  filled = false,
  onLineMove,
  onSelectionChange,
}: DrawingCanvasProps,
ref) {
  const isCustomBackground = isCustomDrawingBackground(backgroundColor);
  const [livePoints, setLivePoints] = useState<number[]>([]);
  /**
   * [2026-09-27追加・実装メモ.md 315章] ✋（うごかす）でつかんでいる線の
   * ライブプレビュー。`{index, points}`＝`lines[index]`を動かしている最中の
   * 表示用の点（0〜1000正規化座標、まだ確定していない）。`null`＝つかんでいない。
   * `livePoints`（ペン・形専用、「新しい線の描きかけ」）とは別に持つ:
   * "move"は既存の`lines[index]`を一時的に隠して、この値で置き換えて描くため。
   */
  const [movePreview, setMovePreview] = useState<{ index: number; points: number[] } | null>(null);
  const colorRef = useRef(color);
  colorRef.current = color;
  // [2026-09-05追加] colorRefと同じ理由（下記PanResponderのコメント参照）で、
  // 選択中の太さも最新値をrefで参照する。
  const widthRef = useRef(strokeWidth);
  widthRef.current = strokeWidth;
  // [2026-09-26追加・実装メモ.md 309章] colorRef・widthRefと同じ理由
  // （PanResponderのクロージャは最新propsを直接読めないため）で、選択中の道具も
  // refで参照する。
  const toolRef = useRef(tool);
  toolRef.current = tool;
  // [2026-09-27追加・実装メモ.md 313章] toolRefと同じ理由（PanResponderのクロージャは
  // 最新propsを直接読めないため）で、塗りの選択もrefで参照する。
  const filledRef = useRef(filled);
  filledRef.current = filled;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const linesCountRef = useRef(lines.length);
  linesCountRef.current = lines.length;
  /**
   * [2026-09-18追加・実装メモ245章、やること.md統括報告「お絵かきの線がずれる」]
   * `panResponder`（直下の`useRef(PanResponder.create({...}))`）は、Reactの
   * `useRef`が「マウント時に渡した初期値だけを保持し、以降の再レンダーで渡された
   * 引数は評価はされるが捨てられる」仕様（node_modules/react-native/Libraries/
   * Renderer/implementations/ReactFabric-dev.jsのuseRef実装、マウント時＝
   * `mountRef(initialValue)`は引数をそのまま`{current: initialValue}`にする一方、
   * 更新時＝`useRef: function () { ... return updateWorkInProgressHook()
   * .memoizedState; }`は引数を受け取ってすらいない）であるため、
   * `onPanResponderGrant`・`onPanResponderMove`内で直接`size`（このpropの値）を
   * 読むと、マウント時点の`size`に永久に固定される。`color`・`strokeWidth`・
   * `disabled`・`lines.length`・`onPan`が既に同じ理由でrefにしてある
   * （colorRef等、上記コメント）のに`size`だけrefにしていなかったのが235章の
   * 見落とし（詳細は本ファイル下部・実装メモ245章）。
   */
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const currentPointsRef = useRef<number[]>([]);
  /**
   * [2026-09-26追加・実装メモ.md 309章] `tool`が`"pen"`以外（形ツール）のときに
   * 使う、なぞった始点・終点（0〜1000正規化座標）。`currentPointsRef`（ペン専用、
   * 描いた全ての点を貯める）とは別に持つ。形は始点・終点の2点だけから
   * `shapeToPolyline`で組み立て直すため、途中の点を貯める必要が無い。
   * どちらも`null`＝「形の描きかけが無い」を表す。
   */
  const shapeStartRef = useRef<[number, number] | null>(null);
  const shapeEndRef = useRef<[number, number] | null>(null);
  /**
   * [2026-09-27追加・実装メモ.md 315章]"move"専用の描きかけの状態。
   * `index`＝つかんだ`lines`内の位置、`startX/startY`＝つかんだ瞬間の正規化座標
   * （平行移動量dx/dyの基準点）、`lastX/lastY`＝直近に反映した指の位置
   * （`MIN_POINT_DISTANCE_PX`と同じ間引き判定に使う、下記PanResponder参照）、
   * `origPoints`＝つかんだ瞬間の`lines[index].p`（このジェスチャー中は不変の
   * 基準として使う。ジェスチャー中に他の操作で`lines`が書き換わることは無い
   * ——`onStartShouldSetPanResponder`がこの部品をresponderにしている間、
   * 他のUI操作は物理的に同時に押せないため）。`null`＝何もつかんでいない。
   */
  const moveGrabRef = useRef<{
    index: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    origPoints: number[];
  } | null>(null);
  /** [2026-09-27追加・315章] 直近に計算した移動後の点（`finishStroke`の`move`分岐が
   *  指を離した瞬間にこの値を`onLineMove`へ渡す）。`moveGrabRef`と同時に張り直す。 */
  const moveCurrentPointsRef = useRef<number[] | null>(null);
  // [2026-09-27追加・315章] ヒットテストは常に「今のlines配列」を見る必要があるため、
  // colorRef等と同じ理由でrefにする（PanResponderのクロージャは最新propsを直接読めない）。
  const linesRef = useRef(lines);
  linesRef.current = lines;
  // [2026-09-27追加・315章] onPanRefと同じ理由で最新のonLineMoveをrefで参照する。
  const onLineMoveRef = useRef(onLineMove);
  onLineMoveRef.current = onLineMove;
  /**
   * [2026-09-27追加・実装メモ.md 316章]✋で「選択中」の線のindex。`null`＝選択なし。
   * `movePreview`（ドラッグ中の一時的なライブプレビュー）とは別に持つ:
   * こちらは指を離した後も（回転ボタンを押すまで）持続する状態のため。
   */
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // PanResponderのクロージャは最新stateを直接読めないため、colorRef等と同じ理由でrefにする。
  const selectedIndexRef = useRef<number | null>(null);
  selectedIndexRef.current = selectedIndex;
  /**
   * [2026-09-27追加・実装メモ.md 316章] 選択中の線を回すための「固定された基準」。
   * `index`＝選択中の`lines`内の位置、`basePoints`＝選んだ瞬間（またはドラッグで
   * 動かした直後）の座標（このセッション中は不変）、`angle`＝これまでに回した
   * 合計角度（15度刻み）。↻を押すたびに`rotateLinePoints(basePoints, angle+15)`を
   * 計算する（`basePoints`自体は書き換えない）ことで、「前回の丸め済み結果を
   * また丸める」ことによる誤差の積み重ねを避ける（`drawingLineMove.ts`の
   * `rotateLinePoints`コメント参照）。`null`＝選択なし、または選択中の線を
   * まだ一度も基準づけていない。
   */
  const rotateBaseRef = useRef<{ index: number; basePoints: number[]; angle: number } | null>(null);
  // [2026-09-27追加・316章] onLineMoveRef等と同じ理由で最新のonSelectionChangeをrefで参照する。
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  // [2026-09-27追加・316章] 選択の有無が変わるたびに親へ通知する（依頼文「選んでいる間だけ
  // ↻ボタンを出す」。`ZoomableDrawingCanvas.tsx`が拡大・パンの影響を受けない位置に
  // ボタンを描くため、このファイルの外で判断できるようにする）。
  useEffect(() => {
    onSelectionChangeRef.current?.(selectedIndex !== null);
  }, [selectedIndex]);
  // [2026-09-27追加・316章、依頼文「別の道具を選ぶと選択を外す」] toolが"move"で
  // なくなった瞬間に選択・回転の基準をリセットする。
  useEffect(() => {
    if (tool !== "move") {
      setSelectedIndex(null);
      rotateBaseRef.current = null;
    }
  }, [tool]);
  // [2026-09-27追加・316章] 「ひとつ もどす」の通常の1本戻す（`lines`の末尾を
  // 削除する）等で選択中のindexが配列の範囲外になったら、選択を外す（保険。
  // 316.4節参照）。
  useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= lines.length) {
      setSelectedIndex(null);
      rotateBaseRef.current = null;
    }
  }, [lines.length, selectedIndex]);
  /**
   * [2026-09-27追加・実装メモ.md 316章] ↻ボタン（`ZoomableDrawingCanvas.tsx`が描く）
   * から呼ばれる命令的API。`DrawingCanvasHandle`参照。
   *
   * [選択後に`lines`が外部要因で丸ごと変わった場合の保険] `rotateBaseRef`は
   * `DrawingCanvas`の内部にあり、「まんなかに おおきく」（`DrawingBoard.tsx`のみ）
   * ・「なおす」で別の絵を読み込む（`startEdit`）といった、このファイルの外で
   * 起きる`lines`全体の書き換えを知らない。基準（`base.basePoints`）が今の
   * `lines[index].p`と食い違っていたら、今の座標を新しい基準（角度0）として
   * 立て直してから回す（食い違ったまま回すと、外部の変更を巻き戻すような
   * 不自然な見た目——例えば拡大前の位置へ戻る——になってしまうため）。
   */
  useImperativeHandle(
    ref,
    () => ({
      rotateSelected: () => {
        const base = rotateBaseRef.current;
        if (base === null) return;
        const currentPoints = linesRef.current[base.index]?.p;
        if (currentPoints === undefined) {
          // 選択していた行そのものが無くなっている。選択ごと外す。
          rotateBaseRef.current = null;
          setSelectedIndex(null);
          return;
        }
        const baseMatchesCurrent =
          currentPoints.length === base.basePoints.length &&
          currentPoints.every((v, i) => v === base.basePoints[i]);
        const effectiveBase = baseMatchesCurrent
          ? base
          : { index: base.index, basePoints: currentPoints, angle: 0 };
        const nextAngle = (effectiveBase.angle + ROTATE_STEP_DEG) % 360;
        const rotated = rotateLinePoints(effectiveBase.basePoints, nextAngle);
        rotateBaseRef.current = { ...effectiveBase, angle: nextAngle };
        onLineMoveRef.current?.(effectiveBase.index, rotated);
      },
    }),
    []
  );
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
    // [2026-09-18変更・実装メモ245章] `size`を直接読まず`sizeRef.current`を読む
    // （上のsizeRef宣言のコメント参照）。この関数自体は毎レンダー作り直されるが、
    // 呼び出し元の`panResponder`はマウント時のバージョンを使い続けるため、
    // 関数の中身が「今の値をrefから読む」ようになっていないと意味がない。
    // 式自体はsrc/lib/drawingCanvasCoords.ts（node単体検証あり）へ切り出し済み。
    return normalizeDrawingPoint(px, py, sizeRef.current);
  };

  const finishStroke = () => {
    // [2026-09-27追加・実装メモ.md 315章]"move"は、ペン・形ツールのどちらとも
    // 別の経路で確定する。新しい線を作らず既存の`lines[index]`を書き換えるだけ
    // なので、`onStrokeEnd`ではなく`onLineMove`を呼ぶ。ツールごとの分岐の中で
    // 最初に判定する（下のPanResponder Grant/Moveでも同じ順で判定している）。
    if (toolRef.current === "move") {
      const grab = moveGrabRef.current;
      const finalPoints = moveCurrentPointsRef.current;
      moveGrabRef.current = null;
      moveCurrentPointsRef.current = null;
      setMovePreview(null);
      if (!grab || !finalPoints) return; // 何もつかめなかった＝何も起きない（依頼文どおり）。
      // [2026-09-27追加・実装メモ.md 316章] 動かした（moved）か、動かさずに離した
      // （タップ＝選ぶ）かで分岐する。
      const moved = finalPoints.some((v, i) => v !== grab.origPoints[i]);
      if (moved) {
        onLineMoveRef.current?.(grab.index, finalPoints);
        // [316章] 選択中の線をドラッグで動かした場合（Grantで選択を外していない＝
        // 同じ線をつかんだ場合のみここに来る）、回転の基準（rotateBaseRef）を
        // 動かした後の座標へ張り直す。動かす前の位置を基準にしたまま回すと、
        // 回転のたびに動かす前の位置へ引き戻って見えてしまうため。
        if (rotateBaseRef.current !== null && rotateBaseRef.current.index === grab.index) {
          rotateBaseRef.current = { index: grab.index, basePoints: finalPoints, angle: 0 };
        }
        return;
      }
      // [316章] つかんだが動かさなかった＝タップ。依頼文「軽くタップ（動かさずに
      // 離す）すると…選ばれた状態になる」のとおり、その線を選択状態にする。
      // 既に選択中の線を再度タップした場合（rotateBaseRefのindexが一致）は、
      // 積み上げてきた回転角度を無駄に0へ戻さないよう基準を張り直さない。
      setSelectedIndex(grab.index);
      if (rotateBaseRef.current === null || rotateBaseRef.current.index !== grab.index) {
        rotateBaseRef.current = {
          index: grab.index,
          basePoints: linesRef.current[grab.index]?.p ?? grab.origPoints,
          angle: 0,
        };
      }
      return;
    }
    // [2026-09-26追加・実装メモ.md 309章] 形ツールは、ペンとは別の経路で確定する。
    // `currentPointsRef`は形ツールのときは常に空のまま（下のPanResponder参照）
    // なので、こちらを先に判定する。
    // [2026-09-27変更・315章] 条件を`!== "pen"`から`isDrawingShapeTool(...)`へ
    // 変更した。"move"が増えたことで「pen以外」が「形」と同義でなくなったため。
    if (isDrawingShapeTool(toolRef.current)) {
      const start = shapeStartRef.current;
      const end = shapeEndRef.current;
      shapeStartRef.current = null;
      shapeEndRef.current = null;
      setLivePoints([]);
      if (!start || !end) return;
      // なぞらずタップのみ（始点=終点）はshapeToPolylineが空配列を返す。
      // DB側chk_family_drawings_line_data（33b章）と同じ「2要素未満は保存しない」
      // 基準で弾く（ペンの1点タップと同じ扱い）。
      const shapePoints = shapeToPolyline(toolRef.current, start[0], start[1], end[0], end[1]);
      if (shapePoints.length < 2) return;
      // [依頼文の指示どおり] simplifyPolyline（Douglas-Peucker型の間引き）は
      // 形には適用しない。角が崩れるため。
      // [2026-09-27追加・実装メモ.md 313章] 塗りが選ばれているときだけ`f: true`を足す。
      // `f: false`は書き込まない（`FamilyDrawingLine.f`のコメントと同じ最小化の考え方）。
      const line: FamilyDrawingLine = { c: colorRef.current, p: shapePoints, w: widthRef.current };
      if (filledRef.current) line.f = true;
      onStrokeEnd(line);
      return;
    }
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
      // [2026-09-27変更・実装メモ.md 315章]"move"は既存の線をつかむだけで新しい線を
      // 増やさないため、線数上限（`maxLines`）の判定を適用しない（線数上限ちょうどの
      // ときにだけ「うごかす」まで巻き添えで使えなくなる、という筋の違うブロックを
      // 避けるため）。呼び出し元が上限到達時に`disabled`ごと全体を無効化している
      // 既存の運用（`DrawingBoard.tsx`・`AvatarDrawingPanel.tsx`の`atCapacity`）は
      // そのまま効くため、実際の見た目・挙動はほぼ変わらない（`disabledRef.current`
      // の判定が先にあるため）。
      onStartShouldSetPanResponder: () =>
        !disabledRef.current &&
        (toolRef.current === "move" || linesCountRef.current < theme.drawingLimits.maxLines),
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
        // [2026-09-27変更・315章]"move"は線数上限を見ない（上のonStartShouldSetPanResponder
        // と同じ理由）ため、このブロックの中止条件からも同様に外す。
        if (disabledRef.current || (toolRef.current !== "move" && linesCountRef.current >= theme.drawingLimits.maxLines))
          return;
        const { locationX, locationY } = evt.nativeEvent;
        const [nx, ny] = toNormalized(locationX, locationY);
        // [2026-09-27追加・実装メモ.md 315章]"move"は、指を置いた点に一番近い線を
        // 探してつかむ（重なっていればあとから描いたもの優先、依頼文の決定）。
        // 純粋関数`findLineIndexAtPoint`（node単体検証あり）にすべての判定を委ね、
        // ここでは正規化座標・太さの単位変換だけを行う（ファイル冒頭コメント参照）。
        if (toolRef.current === "move") {
          const extraToleranceNormalized = (MOVE_HIT_EXTRA_TOLERANCE_PX / sizeRef.current) * 1000;
          const hitTestLines: HitTestLine[] = linesRef.current.map((l) => ({
            p: l.p,
            filled: l.f,
            halfWidth: ((l.w ?? theme.defaultDrawingStrokeWidth) / 2 / sizeRef.current) * 1000,
          }));
          const idx = findLineIndexAtPoint(hitTestLines, nx, ny, extraToleranceNormalized);
          if (idx === null) {
            // 何もつかめなかった＝何も起きない（つかむ操作としては、依頼文どおり）。
            moveGrabRef.current = null;
            moveCurrentPointsRef.current = null;
            setMovePreview(null);
            // [2026-09-27追加・316章、依頼文「何もないところをタップすると選択を外す」]
            // 何もない場所をつかんだ瞬間に、選択中の線があれば即座に外す。
            if (selectedIndexRef.current !== null) {
              setSelectedIndex(null);
              rotateBaseRef.current = null;
            }
          } else {
            const origPoints = linesRef.current[idx].p;
            moveGrabRef.current = { index: idx, startX: nx, startY: ny, lastX: nx, lastY: ny, origPoints };
            moveCurrentPointsRef.current = origPoints;
            setMovePreview({ index: idx, points: origPoints });
            // [2026-09-27追加・316章、依頼文「別の線をつかむと選択を外す」] 今選んで
            // いる線と違う線をつかんだら、つかんだ瞬間（ドラッグかタップかが
            // 決まる前）に前の選択を即座に外す。同じ線を再びつかんだ場合は、
            // 積み上げてきた回転の基準（rotateBaseRef）を保つため何もしない。
            if (selectedIndexRef.current !== null && selectedIndexRef.current !== idx) {
              setSelectedIndex(null);
              rotateBaseRef.current = null;
            }
          }
          return;
        }
        // [2026-09-26追加・実装メモ.md 309章] ツールごとに描きかけの持ち方が違う。
        // 形ツールは始点だけを記録し（`currentPointsRef`には触れない）、指を
        // まだ動かしていない段階では見せる形が無い（始点=終点はshapeToPolylineが
        // 空配列を返す）ため、livePointsは空のままにする。
        // [2026-09-27変更・315章] 条件を`!== "pen"`から`isDrawingShapeTool(...)`へ
        // 変更した（"move"は既に上のブロックでreturn済みのため、ここに来るのは
        // 「形」か「pen」のみ）。
        if (isDrawingShapeTool(toolRef.current)) {
          shapeStartRef.current = [nx, ny];
          shapeEndRef.current = [nx, ny];
          setLivePoints([]);
        } else {
          currentPointsRef.current = [nx, ny];
          setLivePoints([nx, ny]);
        }
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
          // [2026-09-26変更・実装メモ.md 309章] ペンの描きかけ（currentPointsRef）
          // だけでなく、形ツールの描きかけ（shapeStartRef/shapeEndRef）も同じく破棄する。
          if (currentPointsRef.current.length > 0 || shapeStartRef.current !== null) {
            currentPointsRef.current = [];
            shapeStartRef.current = null;
            shapeEndRef.current = null;
            setLivePoints([]);
          }
          // [2026-09-27追加・実装メモ.md 315章]"move"でつかみかけの線も同じく破棄する
          // （依頼文「指2本で絵を動かす既存の操作とぶつからないこと」。つかんだ線は
          // 元の位置のまま＝何も起きなかったことになる。`onLineMove`は呼ばれない）。
          if (moveGrabRef.current !== null) {
            moveGrabRef.current = null;
            moveCurrentPointsRef.current = null;
            setMovePreview(null);
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
        // [2026-09-27追加・実装メモ.md 315章]"move"は、つかんだ瞬間の点(startX,startY)
        // から今の指の位置までの移動量(dx,dy)で、つかんだ線の全ての点を平行移動した
        // ライブプレビューを都度作り直す（依頼文「座標の変換は、線を描くときと同じ
        // 計算を使う」＝`toNormalized`のみ使い、平行移動そのものは純粋関数
        // `translateLinePoints`に委ねる）。何もつかんでいなければ何もしない。
        if (toolRef.current === "move") {
          const grab = moveGrabRef.current;
          if (!grab) return;
          const { locationX, locationY } = evt.nativeEvent;
          const [nx, ny] = toNormalized(locationX, locationY);
          // ペン・形と同じ間引き判定（MIN_POINT_DISTANCE_PX）で再描画の頻度を抑える。
          // dx/dyは間引き前の「直近に反映した位置」ではなく、常に`startX/startY`
          // （つかんだ瞬間）からの累積移動量で計算する（間引きは再描画の頻度だけを
          // 抑えるためのもので、移動量の基準をずらさないため）。
          const thresholdNormalized = (MIN_POINT_DISTANCE_PX / sizeRef.current) * 1000;
          const ldx = nx - grab.lastX;
          const ldy = ny - grab.lastY;
          if (ldx * ldx + ldy * ldy < thresholdNormalized * thresholdNormalized) return;
          grab.lastX = nx;
          grab.lastY = ny;
          const translated = translateLinePoints(grab.origPoints, nx - grab.startX, ny - grab.startY);
          moveCurrentPointsRef.current = translated;
          setMovePreview({ index: grab.index, points: translated });
          return;
        }
        // [2026-09-26追加・実装メモ.md 309章] 形ツール（ペン以外）は、なぞった
        // 「今の指の位置」を終点として、始点との間の形を毎回組み直してライブ
        // プレビューする（依頼文「指を動かしている間は、形が伸び縮みして見える」）。
        // 途中の点は貯めない（`currentPointsRef`には一切触れない）。
        // [2026-09-27変更・315章] 条件を`!== "pen"`から`isDrawingShapeTool(...)`へ
        // 変更した（"move"は既に上のブロックでreturn済み）。
        if (isDrawingShapeTool(toolRef.current)) {
          const start = shapeStartRef.current;
          if (!start) return;
          const { locationX, locationY } = evt.nativeEvent;
          const [nx, ny] = toNormalized(locationX, locationY);
          // ペンのMIN_POINT_DISTANCE_PX間引きと同じ考え方: 直前の終点から
          // わずかしか動いていない移動イベントでは組み直さない（再描画の頻度を
          // ペンと同程度に抑える。1ドラッグでmoveイベントは多数発火するため）。
          const prevEnd = shapeEndRef.current;
          if (prevEnd) {
            const thresholdNormalized = (MIN_POINT_DISTANCE_PX / sizeRef.current) * 1000;
            const dx = nx - prevEnd[0];
            const dy = ny - prevEnd[1];
            if (dx * dx + dy * dy < thresholdNormalized * thresholdNormalized) return;
          }
          shapeEndRef.current = [nx, ny];
          setLivePoints(shapeToPolyline(toolRef.current, start[0], start[1], nx, ny));
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
        // [2026-09-18変更・実装メモ245章] ここも`size`ではなく`sizeRef.current`を使う
        // （上のtoNormalized・sizeRef宣言のコメントと同じ理由）。
        const thresholdNormalized = (MIN_POINT_DISTANCE_PX / sizeRef.current) * 1000;
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
          // [2026-09-27追加・実装メモ.md 315章]✋でつかんでいる最中の線は、ここでは
          // 描かない（下の`movePreview`で、動かした後の位置に描き直す）。同時に
          // 両方描くと「元の位置」と「動かしている最中の位置」が二重に見えてしまうため。
          if (movePreview && movePreview.index === idx) return null;
          const displayStrokeWidth = line.w ?? theme.defaultDrawingStrokeWidth;
          // [2026-09-11追加・要件定義書07-27章決定18] 白い線のふち取りは、背景色が
          // 既定（白）以外のときだけ付ける（既存の家族の絵の見た目は変えない）。
          const needsWhiteOutline = isCustomBackground && line.c === "#FFFFFF";
          return (
            <DrawingLineShape
              key={idx}
              color={line.c}
              points={pointsToPolylineString(line.p, size)}
              // [2026-09-05変更] `line.w`（無ければ決定25のとおり4=ふつうへフォールバック）
              // を使う。以前は固定4pt。
              strokeWidth={displayStrokeWidth}
              filled={line.f}
              needsWhiteOutline={needsWhiteOutline}
              // [2026-09-27追加・実装メモ.md 316章]✋で「選択中」の線は、つかんで
              // ドラッグ中の`movePreview`と同じ薄い影（`highlighted`）を、指を
              // 離した後も選択が続く間ずっと表示する（依頼文「選ばれている間は…
              // 見た目を続ける」。315章の`highlighted`スタイルをそのまま流用）。
              highlighted={selectedIndex === idx}
            />
          );
        })}
        {livePoints.length >= 2 && (
          <DrawingLineShape
            color={color}
            points={pointsToPolylineString(livePoints, size)}
            // [2026-09-05変更] 描画中のライブプレビューも選択中の太さを反映する。
            strokeWidth={strokeWidth}
            // [2026-09-27追加・実装メモ.md 313章] ペン選択中は`filled`propの値に
            // 関わらず塗らない（`tool`が形のときだけ塗りを反映する）。
            filled={tool !== "pen" && filled}
            needsWhiteOutline={isCustomBackground && color === "#FFFFFF"}
          />
        )}
        {/* [2026-09-27追加・実装メモ.md 315章]✋でつかんでいる線を、動かした後の
            位置に描き直す。元の`lines[index]`の色・太さ・塗りをそのまま使い、
            `highlighted`だけ足して「つかんでいる」ことが分かる薄い影を付ける
            （依頼文「つかんだことが分かる見た目」）。他の線より必ず上（最後）に
            描くことで、ドラッグ中は常に一番手前に見える。 */}
        {movePreview &&
          (() => {
            const origLine = lines[movePreview.index];
            if (!origLine) return null;
            const displayStrokeWidth = origLine.w ?? theme.defaultDrawingStrokeWidth;
            const needsWhiteOutline = isCustomBackground && origLine.c === "#FFFFFF";
            return (
              <DrawingLineShape
                color={origLine.c}
                points={pointsToPolylineString(movePreview.points, size)}
                strokeWidth={displayStrokeWidth}
                filled={origLine.f}
                needsWhiteOutline={needsWhiteOutline}
                highlighted
              />
            );
          })()}
      </Svg>
      {/* [2026-09-27追加・実装メモ.md 316章] 回転専用ボタン（↻）はここでは描かない。
          `ZoomableDrawingCanvas.tsx`が`onSelectionChange`・`ref`（`rotateSelected`）
          経由でこのファイルの外に描く（ファイル冒頭316章コメント参照）。 */}
    </View>
  );
});

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
            <DrawingLineShape
              key={idx}
              color={line.c}
              points={pointsToPolylineString(line.p, size)}
              strokeWidth={displayStrokeWidth}
              filled={line.f}
              needsWhiteOutline={needsWhiteOutline}
            />
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
