/**
 * 感謝ポイントへの「スタンプの返し」（gratitude_reactions）の判定・組み立てを1か所にまとめた純粋関数。
 *
 * 参照: 要件定義書07-45章、設計部/成果物/スキーマ設計.sql 83章・API仕様.md 39章、
 * UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 71章（71.10「開発部への申し送り」）、
 * 開発部/成果物/実装メモ.md 347章。
 *
 * 3ロール（保護者P34・子どもC29・みまもりS22）のベル「とどいたもの／とどいたよ」（`InboxPanel`）と、
 * ホームのベルの件数（`countRecentInbox`）が同じ関数を呼ぶ。画面ごとに「いつ入口を出すか」
 * 「贈った人の項目をどう組み立てるか」を書き分けると食い違いが起きるため、ここに集めた。
 *
 * 守ること（07-45章 決定5・10。71.5節）:
 *  - **「押していない」を数えない・返さない。**ここにあるのは、押された行から作る関数だけ。
 *    「まだ押していない感謝の一覧／件数」を返す関数は作らない。
 *  - 集計（スタンプの数・順位・「今月◯個」）を作らない。`countGratitudeStampArrivals`は
 *    ホームのベルの「直近に届いた件数」（既存の`countRecentInbox`と同じ意味）だけ。
 *
 * [制約] `*.verify.ts`からNode単体で読み込めるよう、値のimportを一切持たない
 * （src/lib/requestChore.tsと同じ）。日付は呼び出し側が`toJstDateString`で計算した
 * JST基準の"YYYY-MM-DD"を渡す（src/lib/weeklyReviewDisplay.tsと同じ）。
 */

// ============================================================
// 失敗の振り分け（API仕様.md 39.3章）
// ============================================================

/** RPCが返す専用のHINT（スキーマ設計.sql 83.6章）。 */
export const GRATITUDE_STAMP_HINT_NOT_ALLOWED = "gratitude_stamp_not_allowed";
export const GRATITUDE_STAMP_HINT_SENDER_LEFT = "gratitude_sender_left";

// PG_ERRCODE（src/data/api.ts）と同じ値。このファイルは値のimportを持たないため書き写している
// （値がずれたら両方直す。pgFailureRef.tsと同じ事情）。
const SQLSTATE_NO_DATA_FOUND = "P0002";
const SQLSTATE_CHECK_VIOLATION = "23514";

/**
 * RPC`toggle_gratitude_stamp`が「この操作は受け付けられない」と**断った**失敗か。
 * 断られた系は、画面では通信の失敗と同じ一文で出したうえで、**全体を取り直す**（取り消された感謝は
 * カードごと消え、贈った人が抜けていれば入口の行が消える。71.4節）。
 *  - `no_data_found`（P0002）: 感謝が無い・他家族・自分が受け取った感謝ではない・取り消し済み。
 *  - `check_violation`（23514）＋HINT: 種類が4種以外／贈った人が家族から抜けている。
 * 通信・混み合い・ログイン切れ・権限（42501）は断られたのではないので、取り直さない（押し直せる）。
 */
export function isGratitudeStampRefused(error: { code: string; hint?: string }): boolean {
  if (error.code === SQLSTATE_NO_DATA_FOUND) return true;
  if (error.code === SQLSTATE_CHECK_VIOLATION) {
    return error.hint === GRATITUDE_STAMP_HINT_NOT_ALLOWED || error.hint === GRATITUDE_STAMP_HINT_SENDER_LEFT;
  }
  return false;
}

// ============================================================
// 型（必要な列だけを持つ構造的な型）
// ============================================================

