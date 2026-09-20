/**
 * hiddenContentFilter.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md（本部長依頼2026-09-21「ブロックとNGワード
 * フィルタの画面を実装」章）。src/lib/blockFilter.verify.ts の前例に倣う。
 *
 *   node src/lib/hiddenContentFilter.verify.ts
 */
import {
  hiddenContentKey,
  excludeHiddenById,
  excludeHiddenChoreReactionComments,
  blankHiddenNoteById,
  stripHiddenTreeDotPrizes,
} from "./hiddenContentFilter.ts";

let failed = 0;

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`OK   ${label}`);
  } else {
    failed += 1;
    console.log(`NG   ${label}`);
    console.log(`     期待値: ${e}`);
    console.log(`     実際値: ${a}`);
  }
}

// ---- hiddenContentKey ----
assertEqual("hiddenContentKey: kind:idの形にする", hiddenContentKey("family_board_post", "abc"), "family_board_post:abc");

// ---- excludeHiddenById（掲示板の投稿・公開済みのお絵かき） ----
{
  const posts = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const hidden = new Set([hiddenContentKey("family_board_post", "2")]);
  const result = excludeHiddenById(posts, "family_board_post", hidden);
  assertEqual("excludeHiddenById: 非表示にされた行がカードごと除かれる", result.map((r) => r.id), ["1", "3"]);

  const noneHidden = excludeHiddenById(posts, "family_board_post", new Set());
  assertEqual("excludeHiddenById: 非表示が0件なら全件そのまま返す", noneHidden.length, 3);
}

// ---- excludeHiddenChoreReactionComments（完了報告へのコメント。スタンプは対象外） ----
{
  const reactions = [
    { id: "1", kind: "comment" },
    { id: "2", kind: "stamp" }, // スタンプは対象外（残る。idが一致していても除かない）
    { id: "3", kind: "comment" },
  ];
  const hidden = new Set([
    hiddenContentKey("chore_reaction_comment", "1"),
    hiddenContentKey("chore_reaction_comment", "2"),
  ]);
  const result = excludeHiddenChoreReactionComments(reactions, hidden);
  assertEqual(
    "excludeHiddenChoreReactionComments: 非表示にされたコメントのみ除く。スタンプは残す",
    result.map((r) => r.id),
    ["2", "3"]
  );
}

// ---- blankHiddenNoteById（完了報告のひとこと・感謝のひとこと。noteだけ空にする） ----
{
  const completions = [
    { id: "1", note: "たのしかった" },
    { id: "2", note: "がんばった" },
  ];
  const hidden = new Set([hiddenContentKey("chore_completion_note", "1")]);
  const result = blankHiddenNoteById(completions, "chore_completion_note", hidden);
  assertEqual("blankHiddenNoteById: 非表示にされた行のnoteはnullになる", result[0].note, null);
  assertEqual("blankHiddenNoteById: 非表示にされても行自体は残る（消えない）", result.length, 2);
  assertEqual("blankHiddenNoteById: 対象でない行のnoteはそのまま", result[1].note, "がんばった");
}

// ---- stripHiddenTreeDotPrizes（家族の木の飾り。絵が運営に非表示ならprizeごと除く） ----
{
  const dots = [
    { id: "1", prize: { drawing: { drawingId: "d1" } } },
    { id: "2", prize: { drawing: { drawingId: "d2" } } },
    { id: "3", prize: { drawing: null } }, // 既製の飾り（絵ではない）
    { id: "4", prize: null }, // 未飾りの色丸
  ];
  const hidden = new Set([hiddenContentKey("family_drawing", "d1")]);
  const result = stripHiddenTreeDotPrizes(dots, hidden);
  assertEqual(
    "stripHiddenTreeDotPrizes: 非表示の絵はprizeごとnullになる。色丸自体は残る",
    result.map((d) => ({ id: d.id, prize: d.prize })),
    [
      { id: "1", prize: null },
      { id: "2", prize: { drawing: { drawingId: "d2" } } },
      { id: "3", prize: { drawing: null } },
      { id: "4", prize: null },
    ]
  );
  assertEqual("stripHiddenTreeDotPrizes: 色丸の件数自体は変わらない（消えない）", result.length, 4);

  const noneHidden = stripHiddenTreeDotPrizes(dots, new Set());
  assertEqual("stripHiddenTreeDotPrizes: 非表示が0件なら全件そのまま返す", noneHidden[0].prize !== null, true);
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
