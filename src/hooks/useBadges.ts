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
import { fetchMemberBadgeProgress } from "@/data/api";
import type { MemberBadgeProgress } from "@/types/domain";
import theme, { type BadgeKey } from "@/theme/theme";

export type BadgeLoadState = "loading" | "error" | "ready";

export interface BadgeRow {
  key: BadgeKey;
  emoji: string;
  /** 数字なしの名前（「クエスト」「えかき」…）。theme.badgeDefinitions由来 */
  countName: string;
  /** 回数の単位（[保護者・みまもり, 子ども]）。theme.badgeDefinitions由来 */
  unit: readonly [string, string];
  /** これまでの総回数（実際の値。段階の名前ではない） */
  currentValue: number;
}

/**
 * ポイント通帳（P16/C8）・みまもりホーム（S1）で使う、指標ごとの「これまでの回数」を
 * 取得する。[2026-10-02変更・実装メモ344章、統括「次の段階はいらない、総回数」]
 * 以前は到達済み段階（member_badges）と閾値（badge_tier_thresholds）も取り、
 * 「（達成）（つぎの段階…まで あと◯）」を出していた。総回数だけを見せるので、
 * 現在値（member_badge_progress）の1回の取得で足りる。
 * ランキング・ソートは一切行わない（07-10章必須3条件）。
 */
export function useMemberBadgeRows(memberId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<BadgeLoadState>("loading");
  const [rows, setRows] = useState<BadgeRow[]>([]);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoadState("loading");
    const progressRes = await fetchMemberBadgeProgress(client, memberId);
    if (!progressRes.ok) {
      setLoadState("error");
      return;
    }
    const progress = progressRes.data as MemberBadgeProgress[];
    const nextRows: BadgeRow[] = theme.badgeDefinitions.map((def) => ({
      key: def.key,
      emoji: def.emoji,
      countName: def.countName,
      unit: def.unit,
      currentValue: progress.find((p) => p.badge_key === def.key)?.current_value ?? 0,
    }));
    setRows(nextRows);
    setLoadState("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, rows, reload: load };
}
