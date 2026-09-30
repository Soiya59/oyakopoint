/**
 * requestChore.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md 335章、UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 70章。
 *
 *   node src/lib/requestChore.verify.ts
 *
 * 対象本体は値のimportを持たないため、Node単体で読み込める（src/lib/oneOffFinished.verify.tsと同じ）。
 */
import {
  GRATITUDE_NOTE_MAX,
  REQUEST_BADGE_FALLBACK_NAME,
  buildRequestChildOptions,
  buildRequestChoreIdSet,
  canSubmitRequest,
  countOpenRequestsForChild,
  formatPointsAmount,
  fullChildNames,
  gratitudeLimitBackLabel,
  gratitudeLimitBackRoute,
  initialRequestSelection,
  isAllRequestFull,
  isGratitudeAllowanceConflict,
  isHiddenRequestChore,
  isRequestChore,
  isRequestCompletion,
  isRequestFull,
  isRequestPushType,
  isRequestWithoutAssignee,
  isValidRequestPoints,
  normalizeRequestTitle,
  parseGratitudeSendParams,
  pruneRequestSelection,
  requestArrivedForChild,
  requestBadgeText,
  requestDoneForRequester,
  requestDraftNote,
  requestFailureStatus,
  requestPointChipFlex,
  requestPointChipsLayout,
  requestPointChoices,
  requestTitleCounter,
  routeForRequestPushType,
  shouldHideFromChildFamilyFeed,
  shouldShowChorePoints,
  shouldShowCompletionPoints,
  shouldShowGratitudeLimitCard,
  shouldShowPointsValue,
  splitPointChoicesIntoRows,
  summarizeRequestOutcomes,
  toggleRequestSelection,
} from "./requestChore.ts";
// 上限の値はリテラルを写さず、アプリの定数（theme.requestLimit）を読む（4か所目を作らない。
// DBの`max_request_points()`・rls_checks.sqlのC-R11・themeの3か所で値をそろえる。実装メモ341章）。
import { requestLimit } from "../theme/theme.ts";

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

const LIMIT = 3; // theme.requestLimit.maxOpenPerChild / DBのmax_open_requests_per_child()

// ---- 1. おねがいか ----
assertEqual("is_request=true → おねがい", isRequestChore({ is_request: true }), true);
assertEqual("is_request=false → おねがいでない", isRequestChore({ is_request: false }), false);
assertEqual("is_request未定義（古いデータ）→ おねがいでない", isRequestChore({}), false);
assertEqual("null → おねがいでない", isRequestChore(null), false);
assertEqual("おねがい＋担当あり → 隠さない", isHiddenRequestChore({ is_request: true, assigned_to: "c1" }), false);
assertEqual("おねがい＋担当が空 → どの画面にも出さない", isHiddenRequestChore({ is_request: true, assigned_to: null }), true);
assertEqual("通常のクエスト＋担当が空（誰でも実行可）→ 隠さない", isHiddenRequestChore({ is_request: false, assigned_to: null }), false);
assertEqual("P10の「担当なし」はisHiddenと同じ条件", isRequestWithoutAssignee({ is_request: true, assigned_to: null }), true);

// ---- 2. 完了報告がおねがいか（chore_idで引く） ----
const chores = [
  { id: "r1", is_request: true, is_active: true, assigned_to: "c1", created_by: "p1", created_at: "2026-09-30T01:00:00Z" },
  { id: "r2", is_request: true, is_active: true, assigned_to: "c1", created_by: "p2", created_at: "2026-09-30T02:00:00Z" },
  { id: "r3", is_request: true, is_active: true, assigned_to: "c2", created_by: "p1", created_at: "2026-09-30T03:00:00Z" },
  { id: "n1", is_request: false, is_active: true, assigned_to: "c1", created_by: "p1", created_at: "2026-09-30T04:00:00Z" },
];
const ids = buildRequestChoreIdSet(chores);
assertEqual("おねがいのchore_idの集合", [...ids].sort(), ["r1", "r2", "r3"]);
assertEqual("おねがいの完了報告 → true", isRequestCompletion({ chore_id: "r1" }, ids), true);
assertEqual("通常のクエストの完了報告 → false", isRequestCompletion({ chore_id: "n1" }, ids), false);
assertEqual("chore_idがNULLの完了報告 → おねがいではない（普通のもの）", isRequestCompletion({ chore_id: null }, ids), false);
assertEqual("家族データに無いchore_id → false", isRequestCompletion({ chore_id: "zzz" }, ids), false);

