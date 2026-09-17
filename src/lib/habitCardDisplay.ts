/**
 * 習慣カード（台紙）の表示用の純関数群（要件定義書07-28章、主要画面
 * ワイヤーフレーム.md 49.4章決定11）。UIコンポーネントから分離し、
 * `.verify.ts`パターン（既存の`src/lib/*.verify.ts`と同じ方針）で検証できる形にする。
 */
import type { Chore, HabitFigureCatalogItem } from "@/types/domain";
import { computeHabitCardTierInfo, type HabitCardWithProgress } from "@/hooks/useHabitCards";

export interface HabitCardKindInfo {
  kindKey: string | null;
  kindDisplayName: string;
  kindEmoji: string | null;
}

/**
 * 台紙の種類（habit_figure_catalog.kind_key）は`chores.habit_kind_key`に
 * 持たせている（スキーマ設計.sql 55.3章決定55-10）ため、対応するchoreと
 * カタログから見出し表示用の情報を導く。対応するchore・カタログ行が
 * 見つからない場合（データ不整合・読み込みタイミングのずれ）は、
 * 画面が壊れないよう「台紙」という素の見出しにフォールバックする。
 */
export function getHabitCardKindInfo(
  chore: Chore | undefined,
  catalog: HabitFigureCatalogItem[]
): HabitCardKindInfo {
  const kindKey = chore?.habit_kind_key ?? null;
  if (!kindKey) return { kindKey: null, kindDisplayName: "台紙", kindEmoji: null };
  const found = catalog.find((c) => c.kind_key === kindKey);
  if (!found) return { kindKey, kindDisplayName: "台紙", kindEmoji: null };
  return { kindKey, kindDisplayName: found.kind_display_name, kindEmoji: found.kind_emoji };
}

/**
 * 決定11-B「いまの10マス」: 累計を10で割った余り（無ければ10）を、いま埋まって
 * いるマス数として返す（1〜10）。10・30・50・100はいずれも10の倍数のため、
 * この計算は段階の区切りと矛盾なく重なる（10件目でちょうど10マス目が埋まり、
 * 11件目からは新しいページの1マス目に戻る）。
 */
export function computeCurrentPageFilledCells(count: number): number {
  const remainder = count % 10;
  return remainder === 0 && count > 0 ? 10 : remainder;
}

/**
 * 決定11-C「数字」: 「今の累計/次の段階の閾値」と「次の段階まであと何件か」を
 * 1行にした文言。クリスタル到達済み（次の段階が無い）場合は累計のみを示す。
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
 * 決定14「既存のクエスト一覧行（C5・P19・S5）で、台紙対象クエストは『+◯pt』の
 * 代わりに、種類の絵文字＋現在の累計（例『🐛 37』）を小さく添える」。
 *
 * ポイント型は従来どおり`+{points}pt`。台紙型で対応する進行中の台紙が見つからない
 * 場合（決定14「台紙が『おわりになっている』場合は、通常のポイント無しクエストと
 * 同じ見た目に戻す」）は空文字を返す（呼び出し側は素の絵文字＋タイトルのみになる）。
 *
 * `activeCards`にはmyChores/S5等の一覧と同じ本人（me）の`useHabitCardsForMember`
 * 結果をそのまま渡す想定。新しい通信は発生させない（既にじぶんタブ用に取得済みの
 * データを再利用する）。
 */
export function formatChoreRowRewardLabel(
  chore: Chore,
  activeCards: HabitCardWithProgress[],
  catalog: HabitFigureCatalogItem[]
): string {
  if (chore.reward_mode !== "habit_card") {
    return chore.points != null ? `+${chore.points}pt` : "";
  }
  const entry = activeCards.find((e) => e.card.chore_id === chore.id);
  if (!entry) return "";
  const kindInfo = getHabitCardKindInfo(chore, catalog);
  return `${kindInfo.kindEmoji ?? "🏳️"} ${entry.count}`;
}
