/**
 * blockFilter.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md（本部長依頼2026-09-20「ブロックとNGワード
 * フィルタを実装」章）。src/lib/groupDuplicateRows.verify.ts の前例に倣う。
 *
 *   node src/lib/blockFilter.verify.ts
 */
import { excludeBlockedByAuthor, excludeBlockedChoreReactionComments, blankBlockedGratitudeNotes } from "./blockFilter.ts";

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

// ---- excludeBlockedByAuthor（掲示板の投稿・公開済みのお絵かき） ----
{
  const posts = [
    { id: "1", author_member_id: "grandma" },
    { id: "2", author_member_id: "child-a" },
    { id: "3", author_member_id: "grandma" },
  ];
  const blocked = new Set(["grandma"]);
  const result = excludeBlockedByAuthor(posts, (p) => p.author_member_id, blocked);
  assertEqual("excludeBlockedByAuthor: ブロック対象の投稿がカードごと除かれる", result.map((r) => r.id), ["2"]);

  const noneBlocked = excludeBlockedByAuthor(posts, (p) => p.author_member_id, new Set());
  assertEqual("excludeBlockedByAuthor: ブロックが0件なら全件そのまま返す", noneBlocked.length, 3);
}

// ---- excludeBlockedChoreReactionComments（完了報告へのコメント。スタンプは対象外） ----
{
  const reactions = [
    { id: "1", kind: "comment", reacted_by: "grandma" },
    { id: "2", kind: "stamp", reacted_by: "grandma" }, // スタンプは対象外（残る）
    { id: "3", kind: "comment", reacted_by: "child-a" },
  ];
  const blocked = new Set(["grandma"]);
  const result = excludeBlockedChoreReactionComments(reactions, blocked);
  assertEqual(
    "excludeBlockedChoreReactionComments: ブロック対象のコメントのみ除く。同じ相手のスタンプは残す",
    result.map((r) => r.id),
    ["2", "3"]
  );
}

// ---- blankBlockedGratitudeNotes（感謝のひとこと。noteだけ空にする。ポイントは動かさない） ----
{
  const gratitude = [
    { id: "1", sender_id: "grandma", points: 10, note: "がんばったね" },
    { id: "2", sender_id: "child-a", points: 5, note: "ありがとう" },
  ];
  const blocked = new Set(["grandma"]);
  const result = blankBlockedGratitudeNotes(gratitude, blocked);
  assertEqual("blankBlockedGratitudeNotes: ブロック対象のnoteはnullになる", result[0].note, null);
  assertEqual("blankBlockedGratitudeNotes: ブロック対象でも行自体は残る（消えない）", result.length, 2);
  assertEqual("blankBlockedGratitudeNotes: ブロック対象でもpointsは変わらない（相手は損をしない）", result[0].points, 10);
  assertEqual("blankBlockedGratitudeNotes: ブロック対象でない相手のnoteはそのまま", result[1].note, "ありがとう");
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
