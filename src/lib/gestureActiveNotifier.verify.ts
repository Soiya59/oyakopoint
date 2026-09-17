/**
 * gestureActiveNotifier.ts の単体検証。
 * Node.js単体実行で動かす（`node src/lib/gestureActiveNotifier.verify.ts`、
 * drawingZoomPan.verify.ts と同じ方式）。
 * 参照: 開発部/成果物/実装メモ.md 243章。
 *
 * このファイルはNode単体実行専用のためtsconfig.jsonの`exclude`
 * （`**\/*.verify.ts`）でtscの型チェック対象から外している。
 */
import { nextGestureActiveState } from "./gestureActiveNotifier.ts";

let failCount = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "OK  " : "NG  "} ${label}`);
  if (!ok) failCount++;
}

// 1. 指が触れた瞬間（Grant）: false→trueは通知すべき。
{
  const r = nextGestureActiveState(false, true);
  check("false→trueはshouldNotify=true", r.shouldNotify === true);
  check("false→trueのactiveはtrue", r.active === true);
}

// 2. 全部の指が離れた瞬間（Release/Terminate）: true→falseは通知すべき。
{
  const r = nextGestureActiveState(true, false);
  check("true→falseはshouldNotify=true", r.shouldNotify === true);
  check("true→falseのactiveはfalse", r.active === false);
}

// 3. 2本指ドラッグ中に同じtrueが繰り返し要求されても二重通知しない
//    （onPanResponderMoveのtouches>=2分岐が毎フレーム呼ばれても、Grantで
//    すでにtrue化済みなら不要な再通知をしないことの確認）。
{
  const r = nextGestureActiveState(true, true);
  check("true→trueはshouldNotify=false（二重通知しない）", r.shouldNotify === false);
  check("true→trueのactiveは直前の値のまま(true)", r.active === true);
}

// 4. アンマウント時のクリーンアップで、一度もtrueになっていない
//    （previousActive=false）のにfalseを要求しても、無駄な通知をしない
//    （234.5節の申し送り「アンマウント時も戻す」の実装が、副作用の無い
//    ケースで余計なコールバックを呼ばないことの確認）。
{
  const r = nextGestureActiveState(false, false);
  check("false→falseはshouldNotify=false（無駄な通知をしない）", r.shouldNotify === false);
  check("false→falseのactiveは直前の値のまま(false)", r.active === false);
}

// 5. 「途中で終わっても・アンマウント時も必ずtrueに戻る」の一連の流れを模擬する。
//    Grant→（2本指へ切り替え、trueが繰り返し要求される）→Terminate（強制終了）の順で
//    最終的にfalseへ戻ることを確認する。
{
  let active = false;
  const notified: boolean[] = [];
  const events: boolean[] = [true, true, true, false]; // Grant, move2, move2, Terminate
  for (const requested of events) {
    const r = nextGestureActiveState(active, requested);
    active = r.active;
    if (r.shouldNotify) notified.push(r.active);
  }
  check(
    "Grant→2本指move×2→Terminateの一連で、通知は[true, false]の2回だけ",
    notified.length === 2 && notified[0] === true && notified[1] === false
  );
  check("一連の最後はfalse（画面のスクロールが必ず戻る）", active === false);
}

console.log("");
if (failCount === 0) {
  console.log("全件OK");
} else {
  console.log(`${failCount}件NG`);
  process.exitCode = 1;
}
