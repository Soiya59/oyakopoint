/**
 * commentReply.ts・commentReplyText.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md 364章、要件定義書07-48章、設計部/成果物/API仕様.md 42.4・42.5節、
 * UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 74章。
 *
 *   node src/lib/commentReply.verify.ts
 *
 * 対象本体は値のimportを持たない（型のimportのみ）ため、Node単体で読み込める。
 */
import {
  canShowReplyEntry,
  groupRepliesByParent,
  isReactionForMyReportBell,
  isReplyRow,
  isWithinReplyCancelWindow,
  replyArrivalsFor,
  replyExcerpt,
  type ReplyReactionLike,
} from "./commentReply.ts";
import {
  bellReplySubject,
  ownReplyLineText,
  replyCounterText,
  replyEntryAccessibility,
  replyLineAccessibility,
  replyLineText,
} from "./commentReplyText.ts";

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

let seq = 0;
function row(p: Partial<ReplyReactionLike> & { id: string }): ReplyReactionLike {
  seq += 1;
  return {
    completion_id: "X",
    reacted_by: "M",
    kind: "comment",
    comment_body: "本文",
    created_at: `2026-10-13T00:0${seq}:00Z`,
    reply_to_reaction_id: null,
    ...p,
  };
}

const REPORTER = "child1"; // 完了報告の報告者
const PARENT_USER = "parent1";
const SIBLING = "child2";

// ---- isReplyRow ----
assertEqual("isReplyRow: 返信先を持つコメントは返信", isReplyRow(row({ id: "r", reply_to_reaction_id: "k" })), true);
assertEqual("isReplyRow: 返信先の無いコメントは返信でない", isReplyRow(row({ id: "k" })), false);
assertEqual("isReplyRow: スタンプは返信でない", isReplyRow(row({ id: "s", kind: "stamp" })), false);

// ---- groupRepliesByParent ----
{
  const stamp = row({ id: "s1", kind: "stamp", reacted_by: PARENT_USER, comment_body: null });
  const k1 = row({ id: "k1", reacted_by: PARENT_USER });
  const k2 = row({ id: "k2", reacted_by: SIBLING });
  const r1 = row({ id: "r1", reacted_by: REPORTER, reply_to_reaction_id: "k1" });
  const orphan = row({ id: "r9", reacted_by: REPORTER, reply_to_reaction_id: "gone" }); // 親が一覧に無い
  const toStamp = row({ id: "r8", reacted_by: REPORTER, reply_to_reaction_id: "s1" }); // 親がスタンプ
  const replyToReply = row({ id: "r7", reacted_by: REPORTER, reply_to_reaction_id: "r1" }); // 返信への返信
  const g = groupRepliesByParent([stamp, k1, r1, k2, orphan, toStamp, replyToReply]);
  assertEqual("groupRepliesByParent: 返信でない行が元の順で並ぶ", g.rows.map((r) => r.id), ["s1", "k1", "k2"]);
  assertEqual("groupRepliesByParent: 返信は親ごとにまとまる", [...g.repliesOf.keys()], ["k1"]);
  assertEqual("groupRepliesByParent: 親k1の返信はr1", g.repliesOf.get("k1")?.map((r) => r.id), ["r1"]);
  assertEqual(
    "groupRepliesByParent: 親が一覧に無い返信・スタンプへの返信・返信への返信は出さない",
    [...g.repliesOf.values()].flat().map((r) => r.id),
    ["r1"]
  );
}