export interface GratitudeLike {
  id: string;
  sender_id: string;
  recipient_id: string;
  points: number;
  note: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface GratitudeReactionLike {
  gratitude_id: string;
  stamp_key: string;
  created_at: string;
}

// ============================================================
// 受け取った人のカード（スタンプの行）
// ============================================================

/** この感謝に今付いているスタンプの種類（なければnull）。取得できていない（null）ときもnull。 */
export function stampKeyOf(
  reactions: readonly GratitudeReactionLike[] | null,
  gratitudeId: string
): string | null {
  if (!reactions) return null;
  return reactions.find((r) => r.gratitude_id === gratitudeId)?.stamp_key ?? null;
}

/**
 * 感謝カードにスタンプの行（入口）を出すか（71.2節 E6・71.10節）。次の4つをすべて満たすとき:
 *  1. 自分が受け取った感謝（`recipient_id`が自分）
 *  2. 取り消されていない（`revoked_at`がnull）
 *  3. 贈った人が家族に在籍中（メンバー一覧の`is_active`がtrue。見つからなければfalse）
 *  4. スタンプのデータを取得済み（取得前・失敗時は出さない。押した状態が分からないまま4つ並べると、
 *     押した1つが押していないように見え、押すと取り消しになるため）
 * 「家族のやりとりを使う」トグルは見ない（オフでも出す。07-45章 決定11）。
 */
export function canShowGratitudeStampRow(args: {
  gratitude: Pick<GratitudeLike, "recipient_id" | "revoked_at">;
  memberId: string;
  senderIsActive: boolean;
  reactionsLoaded: boolean;
}): boolean {
  return (
    args.reactionsLoaded &&
    args.gratitude.recipient_id === args.memberId &&
    args.gratitude.revoked_at === null &&
    args.senderIsActive
  );
}

// ============================================================
// 贈った人のベルの項目（71.3節）
// ============================================================

/** 贈った人のベルに並べる「届いたスタンプ」1件。 */
export interface GratitudeStampArrival {
  /** 感謝のid（ベルの項目のid＝`gratitude_stamp:${gratitudeId}`。入れ替えても項目は増えない）。 */
  gratitudeId: string;
  /** スタンプを押した人＝感謝を受け取った人。 */
  recipientId: string;
  stampKey: string;
  /** スタンプを押した時刻（感謝を贈った時刻ではない。入れ替えたときは新しい時刻）。 */
  at: string;
  note: string | null;
  points: number;
  /** 感謝を贈った時刻。 */
  sentAt: string;
}

/**
 * 自分が贈った感謝（`sender_id`が自分・取り消されていない）に付いたスタンプを、押された時刻の新しい順に返す。
 * 受け取った人が自分で押したスタンプは含めない（届いたものではないため）。
 * 感謝の行が見つからないスタンプ（取り直しの途中でずれた等）は黙って除く。
 * `knownKeys`を渡すと、そこに無い種類（将来DBの許可リストが増えて、古いアプリが知らない種類）も除く
 * （画面が描けない項目をベルに出さない。件数にも数えない）。
 */
export function gratitudeStampArrivals(
  gratitude: readonly GratitudeLike[],
  reactions: readonly GratitudeReactionLike[] | null,
  memberId: string,
  knownKeys?: readonly string[]
): GratitudeStampArrival[] {
  if (!memberId || !reactions) return [];
  const mine = new Map(
    gratitude.filter((g) => g.sender_id === memberId && g.revoked_at === null).map((g) => [g.id, g])
  );
  const out: GratitudeStampArrival[] = [];
  for (const r of reactions) {
    const g = mine.get(r.gratitude_id);
    if (!g) continue;
    if (knownKeys && !knownKeys.includes(r.stamp_key)) continue;
    out.push({
      gratitudeId: g.id,
      recipientId: g.recipient_id,
      stampKey: r.stamp_key,
      at: r.created_at,
      note: g.note,
      points: g.points,
      sentAt: g.created_at,
    });
  }
  return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** ホームのベルの件数に数える、自分が贈った感謝に「直近に」届いたスタンプの数（`sinceMs`以降に押された分）。 */
export function countGratitudeStampArrivals(
  gratitude: readonly GratitudeLike[],
  reactions: readonly GratitudeReactionLike[] | null,
  memberId: string,
  sinceMs: number,
  knownKeys?: readonly string[]
): number {
  return gratitudeStampArrivals(gratitude, reactions, memberId, knownKeys).filter((a) => new Date(a.at).getTime() >= sinceMs).length;
}

/** ひとことの先頭20字（超えたら「…」）。`InboxPanel`の`boardPostExcerpt`と同じ長さ・同じ書式。 */
export function gratitudeNoteExcerpt(note: string, max = 20): string {
  return note.length > max ? `${note.slice(0, max)}…` : note;
}

/**
 * 贈った人のベルの項目の「どの感謝への返事か」の一言（71.3節）。先頭に「💌 」。
 *  - ひとこと（`note`）があれば、先頭20字を「」で囲む。
 *  - 無ければ「{贈った日}に贈った {n}pt」（子どもは「おくった」）。日付はM/D（JST）。
 *    贈った年が今年と違うときは「2025/12/1」のように年から書く。
 * 引数の日付は、呼び出し側が`toJstDateString`で計算した"YYYY-MM-DD"（JST）。
 * 「返事」の語は画面に出さない（71.5節 #1）。
 */
export function gratitudeStampSubject(args: {
  note: string | null;
  points: number;
  sentJstDate: string;
  todayJstDate: string;
  child: boolean;
}): string {
  const note = args.note?.trim();
  if (note) return `💌 「${gratitudeNoteExcerpt(note)}」`;
  const [y, m, d] = args.sentJstDate.split("-").map(Number);
  const thisYear = Number(args.todayJstDate.split("-")[0]);
  const date = y === thisYear ? `${m}/${d}` : `${y}/${m}/${d}`;
  return args.child ? `💌 ${date}に おくった ${args.points}pt` : `💌 ${date}に贈った ${args.points}pt`;
}

// ============================================================
// 読み上げ（71.2節の表。「返す」「おへんじ」の語は使わない）
// ============================================================

export function gratitudeStampAccessibility(
  tone: "parent" | "child" | "supporter",
  stampLabel: string,
  selected: boolean
): { label: string; hint: string } {
  if (tone === "child") {
    return selected
      ? { label: `${stampLabel}の スタンプ。えらんでいるよ`, hint: "もういちど おすと、とりけせるよ" }
      : { label: `${stampLabel}の スタンプ`, hint: "おすと、スタンプが とどくよ" };
  }
  return selected
    ? { label: `${stampLabel}のスタンプ。選択中`, hint: "もう一度押すと、取り消します" }
    : { label: `${stampLabel}のスタンプ`, hint: "押すと、スタンプが届きます" };
}