// ---- 3. 「+Npt」を出すか（70.9節D16。【2026-09-30再改訂】おねがいは0より大きいときだけ） ----
assertEqual("おねがいの完了報告（0pt）は「+0pt」を出さない", shouldShowCompletionPoints({ chore_id: "r1", points: 0 }, ids), false);
assertEqual("おねがいの完了報告（1pt）は出す（再改訂）", shouldShowCompletionPoints({ chore_id: "r1", points: 1 }, ids), true);
assertEqual("おねがいの完了報告（2pt）は出す（再改訂）", shouldShowCompletionPoints({ chore_id: "r2", points: 2 }, ids), true);
assertEqual("おねがいの完了報告（上限pt）は出す（再改訂）", shouldShowCompletionPoints({ chore_id: "r3", points: requestLimit.maxPoints }, ids), true);
assertEqual("おねがいの完了報告でpointsがNULLは出さない", shouldShowCompletionPoints({ chore_id: "r1", points: null }, ids), false);
assertEqual("通常の完了報告（0pt）は今までどおり出す（07-28章決定26）", shouldShowCompletionPoints({ chore_id: "n1", points: 0 }, ids), true);
assertEqual("通常の完了報告（5pt）は出す", shouldShowCompletionPoints({ chore_id: "n1", points: 5 }, ids), true);
assertEqual("台紙型でpointsがNULLは出さない（既存の扱い）", shouldShowCompletionPoints({ chore_id: "n1", points: null }, ids), false);
assertEqual("chore_idがNULLの完了報告（通常扱い）は出す", shouldShowCompletionPoints({ chore_id: null, points: 3 }, ids), true);
assertEqual("chore_idがNULLの完了報告（通常扱い・0pt）は今までどおり出す", shouldShowCompletionPoints({ chore_id: null, points: 0 }, ids), true);
assertEqual("一覧の行: おねがい（0pt）は+Nptを出さない", shouldShowChorePoints({ is_request: true, points: 0 }), false);
assertEqual("一覧の行: おねがい（2pt）は出す（再改訂）", shouldShowChorePoints({ is_request: true, points: 2 }), true);
assertEqual("一覧の行: おねがいでpoints未指定は出さない", shouldShowChorePoints({ is_request: true }), false);
assertEqual("一覧の行: 通常（0pt）は今までどおり出す", shouldShowChorePoints({ is_request: false, points: 0 }), true);
assertEqual("一覧の行: 通常は出す", shouldShowChorePoints({ is_request: false }), true);
assertEqual("値の規則: おねがい・0 → 出さない", shouldShowPointsValue(0, true), false);
assertEqual("値の規則: おねがい・1 → 出す", shouldShowPointsValue(1, true), true);
assertEqual("値の規則: おねがい・NaN（points文字列が数でない）→ 出さない", shouldShowPointsValue(NaN, true), false);
assertEqual("値の規則: 通常・0 → 出す", shouldShowPointsValue(0, false), true);
assertEqual("値の規則: 通常・null → 出さない", shouldShowPointsValue(null, false), false);
assertEqual("値の規則: 通常・undefined → 出さない", shouldShowPointsValue(undefined, false), false);
assertEqual("書式は通常のクエストと同じ「+Npt」", formatPointsAmount(2), "+2pt");

// ---- 4. 子どもの印 ----
assertEqual("印: 依頼者の名前あり", requestBadgeText("ママ"), "ママから おねがい");
assertEqual("印: 依頼者が分からない（null）", requestBadgeText(null), `${REQUEST_BADGE_FALLBACK_NAME}から おねがい`);
assertEqual("印: 依頼者が分からない（空白）", requestBadgeText("  "), "おうちの ひとから おねがい");
assertEqual("印: 名前の前後の空白は除く", requestBadgeText(" パパ "), "パパから おねがい");

