/**
 * お絵かき（要件定義書07-13-2章「お絵かき」、API仕様.md 12.2章）向けデータ取得・
 * 操作フック。参照: src/data/api.ts（fetchMyDrawings/createDrawing/deleteDrawing）。
 *
 * [重要] 第2段階（お絵かき）の実装範囲。ガチャ（draw_gacha等、第3段階）は
 * ここには一切含めない。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { createDrawing, deleteDrawing, fetchMyDrawings, type ApiError } from "@/data/api";
import theme from "@/theme/theme";
import type { FamilyDrawing, FamilyDrawingLineData } from "@/types/domain";

export type DrawingsLoadState = "loading" | "error" | "ready";

export type DrawingActionResult = { ok: true } | { ok: false; error: ApiError };

export function useMyDrawings(memberId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<DrawingsLoadState>("loading");
  const [drawings, setDrawings] = useState<FamilyDrawing[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoadState("loading");
    const res = await fetchMyDrawings(client, memberId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setDrawings(res.data);
    setLoadState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 未公開分のみが第2段階の対象（公開済みはコレクター棚〔第5段階〕の範囲）。
  const unpublished = drawings.filter((d) => !d.is_published);
  const atLimit = unpublished.length >= theme.drawingLimits.maxUnpublished;

  const save = useCallback(
    async (lineData: FamilyDrawingLineData): Promise<DrawingActionResult> => {
      const res = await createDrawing(client, lineData);
      if (!res.ok) return { ok: false, error: res.error };
      await load();
      return { ok: true };
    },
    [client, load]
  );

  const remove = useCallback(
    async (drawingId: string): Promise<DrawingActionResult> => {
      const res = await deleteDrawing(client, drawingId);
      if (!res.ok) return { ok: false, error: res.error };
      await load();
      return { ok: true };
    },
    [client, load]
  );

  return { loadState, unpublished, atLimit, reload: load, save, remove };
}
