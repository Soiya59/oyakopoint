/**
 * 「先週のふりかえり」の週の初めの自動ポップアップを、どの週まで出したかを
 * 端末に覚えておく仕組み。`src/lib/introSeen.ts`・`src/lib/lastSeen.ts`と
 * 同じ「メモリキャッシュ＋端末保存（AsyncStorage）＋購読」構成のI/Oラッパー。
 * 判定そのもの（出してよいかどうか）は`src/lib/weeklyReviewPopupLogic.ts`
 * （RN非依存の純粋関数、`node`で検証できる）にある。
 * 参照: 開発部/成果物/実装メモ.md 321章。
 *
 * [`lastSeen.ts`と同じ形にした理由] 保存する値が真偽値1つではなく「最後に出した
 * 週の開始日」という文字列のため、`introSeen.ts`（Set<string>で真偽値相当を表す）
 * よりも、値を持つ`lastSeen.ts`（Map<string, number>）の形に近い。
 *
 * [memberIdごとに分ける理由] 1台の端末で複数の子どもプロフィールを切り替える
 * 運用があるため（きょうだいで同じ端末を使う）。`introSeen.ts`・`lastSeen.ts`と
 * 同じ設計。
 *
 * [出した時点で記録する理由] 依頼文どおり、閉じた時点ではなく開いた（出した）
 * 時点で記録する。こうすることで、開いた直後にユーザーが即座に閉じても
 * 「その週にもう出した」ことになり、同じ週にもう一度自動で開かない
 * （`markWeeklyReviewPopupShown`の呼び出しは`app/child/(tabs)/home.tsx`側が
 * `setWeeklyReviewVisible(true)`と同じタイミングで行う）。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildWeeklyReviewPopupSeenKey } from "./weeklyReviewPopupLogic";

/** メモリ上のキャッシュ。値は「最後に自動で出した週」の開始日（"YYYY-MM-DD"）。 */
const cache = new Map<string, string>();
/** 端末からの読み込みを試みた（成功・失敗を問わない）キーの集合。 */
const hydrated = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribeWeeklyReviewPopupSeen(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 端末に保存された値をキャッシュへ読み込む。同じキーに対して二度目以降は何もしない。
 * 読み込みに失敗しても例外を投げない（黙って「まだ出していない」扱いのまま進む、
 * `lastSeen.ts`の`hydrateLastSeen`と同じ方針）。
 */
export async function hydrateWeeklyReviewPopupSeen(memberId: string): Promise<void> {
  if (!memberId) return;
  const key = buildWeeklyReviewPopupSeenKey(memberId);
  if (hydrated.has(key)) return;
  hydrated.add(key);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) cache.set(key, raw);
  } catch {
    // 端末の保存領域が使えない場合は「まだ出していない」扱いのまま動かす。
  }
  emit();
}

/** 読み込みが完了しているか（完了前は自動ポップアップを開かないための判定に使う）。 */
export function isWeeklyReviewPopupSeenHydrated(memberId: string): boolean {
  if (!memberId) return false;
  return hydrated.has(buildWeeklyReviewPopupSeenKey(memberId));
}

/** キャッシュ上の「最後に自動で出した週」の開始日。まだ無ければnull。 */
export function getLastShownWeeklyReviewPopupWeek(memberId: string): string | null {
  if (!memberId) return null;
  return cache.get(buildWeeklyReviewPopupSeenKey(memberId)) ?? null;
}

/**
 * 「この週はもう出した」ことにする。押した瞬間にキャッシュを更新して購読者へ
 * 通知し、端末への書き込みはその後ろで行う（`lastSeen.ts`の`markSeen`と同じ、
 * 書き込み失敗時も画面上は成功したまま進める）。
 */
export async function markWeeklyReviewPopupShown(memberId: string, weekStart: string): Promise<void> {
  if (!memberId) return;
  const key = buildWeeklyReviewPopupSeenKey(memberId);
  cache.set(key, weekStart);
  hydrated.add(key);
  emit();
  try {
    await AsyncStorage.setItem(key, weekStart);
  } catch {
    // 端末へ書けなくてもキャッシュ上は記録済みのままにする。次回起動時にもう一度
    // 出ることがあるだけで、体験としては破綻しない（`introSeen.ts`と同じ方針）。
  }
}

/** テスト・アカウント切り替え用。端末の保存は消さず、メモリ上だけ捨てる。 */
export function resetWeeklyReviewPopupSeenCacheForTests(): void {
  cache.clear();
  hydrated.clear();
}