// ---- 5. 未完了の数（D19） ----
const finished = (c: { id: string }) => c.id === "r2"; // r2はやってくれた
assertEqual("c1の未完了: r1（r2は完了・n1は通常）→ 1", countOpenRequestsForChild(chores, "c1", finished), 1);
assertEqual("c2の未完了: r3 → 1", countOpenRequestsForChild(chores, "c2", finished), 1);
assertEqual("担当が空の行はどの子にも数えない", countOpenRequestsForChild([{ id: "x", is_request: true, is_active: true, assigned_to: null }], "c1", () => false), 0);
assertEqual("取り下げ済み（is_active=false）は数えない", countOpenRequestsForChild([{ id: "x", is_request: true, is_active: false, assigned_to: "c1" }], "c1", () => false), 0);
assertEqual("通常のクエスト（担当c1・0pt）は数えない（決定19）", countOpenRequestsForChild([{ id: "x", is_request: false, is_active: true, assigned_to: "c1" }], "c1", () => false), 0);
assertEqual("上限3に届かない（2）→ 満杯でない", isRequestFull(2, LIMIT), false);
assertEqual("上限3に届いた（3）→ 満杯", isRequestFull(3, LIMIT), true);
assertEqual("取消で4つになっても満杯（新規だけ止まる）", isRequestFull(4, LIMIT), true);

const manyChores = ["a", "b", "c"].map((k) => ({ id: `m${k}`, is_request: true, is_active: true, assigned_to: "c9" }));
const children = [
  { id: "c1", display_name: "ちひろ" },
  { id: "c9", display_name: "そら" },
];
const optsBase = buildRequestChildOptions(children, [...chores, ...manyChores], () => false, LIMIT);
assertEqual("チップ: c1は満杯でない・c9は満杯", optsBase, [
  { id: "c1", name: "ちひろ", full: false },
  { id: "c9", name: "そら", full: true },
]);
assertEqual("満杯の子の名前", fullChildNames(optsBase), ["そら"]);
assertEqual("全員が満杯かどうか（一部）", isAllRequestFull(optsBase), false);
assertEqual(
  "全員が満杯かどうか（全員）",
  isAllRequestFull([{ id: "c9", name: "そら", full: true }]),
  true
);
assertEqual("子どもがいない → 全員満杯ではない", isAllRequestFull([]), false);
// 完了すると枠が空く
assertEqual(
  "1つ完了 → c9は満杯でなくなる",
  buildRequestChildOptions(children, manyChores, (c) => c.id === "ma", LIMIT).find((o) => o.id === "c9")?.full,
  false
);

// ---- 6. 選択（D4・D19） ----
assertEqual("子ども1人（満杯でない）→ 最初から選択済み", initialRequestSelection([{ id: "c1", name: "ちひろ", full: false }]), ["c1"]);
assertEqual("子ども1人（満杯）→ 選択済みにしない", initialRequestSelection([{ id: "c1", name: "ちひろ", full: true }]), []);
assertEqual("子ども2人以上 → 誰も選ばない", initialRequestSelection(optsBase), []);
assertEqual("子どもがいない → 空", initialRequestSelection([]), []);
assertEqual("チップを押す → 選ぶ", toggleRequestSelection([], optsBase, "c1"), ["c1"]);
assertEqual("もう一度押す → 外す", toggleRequestSelection(["c1"], optsBase, "c1"), []);
assertEqual("満杯の子は選べない", toggleRequestSelection(["c1"], optsBase, "c9"), ["c1"]);
assertEqual("知らないidは何も変えない", toggleRequestSelection(["c1"], optsBase, "zzz"), ["c1"]);
assertEqual("選択中の子が満杯になったら外す", pruneRequestSelection(["c1", "c9"], optsBase), ["c1"]);

// ---- 7. 題名・保存ボタン（D3） ----
assertEqual("題名は前後の空白を除く", normalizeRequestTitle("  おふろのそうじ "), "おふろのそうじ");
assertEqual("カウンター: 12/20・警告なし", requestTitleCounter("あ".repeat(12), 20, 5), { count: 12, text: "12/20", warn: false });
assertEqual("カウンター: 残り5字でアンバー", requestTitleCounter("あ".repeat(15), 20, 5).warn, true);
assertEqual("カウンター: 残り6字は警告なし", requestTitleCounter("あ".repeat(14), 20, 5).warn, false);
assertEqual("保存できる: 1人選択・題名あり・ポイント2", canSubmitRequest({ selectedCount: 1, title: "そうじ", points: 2, saving: false }), true);
assertEqual("保存できる: ポイント0（ポイントなし）は選択済み（U9。0を未選択と取り違えない）", canSubmitRequest({ selectedCount: 1, title: "そうじ", points: 0, saving: false }), true);
assertEqual("保存できない: ポイントが未選択（null。U9）", canSubmitRequest({ selectedCount: 1, title: "そうじ", points: null, saving: false }), false);
assertEqual("保存できない: 誰も選んでいない", canSubmitRequest({ selectedCount: 0, title: "そうじ", points: 1, saving: false }), false);
assertEqual("保存できない: 題名が空白だけ", canSubmitRequest({ selectedCount: 1, title: "   ", points: 1, saving: false }), false);
assertEqual("保存できない: 保存中（二度押し防止）", canSubmitRequest({ selectedCount: 1, title: "そうじ", points: 1, saving: true }), false);

