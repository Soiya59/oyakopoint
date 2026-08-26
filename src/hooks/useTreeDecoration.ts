/**
 * 木への飾り付け（要件定義書07-13-4章、API仕様.md 12.3章）向けデータ取得・操作フック。
 * 参照: src/data/api.ts（fetchUndecoratedGachaDraws/fetchMyDecoratableCompletions/
 * decorateTreeWithGachaPrize）。
 *
 * [重要] 第4段階（木への飾り付け）の実装範囲。ガチャを引く操作自体
 * （`draw_gacha()`、第3段階）は`useGacha.ts`に置いたまま変更しない。
 * コレクター棚（第5段階）向けの一覧取得はここには一切含めない。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { useAppData } from "@/data/store";
import {
  decorateTreeWithGachaPrize,
  fetchMyDecoratableCompletions,
  fetchUndecoratedGachaDraws,
  type ApiError,
  type DecoratableCompletion,
  type UndecoratedGachaDraw,
} from "@/data/api";

export type TreeDecorationLoadState = "loading" | "error" | "ready";

/**
 * ガチャ画面（P27/C21/S15）主要画面ワイヤーフレーム.md 21.2節「未配置の景品あり」
 * 案内カード用。自分のガチャ結果のうちまだ`family_tree_decorations`に反映して
 * いないものを新しい順に返す（複数回分たまっていても、案内・遷移に使うのは
 * 直近の1件でよい。21.4節の画面自体は1回の抽選結果＝1つの`draw_id`を対象にする
 * 設計のため）。
 */
export function useUndecoratedGachaDraw(memberId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<TreeDecorationLoadState>("loading");
  const [draw, setDraw] = useState<UndecoratedGachaDraw | null>(null);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoadState("loading");
    const res = await fetchUndecoratedGachaDraws(client, memberId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setDraw(res.data[0] ?? null);
    setLoadState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, draw, reload: load };
}

/**
 * 木に飾る画面（P29/C23/S17）の一覧部分。今シーズン（`seasonStart`、
 * "YYYY-MM-DD"形式）の自分の完了報告のうち、まだ景品と交換していないものを返す。
 * `seasonStart`がまだ取得できていない間（家族の木の読み込み中）は何もしない。
 */
export function useDecoratableCompletions(memberId: string, seasonStart: string | null) {
  const { client } = useSession();
  const { state } = useAppData();
  const familyId = state.family.id;
  const [loadState, setLoadState] = useState<TreeDecorationLoadState>("loading");
  const [candidates, setCandidates] = useState<DecoratableCompletion[]>([]);

  const load = useCallback(async () => {
    if (!memberId || !familyId || !seasonStart) return;
    setLoadState("loading");
    // useFamilyTree.tsのfetchFamilyTreeCompletionDots呼び出しと同じ変換
    // （season_startはJST基準の暦月初日の日付のみを持つため、JSTの0時を明示する）。
    const seasonStartIso = new Date(`${seasonStart}T00:00:00+09:00`).toISOString();
    const res = await fetchMyDecoratableCompletions(client, familyId, memberId, seasonStartIso);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setCandidates(res.data);
    setLoadState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, familyId, memberId, seasonStart]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, candidates, reload: load };
}

export type DecorateActionResult = { ok: true; decorationId: string } | { ok: false; error: ApiError };

/** 「かざる」ボタンの確定操作。`decorate_tree_with_gacha_prize()`を1回呼ぶだけの薄いラッパー。 */
export function useDecorateTreeAction() {
  const { client } = useSession();
  const [decorating, setDecorating] = useState(false);

  const decorate = useCallback(
    async (drawId: string, completionId: string): Promise<DecorateActionResult> => {
      setDecorating(true);
      const res = await decorateTreeWithGachaPrize(client, drawId, completionId);
      setDecorating(false);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, decorationId: res.data };
    },
    [client]
  );

  return { decorating, decorate };
}
