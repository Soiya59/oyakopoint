/**
 * 「おねがい」（保護者から子どもへ。chores.is_request）の判定を1か所にまとめた純粋関数。
 *
 * 参照: 要件定義書07-43章、設計部/成果物/スキーマ設計.sql 82章・API仕様.md 38章、
 * UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 70章（70.13「開発部への申し送り」1）、
 * 開発部/成果物/実装メモ.md 335章。
 *
 * 子ども・保護者・みまもりの各画面（C5・C6・C7・P7・P8・P9・P10・P16・P18・C8・C15・S1・S2・
 * S12・ベル・かぞくフィード・P22の「おねがいする」タブ）が同じ関数を呼ぶ。画面ごとに
 * 「+0pt を出すか」「選べる子どもは誰か」を書き分けると、食い違いが起きる（70.9節）。
 *
 * [制約] `*.verify.ts`からNode単体で読み込めるよう、値のimportを一切持たない
 * （src/lib/oneOffFinished.tsと同じ）。型は構造的（必要な列だけ）に書く。
 */

// ============================================================
// 型（必要な列だけを持つ構造的な型）
// ============================================================

export interface RequestChoreLike {
  id: string;
  is_request?: boolean;
  assigned_to: string | null;
}

export interface RequestCompletionLike {
  chore_id: string | null;
}

export interface RequestChildLike {
  id: string;
  display_name: string;
}

// ============================================================
// 判定（おねがいか）
// ============================================================

/** おねがい（`chores.is_request`が真）か。 */
export function isRequestChore(chore: { is_request?: boolean } | null | undefined): boolean {
  return chore?.is_request === true;
}

/**
 * どの画面にも出さない行（担当だった子どもがいなくなったおねがい。`is_request`が真で
 * `assigned_to`が空。企画部決定10の★・API仕様.md 38.3章）。**P10だけは例外**で「担当なし」として
 * 「終わった単発のクエスト」の区分に並べ、開くと取り下げだけできる（70.8節。`isRequestWithoutAssignee`）。
 */
export function isHiddenRequestChore(chore: { is_request?: boolean; assigned_to: string | null }): boolean {
  return isRequestChore(chore) && chore.assigned_to === null;
}

/** P10で「おねがい・担当なし」として扱う行か（`isHiddenRequestChore`と同じ条件。名前で意図を分ける）。 */
export function isRequestWithoutAssignee(chore: { is_request?: boolean; assigned_to: string | null }): boolean {
  return isHiddenRequestChore(chore);
}

/** 家族のクエスト一覧から、おねがいの`chore_id`の集合を作る（完了報告の判定に使う）。 */
export function buildRequestChoreIdSet(chores: readonly { id: string; is_request?: boolean }[]): Set<string> {
  const ids = new Set<string>();
  for (const c of chores) {
    if (isRequestChore(c)) ids.add(c.id);
  }
  return ids;
}

/**
 * 完了報告がおねがいのものか（`chore_id`から引いた`chores.is_request`が真）。
 * **`chore_id`がNULLの完了報告は、おねがいではない普通のものとして扱う**（やってくれたおねがいは
 * 取り下げ不可のため、おねがいの完了報告の`chore_id`がNULLになる経路は無い。API仕様.md 38.3章）。
 */
export function isRequestCompletion(
  completion: RequestCompletionLike,
  requestChoreIds: ReadonlySet<string>
): boolean {
  return completion.chore_id !== null && requestChoreIds.has(completion.chore_id);
}

/**
 * 「+Npt」の断片を出してよいポイントか（70.9節D16・企画部決定23・U12。2026-09-30再改訂）。
 * - **おねがい**: `points`が**0より大きいときだけ**出す。0のときは出さない（「ポイントなし」のおねがいに
 *   「+0」と出すと「0しかもらえない」と読めるため）。
 * - **普通のクエスト**: 今までどおり。`points`が数値なら0でも出す（07-28章決定26「+0pt」）。
 *   台紙型で`points`がNULLのときは出さない（既存の扱い）。
 * 判定はここの1か所。画面ごとに「おねがいなら出さない」を書き分けない。
 */
export function shouldShowPointsValue(points: number | null | undefined, isRequest: boolean): boolean {
  if (points === null || points === undefined) return false;
  return isRequest ? points > 0 : true;
}

/**
 * 「+Npt」を出してよい完了報告か（70.9節D16の規則。「+0pt」の断片だけを出さない。行そのものは残す）。
 * おねがいの完了報告は`points`が0より大きいときだけ（`chore_completions.points`は完了時のスナップショット）。
 * 通常の完了報告は今までどおり（ポイントがあれば0でも出す）。
 */
