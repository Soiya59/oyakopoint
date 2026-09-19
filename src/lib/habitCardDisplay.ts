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
 * シール帳の絵柄（habit_figure_catalog.kind_key）は`habit_cards`自身が持つ
 * （決定29・スキーマ設計.sql 57.3章、クエストに紐づかなくなったため）。
 * 対応するカタログ行が見つからない場合（データ不整合・読み込みタイミングの
 * ずれ）は、画面が壊れないよう「シール帳」という素の見出しにフォールバック
 * する。
 */
export function getHabitCardKindInfo(
  card: HabitCard | null | undefined,
  catalog: HabitFigureCatalogItem[]
): HabitCardKindInfo {
  const kindKey = card?.kind_key ?? null;
  if (!kindKey) return { kindKey: null, kindDisplayName: "シール帳", kindEmoji: null };
  const found = catalog.find((c) => c.kind_key === kindKey);
  if (!found) return { kindKey, kindDisplayName: "シール帳", kindEmoji: null };
  return { kindKey, kindDisplayName: found.kind_display_name, kindEmoji: found.kind_emoji };
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
