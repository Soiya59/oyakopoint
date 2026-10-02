/**
 * gratitudeStamp.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md 347章、UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 71章、
 * 設計部/成果物/API仕様.md 39章。
 *
 *   node src/lib/gratitudeStamp.verify.ts
 *
 * 対象本体は値のimportを持たないため、Node単体で読み込める（src/lib/requestChore.verify.tsと同じ）。
 */
import {
  canShowGratitudeStampRow,
  countGratitudeStampArrivals,
  gratitudeNoteExcerpt,
  gratitudeStampAccessibility,
  gratitudeStampArrivals,
  gratitudeStampSubject,
  isGratitudeStampRefused,
  stampKeyOf,
} from "./gratitudeStamp.ts";

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

// ---- 失敗の振り分け（API仕様.md 39.3章） ----
assertEqual("no_data_found（P0002）は断られた", isGratitudeStampRefused({ code: "P0002" }), true);
assertEqual(
  "23514＋gratitude_stamp_not_allowedは断られた",
  isGratitudeStampRefused({ code: "23514", hint: "gratitude_stamp_not_allowed" }),
  true
);
assertEqual(
  "23514＋gratitude_sender_leftは断られた",
  isGratitudeStampRefused({ code: "23514", hint: "gratitude_sender_left" }),
  true
);
assertEqual("23514でもHINTが無ければ断られた扱いにしない", isGratitudeStampRefused({ code: "23514" }), false);
assertEqual(
  "23514＋別のHINTは断られた扱いにしない",
  isGratitudeStampRefused({ code: "23514", hint: "chore_request_limit_reached" }),
  false
);
assertEqual("42501（ログイン切れ・権限）は断られたのではない", isGratitudeStampRefused({ code: "42501" }), false);
assertEqual("通信失敗（network）は断られたのではない", isGratitudeStampRefused({ code: "" }), false);
assertEqual("P0001（別のRAISE）は断られた扱いにしない", isGratitudeStampRefused({ code: "P0001" }), false);

// ---- 受け取った人のカード ----
const g = (over: Partial<{
  id: string;
  sender_id: string;
  recipient_id: string;
  points: number;
  note: string | null;
  created_at: string;
  revoked_at: string | null;
}> = {}) => ({
  id: "g1",
  sender_id: "parent",
  recipient_id: "child",
  points: 2,
  note: "おてつだい ありがとう",
  created_at: "2026-10-01T10:00:00Z",
  revoked_at: null,
  ...over,
});

assertEqual(
  "入口を出す（受け取った・取り消されていない・贈った人が在籍・取得済み）",
  canShowGratitudeStampRow({ gratitude: g(), memberId: "child", senderIsActive: true, reactionsLoaded: true }),
  true
);
assertEqual(
  "贈った人が抜けていたら出さない",
  canShowGratitudeStampRow({ gratitude: g(), memberId: "child", senderIsActive: false, reactionsLoaded: true }),
  false
);
assertEqual(
  "スタンプの取得前・取得失敗なら出さない",
  canShowGratitudeStampRow({ gratitude: g(), memberId: "child", senderIsActive: true, reactionsLoaded: false }),
  false
);
assertEqual(
  "取り消された感謝には出さない",
  canShowGratitudeStampRow({
    gratitude: g({ revoked_at: "2026-10-01T10:02:00Z" }),
    memberId: "child",
    senderIsActive: true,
    reactionsLoaded: true,
  }),
  false
);
assertEqual(
  "自分が贈った感謝には出さない（贈った人は押せない）",
  canShowGratitudeStampRow({ gratitude: g(), memberId: "parent", senderIsActive: true, reactionsLoaded: true }),
  false
);
assertEqual(
  "第三者には出さない",
  canShowGratitudeStampRow({ gratitude: g(), memberId: "supporter", senderIsActive: true, reactionsLoaded: true }),
  false
);

const reactions = [
  { gratitude_id: "g1", stamp_key: "sugoi", created_at: "2026-10-02T09:00:00Z" },
  { gratitude_id: "g2", stamp_key: "arigato", created_at: "2026-10-03T09:00:00Z" },
  { gratitude_id: "gX", stamp_key: "ganbatta", created_at: "2026-10-03T10:00:00Z" },
];
assertEqual("stampKeyOf: 付いている", stampKeyOf(reactions, "g1"), "sugoi");
assertEqual("stampKeyOf: 付いていない", stampKeyOf(reactions, "g9"), null);
assertEqual("stampKeyOf: 取得できていない（null）", stampKeyOf(null, "g1"), null);