export function shouldShowCompletionPoints(
  completion: RequestCompletionLike & { points?: number | null },
  requestChoreIds: ReadonlySet<string>
): boolean {
  return shouldShowPointsValue(completion.points, isRequestCompletion(completion, requestChoreIds));
}

/**
 * 一覧の行の「+Npt」を出してよいクエストか（`chore.points`。おねがいは0より大きいときだけ。
 * 普通のクエストは今までどおり常に出す。決定23）。
 */
export function shouldShowChorePoints(chore: { is_request?: boolean; points?: number | null }): boolean {
  if (!isRequestChore(chore)) return true;
  return shouldShowPointsValue(chore.points, true);
}

/** 「+Npt」の書式（通常のクエストの行と同じ）。 */
export function formatPointsAmount(points: number): string {
  return `+${points}pt`;
}

// ============================================================
// 子どもの画面の印（C5・C6）
// ============================================================

export const REQUEST_BADGE_FALLBACK_NAME = "おうちの ひと";

/** 子どものカードの印「{依頼者}から おねがい」（依頼者が分からないときは「おうちの ひとから おねがい」）。 */
export function requestBadgeText(creatorDisplayName: string | null | undefined): string {
  const name = creatorDisplayName && creatorDisplayName.trim().length > 0 ? creatorDisplayName.trim() : REQUEST_BADGE_FALLBACK_NAME;
  return `${name}から おねがい`;
}

// ============================================================
// 未完了のおねがいの上限（D19。子ども1人につき3つまで。DBの`max_open_requests_per_child()`と同じ値）
// ============================================================

/**
 * 子ども1人の「未完了のおねがい」の数（端末側の式。API仕様.md 38.2.1節）。
 * `is_request`・`is_active`・担当がその子ども・完了報告が1件も無い、の4つを満たす行を数える。
 * 担当が空の行はどの子どもにも数えない。取り下げ・完了で減る。
 * `isFinished`は「そのおねがいに完了報告が1件でもあるか」（`useChoreCompletionTotals`の`isOneOffFinished`）。
 * 別の端末・別の保護者が同時に作ることがあるので、最終防衛線はDBの`RQ001`。
 */
export function countOpenRequestsForChild<C extends { id: string; is_request?: boolean; is_active?: boolean; assigned_to: string | null }>(
  chores: readonly C[],
  childId: string,
  isFinished: (chore: C) => boolean
): number {
  return chores.filter(
    (c) => isRequestChore(c) && c.is_active !== false && c.assigned_to === childId && !isFinished(c)
  ).length;
}

/** 未完了の数が上限に達しているか（新しく頼めないか）。 */
export function isRequestFull(openCount: number, max: number): boolean {
  return openCount >= max;
}

export interface RequestChildOption {
  id: string;
  name: string;
  full: boolean;
}

/** 「だれに」のチップ。満杯の子は`full`（淡色にして押せなくする）。 */
export function buildRequestChildOptions<C extends { id: string; is_request?: boolean; is_active?: boolean; assigned_to: string | null }>(
  children: readonly RequestChildLike[],
  chores: readonly C[],
  isFinished: (chore: C) => boolean,
  max: number
): RequestChildOption[] {
  return children.map((c) => ({
    id: c.id,
    name: c.display_name,
    full: isRequestFull(countOpenRequestsForChild(chores, c.id, isFinished), max),
  }));
}

/**
 * 開いた直後の選択。**子どもが1人だけの家族**は最初から選択済み（題名だけ入れればよい）。ただし
 * その子が満杯のときは選択済みにしない。子どもが2人以上のときは誰も選ばない（頼む相手を間違えないため）。
 */
export function initialRequestSelection(options: readonly RequestChildOption[]): string[] {
  if (options.length === 1 && !options[0].full) return [options[0].id];
  return [];
}

/** チップを押したときの選択。満杯の子は選べない（何も変わらない）。 */
export function toggleRequestSelection(
  selection: readonly string[],
  options: readonly RequestChildOption[],
  childId: string
): string[] {
  const opt = options.find((o) => o.id === childId);
  if (!opt || opt.full) return [...selection];
  return selection.includes(childId) ? selection.filter((id) => id !== childId) : [...selection, childId];
}

/**
 * 選択中の子どもが満杯になった（別の保護者が同時に頼んだ・一覧を取り直した）ときに、
 * その子を選択から外す。選べない子が選択されたままにならないようにする。
 */
