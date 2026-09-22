/**
 * シール帳（習慣カード）の表示用の純関数群（要件定義書07-28章2026-09-19
 * 全面改訂・決定25〜33、主要画面ワイヤーフレーム.md 49-B章）。UIコンポーネント
 * から分離し、`.verify.ts`パターン（既存の`src/lib/*.verify.ts`と同じ方針）で
 * 検証できる形にする。
 */
import type { Chore, HabitCard, HabitCardChoreBreakdownRow, HabitFigureCatalogItem } from "@/types/domain";
import { computeHabitCardTierInfo } from "@/hooks/useHabitCards";

export interface HabitCardKindInfo {
  kindKey: string | null;
  kindDisplayName: string;
  kindEmoji: string | null;
}

/**
 * 決定71「絵柄の名前も子ども向けはひらがな」（主要画面ワイヤーフレーム.md
 * 49-B.15章、API仕様.md 17.10節）。`kind_display_name_child`がNULL（未入力）
 * の場合は、既存の`kind_display_name`（漢字・大人向け）にフォールバックする
 * （60.1章決定60-3、書き忘れても壊れない設計）。大人・みまもり向け
 * （`isChild=false`）は常に`kind_display_name`のみを使う。
 *
 * 呼び出し元によってフィールド名がsnake_case（`HabitFigureCatalogItem`）と
 * camelCase（`HabitKindGroup`）の両方があるため、値そのもの（adultName /
 * childName）を受け取る形にしている。
 */
export function resolveChildFriendlyKindDisplayName(adultName: string, childName: string | null | undefined): string {
  return childName ?? adultName;
}

/** `HabitFigureCatalogItem`（snake_case）向けの薄いラッパー。 */
export function getChildFriendlyKindDisplayName(item: Pick<HabitFigureCatalogItem, "kind_display_name" | "kind_display_name_child">): string {
  return resolveChildFriendlyKindDisplayName(item.kind_display_name, item.kind_display_name_child);
}

/**
 * シール帳の絵柄（habit_figure_catalog.kind_key）は`habit_cards`自身が持つ
 * （決定29・スキーマ設計.sql 57.3章、クエストに紐づかなくなったため）。
 * 対応するカタログ行が見つからない場合（データ不整合・読み込みタイミングの
 * ずれ）は、画面が壊れないよう「シール帳」という素の見出しにフォールバック
 * する。
 *
 * `isChild`（決定71）: trueのときは`getChildFriendlyKindDisplayName()`で
 * 解決した子ども向け表示名を返す。省略時はfalse扱い（既存呼び出し元との
 * 後方互換のため、呼び出し元は大人向け画面のまま動く）。
 */
export function getHabitCardKindInfo(
  card: HabitCard | null | undefined,
  catalog: HabitFigureCatalogItem[],
  isChild = false
): HabitCardKindInfo {
  const kindKey = card?.kind_key ?? null;
  if (!kindKey) return { kindKey: null, kindDisplayName: "シール帳", kindEmoji: null };
  const found = catalog.find((c) => c.kind_key === kindKey);
  if (!found) return { kindKey, kindDisplayName: "シール帳", kindEmoji: null };
  return {
    kindKey,
    kindDisplayName: isChild ? getChildFriendlyKindDisplayName(found) : found.kind_display_name,
    kindEmoji: found.kind_emoji,
  };
}

/**
 * 決定38「段階〈10・30・50・100〉の見せ方」で使う、いまの累計から求める
 * 進み具合の比率（0〜1）。帯の細いバーの塗り幅に使う。
 */
export function computeHabitCardProgressRatio(count: number): number {
  const clamped = Math.max(0, Math.min(count, 100));
  return clamped / 100;
}

/**
 * 決定11-B「いまの10マス」（タップ先の画面へ移設、49-B.5節）: 累計を10で
 * 割った余り（無ければ10）を、いま埋まっているマス数として返す（1〜10）。
 * 10・30・50・100はいずれも10の倍数のため、この計算は段階の区切りと矛盾
 * なく重なる（10件目でちょうど10マス目が埋まり、11件目からは新しいページの
 * 1マス目に戻る）。
 */
export function computeCurrentPageFilledCells(count: number): number {
  const remainder = count % 10;
  return remainder === 0 && count > 0 ? 10 : remainder;
}

/**
 * 決定11-C「数字」（タップ先の画面へ移設、49-B.5節）: 「今の累計/次の段階の
 * 閾値」と「次の段階まであと何件か」を1行にした文言。クリスタル到達済み
 * （次の段階が無い）場合は累計のみを示す。
 */