// ---- 贈った人のベルの項目 ----
const gratitude = [
  g({ id: "g1", sender_id: "parent", recipient_id: "child" }),
  g({ id: "g2", sender_id: "parent", recipient_id: "child2", note: null, points: 1, created_at: "2025-12-01T03:00:00Z" }),
  g({ id: "g3", sender_id: "child", recipient_id: "parent" }), // 子どもが贈った感謝（gXではない）
];
const arrivalsP = gratitudeStampArrivals(gratitude, reactions, "parent");
assertEqual("贈った人: 自分が贈った感謝のスタンプだけ・押した時刻の新しい順", arrivalsP.map((a) => a.gratitudeId), ["g2", "g1"]);
assertEqual("贈った人: 押した人＝受け取った人", arrivalsP.map((a) => a.recipientId), ["child2", "child"]);
assertEqual("贈った人: 時刻はスタンプを押した時刻", arrivalsP[0]?.at, "2026-10-03T09:00:00Z");
assertEqual(
  "受け取った人が自分で押した分は、受け取った人のベルには数えない",
  gratitudeStampArrivals(gratitude, reactions, "child").length,
  0
);
assertEqual("感謝の行が見つからないスタンプ（gX）は除く", arrivalsP.some((a) => a.gratitudeId === "gX"), false);
assertEqual(
  "取り消された感謝のスタンプは出さない",
  gratitudeStampArrivals(
    [g({ id: "g1", revoked_at: "2026-10-01T10:02:00Z" })],
    [{ gratitude_id: "g1", stamp_key: "sugoi", created_at: "2026-10-02T09:00:00Z" }],
    "parent"
  ).length,
  0
);
assertEqual(
  "knownKeysに無い種類（将来増えた種類）は除く",
  gratitudeStampArrivals(gratitude, reactions, "parent", ["sugoi"]).map((a) => a.gratitudeId),
  ["g1"]
);
assertEqual("スタンプが取得できていない（null）なら空", gratitudeStampArrivals(gratitude, null, "parent"), []);
assertEqual("memberIdが空なら空", gratitudeStampArrivals(gratitude, reactions, ""), []);

// ---- 件数 ----
assertEqual(
  "件数: since以降に押された分だけ数える（g1=10/2・g2=10/3、sinceは10/2 12:00）",
  countGratitudeStampArrivals(gratitude, reactions, "parent", new Date("2026-10-02T12:00:00Z").getTime()),
  1
);
assertEqual(
  "件数: sinceを過去にすれば2件（受け取った人側には数えない）",
  countGratitudeStampArrivals(gratitude, reactions, "parent", new Date("2026-10-01T00:00:00Z").getTime()),
  2
);
assertEqual(
  "件数: 受け取った人は0",
  countGratitudeStampArrivals(gratitude, reactions, "child", new Date("2026-10-01T00:00:00Z").getTime()),
  0
);

// ---- 対象の一言（71.3節） ----
assertEqual("ひとこと20字以内はそのまま「」で囲む",
  gratitudeStampSubject({ note: "おてつだい ありがとう", points: 2, sentJstDate: "2026-10-01", todayJstDate: "2026-10-03", child: false }),
  "💌 「おてつだい ありがとう」"
);
assertEqual("ひとことが20字を超えたら先頭20字＋…",
  gratitudeStampSubject({ note: "あいうえおかきくけこさしすせそたちつてとなにぬ", points: 2, sentJstDate: "2026-10-01", todayJstDate: "2026-10-03", child: false }),
  "💌 「あいうえおかきくけこさしすせそたちつてと…」"
);
assertEqual("ひとこと無し（大人）: 贈った日と◯pt",
  gratitudeStampSubject({ note: null, points: 2, sentJstDate: "2026-10-01", todayJstDate: "2026-10-03", child: false }),
  "💌 10/1に贈った 2pt"
);
assertEqual("ひとこと無し（子ども）: ひらがな",
  gratitudeStampSubject({ note: null, points: 2, sentJstDate: "2026-10-01", todayJstDate: "2026-10-03", child: true }),
  "💌 10/1に おくった 2pt"
);
assertEqual("ひとことが空白だけなら、無いものとして日付の形",
  gratitudeStampSubject({ note: "   ", points: 1, sentJstDate: "2026-10-01", todayJstDate: "2026-10-03", child: false }),
  "💌 10/1に贈った 1pt"
);
assertEqual("贈った年が今年と違うときは年から",
  gratitudeStampSubject({ note: "", points: 1, sentJstDate: "2025-12-01", todayJstDate: "2026-10-03", child: false }),
  "💌 2025/12/1に贈った 1pt"
);
assertEqual("年が違う（子ども）",
  gratitudeStampSubject({ note: null, points: 3, sentJstDate: "2025-12-01", todayJstDate: "2026-10-03", child: true }),
  "💌 2025/12/1に おくった 3pt"
);
assertEqual("抜粋: ちょうど20字は切らない", gratitudeNoteExcerpt("あ".repeat(20)), "あ".repeat(20));
assertEqual("抜粋: 21字は切る", gratitudeNoteExcerpt("あ".repeat(21)), `${"あ".repeat(20)}…`);

// ---- 読み上げ（「返す」「おへんじ」の語を使わない） ----
const a1 = gratitudeStampAccessibility("parent", "すごい！", false);
const a2 = gratitudeStampAccessibility("supporter", "すごい！", true);
const a3 = gratitudeStampAccessibility("child", "すごい！", true);
assertEqual("読み上げ（大人・未選択）", a1, { label: "すごい！のスタンプ", hint: "押すと、スタンプが届きます" });
assertEqual("読み上げ（大人・選択中）", a2, { label: "すごい！のスタンプ。選択中", hint: "もう一度押すと、取り消します" });
assertEqual("読み上げ（子ども・選択中）", a3, { label: "すごい！の スタンプ。えらんでいるよ", hint: "もういちど おすと、とりけせるよ" });
const allText = [a1, a2, a3, gratitudeStampAccessibility("child", "すごい！", false)].map((x) => x.label + x.hint).join("");
assertEqual("読み上げに「返」「へんじ」「おれい」「返信」の語が無い", /返|へんじ|おれい|返信/.test(allText), false);

if (failed > 0) {
  console.log(`\n${failed}件 NG`);
  process.exit(1);
}
console.log("\nすべて OK");