export function pruneRequestSelection(
  selection: readonly string[],
  options: readonly RequestChildOption[]
): string[] {
  const valid = new Set(options.filter((o) => !o.full).map((o) => o.id));
  return selection.filter((id) => valid.has(id));
}

/** 満杯の子の名前（理由の文に使う。並びは`options`の順）。 */
export function fullChildNames(options: readonly RequestChildOption[]): string[] {
  return options.filter((o) => o.full).map((o) => o.name);
}

/** 全員が満杯か（保存ボタンは無効のまま。理由の文だけ出す）。 */
export function isAllRequestFull(options: readonly RequestChildOption[]): boolean {
  return options.length > 0 && options.every((o) => o.full);
}

// ============================================================
// 題名
// ============================================================

/** 題名の前後の空白を除く（空白だけは無効）。 */
export function normalizeRequestTitle(raw: string): string {
  return raw.trim();
}

/** 題名のカウンター（「{n}/{max}」）と、残りがしきい値以下か（アンバーにする。赤は使わない）。 */
export function requestTitleCounter(
  raw: string,
  max: number,
  warnThreshold: number
): { count: number; text: string; warn: boolean } {
  const count = raw.length;
  return { count, text: `${count}/${max}`, warn: max - count <= warnThreshold };
}

/**
 * 保存できるか（子どもを1人以上選び、題名が1字以上で、**ポイントが選ばれていて**、保存中でない）。
 * `points`は**`null`＝未選択**、`0`＝「ポイントなし」を選んだ、を区別する（統括判断U9。`points !== null`で
 * 判定し、`!points`のような真偽では判定しない。0を「未選択」と取り違えない）。
 */
export function canSubmitRequest(input: {
  selectedCount: number;
  title: string;
  points: number | null;
  saving: boolean;
}): boolean {
  return (
    !input.saving &&
    input.selectedCount >= 1 &&
    normalizeRequestTitle(input.title).length >= 1 &&
    input.points !== null
  );
}

// ============================================================
// ポイントの欄（D20〜D22。2026-09-30再改訂）
// ============================================================

/**
 * ポイントのチップの値（「ポイントなし」＝0と、1〜max）。並びは固定で、`max`（`theme.requestLimit.maxPoints`）から
 * 作る（3をチップにベタ書きしない）。
 */
export function requestPointChoices(max: number): number[] {
  const out: number[] = [];
  for (let n = 0; n <= max; n += 1) out.push(n);
  return out;
}

/** 頼むときのポイントとして正しいか（0以上max以下の整数）。範囲外・小数・NaNは送らない（DBが最終防衛線）。 */
export function isValidRequestPoints(points: number, max: number): boolean {
  return Number.isInteger(points) && points >= 0 && points <= max;
}

/**
 * ポイントのチップの並べ方（70.11節D22）。文字の大きさの設定（`PixelRatio.getFontScale()`）が
 * `gridThreshold`（`theme.requestLimit.pointChipsGridFontScale`、1.3）以上なら2行2列、それより小さければ1行。
 * 1行のときの幅の配りは`requestPointChipFlex`。
 */
export function requestPointChipsLayout(fontScale: number, gridThreshold: number): "row" | "grid" {
  return fontScale >= gridThreshold ? "grid" : "row";
}

/** 1行に並べるときのチップの幅の割合。「ポイントなし」（6字）は1.7、ほかは1（D22）。 */
export function requestPointChipFlex(points: number): number {
  return points === 0 ? 1.7 : 1;
}

/** 2行2列のときの行への分け方（各行2つ。順番は変えない）。 */
export function splitPointChoicesIntoRows(choices: readonly number[], perRow: number): number[][] {
  const rows: number[][] = [];
  for (let i = 0; i < choices.length; i += perRow) rows.push(choices.slice(i, i + perRow));
  return rows;
}

// ============================================================
// 保存の結果（子どもごと。API仕様.md 38.2章）
// ============================================================

export type RequestOutcomeStatus = "ok" | "full" | "failed";

/** 1人分の保存の失敗が「3つまで」か、それ以外か（`error.code`がRQ001なら"full"）。 */
export function requestFailureStatus(errorCode: string | null | undefined, limitCode: string): "full" | "failed" {
  return errorCode === limitCode ? "full" : "failed";
}

export interface RequestOutcome {
  childId: string;
  status: RequestOutcomeStatus;
}

