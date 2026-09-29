/**
 * avatarStock.ts の検証スクリプト（実装メモ.md 334章、要件定義書07-44章、
 * 主要画面ワイヤーフレーム.md 69章）。
 *
 *   node src/lib/avatarStock.verify.ts
 *
 * 確かめること: 保存を止める条件（決定13の4つがすべて）・「色にもどす」を止める条件（決定16）・
 * まえのアバターの欄を出す条件（決定4）・戻したあとにキャンバスを差し替える条件（決定7）・
 * 保存の結果`result`ごとの「残ったよ」の出し分け（決定11）・一覧が変わったあとの選択の保ち方。
 */
import {
  buildStockSlots,
  isAvatarResetBlocked,
  isAvatarSaveBlocked,
  isCanvasSameAsSaved,
  jsonEqual,
  keepSelectedStockId,
  savedResultLeftPreviousInStock,
  shouldNoteDraftKept,
  shouldReplaceCanvasAfterRestore,
  shouldShowStockSection,
} from "./avatarStock.ts";

let failed = 0;

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`OK   ${label}`);
  } else {
    failed += 1;
    console.log(`NG   ${label}`);
    console.log(`     期待値: ${JSON.stringify(expected)}`);
    console.log(`     実際値: ${JSON.stringify(actual)}`);
  }
}

const MAX = 3; // theme.avatarStock.maxSlots（DBのmax_avatar_stock_per_member()と同じ値）

const lineA = { c: "#2E2E2E", p: [100, 100, 200, 200] };
const lineB = { c: "#EF4444", p: [300, 300, 400, 400], w: 7 };
const saved = { v: 1 as const, lines: [lineA] };

// ---- 1. jsonEqual（JSONBの=と同じ。キーの順序は無視する） ----
assertEqual("jsonEqual: キーの順序が違っても同じ", jsonEqual({ c: "#2E2E2E", p: [1, 2] }, { p: [1, 2], c: "#2E2E2E" }), true);
assertEqual("jsonEqual: 配列の順序は区別する", jsonEqual([1, 2], [2, 1]), false);
assertEqual("jsonEqual: 値が違えば別", jsonEqual({ a: 1 }, { a: 2 }), false);
assertEqual("jsonEqual: キーの数が違えば別（w有り／無し）", jsonEqual({ c: "x", p: [1] }, { c: "x", p: [1], w: 4 }), false);
assertEqual("jsonEqual: nullと{}は別", jsonEqual(null, {}), false);
assertEqual("jsonEqual: 配列とオブジェクトは別", jsonEqual([], {}), false);

// ---- 2. isCanvasSameAsSaved（決定11・13(d)。サーバーのunchanged判定と同じ考え方） ----
assertEqual("同じ絵（読み込んだまま）", isCanvasSameAsSaved([lineA], saved), true);
assertEqual("線を1本足した", isCanvasSameAsSaved([lineA, lineB], saved), false);
assertEqual("線を消した（空）", isCanvasSameAsSaved([], saved), false);
assertEqual("今の絵が無い（null）ときは常にfalse", isCanvasSameAsSaved([lineA], null), false);
assertEqual("キーの順序が違うだけの同じ絵", isCanvasSameAsSaved([{ p: [100, 100, 200, 200], c: "#2E2E2E" }], saved), true);

// ---- 3. isAvatarSaveBlocked（決定13。4つがすべて当てはまるときだけ止める） ----
const base = { stockCount: 3, maxSlots: MAX, hasSavedAvatar: true, lineCount: 2, sameAsSaved: false };
assertEqual("3枚・今の絵あり・線あり・違う絵 → 止める", isAvatarSaveBlocked(base), true);
assertEqual("2枚（空きあり）→ 止めない", isAvatarSaveBlocked({ ...base, stockCount: 2 }), false);
assertEqual("0枚 → 止めない", isAvatarSaveBlocked({ ...base, stockCount: 0 }), false);
assertEqual("3枚でも今の絵が無い（色＋頭文字だけ）→ 止めない（created）", isAvatarSaveBlocked({ ...base, hasSavedAvatar: false }), false);
assertEqual("3枚でもキャンバスが空 → 止めない（そもそも保存できない）", isAvatarSaveBlocked({ ...base, lineCount: 0 }), false);
assertEqual("3枚でも今の絵と同じ（触っていない）→ 止めない（unchanged）", isAvatarSaveBlocked({ ...base, sameAsSaved: true }), false);
assertEqual("一覧を読めていない（null）→ 止めない（DBが最終防衛線）", isAvatarSaveBlocked({ ...base, stockCount: null }), false);
assertEqual("上限を超えて見えても止める（4枚）", isAvatarSaveBlocked({ ...base, stockCount: 4 }), true);

// ---- 4. isAvatarResetBlocked（決定16） ----
assertEqual("3枚・今の絵あり → 色にもどすを止める", isAvatarResetBlocked({ stockCount: 3, maxSlots: MAX, hasSavedAvatar: true }), true);
assertEqual("2枚・今の絵あり → 止めない", isAvatarResetBlocked({ stockCount: 2, maxSlots: MAX, hasSavedAvatar: true }), false);
assertEqual("3枚でも今の絵が無い → 止めない（リンク自体が出ない）", isAvatarResetBlocked({ stockCount: 3, maxSlots: MAX, hasSavedAvatar: false }), false);
assertEqual("一覧を読めていない → 止めない", isAvatarResetBlocked({ stockCount: null, maxSlots: MAX, hasSavedAvatar: true }), false);

