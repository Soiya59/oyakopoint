/**
 * 「自分で目標を決める」（要件定義書07-36章、API仕様.md 28章、
 * スキーマ設計.sql 71章`member_goals`）向けのデータ取得・操作フック。
 *
 * [load()の中心バンドルに追加しないこと・API仕様.md 17.9節と同じ申し送り]
 * `src/data/store.tsx`の`load()`には一切クエリを足していない。「いまの目標」
 * カードがマウントされたときにだけ個別に通信する。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { fetchActiveMemberGoal, fetchActiveMemberGoalsForFamily, setMemberGoal, type ApiError } from "@/data/api";
import type { MemberGoal } from "@/types/domain";

export type MemberGoalLoadState = "loading" | "error" | "ready";

/** 子ども1人ぶんの「いまの目標」（子ども向けC5カード、API仕様.md 28.3章）。 */
export function useActiveMemberGoal(memberId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<MemberGoalLoadState>("loading");
  const [goal, setGoal] = useState<MemberGoal | null>(null);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoadState("loading");
    const res = await fetchActiveMemberGoal(client, memberId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setGoal(res.data);
    setLoadState("ready");
  }, [client, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, goal, reload: load };
}

/**
 * 家族の子ども全員ぶんの「いまの目標」（保護者向けP8カード、主要画面
 * ワイヤーフレーム.md 61.3節決定7）。子どもの人数ぶん個別に問い合わせない
 * （N+1にしない、family_idだけで一括取得）。
 */
export function useFamilyMemberGoals(familyId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<MemberGoalLoadState>("loading");
  const [goals, setGoals] = useState<MemberGoal[]>([]);

  const load = useCallback(async () => {
    if (!familyId) return;
    setLoadState("loading");
    const res = await fetchActiveMemberGoalsForFamily(client, familyId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setGoals(res.data);
    setLoadState("ready");
  }, [client, familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, goals, reload: load };
}

export type SetMemberGoalActionResult = { ok: true; goalId: string } | { ok: false; error: ApiError };

/**
 * 新しい目標の登録・差し替え（保護者操作、API仕様.md 28.1章）。
 * `set_member_goal()`経由のみ（71.4章、直接INSERTはRLSに拒否される）。
 */
export function useSetMemberGoalAction() {
  const { client } = useSession();
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (memberId: string, goalText: string, linkedChoreId: string | null): Promise<SetMemberGoalActionResult> => {
      setSaving(true);
      const res = await setMemberGoal(client, memberId, goalText, linkedChoreId);
      setSaving(false);
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, goalId: res.data };
    },
    [client]
  );

  return { saving, save };
}