export function formatHabitCardProgressText(count: number, tierLabelForNext: (tier: "bronze" | "silver" | "gold" | "crystal") => string): string {
  const { currentTier, nextThreshold } = computeHabitCardTierInfo(count);
  if (nextThreshold == null) {
    return `${count}（クリスタルたっせい）`;
  }
  const nextTier: "bronze" | "silver" | "gold" | "crystal" =
    currentTier === "gold" ? "crystal" : currentTier === "silver" ? "gold" : currentTier === "bronze" ? "silver" : "bronze";
  const remaining = nextThreshold - count;
  return `${count}/${nextThreshold}（${tierLabelForNext(nextTier)}まで あと${remaining}）`;
}

/**
 * 決定66「いまの頁が目指す段階の色」（主要画面ワイヤーフレーム.md 49-B.14章）:
 * 「いまの10マス」は常に現在進行中の1頁だけを表示する（`computeCurrentPageFilledCells`）。
 * この頁を埋め終えると到達する段階（`computeHabitCardTierInfo(count).nextThreshold`が
 * 指す段階）の名前を返す純関数。クリスタル到達済み（`nextThreshold === null`）の
 * ときは`nextThreshold`ではなく`currentTier`（＝"crystal"のはず）をそのまま返す。
 *
 * [2026-09-23修正・統括が実機で発見] 累計がちょうど10の倍数のとき
 * （`computeCurrentPageFilledCells`が10＝頁が埋まりきった状態を返すとき）は、
 * 表示している頁は「いま埋め終えた頁」であり「これから向かう頁」ではない。
 * 旧実装は`count`そのままで判定していたため、10件目ちょうどで
 * `nextThreshold`が既に30へ進んでおり、銅の頁が銀色で塗られていた
 * （30・50・100件目でも同じく1段階先の色になっていた）。
 * 決定66「1〜10件目＝銅色の頁、11〜30件目＝銀色の頁」に合わせ、
 * 頁が埋まりきっているときは1件手前（その頁の中）で判定する。
 */
export function computeHabitCardPageTier(count: number): "bronze" | "silver" | "gold" | "crystal" {
  const pageIsFull = count > 0 && count % 10 === 0;
  const { currentTier, nextThreshold } = computeHabitCardTierInfo(pageIsFull ? count - 1 : count);
  if (nextThreshold == null) return currentTier ?? "crystal";
  if (nextThreshold === 10) return "bronze";
  if (nextThreshold === 30) return "silver";
  if (nextThreshold === 50) return "gold";
  return "crystal"; // nextThreshold === 100
}

/**
 * 決定25「クエスト一覧行は全クエスト共通で通常の+◯pt表示に統一される」。
 * `reward_mode`という区別が撤去されたため、常に`chore.points`をそのまま
 * 返すだけでよい（0ptのクエストは`+0pt`と表示する、決定26）。
 */
export function formatChoreRowRewardLabel(chore: Chore): string {
  return `+${chore.points}pt`;
}

export interface HabitCardBreakdownEntry {
  choreId: string | null;
  title: string;
  emoji: string | null;
  count: number;
}

/**
 * 決定46「進行中の内訳の見せ方」（企画部3-3節(2)）: `habit_card_chore_
 * breakdown`が返す行を`completion_count`降順に並べ替え、上位`limit`件のみを
 * 返す。残りは呼び出し側が「ほか◯件」として合計件数を表示する
 * （API仕様.md 17.3節、並び替え・件数制限はクライアント側）。
 *
 * `chore_id`が`chores`一覧に見つからない場合（クエスト削除済み、57.11章の
 * 移行で旧シール帳型クエストが削除された場合等）は「削除されたクエスト」に
 * フォールバックする（新しい問い合わせは発生させない）。
 */
export function summarizeHabitCardBreakdown(
  rows: HabitCardChoreBreakdownRow[],
  chores: Chore[],
  limit = 5
): { top: HabitCardBreakdownEntry[]; otherCount: number; otherTotal: number; total: number } {
  const entries: HabitCardBreakdownEntry[] = rows.map((row) => {
    const chore = row.chore_id ? chores.find((c) => c.id === row.chore_id) : undefined;
    return {
      choreId: row.chore_id,
      title: chore?.title ?? "削除されたクエスト",
      emoji: chore?.emoji ?? null,
      count: row.completion_count,
    };
  });
  entries.sort((a, b) => b.count - a.count);
  const top = entries.slice(0, limit);
  const rest = entries.slice(limit);
  const otherCount = rest.length;
  const otherTotal = rest.reduce((sum, e) => sum + e.count, 0);
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  return { top, otherCount, otherTotal, total };
}

/**
 * 決定30「期間（開始日〜完成日・日数）」。`completed_at`が`null`（進行中の
 * 冊）の場合は`now`までを範囲とみなす（API仕様.md 17.4節）。
 */
export function computeHabitCardDurationDays(startedAtIso: string, completedAtIso: string | null, nowIso: string = new Date().toISOString()): number {
  const start = new Date(startedAtIso).getTime();
  const end = new Date(completedAtIso ?? nowIso).getTime();
  return Math.max(0, Math.round((end - start) / (24 * 60 * 60 * 1000)));
}
