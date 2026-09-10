/**
 * 「最後に見た時刻」を画面から使うためのフック2本（実装メモ.md 190章）。
 * 保存の仕組みと、そうした理由は`src/lib/lastSeen.ts`の冒頭コメントを参照。
 *
 * - `useUnreadSince(surface, memberId)` … 件数を数えるときの基準時刻を返す。
 *   ベル・新着件数を出している画面で使う。
 * - `useMarkSeen(surface, memberId)` … その画面を「見た」ことにする。
 *   とどいたよ・完了報告の画面そのもので使う。
 */
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "expo-router";
import {
  DEFAULT_FALLBACK_WINDOW_MS,
  getLastSeen,
  hydrateLastSeen,
  markSeen,
  subscribeLastSeen,
  type SeenSurface,
} from "@/lib/lastSeen";

/**
 * 件数を数えるときの基準時刻（エポックミリ秒）を返す。これより後に起きたものが「未読」。
 *
 * まだ一度もその画面を開いていない間は、**従来どおり24時間前**を返す（`lastSeen.ts`の
 * 「初期値の扱い」参照）。一度開けば、以後はその時刻が基準になる。
 *
 * `usePathname()`を購読しているのは、`src/hooks/useBackgroundAutoRefresh.ts`と同じ理由で、
 * 画面を移動して戻ってきたときに数え直すため。個々の画面に`useFocusEffect`を配って回らずに
 * 済む（172章で採った方式をそのまま踏襲している）。
 */
export function useUnreadSince(surface: SeenSurface, memberId: string): number {
  const pathname = usePathname();
  const [, forceRender] = useState(0);

  useEffect(() => subscribeLastSeen(() => forceRender((n) => n + 1)), []);

  useEffect(() => {
    void hydrateLastSeen(surface, memberId);
  }, [surface, memberId]);

  // pathnameが変わるたびに読み直す（別画面で「見た」が記録された直後に戻ってきた場合）。
  useEffect(() => {
    forceRender((n) => n + 1);
  }, [pathname]);

  const lastSeen = getLastSeen(surface, memberId);
  return lastSeen ?? Date.now() - DEFAULT_FALLBACK_WINDOW_MS;
}

/**
 * この画面を「見た」ことにする。画面のトップレベルで1回呼ぶだけでよい。
 *
 * 画面に入った時点で記録する。滞在中に届いたものは、次に離れて戻ってきたときに
 * 未読として数えられる（滞在中のものまで既読にしてしまわないため）。
 */
export function useMarkSeen(surface: SeenSurface, memberId: string): void {
  useEffect(() => {
    void markSeen(surface, memberId);
  }, [surface, memberId]);
}

/** 押した瞬間に既読にしたい場合の手動版（現状は未使用。入口が増えたとき用）。 */
export function useMarkSeenCallback(surface: SeenSurface, memberId: string): () => void {
  return useCallback(() => {
    void markSeen(surface, memberId);
  }, [surface, memberId]);
}
