/**
 * ガチャ（要件定義書07-13-1章、API仕様.md 12.1・12.3章）向けデータ取得・操作フック。
 * 参照: src/data/api.ts（fetchGachaProgressSummary/drawGacha/fetchGachaPresetOrnament/
 * fetchGachaPrizeDrawing）。
 *
 * [重要] 第3段階（ガチャを引く）の実装範囲。木への飾り付け
 * （`decorate_tree_with_gacha_prize`、第4段階）は`useTreeDecoration.ts`に分離した。
 * コレクター棚（第5段階）はここには一切含めない。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import {
  drawGacha,
  fetchGachaPresetOrnament,
  fetchGachaPrizeDrawing,
  fetchGachaProgressSummary,
  type ApiError,
  type GachaPrizeDrawing,
} from "@/data/api";
import type { GachaDrawResult, GachaPresetOrnament, GachaPrizeKind } from "@/types/domain";

export type GachaLoadState = "loading" | "error" | "ready";

/**
 * ホームウィジェット（P7/C5/S1）・ガチャ画面（P27/C21/S15）共通の進捗取得。
 * 行が存在しない場合（33a章、まだ1件も完了報告していない）はAPI仕様.md 12.1章の
 * 指示どおり remaining=5・canDrawNow=false として扱う。
 */
export function useGachaProgress(memberId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<GachaLoadState>("loading");
  const [remaining, setRemaining] = useState(5);
  const [canDrawNow, setCanDrawNow] = useState(false);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoadState("loading");
    const res = await fetchGachaProgressSummary(client, memberId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    if (res.data) {
      setRemaining(res.data.remaining_until_next_draw);
      setCanDrawNow(res.data.can_draw_now);
    } else {
      setRemaining(5);
      setCanDrawNow(false);
    }
    setLoadState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, remaining, canDrawNow, reload: load };
}

export type GachaDrawActionResult = { ok: true; data: GachaDrawResult } | { ok: false; error: ApiError };

/**
 * ガチャ画面（P27/C21/S15）の「まわす」操作。主要画面ワイヤーフレーム.md 21.2節
 * 「抽選中：短い待機演出（0.5〜1秒程度）」に対応するため、実際のAPI呼び出しと
 * 最短待機時間をPromise.allで揃える（21.0決定2「演出は最小限、作り込まない」ため、
 * 新しいアニメーション基盤は追加せず待機時間の調整のみで表現する）。
 */
export function useGachaDrawAction() {
  const { client } = useSession();
  const [drawing, setDrawing] = useState(false);

  const draw = useCallback(async (): Promise<GachaDrawActionResult> => {
    setDrawing(true);
    const [res] = await Promise.all([
      drawGacha(client),
      new Promise<void>((resolve) => setTimeout(resolve, 600)),
    ]);
    setDrawing(false);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, data: res.data };
  }, [client]);

  return { drawing, draw };
}

export interface GachaPrizeDetail {
  kind: GachaPrizeKind;
  ornament: GachaPresetOrnament | null;
  drawing: GachaPrizeDrawing | null;
}

/**
 * ガチャ結果画面（P28/C22/S16）向け。`draw_gacha()`が返すID（prize_kindに応じて
 * どちらか一方）から、表示に必要な詳細（既製の飾りの名称・絵文字、または家族の絵の
 * 線データ・作成者名）を取得する。API仕様.md 12.3章「返り値のIDを使って…通常の
 * PostgREST SELECTで取得する」に対応。
 */
export function useGachaPrizeDetail(
  prizeKind: GachaPrizeKind | null,
  presetOrnamentId: string | null,
  prizeDrawingId: string | null
) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<GachaLoadState>("loading");
  const [detail, setDetail] = useState<GachaPrizeDetail | null>(null);

  const load = useCallback(async () => {
    if (!prizeKind) {
      setLoadState("error");
      return;
    }
    setLoadState("loading");
    if (prizeKind === "preset_ornament" && presetOrnamentId) {
      const res = await fetchGachaPresetOrnament(client, presetOrnamentId);
      if (!res.ok) {
        setLoadState("error");
        return;
      }
      setDetail({ kind: "preset_ornament", ornament: res.data, drawing: null });
      setLoadState("ready");
      return;
    }
    if (prizeKind === "family_drawing" && prizeDrawingId) {
      const res = await fetchGachaPrizeDrawing(client, prizeDrawingId);
      if (!res.ok) {
        setLoadState("error");
        return;
      }
      setDetail({ kind: "family_drawing", ornament: null, drawing: res.data });
      setLoadState("ready");
      return;
    }
    setLoadState("error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, prizeKind, presetOrnamentId, prizeDrawingId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, detail, reload: load };
}
