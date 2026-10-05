import {
  clearPendingSupporterInvite,
  getPendingSupporterInvite,
  setPendingSupporterInvite,
} from "./pendingSupporterInvite";

let ng = 0;
const check = (name: string, got: unknown, want: unknown) => {
  if (got !== want) {
    ng++;
    console.log("NG", name, "→", got, "期待", want);
  }
};
const T = "b22845f7-675b-428a-be90-3c847c2ab9e9";
const t0 = 1_000_000;
check("最初は無い", getPendingSupporterInvite(t0), null);
setPendingSupporterInvite(T, t0);
check("覚えている", getPendingSupporterInvite(t0 + 1000), T);
check("読んでも消えない", getPendingSupporterInvite(t0 + 2000), T);
check("10分ちょうどはまだ有効", getPendingSupporterInvite(t0 + 10 * 60 * 1000), T);
check("10分を過ぎたら捨てる", getPendingSupporterInvite(t0 + 10 * 60 * 1000 + 1), null);
check("捨てたあとも無い", getPendingSupporterInvite(t0 + 1), null);
setPendingSupporterInvite(T, t0);
clearPendingSupporterInvite();
check("clearで消える", getPendingSupporterInvite(t0 + 1), null);
console.log(ng === 0 ? "全部OK（7件）" : `NG ${ng}件`);
if (ng) process.exit(1);