export interface RequestOutcomeSummary {
  allOk: boolean;
  okIds: string[];
  fullIds: string[];
  failedIds: string[];
  /** 「もう一度おねがいする」の対象＝通信などの失敗だけ。成功済みは二度作らず、満杯の子は何度押しても同じなので含めない。 */
  retryIds: string[];
  /** 全員が「3つまで」で失敗した（押せるのは「ここまでの分でよい」だけ）。 */
  onlyFull: boolean;
}

export function summarizeRequestOutcomes(outcomes: readonly RequestOutcome[]): RequestOutcomeSummary {
  const okIds = outcomes.filter((o) => o.status === "ok").map((o) => o.childId);
  const fullIds = outcomes.filter((o) => o.status === "full").map((o) => o.childId);
  const failedIds = outcomes.filter((o) => o.status === "failed").map((o) => o.childId);
  return {
    allOk: outcomes.length > 0 && okIds.length === outcomes.length,
    okIds,
    fullIds,
    failedIds,
    retryIds: failedIds,
    onlyFull: outcomes.length > 0 && fullIds.length === outcomes.length,
  };
}

// ============================================================
// P22（感謝ポイントの画面）が受け取る引数（D13。名前は`to`・`draft`・`tab`・`from`）
// ============================================================

export type GratitudeSendTab = "thanks" | "request";
export type GratitudeSendFrom = "approvals" | null;

export interface GratitudeSendInitial {
  tab: GratitudeSendTab;
  recipientId: string | null;
  draft: string;
  from: GratitudeSendFrom;
}

/** ひとことの上限（200字。gratitude_pointsのCHECKと同じ）。 */
export const GRATITUDE_NOTE_MAX = 200;

/** 「{題名}をやってくれた」（P8・P9のボタンから渡す下書き。編集できる）。 */
export function requestDraftNote(title: string): string {
  return `${title}をやってくれた`.slice(0, GRATITUDE_NOTE_MAX);
}

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * URLの引数から、開いたときのタブ・相手・下書きを決める。
 * - `to`が「在籍中で自分以外」（`candidateIds`に含まれる）ならその人を選択済みにする。含まれなければ
 *   **何も選ばず、下書きも入れない**（相手の分からない下書きは意味が無い。エラーは出さない）。
 * - `draft`は**やりとりスイッチがONのとき（ひとこと欄があるとき）だけ**渡す。OFFなら捨てる。200字で切る。
 * - `tab`は`request`のときだけおねがいのタブ。それ以外は「ありがとうを贈る」（既定）。
 * - `from`は`approvals`のときだけ（残り0のときの戻る導線の名前を変える）。
 */
export function parseGratitudeSendParams(
  params: { to?: string | string[]; draft?: string | string[]; tab?: string | string[]; from?: string | string[] },
  candidateIds: readonly string[],
  interactionsEnabled: boolean
): GratitudeSendInitial {
  const tab: GratitudeSendTab = firstParam(params.tab) === "request" ? "request" : "thanks";
  const from: GratitudeSendFrom = firstParam(params.from) === "approvals" ? "approvals" : null;
  const to = firstParam(params.to);
  const recipientId = to && candidateIds.includes(to) ? to : null;
  const rawDraft = firstParam(params.draft) ?? "";
  const draft = recipientId && interactionsEnabled ? rawDraft.slice(0, GRATITUDE_NOTE_MAX) : "";
  return { tab, recipientId, draft, from };
}

// ============================================================
// P22「ありがとうを贈る」タブの、1日の上限（残り0）の案内（D14）
// ============================================================

export type GratitudeBalanceState = "loading" | "error" | "ready";

/** 残りが0と分かったか（案内カードを出し、フォームを出さない）。読み込み中・失敗のときは出さない。 */
export function shouldShowGratitudeLimitCard(state: GratitudeBalanceState, balance: number | null): boolean {
  return state === "ready" && balance !== null && balance <= 0;
}

/** 「もどる」の名前。P8・P9から来た（`from=approvals`）ときだけ「完了報告にもどる」。 */
export function gratitudeLimitBackLabel(from: GratitudeSendFrom): string {
  return from === "approvals" ? "完了報告にもどる" : "感謝ポイントにもどる";
}

/** 戻れないときの行き先。 */
export function gratitudeLimitBackRoute(from: GratitudeSendFrom): "/parent/approvals" | "/parent/gratitude" {
  return from === "approvals" ? "/parent/approvals" : "/parent/gratitude";
}

/**
 * 送信の失敗が「1日の上限（原資）を超えた」競合か（別の保護者が最後の1ptを贈った直後など）。
 * このときは残りを0に置き換えて案内カードを出す（DBの生の文言を出さない。70.7節D14）。
 * `limitCode`はcheck_violation（23514）、原資の文言に「原資」を含む（既存の判定と同じ）。
 */
