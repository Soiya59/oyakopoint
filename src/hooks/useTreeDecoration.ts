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
 *
 * [2026-08-26修正・本部長] **画面がスケルトン表示のまま永久に止まる不具合を修正した。**
 * 修正前は入力が揃わないと`loadState`を変えずにreturnしていたため、
 * `seasonStart`が最後までnullのままだと`"loading"`から二度と抜けられなかった
 * （エラーにもならないので、ユーザーには「読み込み中が終わらない」としか見えない）。
 * `useFamilyTreeDetail`は現在シーズンが取得できなくても`loadState="ready"`／
 * `season=null`を返す実装のため、この経路は実際に発生しうる。
 *
 * 修正後は「まだ待っている状態」と「待っても来ない状態」を呼び出し側が区別できる
 * ようにし、後者では空の一覧として`ready`にする（画面は空状態の案内を出せる）。
 *
 * @param seasonResolved 家族の木の読み込みが完了したか。`true`かつ`seasonStart`が
 *   nullなら「進行中のシーズンが無い」と確定した状態であり、待ち続けない。
 */
export function useDecoratableCompletions(
  memberId: string,
  seasonStart: string | null,
  seasonResolved: boolean
) {
  const { client } = useSession();
  const { state } = useAppData();
  const familyId = state.family.id;
  const [loadState, setLoadState] = useState<TreeDecorationLoadState>("loading");
  const [candidates, setCandidates] = useState<DecoratableCompletion[]>([]);

  const load = useCallback(async () => {
    // 進行中のシーズンが無いことが確定した場合は、待たずに空で確定させる。
    if (seasonResolved && !seasonStart) {
      setCandidates([]);
      setLoadState("ready");
      return;
    }
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
  }, [client, familyId, memberId, seasonStart, seasonResolved]);

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
