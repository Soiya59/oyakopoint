/**
 * クエストごとの「これまで何回やったか」（累計実施回数、やること.md 4-55、
 * スキーマ設計.sql 56章・API仕様.md 16章・主要画面ワイヤーフレーム.md 53章）
 * 向けのデータ取得フック。
 *
 * [load()の中心バンドルに追加しないこと・56.4章・API仕様.md 16章申し送り]
 * `src/data/store.tsx`の`load()`には一切クエリを足していない（`useHabitCards.ts`
 * と同じ申し送り）。このフックはクエスト一覧画面（C5・P19・S5・P10）が
 * マウントされたとき、および完了報告・取消の成功直後に、その画面が個別に
 * `reload()`する形で使う。
 *
 * [取り方・決定56-6] `family_id`のみで絞り、家族ぶんをまとめて1回で取る
 * （`member_id`では絞らない。C5・P19・S5・P10の4画面共通の標準パターン）。
 * クエストごとに個別の問い合わせを飛ばさない（N+1にしない、56.4章「禁止事項」）。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { useAppData } from "@/data/store";
import { fetchChoreCompletionTotals } from "@/data/api";
import type { ChoreCompletionTotalEntry } from "@/types/domain";

export type ChoreCompletionTotalsLoadState = "loading" | "error" | "ready";

/**
 * `chore_id`×`member_id`をキーにしたルックアップを作る純関数。
 * C5・P19・S5は`key(choreId, 自分のmemberId)`、P10は`key(choreId, assigned_to)`
 * で引く（56.4章「各画面での使い方」）。見つからない場合は0回（53.6節決定7）。
 */
export function keyChoreCompletionTotal(choreId: string, memberId: string): string {
  return `${choreId}:${memberId}`;
}

export function buildChoreCompletionTotalsLookup(entries: ChoreCompletionTotalEntry[]): Record<string, number> {
  const lookup: Record<string, number> = {};
  for (const e of entries) {
    if (!e.chore_id) continue; // choreが物理削除された行は参照されないため無視（56.3章）
    lookup[keyChoreCompletionTotal(e.chore_id, e.member_id)] = e.total_count;
  }
  return lookup;
}

/**
 * 家族ぶんの累計回数（決定56-6）。familyIdは`state.family.id`から自前で取得する
 * （`useFamilyTreeSummary`と同じ形。呼び出し側は引数を渡す必要が無い）。
 */
export function useChoreCompletionTotals() {
  const { client } = useSession();
  const { state } = useAppData();
  const familyId = state.family.id;
  const [loadState, setLoadState] = useState<ChoreCompletionTotalsLoadState>("loading");
  const [entries, setEntries] = useState<ChoreCompletionTotalEntry[]>([]);

  const load = useCallback(async () => {
    if (!familyId) return;
    setLoadState("loading");
    const res = await fetchChoreCompletionTotals(client, familyId);
    if (!res.ok) {
      // [53.7節「回数のみ取得失敗」] 一覧本体を巻き込まない。呼び出し側は
      // loadState==="error"のときルックアップを空のまま扱い、回数部分だけを
      // 出さない（一覧全体をErrorStateに倒さない）。
      setLoadState("error");
      return;
    }
    setEntries(res.data);
    setLoadState("ready");
  }, [client, familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const lookup = buildChoreCompletionTotalsLookup(entries);

  return { loadState, entries, lookup, reload: load };
}