// ---- 7b. ポイントの欄（D20〜D22。上限はthemeの値から作る） ----
assertEqual("チップの値は0〜maxPoints（「ポイントなし」＋1〜max）", requestPointChoices(requestLimit.maxPoints), [0, 1, 2, 3]);
assertEqual("チップの数はmaxPoints+1（上限が変わっても作り直せる）", requestPointChoices(5), [0, 1, 2, 3, 4, 5]);
assertEqual("チップの値: 上限0なら「ポイントなし」だけ", requestPointChoices(0), [0]);
assertEqual("正しいポイント: 0", isValidRequestPoints(0, requestLimit.maxPoints), true);
assertEqual("正しいポイント: 上限ちょうど", isValidRequestPoints(requestLimit.maxPoints, requestLimit.maxPoints), true);
assertEqual("範囲外: 上限+1", isValidRequestPoints(requestLimit.maxPoints + 1, requestLimit.maxPoints), false);
assertEqual("範囲外: 負", isValidRequestPoints(-1, requestLimit.maxPoints), false);
assertEqual("範囲外: 小数", isValidRequestPoints(1.5, requestLimit.maxPoints), false);
assertEqual("範囲外: NaN", isValidRequestPoints(NaN, requestLimit.maxPoints), false);
assertEqual("並べ方: 通常（1.0倍）は1行", requestPointChipsLayout(1.0, requestLimit.pointChipsGridFontScale), "row");
assertEqual("並べ方: 1.29倍は1行", requestPointChipsLayout(1.29, requestLimit.pointChipsGridFontScale), "row");
assertEqual("並べ方: しきい値ちょうど（1.3）は2行2列", requestPointChipsLayout(1.3, requestLimit.pointChipsGridFontScale), "grid");
assertEqual("並べ方: 2.0倍は2行2列", requestPointChipsLayout(2.0, requestLimit.pointChipsGridFontScale), "grid");
assertEqual("幅の配り: 「ポイントなし」は1.7", requestPointChipFlex(0), 1.7);
assertEqual("幅の配り: 1ptは1", requestPointChipFlex(1), 1);
assertEqual("2行2列: 1行目＝ポイントなし・1pt、2行目＝2pt・3pt", splitPointChoicesIntoRows(requestPointChoices(requestLimit.maxPoints), 2), [[0, 1], [2, 3]]);
assertEqual("themeの上限（DB・rls_checksのC-R11と同じ3）", requestLimit.maxPoints, 3);

// ---- 8. 保存の結果（子どもごと） ----
assertEqual("RQ001は「3つまで」", requestFailureStatus("RQ001", "RQ001"), "full");
assertEqual("通信断（code空）は失敗", requestFailureStatus("", "RQ001"), "failed");
assertEqual("check_violationは失敗（3つまでではない）", requestFailureStatus("23514", "RQ001"), "failed");
assertEqual("undefinedは失敗", requestFailureStatus(undefined, "RQ001"), "failed");
assertEqual(
  "全員成功",
  summarizeRequestOutcomes([
    { childId: "c1", status: "ok" },
    { childId: "c2", status: "ok" },
  ]),
  { allOk: true, okIds: ["c1", "c2"], fullIds: [], failedIds: [], retryIds: [], onlyFull: false }
);
assertEqual(
  "一部が通信の失敗 → その子だけやり直し（成功済みは二度作らない）",
  summarizeRequestOutcomes([
    { childId: "c1", status: "ok" },
    { childId: "c2", status: "failed" },
  ]).retryIds,
  ["c2"]
);
assertEqual(
  "満杯の子はやり直しの対象にしない（何度押しても同じ）",
  summarizeRequestOutcomes([
    { childId: "c1", status: "ok" },
    { childId: "c2", status: "full" },
  ]).retryIds,
  []
);
assertEqual(
  "全員が満杯で失敗 → onlyFull",
  summarizeRequestOutcomes([{ childId: "c2", status: "full" }]).onlyFull,
  true
);
assertEqual("結果が空 → allOkにしない", summarizeRequestOutcomes([]).allOk, false);

