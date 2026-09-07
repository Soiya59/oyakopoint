/**
 * 累計到達バッジ（要件定義書07-19-9b章、API仕様.md 14.7章）向けのデータ取得フック。
 * 参照: src/data/api.ts（fetchMemberBadges/fetchMemberBadgeProgress/fetchBadgeTierThresholds）。
 *
 * バッジの獲得判定・記録は完全にサーバー側（元イベントへのAFTER INSERTトリガー、
 * スキーマ設計.sql 47.6章）で自動的に行われ、クライアントから明示的に「判定して
 * ください」と呼び出すAPIは存在しない。完了報告・お絵かき保存・ガチャ・ステッカー
 * 購入のいずれかを行った直後に、本フックの`reload`を呼べば新しく増えた行が見える。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { fetchBadgeTierThresholds, fetchMemberBadgeProgress, fetchMemberBadges } from "@/data/api";
import type { MemberBadge, MemberBadgeProgress } from "@/types/domain";
import theme, { type BadgeKey } from "@/theme/theme";

export type BadgeLoadState = "loading" | "error" | "ready";

export interface BadgeRow {
  key: BadgeKey;
  emoji: string;
  nameParent: string;
  nameChild: string;
  currentValue: number;
  achievedTier: number | null;
  nextTier: number | null;
  remaining: number | null;
}

/**
 * ポイント通帳（P16/C8）・みまもりホーム（S1）で使う、5指標分のバッジ行を
 * まとめて取得する。獲得済み段階（member_badges）・現在値（member_badge_progress）・
 * 閾値配列（badge_tier_thresholds、5指標分を並列取得）を組み合わせてUI表示用の
 * 1行ずつのデータに整形する。ランキング・ソートは一切行わない（07-10章必須3条件）。
 */
export function useMemberBadgeRows(memberId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<BadgeLoadState>("loading");
  const [rows, setRows] = useState<BadgeRow[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoadState("loading");
    const [badgesRes, progressRes, ...tierResList] = await Promise.all([
      fetchMemberBadges(client, memberId),
      fetchMemberBadgeProgress(client, memberId),
      ...theme.badgeDefinitions.map((d) => fetchBadgeTierThresholds(client, d.key)),
    ]);
    if (!badgesRes.ok || !progressRes.ok || tierResList.some((r) => !r.ok)) {
      setLoadState("error");
      return;
    }
    const badges = badgesRes.data as MemberBadge[];
    const progress = progressRes.data as MemberBadgeProgress[];
    const tiersByKey = new Map<BadgeKey, number[]>();
    theme.badgeDefinitions.forEach((d, i) => {
      const r = tierResList[i];
      tiersByKey.set(d.key, r.ok ? r.data : []);
    });

    const nextRows: BadgeRow[] = theme.badgeDefinitions.map((def) => {
      const currentValue = progress.find((p) => p.badge_key === def.key)?.current_value ?? 0;
      const tiers = tiersByKey.get(def.key) ?? [];
      // member_badgesの記録（本人が実際に到達済みの段階）を正とし、tier一覧との
      // 突き合わせは行わない（後退しない原則。到達ログが最終権威、47.6章）。
      const achievedTiers = badges.filter((b) => b.badge_key === def.key).map((b) => b.tier_value);
      const achievedTier = achievedTiers.length > 0 ? Math.max(...achievedTiers) : null;
      const nextTier = tiers.find((t) => t > (achievedTier ?? -1)) ?? null;
      return {
        key: def.key,
        emoji: def.emoji,
        nameParent: def.nameParent,
        nameChild: def.nameChild,
        currentValue,
        achievedTier,
        nextTier,
        remaining: nextTier !== null ? nextTier - currentValue : null,
      };
    });
    setRows(nextRows);
    setLoadState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, rows, reload: load };
}
