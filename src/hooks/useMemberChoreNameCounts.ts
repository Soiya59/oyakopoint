/**
 * 「きろく」の「クエストごとの回数」（要件定義書07-46章、設計部/成果物/スキーマ設計.sql 84章・
 * API仕様.md 40章、UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 72章、開発部/成果物/
 * 実装メモ.md 353章）向けのデータ取得フック。`useMemberBadgeRows`（useBadges.ts）と同じ形。
 *
 * [load()の中心バンドルに足さないこと・07-46章 決定11] このフックは、枠が**開かれたとき**
 * （`enabled`が真になったとき）に、**1人ぶん**だけ読む。`src/data/store.tsx`の`load()`・
 * `refreshAfterReport()`・`refreshAfterCancel()`には何も足していない（完了報告の直後は、
 * きろくの画面を開き直せば最新になる）。`state.completions`から数えることもしない
 * （2万件で古い側が欠ける。API仕様.md 40.0章）。
 *
 * 動き（72.4節）:
 *  - `enabled`が偽（閉じている・「＋家族全体」）のあいだは読まない。
 *  - 同じ`memberId`のあいだ、読み込めた結果は保持する。閉じて開き直しても読み直さない。
 *    **失敗のままなら、開くたびに読み直す**。
 *  - `memberId`が変わったら、前の人の行・失敗・読み込み中をすべて捨てる（一瞬も前の人の数字を返さない）。
 *    切り替え前の読み込みの返事が後から届いても、画面に出さない。
 *  - 取得の窓口は`fetchMemberChoreNameCounts`ただ1つ（`memberId`必須）。
 *  - 部品に渡す行は`{ name, emoji, count }`だけ（最後にやった時刻・順位の材料は渡さない）。
 *    並べ替えない（取得した順のまま）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/session";
import { useAppData } from "@/data/store";
import { fetchMemberChoreNameCounts, type ApiError } from "@/data/api";
import { toQuestCountRows, type QuestCountRow } from "@/lib/questCount";

export type MemberChoreNameCountsLoadState = "idle" | "loading" | "error" | "ready";

interface Result {
  /** この結果がどの家族×メンバーのものか（違うキーの結果は返さない） */
  key: string;
  loadState: MemberChoreNameCountsLoadState;
  rows: QuestCountRow[];
  failure: ApiError | null;
}

const idleResult = (key: string): Result => ({ key, loadState: "idle", rows: [], failure: null });

export function useMemberChoreNameCounts(memberId: string, enabled: boolean) {
  const { client } = useSession();
  const { state } = useAppData();
  const familyId = state.family.id;
  const key = `${familyId}:${memberId}`;

  const [result, setResult] = useState<Result>(() => idleResult(key));
  // 読み込めた（ready）キー。同じキーのあいだは、閉じて開き直しても読み直さない。
  const loadedKeyRef = useRef<string | null>(null);
  // 返事の取り違え防止。新しく読み始める・メンバーが変わる・画面が外れるたびに進め、古い返事は捨てる。
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!memberId || !familyId) return;
    const seq = ++requestSeq.current;
    loadedKeyRef.current = null;
    setResult({ key, loadState: "loading", rows: [], failure: null });
    const res = await fetchMemberChoreNameCounts(client, familyId, memberId);
    if (seq !== requestSeq.current) return; // メンバーが変わった・画面が外れた・読み直し済み
    if (!res.ok) {
      setResult({ key, loadState: "error", rows: [], failure: res.error });
      return;
    }
    loadedKeyRef.current = key;
    setResult({ key, loadState: "ready", rows: toQuestCountRows(res.data), failure: null });
  }, [client, familyId, memberId, key]);

  useEffect(() => {
    if (!enabled) return;
    if (loadedKeyRef.current === key) return; // 読み込み済み。読み直さない
    void load();
  }, [enabled, key, load]);

  // 画面が外れたら、返事を捨てる。
  useEffect(
    () => () => {
      requestSeq.current += 1;
    },
    []
  );

  // メンバーが変わった直後の1回は、前の人の結果を返さない。
  const current = result.key === key ? result : idleResult(key);
  return {
    loadState: current.loadState,
    rows: current.rows,
    failure: current.failure,
    reload: load,
  };
}
