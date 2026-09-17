/**
 * [2026-09-17追加・実装メモ243章、やること.md 4-41続き]
 * `DrawingCanvas.tsx`が「指がキャンバスに触れているか」を上位（`Screen.tsx`の
 * `scrollEnabled`）へ伝えるときの、二重通知を防ぐための純粋関数。
 *
 * PanResponderの`onPanResponderGrant`（指が触れた）・`onPanResponderRelease`／
 * `onPanResponderTerminate`（全部の指が離れた／責任者を失った）・アンマウント時の
 * クリーンアップ、どこから呼んでも同じルールで判定できるように、ref更新や
 * コールバック呼び出しといった副作用から切り離してある
 * （`drawingZoomPan.ts`・`fitDrawingToCircle.ts`と同じ方針）。
 *
 * ルール:
 * - 直前の状態と要求された状態が同じなら何もしない（`shouldNotify: false`）。
 *   例: 2本指ドラッグ中に指を1本ずつ離しても、まだ1本残っていれば
 *   `onPanResponderRelease`自体が呼ばれないため実際には関与しないが、
 *   念のため「trueをtrueで要求」しても二重通知しないことを保証する。
 * - 違うときだけ、新しい状態を返し「通知すべき」と伝える。
 *   アンマウント時のクリーンアップで「一度もtrueになっていない
 *   （＝previousActive=false）のにfalseを要求する」ケースでも、この関数が
 *   `shouldNotify: false`を返すため、呼び出し元は無駄な通知をしないで済む。
 */
export function nextGestureActiveState(
  previousActive: boolean,
  requestedActive: boolean
): { active: boolean; shouldNotify: boolean } {
  if (previousActive === requestedActive) {
    return { active: previousActive, shouldNotify: false };
  }
  return { active: requestedActive, shouldNotify: true };
}
