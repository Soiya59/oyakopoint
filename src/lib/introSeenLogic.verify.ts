/**
 * introSeenLogic.ts の単体検証（`node src/lib/introSeenLogic.verify.ts`、
 * drawingCanvasCoords.verify.ts と同じ流儀）。
 * 参照: 開発部/成果物/実装メモ.md 247章「アプリ内の案内を手厚くする」。
 *
 * 確認する2点（依頼文どおり）:
 * 1. 一度×を押したら（＝markSeen相当）二度と出ない
 * 2. メンバーが変われば別々に記録される（一方を閉じても、もう一方には出る）
 *
 * このファイルはNode単体実行専用のためtsconfig.jsonの`exclude`
 * （`**\/*.verify.ts`）でtscの型チェック対象から外している。
 */
import {
  applyHydration,
  applyMarkSeen,
  buildIntroSeenKey,
  computeIsSeen,
  createIntroSeenState,
} from "./introSeenLogic.ts";

let failCount = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "OK  " : "NG  "} ${label}`);
  if (!ok) failCount++;
}

// 1. キーの組み立て（buildIntroSeenKey）。
{
  check(
    "タブ案内のキーはkind・tabKey・memberIdを含む",
    buildIntroSeenKey({ kind: "tab", tabKey: "parent.family" }, "member-1") ===
      "oyakopoint.introSeen.tab.parent.family.member-1"
  );
  check(
    "規約直後ステップのキーはmemberIdのみで変わる",
    buildIntroSeenKey({ kind: "postConsentGuide" }, "member-1") ===
      "oyakopoint.introSeen.postConsentGuide.member-1"
  );
  check(
    "タブが違えば同じmemberIdでもキーが異なる",
    buildIntroSeenKey({ kind: "tab", tabKey: "parent.family" }, "member-1") !==
      buildIntroSeenKey({ kind: "tab", tabKey: "parent.self" }, "member-1")
  );
}

// 2. 読み込み未完了（hydrate前）は「見た」扱い（＝表示しない、フリッカー防止）。
{
  const state = createIntroSeenState();
  const key = buildIntroSeenKey({ kind: "tab", tabKey: "child.home" }, "child-1");
  check("hydrate前は見た扱い（表示しない）", computeIsSeen(state, key) === true);
}

// 3. hydrate後、保存記録が無ければ「まだ見ていない」（＝表示する）。
{
  const state = createIntroSeenState();
  const key = buildIntroSeenKey({ kind: "tab", tabKey: "child.home" }, "child-1");
  applyHydration(state, key, null); // AsyncStorage.getItemがnullを返した想定
  check("hydrate後・記録なしは未読扱い（表示する）", computeIsSeen(state, key) === false);
}

// 4. hydrate後、保存記録が"1"なら「見た」（＝表示しない）。
{
  const state = createIntroSeenState();
  const key = buildIntroSeenKey({ kind: "tab", tabKey: "child.home" }, "child-1");
  applyHydration(state, key, "1");
  check('hydrate後・記録"1"は既読扱い（表示しない）', computeIsSeen(state, key) === true);
}

// 5. [本題1] 一度×を押したら（markSeen）、以後は二度と出ない。
{
  const state = createIntroSeenState();
  const key = buildIntroSeenKey({ kind: "tab", tabKey: "parent.tree" }, "member-1");
  applyHydration(state, key, null); // 起動直後、まだ記録が無い＝未読
  check("×を押す前は未読（表示する）", computeIsSeen(state, key) === false);
  applyMarkSeen(state, key); // ×を押した
  check("×を押した直後は既読（表示しない）", computeIsSeen(state, key) === true);
  // 「二度と出ない」＝以後何度呼んでも既読のまま（アプリを開き直した想定で
  // 新しいstateにhydrateし直しても、保存値が"1"なら既読のまま戻ることを別途4番で確認済み）。
  applyMarkSeen(state, key);
  check("重ねて呼んでも既読のまま", computeIsSeen(state, key) === true);
}

// 6. [本題2] メンバーが変われば別々に記録される。
{
  const state = createIntroSeenState();
  const keyA = buildIntroSeenKey({ kind: "tab", tabKey: "child.self" }, "child-A");
  const keyB = buildIntroSeenKey({ kind: "tab", tabKey: "child.self" }, "child-B");
  applyHydration(state, keyA, null);
  applyHydration(state, keyB, null);
  applyMarkSeen(state, keyA); // きょうだいAが×を押した
  check("×を押した本人（A）は既読", computeIsSeen(state, keyA) === true);
  check("×を押していないきょうだい（B）には引き続き出る", computeIsSeen(state, keyB) === false);
}

// 7. 規約直後の「読んだ」ステップも、タブ案内と独立して記録される
//    （同じmemberIdでもkindが違えば別キー）。
{
  const state = createIntroSeenState();
  const memberId = "member-1";
  const tabKey = buildIntroSeenKey({ kind: "tab", tabKey: "parent.family" }, memberId);
  const guideKey = buildIntroSeenKey({ kind: "postConsentGuide" }, memberId);
  applyHydration(state, tabKey, null);
  applyHydration(state, guideKey, null);
  applyMarkSeen(state, guideKey); // 「読んだ」を押した
  check("「読んだ」を押しても、同じ人のタブ案内は別記録のまま未読", computeIsSeen(state, tabKey) === false);
  check("「読んだ」ステップ自体は既読", computeIsSeen(state, guideKey) === true);
}

console.log("");
if (failCount === 0) {
  console.log("全件OK");
} else {
  console.log(`${failCount}件NG`);
  process.exitCode = 1;
}