export function isGratitudeAllowanceConflict(
  error: { code: string; message: string },
  checkViolationCode: string
): boolean {
  return error.code === checkViolationCode && error.message.includes("原資");
}

// ============================================================
// 通知をタップしたときの遷移先（D10）
// ============================================================

/** `NotificationSoftAsk.tsx`の`SessionStatus`と同じ文字列（値のimportを持たないため文字列で受ける）。 */
export type PushRouteStatus = string;

/**
 * おねがい・感謝ポイントの通知のタップ先（70.5節D10）。ログイン中のロールで決める。決められないときは
 * nullを返し、呼び出し側は何もしない（共有端末で保護者がログイン中のとき、子ども向けの画面へ勝手に
 * 飛ばさない）。
 * - `chore_request`（おねがいが届いた）: 子ども→子どものホーム。それ以外は移動しない。
 * - `chore_request_done`（やってくれた）: 保護者→完了報告一覧（P8）。それ以外は移動しない。
 * - `gratitude_received`（ありがとうが届いた）: 各ロールの「とどいたよ」。
 * 知らない`type`はnull。
 */
export function routeForRequestPushType(type: string | undefined, status: PushRouteStatus): string | null {
  if (type === "chore_request") return status === "child" ? "/child/home" : null;
  if (type === "chore_request_done") return status === "parent" ? "/parent/approvals" : null;
  if (type === "gratitude_received") {
    if (status === "parent") return "/parent/inbox";
    if (status === "child") return "/child/inbox";
    if (status === "supporter") return "/supporter/inbox";
    return null;
  }
  return null;
}

/** この`data.type`が本モジュールの担当（おねがい・感謝ポイントの通知）か。 */
export function isRequestPushType(type: string | undefined): boolean {
  return type === "chore_request" || type === "chore_request_done" || type === "gratitude_received";
}

// ============================================================
// ベル「とどいたよ」（D9。端末が持つchores・chore_completionsから組み立てる）
// ============================================================

export interface RequestInboxChore {
  id: string;
  is_request?: boolean;
  is_active?: boolean;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
}

export interface RequestInboxCompletion {
  id: string;
  chore_id: string | null;
  reported_by: string;
  reported_at: string;
}

/**
 * 子どものベル「💌 おねがいが とどいたよ」の項目（自分が担当の、まだやっていないおねがい）。
 * 取り下げられると消える（choresから消える）。やったあとは、一覧から消えるのと同じに項目も消す
 * （`completions`に自分の完了報告があれば除く）。題名は載せない（呼び出し側が出さない）。
 */
export function requestArrivedForChild<C extends RequestInboxChore>(
  chores: readonly C[],
  completions: readonly RequestInboxCompletion[],
  childId: string
): { chore: C; at: string }[] {
  if (!childId) return [];
  const doneIds = new Set(completions.flatMap((c) => (c.chore_id ? [c.chore_id] : [])));
  return chores
    .filter((c) => isRequestChore(c) && c.is_active !== false && c.assigned_to === childId && !doneIds.has(c.id))
    .map((c) => ({ chore: c, at: c.created_at }));
}

/**
 * 依頼者の保護者のベル「✅ おねがいを やってくれました」の項目（自分が作ったおねがいの完了報告）。
 * **他の保護者・みまもりには出さない**。1分以内の取消（完了報告の削除）で消える。
 */
export function requestDoneForRequester<C extends RequestInboxChore, K extends RequestInboxCompletion>(
  chores: readonly C[],
  completions: readonly K[],
  requesterId: string
): { chore: C; completion: K; at: string }[] {
  if (!requesterId) return [];
  const byId = new Map(chores.map((c) => [c.id, c]));
  const out: { chore: C; completion: K; at: string }[] = [];
  for (const k of completions) {
    if (!k.chore_id) continue;
    const chore = byId.get(k.chore_id);
    if (chore && isRequestChore(chore) && chore.created_by === requesterId) {
      out.push({ chore, completion: k, at: k.reported_at });
    }
  }
  return out;
}

// ============================================================
// 子どもの「かぞく」（D8。おねがいの完了を並べない）
// ============================================================

/** 子どもの「かぞく」の並びから除く完了報告か（おねがいの完了。`chore_id`がNULLは除かない）。 */
export function shouldHideFromChildFamilyFeed(
  completion: RequestCompletionLike,
  requestChoreIds: ReadonlySet<string>
): boolean {
  return isRequestCompletion(completion, requestChoreIds);
}
