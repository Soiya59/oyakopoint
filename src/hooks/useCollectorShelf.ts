/**
 * コレクター棚（要件定義書07-13-3章、API仕様.md 12.4・12.5章）向けデータ取得フック。
 * 参照: src/data/api.ts（fetchFamilyCollectedGachaDraws／fetchFamilyTreeSeasonHistory／
 * fetchFamilyTreeCompletionDots）。
 *
 * [2026-08-27新設・第5段階（最終段階）]
 * 「集めたもの」区画は新規クエリ（fetchFamilyCollectedGachaDraws）、
 * 「過去の木」区画は第3〜4段階までに実装済みの既存クエリの組み合わせのみで
 * 構成する（要件定義書07-13-7章「新規テーブルは不要」・API仕様.md 12.5章）。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import {
  fetchFamilyCollectedGachaDraws,
  fetchFamilyTreeCompletionDots,
  fetchFamilyTreeSeasonHistory,
  type CollectedGachaDraw,
  type FamilyTreeCompletionDot,
} from "@/data/api";
import type { FamilyTreeSeason } from "@/types/domain";

export type CollectorShelfLoadState = "loading" | "error" | "ready";

/** 「集めたもの」区画（API仕様.md 12.4章）。家族共有・永久保管の一覧。 */
export function useCollectedPrizes(familyId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<CollectorShelfLoadState>("loading");
  const [items, setItems] = useState<CollectedGachaDraw[]>([]);

  const load = useCallback(async () => {
    if (!familyId) return;
    setLoadState("loading");
    const res = await fetchFamilyCollectedGachaDraws(client, familyId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setItems(res.data);
    setLoadState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, items, reload: load };
}

/**
 * 「過去の木」区画のシーズン一覧（API仕様.md 12.5章「対象シーズンは9.4節で取得できる
 * family_tree_seasons一覧から選ぶ」）。終了済み（`season_end`が非NULL）のみを対象にし、
 * 新しい順（`fetchFamilyTreeSeasonHistory`がすでにその順で返す）のまま公開する。
 */
export function usePastTreeSeasons(familyId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<CollectorShelfLoadState>("loading");
  const [seasons, setSeasons] = useState<FamilyTreeSeason[]>([]);

  const load = useCallback(async () => {
    if (!familyId) return;
    setLoadState("loading");
    const res = await fetchFamilyTreeSeasonHistory(client, familyId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setSeasons(res.data.filter((s) => s.season_end !== null));
    setLoadState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, seasons, reload: load };
}

/**
 * 「過去の木」区画で、シーズンカードを展開（「見る」）した瞬間に当該シーズンの
 * 木（色丸＋景品交換の反映）を取得する。一覧は`usePastTreeSeasons`の全件を
 * 一度に読み込まず、展開されたシーズンだけを都度取得する（21.6節ワイヤーフレーム
 * 「タップで展開し…読み取り専用のまま再現表示する」）。
 *
 * `fetchFamilyTreeCompletionDots`は`seasonStartIso`〜`seasonEndIso`（省略時は
 * 進行中扱い）を渡すだけで動くため、過去シーズン専用の新規APIは追加していない
 * （要件定義書07-13-7章「新規テーブルは不要」・本部長確認済みの再現方式）。
 */
export function usePastTreeSeasonDots(familyId: string) {
  const { client } = useSession();
  const [dotsBySeasonId, setDotsBySeasonId] = useState<Record<string, FamilyTreeCompletionDot[]>>({});
  const [loadingSeasonIds, setLoadingSeasonIds] = useState<Record<string, boolean>>({});
  const [errorSeasonIds, setErrorSeasonIds] = useState<Record<string, boolean>>({});

  const loadSeason = useCallback(
    async (season: FamilyTreeSeason) => {
      if (!familyId || dotsBySeasonId[season.id] || loadingSeasonIds[season.id]) return;
      setLoadingSeasonIds((prev) => ({ ...prev, [season.id]: true }));
      setErrorSeasonIds((prev) => ({ ...prev, [season.id]: false }));
      // useFamilyTree.ts・useTreeDecoration.tsと同じ変換（season_start/season_endは
      // JST基準の暦月初日の日付のみを持つため、JSTの0時を明示してISOに変換する）。
      const seasonStartIso = new Date(`${season.season_start}T00:00:00+09:00`).toISOString();
      const seasonEndIso = season.season_end ? new Date(`${season.season_end}T00:00:00+09:00`).toISOString() : null;
      const res = await fetchFamilyTreeCompletionDots(client, familyId, seasonStartIso, seasonEndIso);
      setLoadingSeasonIds((prev) => ({ ...prev, [season.id]: false }));
      if (!res.ok) {
        setErrorSeasonIds((prev) => ({ ...prev, [season.id]: true }));
        return;
      }
      setDotsBySeasonId((prev) => ({ ...prev, [season.id]: res.data }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, familyId, dotsBySeasonId, loadingSeasonIds]
  );

  return { dotsBySeasonId, loadingSeasonIds, errorSeasonIds, loadSeason };
}