// ---- 9. P22の引数（D13） ----
const cand = ["c1", "c2", "p2"];
assertEqual(
  "引数なし → ありがとうタブ・相手なし・下書きなし",
  parseGratitudeSendParams({}, cand, true),
  { tab: "thanks", recipientId: null, draft: "", from: null }
);
assertEqual(
  "P8から: 相手・下書き・from",
  parseGratitudeSendParams({ to: "c1", draft: "おふろのそうじをやってくれた", from: "approvals" }, cand, true),
  { tab: "thanks", recipientId: "c1", draft: "おふろのそうじをやってくれた", from: "approvals" }
);
assertEqual(
  "相手が候補に無い（退会・自分・他家族）→ 何も選ばず下書きも入れない",
  parseGratitudeSendParams({ to: "zzz", draft: "下書き" }, cand, true),
  { tab: "thanks", recipientId: null, draft: "", from: null }
);
assertEqual(
  "やりとりOFF（ひとこと欄なし）→ 下書きは渡さない",
  parseGratitudeSendParams({ to: "c1", draft: "下書き" }, cand, false).draft,
  ""
);
assertEqual(
  "やりとりOFFでも相手は選ぶ",
  parseGratitudeSendParams({ to: "c1", draft: "下書き" }, cand, false).recipientId,
  "c1"
);
assertEqual(
  "下書きは200字で切る",
  parseGratitudeSendParams({ to: "c1", draft: "あ".repeat(250) }, cand, true).draft.length,
  GRATITUDE_NOTE_MAX
);
assertEqual("tab=request → おねがいのタブ", parseGratitudeSendParams({ tab: "request" }, cand, true).tab, "request");
assertEqual("tabが知らない値 → ありがとうタブ", parseGratitudeSendParams({ tab: "zzz" }, cand, true).tab, "thanks");
assertEqual("fromが知らない値 → null", parseGratitudeSendParams({ from: "zzz" }, cand, true).from, null);
assertEqual("配列で渡されても先頭を使う", parseGratitudeSendParams({ to: ["c2", "c1"] }, cand, true).recipientId, "c2");
assertEqual("下書き: 「{題名}をやってくれた」", requestDraftNote("おふろのそうじ"), "おふろのそうじをやってくれた");
assertEqual("下書きは200字を超えない", requestDraftNote("あ".repeat(300)).length, GRATITUDE_NOTE_MAX);

// ---- 10. 残り0の案内（D14） ----
assertEqual("残り0（取得済み）→ 案内カード", shouldShowGratitudeLimitCard("ready", 0), true);
assertEqual("残り1 → フォーム", shouldShowGratitudeLimitCard("ready", 1), false);
assertEqual("読み込み中 → フォームのまま（案内を出さない）", shouldShowGratitudeLimitCard("loading", null), false);
assertEqual("取得に失敗 → 案内カードにしない（『贈る』は無効・再取得）", shouldShowGratitudeLimitCard("error", null), false);
assertEqual("戻る導線の名前: P8から", gratitudeLimitBackLabel("approvals"), "完了報告にもどる");
assertEqual("戻る導線の名前: P21から・引数なし", gratitudeLimitBackLabel(null), "感謝ポイントにもどる");
assertEqual("戻れないときの行き先: P8", gratitudeLimitBackRoute("approvals"), "/parent/approvals");
assertEqual("戻れないときの行き先: P21", gratitudeLimitBackRoute(null), "/parent/gratitude");
assertEqual(
  "競合: 原資の超過（check_violation）→ 残り0に置き換える",
  isGratitudeAllowanceConflict({ code: "23514", message: "今日贈れる感謝ポイントの残り原資（3pt）を超えています（残り0pt）" }, "23514"),
  true
);
assertEqual(
  "競合ではない: 自己贈呈（check_violationだが原資の文言でない）",
  isGratitudeAllowanceConflict({ code: "23514", message: "chk_gratitude_no_self_gift" }, "23514"),
  false
);
assertEqual("競合ではない: 通信断", isGratitudeAllowanceConflict({ code: "", message: "TypeError" }, "23514"), false);