// ---- 5. shouldShowStockSection（決定4） ----
assertEqual("一度も保存していない・0枚・読めた → 出さない", shouldShowStockSection({ hasSavedAvatar: false, stockCount: 0, status: "ready" }), false);
assertEqual("今の絵あり・0枚 → 出す（点線の枠3つ＋予告）", shouldShowStockSection({ hasSavedAvatar: true, stockCount: 0, status: "ready" }), true);
assertEqual("色にもどしたあと（今の絵なし・1枚以上）→ 出す", shouldShowStockSection({ hasSavedAvatar: false, stockCount: 1, status: "ready" }), true);
assertEqual("読み込み中・今の絵あり → 出す（グレーの枠）", shouldShowStockSection({ hasSavedAvatar: true, stockCount: 0, status: "loading" }), true);
assertEqual("読み込み中・今の絵なし → 出さない", shouldShowStockSection({ hasSavedAvatar: false, stockCount: 0, status: "loading" }), false);
assertEqual("読み込み失敗・今の絵あり → 出す（失敗文言と「もういちど」）", shouldShowStockSection({ hasSavedAvatar: true, stockCount: 0, status: "error" }), true);
assertEqual("読み込み失敗・今の絵なし → 出さない", shouldShowStockSection({ hasSavedAvatar: false, stockCount: 0, status: "error" }), false);

// ---- 6. buildStockSlots（3つの枠。左が新しい・空き枠はnull） ----
const s1 = { id: "s1", member_id: "m", line_data: saved, stocked_at: "2026-09-30T10:00:00Z" };
const s2 = { id: "s2", member_id: "m", line_data: saved, stocked_at: "2026-09-30T09:00:00Z" };
const s3 = { id: "s3", member_id: "m", line_data: saved, stocked_at: "2026-09-30T08:00:00Z" };
const s4 = { id: "s4", member_id: "m", line_data: saved, stocked_at: "2026-09-30T07:00:00Z" };
assertEqual("0枚 → 空き3つ", buildStockSlots([], MAX).map((x) => x?.id ?? null), [null, null, null]);
assertEqual("1枚 → 先頭に入り残りは空き", buildStockSlots([s1], MAX).map((x) => x?.id ?? null), ["s1", null, null]);
assertEqual("3枚 → そのまま（左が新しい）", buildStockSlots([s1, s2, s3], MAX).map((x) => x?.id ?? null), ["s1", "s2", "s3"]);
assertEqual("4枚見えても枠の数（3）で打ち切る", buildStockSlots([s1, s2, s3, s4], MAX).map((x) => x?.id ?? null), ["s1", "s2", "s3"]);

// ---- 7. shouldReplaceCanvasAfterRestore（決定7。描きかけは絶対に消さない） ----
assertEqual("開いたまま触っていない → 戻した絵に差し替える", shouldReplaceCanvasAfterRestore([lineA], saved), true);
assertEqual("描き足した → 触らない", shouldReplaceCanvasAfterRestore([lineA, lineB], saved), false);
assertEqual("空（保存直後・ぜんぶけす後）→ 触らない", shouldReplaceCanvasAfterRestore([], saved), false);
assertEqual("今の絵が無く、何か描いている → 触らない", shouldReplaceCanvasAfterRestore([lineB], null), false);
assertEqual("今の絵が無く、キャンバスも空 → 触らない", shouldReplaceCanvasAfterRestore([], null), false);

// ---- 8. shouldNoteDraftKept ----
assertEqual("線があって差し替えなかった → 一文を出す", shouldNoteDraftKept([lineA, lineB], false), true);
assertEqual("差し替えた → 出さない", shouldNoteDraftKept([lineA], true), false);
assertEqual("空のキャンバス → 残るものが無いので出さない", shouldNoteDraftKept([], false), false);

// ---- 9. savedResultLeftPreviousInStock（決定11。stockedのときだけ「残ったよ」） ----
assertEqual("stocked → 出す", savedResultLeftPreviousInStock("stocked"), true);
assertEqual("created（初めて描いた）→ 出さない", savedResultLeftPreviousInStock("created"), false);
assertEqual("unchanged（同じ絵）→ 出さない", savedResultLeftPreviousInStock("unchanged"), false);

// ---- 10. keepSelectedStockId（一覧が変わったあとの選択） ----
assertEqual("選択なし → null", keepSelectedStockId(null, [s1, s2]), null);
assertEqual("選んだ絵がまだある → そのまま", keepSelectedStockId("s2", [s1, s2]), "s2");
assertEqual("入れ替えでidが変わって無くなった → null（プレビューを閉じる）", keepSelectedStockId("s2", [s1, s3]), null);
assertEqual("一覧が空になった → null", keepSelectedStockId("s1", []), null);

if (failed > 0) {
  console.log(`\n${failed}件 NG`);
  process.exit(1);
}
console.log("\n全件OK");