// ---- canShowReplyEntry（API仕様.md 42.4節の5条件＋読み込み） ----
{
  const base = {
    reportedBy: REPORTER,
    myMemberId: REPORTER,
    parent: row({ id: "k1", reacted_by: PARENT_USER }),
    hasReply: false,
    authorIsActive: true,
    repliesEnabled: true,
    loaded: true,
  };
  assertEqual("canShowReplyEntry: すべて満たせば出す", canShowReplyEntry(base), true);
  assertEqual("canShowReplyEntry: 報告者が自分でなければ出さない（保護者がP9で見るとき）", canShowReplyEntry({ ...base, myMemberId: PARENT_USER }), false);
  assertEqual("canShowReplyEntry: 報告者が分からなければ出さない", canShowReplyEntry({ ...base, reportedBy: undefined }), false);
  assertEqual(
    "canShowReplyEntry: スタンプの行には出さない",
    canShowReplyEntry({ ...base, parent: row({ id: "s", kind: "stamp", reacted_by: PARENT_USER }) }),
    false
  );
  assertEqual(
    "canShowReplyEntry: 返信の行には出さない（返信への返信は無い）",
    canShowReplyEntry({ ...base, parent: row({ id: "r", reacted_by: PARENT_USER, reply_to_reaction_id: "k0" }) }),
    false
  );
  assertEqual(
    "canShowReplyEntry: 自分のコメントには出さない",
    canShowReplyEntry({ ...base, parent: row({ id: "k", reacted_by: REPORTER }) }),
    false
  );
  assertEqual("canShowReplyEntry: 書いた人が家族にいなければ出さない", canShowReplyEntry({ ...base, authorIsActive: false }), false);
  assertEqual("canShowReplyEntry: 返信がすでにあれば出さない（取り消すと戻る）", canShowReplyEntry({ ...base, hasReply: true }), false);
  assertEqual("canShowReplyEntry: 「家族のやりとりを使う」がオフなら出さない", canShowReplyEntry({ ...base, repliesEnabled: false }), false);
  assertEqual("canShowReplyEntry: 読み込み前は出さない", canShowReplyEntry({ ...base, loaded: false }), false);
}

// ---- replyArrivalsFor（ベルの「返信が来た」・バッジ） ----
{
  // 完了報告Xは子どもchild1（REPORTER）の報告。保護者parent1ときょうだいchild2がコメントし、child1が返信。
  const kP = row({ id: "kP", reacted_by: PARENT_USER });
  const kS = row({ id: "kS", reacted_by: SIBLING });
  const rP = row({ id: "rP", reacted_by: REPORTER, reply_to_reaction_id: "kP" });
  const rS = row({ id: "rS", reacted_by: REPORTER, reply_to_reaction_id: "kS" });
  const all = [kP, kS, rP, rS];
  assertEqual(
    "replyArrivalsFor: コメントを書いた保護者には、自分のコメントへの返信だけが届く",
    replyArrivalsFor(all, PARENT_USER).map((a) => [a.reply.id, a.parent.id]),
    [["rP", "kP"]]
  );
  assertEqual(
    "replyArrivalsFor: きょうだいには自分のコメントへの返信だけ",
    replyArrivalsFor(all, SIBLING).map((a) => [a.reply.id, a.parent.id]),
    [["rS", "kS"]]
  );
  assertEqual("replyArrivalsFor: 返信を書いた本人（報告者）には載せない", replyArrivalsFor(all, REPORTER), []);
  assertEqual("replyArrivalsFor: 親が消えた返信は載せない", replyArrivalsFor([rP, rS], PARENT_USER), []);
  assertEqual("replyArrivalsFor: memberIdが空なら空", replyArrivalsFor(all, ""), []);
}

// ---- isReactionForMyReportBell（自分の報告に付いた反応。自分の返信は除く） ----
{
  assertEqual(
    "isReactionForMyReportBell: 他人のコメントは載せる",
    isReactionForMyReportBell(row({ id: "k", reacted_by: PARENT_USER }), REPORTER),
    true
  );
  assertEqual(
    "isReactionForMyReportBell: 他人のスタンプは載せる",
    isReactionForMyReportBell(row({ id: "s", kind: "stamp", reacted_by: PARENT_USER }), REPORTER),
    true
  );
  assertEqual(
    "isReactionForMyReportBell: 自分の返信（書いた人＝自分）は載せない",
    isReactionForMyReportBell(row({ id: "r", reacted_by: REPORTER, reply_to_reaction_id: "k" }), REPORTER),
    false
  );
  assertEqual(
    "isReactionForMyReportBell: 返信の行は（書いた人が他人でも）この種類には載せない",
    isReactionForMyReportBell(row({ id: "r", reacted_by: PARENT_USER, reply_to_reaction_id: "k" }), REPORTER),
    false
  );
}