// ---- 11. 通知をタップしたときの遷移先（D10） ----
assertEqual("おねがいが届いた: 子ども → /child/home", routeForRequestPushType("chore_request", "child"), "/child/home");
assertEqual("おねがいが届いた: 保護者 → 移動しない", routeForRequestPushType("chore_request", "parent"), null);
assertEqual("おねがいが届いた: みまもり → 移動しない", routeForRequestPushType("chore_request", "supporter"), null);
assertEqual("やってくれた: 保護者 → P8", routeForRequestPushType("chore_request_done", "parent"), "/parent/approvals");
assertEqual("やってくれた: 子ども → 移動しない", routeForRequestPushType("chore_request_done", "child"), null);
assertEqual("やってくれた: みまもり → 移動しない", routeForRequestPushType("chore_request_done", "supporter"), null);
assertEqual("ありがとう: 保護者 → /parent/inbox", routeForRequestPushType("gratitude_received", "parent"), "/parent/inbox");
assertEqual("ありがとう: 子ども → /child/inbox", routeForRequestPushType("gratitude_received", "child"), "/child/inbox");
assertEqual("ありがとう: みまもり → /supporter/inbox", routeForRequestPushType("gratitude_received", "supporter"), "/supporter/inbox");
assertEqual("ロール未確定（loading）→ null（確定後に再評価される）", routeForRequestPushType("gratitude_received", "loading"), null);
assertEqual("未ログイン → null", routeForRequestPushType("chore_request", "signedOut"), null);
assertEqual("知らないtype → null", routeForRequestPushType("comment", "parent"), null);
assertEqual("typeなし → null", routeForRequestPushType(undefined, "parent"), null);
assertEqual("担当のtype: chore_request", isRequestPushType("chore_request"), true);
assertEqual("担当のtype: gratitude_received", isRequestPushType("gratitude_received"), true);
assertEqual("担当でないtype: comment", isRequestPushType("comment"), false);

// ---- 12. ベル（D9） ----
const completions = [
  { id: "k2", chore_id: "r2", reported_by: "c1", reported_at: "2026-09-30T05:00:00Z" }, // r2は依頼者p2
  { id: "k4", chore_id: "n1", reported_by: "c1", reported_at: "2026-09-30T06:00:00Z" }, // 通常
  { id: "k5", chore_id: null, reported_by: "c1", reported_at: "2026-09-30T07:00:00Z" }, // chore_idなし
];
assertEqual(
  "子どものベル: c1宛て・未完了のおねがい（r2は完了・n1は通常）→ r1だけ",
  requestArrivedForChild(chores, completions, "c1").map((x) => x.chore.id),
  ["r1"]
);
assertEqual("子どものベル: 時刻はおねがいを作った時刻", requestArrivedForChild(chores, completions, "c1")[0].at, "2026-09-30T01:00:00Z");
assertEqual("子どものベル: c2宛てはc2にだけ", requestArrivedForChild(chores, completions, "c2").map((x) => x.chore.id), ["r3"]);
assertEqual("子どものベル: memberIdが空 → 空", requestArrivedForChild(chores, completions, ""), []);
assertEqual(
  "依頼者のベル: p2が作ったr2の完了だけp2に出る",
  requestDoneForRequester(chores, completions, "p2").map((x) => x.completion.id),
  ["k2"]
);
assertEqual("依頼者のベル: 別の保護者p1には出ない（r1・r3は未完了・r2はp2の分）", requestDoneForRequester(chores, completions, "p1"), []);
assertEqual("依頼者のベル: 完了報告が取り消されて消えたら項目も消える", requestDoneForRequester(chores, [], "p2"), []);
assertEqual("依頼者のベル: 時刻は完了報告の時刻", requestDoneForRequester(chores, completions, "p2")[0].at, "2026-09-30T05:00:00Z");
assertEqual("依頼者のベル: chore_idがNULLの完了報告は出さない", requestDoneForRequester(chores, [completions[2]], "p1"), []);

// ---- 13. 子どもの「かぞく」（D8） ----
assertEqual("かぞく: おねがいの完了は除く", shouldHideFromChildFamilyFeed({ chore_id: "r1" }, ids), true);
assertEqual("かぞく: 通常の完了は除かない", shouldHideFromChildFamilyFeed({ chore_id: "n1" }, ids), false);
assertEqual("かぞく: chore_idがNULLは除かない", shouldHideFromChildFamilyFeed({ chore_id: null }, ids), false);

console.log("");
if (failed === 0) {
  console.log("全件OK");
} else {
  console.log(`${failed}件NG`);
  process.exitCode = 1;
}
