/**
 * sequentialSave.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md（本章、番号は本部長が採番する）。
 *
 * このリポジトリにはテストランナー（jest等）が導入されていないため、
 * src/lib/groupDuplicateRows.verify.ts の前例に倣い「Node で直接実行する検証スクリプト」
 * として書いた。Node.js 22（`--experimental-strip-types`が既定で有効）であれば
 * ビルド不要でそのまま実行できる:
 *
 *   node src/lib/sequentialSave.verify.ts
 *
 * 実行するとテストケースごとにOK/NGを表示し、1件でも失敗すれば非ゼロの終了コードで
 * 終わる（`process.exitCode`）。対象本体（sequentialSave.ts）は相対importのみ・
 * パスエイリアス非依存にしてある。tsconfig.jsonのexclude（*.verify.tsを除外する
 * パターン）によりtscの型チェック対象からも外れる。
 *
 * 検証する3パターン（依頼「1人選択／3人選択／2人目で失敗」）は、要件定義書07-26章
 * 決定20「成功済みの行は取り消さない・再試行は未保存のメンバーのみ」を満たすことを
 * 確認する。実際の画面（app/parent/chore-edit.tsx・app/parent/reward-edit.tsx）は
 * createChore/createReward（Supabase呼び出し）をcreateOneとして渡すが、ここでは
 * 画面にもSupabaseにも依存しないダミーのcreateOneで検証する。
 */
import { saveSequentially } from "./sequentialSave.ts";
import type { SequentialCreateResult } from "./sequentialSave.ts";

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

const labels: Record<string, string> = { chihiro: "ちひろ", fuka: "ふうか", jiji: "じじ" };
const labelOf = (id: string) => labels[id] ?? "";

/** 呼ばれた順番を記録しつつ、指定したIDだけ失敗させるダミーのcreateOne。 */
function makeCreateOne(failingIds: readonly string[], calls: string[]) {
  return async (id: string): Promise<SequentialCreateResult> => {
    calls.push(id);
    if (failingIds.includes(id)) {
      return { ok: false, error: { message: "通信できませんでした" } };
    }
    return { ok: true };
  };
}

// ---- 1. 1人選択 → 1回だけ呼ばれ、全員成功で終わる ----
{
  const calls: string[] = [];
  const outcome = await saveSequentially(["chihiro"], labelOf, makeCreateOne([], calls));
  assertEqual("1人選択・成功 → 呼び出し回数は1回", calls, ["chihiro"]);
  assertEqual("1人選択・成功 → succeededは['ちひろ']", outcome.succeeded, ["ちひろ"]);
  assertEqual("1人選択・成功 → failedは空", outcome.failed, []);
  assertEqual("1人選択・成功 → remainingIdsは空（再試行不要）", outcome.remainingIds, []);
  assertEqual("1人選択・成功 → errorMessageはnull", outcome.errorMessage, null);
}

// ---- 2. 3人選択・全員成功 → 3回呼ばれ、成功順にsucceededへ積まれる ----
{
  const calls: string[] = [];
  const outcome = await saveSequentially(["chihiro", "fuka", "jiji"], labelOf, makeCreateOne([], calls));
  assertEqual("3人選択・全員成功 → 呼び出し順はちひろ→ふうか→じじ", calls, ["chihiro", "fuka", "jiji"]);
  assertEqual("3人選択・全員成功 → succeededは3人分すべて", outcome.succeeded, ["ちひろ", "ふうか", "じじ"]);
  assertEqual("3人選択・全員成功 → failedは空", outcome.failed, []);
  assertEqual("3人選択・全員成功 → remainingIdsは空", outcome.remainingIds, []);
}

// ---- 3. 3人選択・2人目（ふうか）で失敗 → 決定20の中心ケース ----
//    「成功した分は取り消さない・失敗以降は止まる・どの人が保存できたか分かる」
{
  const calls: string[] = [];
  const outcome = await saveSequentially(["chihiro", "fuka", "jiji"], labelOf, makeCreateOne(["fuka"], calls));
  assertEqual(
    "2人目で失敗 → じじの呼び出しは発生しない（失敗した時点で止める、決定20）",
    calls,
    ["chihiro", "fuka"]
  );
  assertEqual("2人目で失敗 → 1人目（ちひろ）は成功したまま残る（取り消さない）", outcome.succeeded, ["ちひろ"]);
  assertEqual(
    "2人目で失敗 → failedは『ふうか・じじ』（失敗した本人＋以降の未着手）",
    outcome.failed,
    ["ふうか", "じじ"]
  );
  assertEqual("2人目で失敗 → remainingIdsは['fuka','jiji']（再試行対象）", outcome.remainingIds, ["fuka", "jiji"]);
  assertEqual("2人目で失敗 → errorMessageはAPIのエラーメッセージ", outcome.errorMessage, "通信できませんでした");
}

// ---- 4. 再試行: 上記3.のremainingIdsに対してもう一度呼び、今度は全員成功する ----
//    「再試行は未保存のメンバーのみを対象に行う」（決定20）ことの確認。
{
  const calls: string[] = [];
  const firstOutcome = await saveSequentially(["chihiro", "fuka", "jiji"], labelOf, makeCreateOne(["fuka"], []));
  const retryOutcome = await saveSequentially(
    firstOutcome.remainingIds,
    labelOf,
    makeCreateOne([], calls),
    firstOutcome.succeeded
  );
  assertEqual("再試行 → 呼び出し対象は未保存だった['fuka','jiji']のみ（ちひろは再作成しない）", calls, ["fuka", "jiji"]);
  assertEqual(
    "再試行・全員成功 → succeededは1回目の成功分(ちひろ)を引き継ぎ3人分すべてになる",
    retryOutcome.succeeded,
    ["ちひろ", "ふうか", "じじ"]
  );
  assertEqual("再試行・全員成功 → remainingIdsは空（結果表示を終えてよい）", retryOutcome.remainingIds, []);
}

// ---- 5. 再試行してもまた失敗する場合 → failed・remainingIdsが縮む ----
{
  const firstOutcome = await saveSequentially(["chihiro", "fuka", "jiji"], labelOf, makeCreateOne(["fuka"], []));
  // 再試行でも「じじ」が失敗する状況（例: 2回目もネットワークが不安定）。
  const retryOutcome = await saveSequentially(
    firstOutcome.remainingIds,
    labelOf,
    makeCreateOne(["jiji"], []),
    firstOutcome.succeeded
  );
  assertEqual(
    "再試行で一部だけ成功 → succeededはちひろ・ふうか（じじはまだ）",
    retryOutcome.succeeded,
    ["ちひろ", "ふうか"]
  );
  assertEqual("再試行で一部だけ成功 → failedは['じじ']のみに縮む", retryOutcome.failed, ["じじ"]);
  assertEqual("再試行で一部だけ成功 → remainingIdsは['jiji']のみに縮む", retryOutcome.remainingIds, ["jiji"]);
}

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