// ---- replyExcerpt ----
assertEqual("replyExcerpt: 20字以内はそのまま", replyExcerpt("あいうえお"), "あいうえお");
assertEqual("replyExcerpt: 20字ちょうどはそのまま", replyExcerpt("あ".repeat(20)), "あ".repeat(20));
assertEqual("replyExcerpt: 21字以上は先頭20字＋…", replyExcerpt("あ".repeat(21)), `${"あ".repeat(20)}…`);

// ---- isWithinReplyCancelWindow ----
{
  const t = "2026-10-13T00:00:00Z";
  const ms = new Date(t).getTime();
  assertEqual("isWithinReplyCancelWindow: 4分59秒後は取消できる", isWithinReplyCancelWindow(t, ms + 299_000), true);
  assertEqual("isWithinReplyCancelWindow: 5分ちょうどは取消できる（コメントと同じ）", isWithinReplyCancelWindow(t, ms + 300_000), true);
  assertEqual("isWithinReplyCancelWindow: 5分1秒後は取消できない", isWithinReplyCancelWindow(t, ms + 301_000), false);
}

// ---- 文言（ワイヤーフレーム74.5・74.10の転記どおりか） ----
assertEqual("replyLineText 大人", replyLineText("parent", "あわ", "ありがとう！"), "あわの返信「ありがとう！」");
assertEqual("replyLineText 子ども", replyLineText("child", "ちひろ", "ありがとう！"), "ちひろの へんじ「ありがとう！」");
assertEqual(
  "bellReplySubject 大人",
  bellReplySubject("parent", "🧹 おふろ掃除", "がんばったね"),
  "🧹 おふろ掃除　あなたのコメント「がんばったね」への返信"
);
assertEqual(
  "bellReplySubject 子ども",
  bellReplySubject("child", "🧹 おふろそうじ", "がんばったね"),
  "🧹 おふろそうじ　あなたの コメント「がんばったね」に"
);
assertEqual("ownReplyLineText 大人", ownReplyLineText("supporter", "ありがとう！"), "あなたの返信「ありがとう！」");
assertEqual("ownReplyLineText 子ども", ownReplyLineText("child", "ありがとう！"), "あなたの へんじ「ありがとう！」");
assertEqual("replyCounterText 大人", replyCounterText("parent", 12), "12/200字");
assertEqual("replyCounterText 子ども", replyCounterText("child", 0), "0/200もじ");
assertEqual(
  "replyEntryAccessibility 大人",
  replyEntryAccessibility("parent", "ちひろ"),
  { label: "ちひろのコメントに返信を書く", hint: "押すと、入力欄が開きます" }
);
assertEqual(
  "replyEntryAccessibility 子ども",
  replyEntryAccessibility("child", "パパ"),
  { label: "パパの コメントに へんじを かく", hint: "おすと、かく ところが でるよ" }
);
assertEqual(
  "replyLineAccessibility 大人",
  replyLineAccessibility("parent", { authorName: "あわ", body: "ありがとう", time: "18:45", commenterName: "ちひろ" }),
  "あわの返信。ありがとう。18:45。ちひろのコメントへの返信"
);
assertEqual(
  "replyLineAccessibility 子ども",
  replyLineAccessibility("child", { authorName: "ちひろ", body: "ありがとう", time: "18:45", commenterName: "パパ" }),
  "ちひろの へんじ。ありがとう。18:45"
);

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
