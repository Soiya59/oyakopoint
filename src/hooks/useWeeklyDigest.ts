/**
 * 今週のまとめメッセージ（要件定義書07-8章）向けのデータ取得フック。
 * 保護者向けホーム画面（P7）の「今週のできごと」カード専用
 * （07-8章「子ども向け画面への表示はMVP対象外」のためP7のみで使用）。
 *
 * 参照: API仕様.md 10.1章、src/data/api.ts fetchLatestWeeklyFamilyDigest。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { useAppData } from "@/data/store";
import { fetchLatestWeeklyFamilyDigest } from "@/data/api";
import type { WeeklyFamilyDigest } from "@/types/domain";

export function useWeeklyDigest() {
  const { client } = useSession();
  const { state } = useAppData();
  const familyId = state.family.id;
  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [digest, setDigest] = useState<WeeklyFamilyDigest | null>(null);

  const load = useCallback(async () => {
    if (!familyId) return;
    setLoadState("loading");
    const res = await fetchLatestWeeklyFamilyDigest(client, familyId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setDigest(res.data);
    setLoadState("ready");
  }, [client, familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, digest, reload: load };
}
