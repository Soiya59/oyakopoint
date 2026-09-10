/**
 * groupDuplicateRows.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md 193章。
 *
 * このリポジトリにはテストランナー（jest等）が導入されていないため、
 * src/lib/simplifyPolyline.verify.ts の前例に倣い「Node で直接実行する検証スクリプト」
 * として書いた。Node.js 22（`--experimental-strip-types`が既定で有効）であれば
 * ビルド不要でそのまま実行できる:
 *
 *   node src/lib/groupDuplicateRows.verify.ts
 *
 * 実行するとテストケースごとにOK/NGを表示し、1件でも失敗すれば非ゼロの終了コードで
 * 終わる（`process.exitCode`）。simplifyPolyline.ts と同じ理由で、対象本体
 * （groupDuplicateRows.ts）は相対importのみ・パスエイリアス非依存にしてある。
 * tsconfig.json の exclude（ファイル名が.verify.tsで終わるものを除外するパターン）に
 * よりtscの型チェック対象からも外れる。
 */
import { groupDuplicateRows, resolveAssigneeLabel } from "./groupDuplicateRows.ts";
import type { AssignableRow, MemberOrderInput } from "./groupDuplicateRows.ts";

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

function assert(label: string, condition: boolean): void {
  if (condition) {
    console.log(`OK   ${label}`);
  } else {
    failed += 1;
    console.log(`NG   ${label}`);
  }
}

// テスト用の最小の行データ（クエスト・ごほうびを想定した title/points）。
interface Row extends AssignableRow {
  id: string;
  title: string;
  points: number;
}

const keyOf = (row: Row): string => `${row.title.trim()} ${row.points}`;

// 家族に参加した順（created_at昇順）: ちひろ → ふうか → じじ
const members: MemberOrderInput[] = [
  { id: "chihiro", created_at: "2026-01-01T00:00:00Z" },
  { id: "fuka", created_at: "2026-01-02T00:00:00Z" },
  { id: "jiji", created_at: "2026-01-03T00:00:00Z" },
];

// ---- 1. 同じ名前・同じポイントが2件 → 1グループにまとまる ----
{
  const rows: Row[] = [
    { id: "1", title: "はみがき", points: 1, assigned_to: "chihiro" },
    { id: "2", title: "はみがき", points: 1, assigned_to: "fuka" },
  ];
  const groups = groupDuplicateRows(rows, keyOf, members);
  assertEqual("同名・同ポイント2件 → グループ数は1", groups.length, 1);
  assert("同名・同ポイント2件 → そのグループは2件でまとまる", groups[0].items.length === 2);
  assertEqual(
    "同名・同ポイント2件 → 内訳はちひろ→ふうか（created_at昇順、決定9）",
    groups[0].items.map((r) => r.id),
    ["1", "2"]
  );
}

// ---- 2. ポイントだけ違う2件 → まとめない（決定1） ----
{
  const rows: Row[] = [
    { id: "1", title: "おてつだい", points: 1, assigned_to: "chihiro" },
    { id: "2", title: "おてつだい", points: 3, assigned_to: "fuka" },
  ];
  const groups = groupDuplicateRows(rows, keyOf, members);
  assertEqual("ポイント違い2件 → グループ数は2（まとめない）", groups.length, 2);
  assert("ポイント違い2件 → 両方とも単独行のまま", groups.every((g) => g.items.length === 1));
}

// ---- 3. 担当者NULLを含む3件（誰でも・ちひろ・ふうか） → まとめ、NULLが先頭（決定3・9） ----
{
  const rows: Row[] = [
    { id: "1", title: "おふろそうじ", points: 2, assigned_to: "fuka" },
    { id: "2", title: "おふろそうじ", points: 2, assigned_to: null },
    { id: "3", title: "おふろそうじ", points: 2, assigned_to: "chihiro" },
  ];
  const groups = groupDuplicateRows(rows, keyOf, members);
  assertEqual("NULL含む3件 → グループ数は1", groups.length, 1);
  assertEqual("NULL含む3件 → 件数は3（決定3：NULLも数える）", groups[0].items.length, 3);
  assertEqual(
    "NULL含む3件 → 並び順は「誰でも」(id:2)→ちひろ(id:3)→ふうか(id:1)（決定9）",
    groups[0].items.map((r) => r.id),
    ["2", "3", "1"]
  );
}

// ---- 4. 1件のみ → まとめない（決定4） ----
{
  const rows: Row[] = [{ id: "1", title: "せんたく", points: 3, assigned_to: "chihiro" }];
  const groups = groupDuplicateRows(rows, keyOf, members);
  assertEqual("1件のみ → グループ数は1（単独行扱い）", groups.length, 1);
  assert("1件のみ → items.length===1（見出し化しない）", groups[0].items.length === 1);
}

// ---- 5. 見出し行の位置（決定8）: 1番目・5番目の「はみがき」を1番目の位置にまとめる ----
{
  const rows: Row[] = [
    { id: "hamigaki-1", title: "はみがき", points: 1, assigned_to: "chihiro" }, // 1番目
    { id: "sentaku", title: "せんたく", points: 3, assigned_to: null }, // 2番目
    { id: "ofuro", title: "おふろそうじ", points: 2, assigned_to: null }, // 3番目
    { id: "shokki", title: "しょっきあらい", points: 8, assigned_to: null }, // 4番目
    { id: "hamigaki-2", title: "はみがき", points: 1, assigned_to: "fuka" }, // 5番目
  ];
  const groups = groupDuplicateRows(rows, keyOf, members);
  assertEqual("5件・末尾に2件目のはみがき → グループ数は4", groups.length, 4);
  assertEqual(
    "「はみがき」グループは1番目の位置に残り、せんたく・おふろそうじ・しょっきあらいは1つずつ繰り上がる（決定8・決定10）",
    groups.map((g) => g.key),
    [keyOf(rows[0]), keyOf(rows[1]), keyOf(rows[2]), keyOf(rows[3])]
  );
  const hamigakiGroup = groups.find((g) => g.key === keyOf(rows[0]));
  assertEqual(
    "「はみがき」グループの中身は2件（ちひろ→ふうか、created_at昇順）",
    hamigakiGroup?.items.map((r) => r.id),
    ["hamigaki-1", "hamigaki-2"]
  );
}

// ---- 6. resolveAssigneeLabel: NULLは everyoneLabel、非NULLは display_name、未知IDはnull ----
{
  const displayMembers = [
    { id: "chihiro", display_name: "ちひろ" },
    { id: "fuka", display_name: "ふうか" },
  ];
  assertEqual(
    "resolveAssigneeLabel(null, ..., '誰でも実行可') → '誰でも実行可'",
    resolveAssigneeLabel(null, displayMembers, "誰でも実行可"),
    "誰でも実行可"
  );
  assertEqual(
    "resolveAssigneeLabel('chihiro', ...) → 'ちひろ'",
    resolveAssigneeLabel("chihiro", displayMembers, "誰でも実行可"),
    "ちひろ"
  );
  assertEqual(
    "resolveAssigneeLabel('unknown-id', ...) → null（見つからない場合は追記自体を省略）",
    resolveAssigneeLabel("unknown-id", displayMembers, "誰でも実行可"),
    null
  );
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
