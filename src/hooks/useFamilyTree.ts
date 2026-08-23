/**
 * 家族の木（要件定義書07-9章）・色分けによる個人の可視化（07-10章）向けの
 * データ取得フック。P7/C5/S1ホームウィジェット（軽量表示）と、
 * P26/C20/S14詳細画面（内訳・視覚要素まで含む）の2種類を用意する
 * （主要画面ワイヤーフレーム.md 20.0節決定7「ホームは段階名・件数の2情報のみ」）。
 *
 * 参照: API仕様.md 9章、src/data/api.ts。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { useAppData } from "@/data/store";
import {
  fetchFamilyTreeCompletionDots,
  fetchFamilyTreeCurrentSeason,
  fetchFamilyTreeMemberBreakdown,
  fetchFamilyTreeSeasonHistory,
  type FamilyTreeCompletionDot,
} from "@/data/api";
import type { FamilyTreeMemberBreakdown, FamilyTreeSeason } from "@/types/domain";

export type FamilyTreeLoadState = "loading" | "error" | "ready";

/** P7/C5/S1ホームウィジェット用の軽量版（現在シーズンの段階・件数のみ）。 */
export function useFamilyTreeSummary() {
  const { client } = useSession();
  const { state } = useAppData();
  const familyId = state.family.id;
  const [loadState, setLoadState] = useState<FamilyTreeLoadState>("loading");
  const [season, setSeason] = useState<FamilyTreeSeason | null>(null);

  const load = useCallback(async () => {
    if (!familyId) return;
    setLoadState("loading");
    const res = await fetchFamilyTreeCurrentSeason(client, familyId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setSeason(res.data);
    setLoadState("ready");
  }, [client, familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, season, reload: load };
}

/** P26/C20/S14詳細画面用（現在シーズン・内訳・完了報告ドット・先月分の記録）。 */
export function useFamilyTreeDetail() {
  const { client } = useSession();
  const { state } = useAppData();
  const familyId = state.family.id;
  const [loadState, setLoadState] = useState<FamilyTreeLoadState>("loading");
  const [season, setSeason] = useState<FamilyTreeSeason | null>(null);
  const [breakdown, setBreakdown] = useState<FamilyTreeMemberBreakdown[]>([]);
  const [dots, setDots] = useState<FamilyTreeCompletionDot[]>([]);
  const [lastSeason, setLastSeason] = useState<FamilyTreeSeason | null>(null);

  const load = useCallback(async () => {
    if (!familyId) return;
    setLoadState("loading");
    const seasonRes = await fetchFamilyTreeCurrentSeason(client, familyId);
    if (!seasonRes.ok) {
      setLoadState("error");
      return;
    }
    const [breakdownRes, historyRes] = await Promise.all([
      fetchFamilyTreeMemberBreakdown(client, familyId),
      fetchFamilyTreeSeasonHistory(client, familyId),
    ]);
    if (!breakdownRes.ok || !historyRes.ok) {
      setLoadState("error");
      return;
    }
    let dotsResData: FamilyTreeCompletionDot[] = [];
    if (seasonRes.data) {
      const seasonStartIso = new Date(`${seasonRes.data.season_start}T00:00:00+09:00`).toISOString();
      const dotsRes = await fetchFamilyTreeCompletionDots(client, familyId, seasonStartIso);
      if (!dotsRes.ok) {
        setLoadState("error");
        return;
      }
      dotsResData = dotsRes.data;
    }

    // 20.0節決定6: 直近1シーズン分の最終形態のみ「先月の木」として一言添える
    // （season_end非NULLの行のうち最新のもの。専用ギャラリー画面は次フェーズ）。
    const closedSeasons = historyRes.data.filter((s) => s.season_end !== null);
    const mostRecentClosed = closedSeasons.length > 0 ? closedSeasons[0] : null;

    setSeason(seasonRes.data);
    setBreakdown(breakdownRes.data);
    setDots(dotsResData);
    setLastSeason(mostRecentClosed);
    setLoadState("ready");
  }, [client, familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, season, breakdown, dots, lastSeason, reload: load };
}
