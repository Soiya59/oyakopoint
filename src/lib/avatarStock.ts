/**
 * [2026-09-30新設・要件定義書07-44章、主要画面ワイヤーフレーム.md 69章、
 * スキーマ設計.sql 81章、開発部/成果物/実装メモ.md 334章]
 * アバターの「まえのアバター」（ストック3枚）に関する画面側の判定を、React・通信から
 * 切り離した純粋関数にしたもの（src/lib/avatarStock.verify.tsで確かめる）。
 *
 * **DBが最終防衛線**（同時操作で別の端末が先に埋めることがある）。ここの判定は「押せない
 * ボタンを事前に無効にして理由を出す」ためのもので、通ってもDBがAV001で断ることがある
 * （そのときは画面が一覧を取り直して理由カードを出す。useAvatarEditing.ts）。
 *
 * [制約] `*.verify.ts`からNode単体で読み込めるよう、値のimportを一切持たない
 * （型のみ`import type`）。上限の枚数（3）はここに持たず、呼び出し側が
 * `theme.avatarStock.maxSlots`を引数で渡す（DBのmax_avatar_stock_per_member()と同じ値）。
 */
import type { FamilyDrawingLine, FamilyDrawingLineData, MemberAvatarStockRow } from "@/types/domain";

export type AvatarStockStatus = "loading" | "ready" | "error";

/**
 * JSONとしての等しさ（オブジェクトのキーの順序は無視する）。サーバー側の
 * `save_member_avatar`が使うJSONBの`=`と同じ考え方（スキーマ設計.sql 81.4章）。
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const aa = a as unknown[];
    const bb = b as unknown[];
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i += 1) {
      if (!jsonEqual(aa[i], bb[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false;
    if (!jsonEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * キャンバスの絵が「今の絵と全く同じ」か。保存しても何も足されない・何も変わらない扱い
 * （サーバーは`unchanged`を返す。決定11・決定13(d)）。今の絵が無い（null）ときは常にfalse。
 * 「読み込んだまま触っていない」の判定（決定7）にも同じ関数を使う（キャンバスは開いた時点で
 * 今の絵を読み込み、戻す・保存のたびに今の絵と揃えるため）。
 */
export function isCanvasSameAsSaved(lines: FamilyDrawingLine[], saved: FamilyDrawingLineData | null): boolean {
  if (saved === null) return false;
  return jsonEqual({ v: 1, lines }, saved);
}

/**
 * 「これにする」（保存）を止めるか（決定13）。次の**4つがすべて**当てはまるとき。
 * (a) まえのアバターが上限（3枚）いっぱい、(b) 今の絵がある（保存すると今の絵を押し出す）、
 * (c) キャンバスに線が1本以上ある、(d) キャンバスが「今の絵と同じ」ではない。
 * (b)が無い（色＋頭文字だけ）、または(d)が無い（開いたまま何も触っていない）ときは、
 * いっぱいでも保存できる（DBも同じ条件で通す。スキーマ設計.sql 81.4章）。
 * `stockCount`は「一覧を読めているとき」だけ渡す（読めていない間は止めない＝呼び出し側で
 * `null`を渡す。DBが最終防衛線）。
 */
export function isAvatarSaveBlocked(args: {
  stockCount: number | null;
  maxSlots: number;
  hasSavedAvatar: boolean;
  lineCount: number;
  sameAsSaved: boolean;
}): boolean {
  const { stockCount, maxSlots, hasSavedAvatar, lineCount, sameAsSaved } = args;
  if (stockCount === null) return false;
  return stockCount >= maxSlots && hasSavedAvatar && lineCount > 0 && !sameAsSaved;
}

/**
 * 「色にもどす」を止めるか（決定16）。まえのアバターが上限いっぱいで、今の絵がある
 * （＝色にもどすで今の絵を押し出す）とき。今の絵が無ければ、そもそもリンクを出さない。
 */
export function isAvatarResetBlocked(args: {
  stockCount: number | null;
  maxSlots: number;
  hasSavedAvatar: boolean;
}): boolean {
  const { stockCount, maxSlots, hasSavedAvatar } = args;
  if (stockCount === null) return false;
  return hasSavedAvatar && stockCount >= maxSlots;
}

/**
 * 「まえのアバター」の欄（見出し・枠3つ）を出すか（決定4）。今の絵がある、または
 * まえのアバターが1枚以上あるとき（色にもどしたあとは、今の絵が無くても1枚以上入っている）。
 * まだ一度も絵を保存していない人には出さない。一覧を読み込み中・読み込み失敗のときは、
 * 枚数が分からないので「今の絵がある」ときだけ出す（色＋頭文字のままの人に、読めていない
 * 欄を出さない）。
 */
export function shouldShowStockSection(args: {
  hasSavedAvatar: boolean;
  stockCount: number;
  status: AvatarStockStatus;
}): boolean {
  const { hasSavedAvatar, stockCount, status } = args;
  if (status === "ready") return hasSavedAvatar || stockCount > 0;
  return hasSavedAvatar;
}

/**
 * 枠3つ（左が一番新しい・空き枠はnull）。DBは常に上限以下だが、上限を下げる変更が
 * 出たとき等に超えていても、枠の数（maxSlots）で打ち切る（幅を固定するため）。
 */
export function buildStockSlots(stocks: MemberAvatarStockRow[], maxSlots: number): (MemberAvatarStockRow | null)[] {
  const slots: (MemberAvatarStockRow | null)[] = [];
  for (let i = 0; i < maxSlots; i += 1) {
    slots.push(i < stocks.length ? stocks[i] : null);
  }
  return slots;
}

/**
 * 「これにもどす」の成功後、キャンバスを戻した絵に差し替えてよいか（決定7）。
 * キャンバスが「今の絵のまま触っていない」（＝今の絵と同じで、線がある）ときだけ差し替える。
 * 描き足した・消した（触っている）、または空（保存直後・ぜんぶけす後）のときは触らない
 * （描きかけは絶対に消さない）。
 */
export function shouldReplaceCanvasAfterRestore(
  lines: FamilyDrawingLine[],
  savedBeforeRestore: FamilyDrawingLineData | null
): boolean {
  return lines.length > 0 && isCanvasSameAsSaved(lines, savedBeforeRestore);
}

/**
 * 戻したあと「描いている途中の絵はそのままです」を出すか（決定7）。キャンバスに線が
 * あって、差し替えなかったときだけ（空のキャンバスには残るものが無い）。
 */
export function shouldNoteDraftKept(lines: FamilyDrawingLine[], replaced: boolean): boolean {
  return lines.length > 0 && !replaced;
}

/**
 * 保存の結果`result`が、「前の絵は『まえのアバター』に残ったよ」を出す場合か（決定11）。
 * `stocked`のときだけ（`created`＝初めて描いた・`unchanged`＝同じ絵のままは出さない）。
 */
export function savedResultLeftPreviousInStock(result: string): boolean {
  return result === "stocked";
}

/**
 * 枠の選択を、一覧が変わったあとも保てるか。選んでいた絵が一覧から消えた
 * （別の端末で先に戻された・消された・入れ替えでidが変わった）ときはnull。
 */
export function keepSelectedStockId(selectedId: string | null, stocks: MemberAvatarStockRow[]): string | null {
  if (selectedId === null) return null;
  return stocks.some((s) => s.id === selectedId) ? selectedId : null;
}
