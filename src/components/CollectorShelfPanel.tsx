/**
 * コレクター棚（P31／C26／S19）本体の3ロール共通コンポーネント。
 * 参照: 要件定義書07-13-3章、主要画面ワイヤーフレーム.md 21.0節決定6・21.6節。
 *
 * 決定6「木に飾る」「並べ替える」ボタンを一切配置しない。棚は「並べ直すための在庫」
 * ではなく「見返すためのアルバム」（07-13-3章）。本コンポーネントは表示専用の
 * 2区画（「集めたもの」「過去の木」）のみを持ち、木へ景品を戻す・並べ替える導線は
 * 一切実装しない。
 *
 * 「集めたもの」: 家族共有・永久保管の景品一覧。タップで詳細（獲得した人・日付、
 *   家族の絵の場合は描いた人の名前も表示）。未公開の絵はそもそもこの一覧に
 *   含まれない（`gacha_draws`経由でのみ取得するため。src/data/api.ts参照）。
 * 「過去の木」: シーズンごとの家族の木を、その月に飾られた景品が乗った状態のまま
 *   再現表示する。読み取り専用（タップ操作を持たない）。
 */
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import Card from "./Card";
import { DrawingThumbnail } from "./DrawingCanvas";
import { TreeStageVisual } from "./FamilyTree";
import { ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";
import type { CollectedGachaDraw, FamilyTreeCompletionDot } from "@/data/api";
import type { FamilyTreeSeason } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";
type ShelfTab = "collected" | "pastTrees";

export interface CollectorShelfPanelProps {
  tone: Tone;
  collectedLoadState: LoadState;
  collectedItems: CollectedGachaDraw[];
  onRetryCollected: () => void;
  /** 空状態（集めたもの、初回）のガチャ画面への軽い導線。 */
  onGoToGacha: () => void;

  pastSeasonsLoadState: LoadState;
  pastSeasons: FamilyTreeSeason[];
  onRetryPastSeasons: () => void;

  dotsBySeasonId: Record<string, FamilyTreeCompletionDot[]>;
  loadingSeasonIds: Record<string, boolean>;
  errorSeasonIds: Record<string, boolean>;
  onExpandSeason: (season: FamilyTreeSeason) => void;
}

const bodyStyleFor = (tone: Tone) =>
  tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
const bodyMediumStyleFor = (tone: Tone) =>
  tone === "child"
    ? theme.typography.childBody
    : tone === "supporter"
    ? theme.typography.supporterBodyMedium
    : theme.typography.parentBodyMedium;
const captionStyleFor = (tone: Tone) =>
  tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;

/** season_start/season_end（"YYYY-MM-DD"、JST基準の暦月初日）をJST 0時としてDate化する。 */
function jstDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00+09:00`);
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

function formatMonthLabel(dateOnly: string): string {
  return jstDate(dateOnly).toLocaleDateString("ja-JP", { month: "long" });
}

export function CollectorShelfPanel({
  tone,
  collectedLoadState,
  collectedItems,
  onRetryCollected,
  onGoToGacha,
  pastSeasonsLoadState,
  pastSeasons,
  onRetryPastSeasons,
  dotsBySeasonId,
  loadingSeasonIds,
  errorSeasonIds,
  onExpandSeason,
}: CollectorShelfPanelProps) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const [tab, setTab] = useState<ShelfTab>("collected");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [expandedSeasonId, setExpandedSeasonId] = useState<string | null>(null);

  const collectedLabel = isChild ? "あつめたもの" : "集めたもの";
  const pastTreesLabel = isChild ? "まえの木" : "過去の木";

  const toggleSeason = (season: FamilyTreeSeason) => {
    const next = expandedSeasonId === season.id ? null : season.id;
    setExpandedSeasonId(next);
    if (next && !dotsBySeasonId[season.id]) onExpandSeason(season);
  };

  /**
   * [2026-08-27追加・本部長] 同じ既製の飾りは1マスにまとめて個数で見せる。
   *
   * ユーザーの指摘: 7人程度が参加する家族では「木も棚もパンパンになりそう」。
   * 完了報告5回ごとに1回引けるため、7人がお手伝いをすれば月に数十回引かれ、
   * 既製の飾りが半分出るとして半年で百個以上になる。1個1マスで並べると
   * **せっかくの家族の絵が既製品に埋もれて探せなくなる**。
   *
   * 家族の絵は1枚ずつ固有のものなのでまとめず、常に個別に表示する。
   * これにより、既製品が何個増えても絵が主役の位置を保てる。
   * 個数が増えること自体は「集まってきた」という手応えになるため、
   * まとめても失われる情報は無い（07-13-1章「外れ枠を作らない」とも整合）。
   */
  const shelfEntries = useMemo(() => {
    const entries: { key: string; item: CollectedGachaDraw; count: number }[] = [];
    const presetIndexByName = new Map<string, number>();
    for (const item of collectedItems) {
      if (item.prizeKind === "preset_ornament") {
        const name = item.presetOrnament?.display_name ?? "?";
        const at = presetIndexByName.get(name);
        if (at !== undefined) {
          entries[at].count += 1;
          continue;
        }
        presetIndexByName.set(name, entries.length);
        entries.push({ key: `preset:${name}`, item, count: 1 });
      } else {
        entries.push({ key: item.id, item, count: 1 });
      }
    }
    return entries;
  }, [collectedItems]);

  const selectedEntry = shelfEntries.find((e) => e.key === selectedItemId) ?? null;
  const selectedItem = selectedEntry?.item ?? null;

  return (
    <View style={{ marginTop: theme.spacing.s4 }}>
      <View style={styles.tabRow}>
        <Pressable
          onPress={() => setTab("collected")}
          style={[styles.tabButton, tab === "collected" && styles.tabButtonActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: tab === "collected" }}
        >
          <Text style={[bodyMediumStyle, tab === "collected" && styles.tabTextActive]}>{collectedLabel}</Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("pastTrees")}
          style={[styles.tabButton, tab === "pastTrees" && styles.tabButtonActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: tab === "pastTrees" }}
        >
          <Text style={[bodyMediumStyle, tab === "pastTrees" && styles.tabTextActive]}>{pastTreesLabel}</Text>
        </Pressable>
      </View>

      {tab === "collected" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          {collectedLoadState === "loading" && <SkeletonList count={3} />}
          {collectedLoadState === "error" && (
            <ErrorState
              tone={isChild ? "child" : "parent"}
              title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"}
              onRetry={onRetryCollected}
            />
          )}
          {collectedLoadState === "ready" && collectedItems.length === 0 && (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyEmoji}>🎁</Text>
              <Text style={[bodyStyle, styles.emptyText]}>
                {isChild
                  ? "まだ なにも あつまっていないよ。ガチャで あつめてみよう！"
                  : "まだ何も集まっていません。ガチャで集めてみましょう"}
              </Text>
              <AppButton
                label={isChild ? "ガチャへ →" : "ガチャへ"}
                tone={tone}
                onPress={onGoToGacha}
                style={{ marginTop: theme.spacing.s4 }}
              />
            </View>
          )}
          {collectedLoadState === "ready" && collectedItems.length > 0 && (
            <>
              <View style={styles.grid}>
                {shelfEntries.map((entry) => {
                  const item = entry.item;
                  const selected = entry.key === selectedItemId;
                  return (
                    <Pressable
                      key={entry.key}
                      onPress={() => setSelectedItemId(selected ? null : entry.key)}
                      style={[styles.gridItem, selected && styles.gridItemSelected]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      {item.prizeKind === "preset_ornament" ? (
                        <Text style={styles.gridEmoji}>{item.presetOrnament?.emoji ?? "🎁"}</Text>
                      ) : item.drawing ? (
                        <DrawingThumbnail lineData={item.drawing.line_data} size={48} />
                      ) : null}
                      <Text style={[captionStyle, styles.gridCaption]}>
                        {entry.count > 1 ? `×${entry.count}` : formatShortDate(item.drawnAt)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {selectedItem && (
                <Card tone={tone} style={{ marginTop: theme.spacing.s4 }}>
                  {selectedItem.prizeKind === "preset_ornament" ? (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailEmoji}>{selectedItem.presetOrnament?.emoji ?? "🎁"}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={bodyMediumStyle}>{selectedItem.presetOrnament?.display_name ?? "かざり"}</Text>
                        <Text style={[captionStyle, { marginTop: theme.spacing.s1 }]}>
                          {formatShortDate(selectedItem.drawnAt)} {selectedItem.collectorName}
                          {isChild ? "が みつけたよ" : "が獲得"}
                        </Text>
                      </View>
                    </View>
                  ) : selectedItem.drawing ? (
                    <View style={styles.detailRow}>
                      <DrawingThumbnail lineData={selectedItem.drawing.line_data} size={72} />
                      <View style={{ flex: 1 }}>
                        <Text style={bodyMediumStyle}>
                          {isChild
                            ? `「${selectedItem.drawing.artistName}」の絵`
                            : `「${selectedItem.drawing.artistName}」が描いた絵`}
                        </Text>
                        {/* [2026-08-29修正・本部長] 既製の飾りには「◯◯が獲得」と出るのに、
                            絵には**描いた人しか出ておらず、ガチャで引き当てた人が分からなかった**
                            （ユーザーの実機指摘）。collectorNameは既に取得済みで使っていないだけ
                            だった。絵は「描いた人」と「見つけた人」が別人になりうるので、
                            日付と一緒に見つけた人も出す。 */}
                        <Text style={[captionStyle, { marginTop: theme.spacing.s1 }]}>
                          {formatShortDate(selectedItem.drawnAt)} {selectedItem.collectorName}
                          {isChild ? "が みつけたよ" : "が獲得"}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                </Card>
              )}
            </>
          )}
        </View>
      )}

      {tab === "pastTrees" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          {pastSeasonsLoadState === "loading" && <SkeletonList count={2} />}
          {pastSeasonsLoadState === "error" && (
            <ErrorState
              tone={isChild ? "child" : "parent"}
              title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"}
              onRetry={onRetryPastSeasons}
            />
          )}
          {pastSeasonsLoadState === "ready" && pastSeasons.length === 0 && (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyEmoji}>🌳</Text>
              <Text style={[bodyStyle, styles.emptyText]}>
                {isChild
                  ? "きろくは まだ ないよ。今月の木が おわると、ここに のこるよ"
                  : "記録はまだありません。今月の木が終わると、ここに残ります"}
              </Text>
            </View>
          )}
          {pastSeasonsLoadState === "ready" &&
            pastSeasons.map((season) => {
              const expanded = expandedSeasonId === season.id;
              const stageInfo = theme.treeStages[season.current_stage] ?? theme.treeStages[0];
              return (
                <Card key={season.id} tone={tone} style={{ marginTop: theme.spacing.s3 }}>
                  <Pressable
                    onPress={() => toggleSeason(season)}
                    style={styles.seasonHeaderRow}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                  >
                    <Text style={bodyMediumStyle}>
                      {formatMonthLabel(season.season_start)}の木：{stageInfo.name} {stageInfo.emoji}
                    </Text>
                    <Text style={[bodyStyle, styles.seasonToggle]}>{isChild ? (expanded ? "とじる" : "みる ▼") : expanded ? "とじる ▲" : "見る ▼"}</Text>
                  </Pressable>

                  {expanded && (
                    <View style={{ marginTop: theme.spacing.s3 }}>
                      {loadingSeasonIds[season.id] && <SkeletonList count={1} />}
                      {errorSeasonIds[season.id] && (
                        <ErrorState
                          tone={isChild ? "child" : "parent"}
                          title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"}
                          onRetry={() => onExpandSeason(season)}
                        />
                      )}
                      {!loadingSeasonIds[season.id] && !errorSeasonIds[season.id] && dotsBySeasonId[season.id] && (
                        <TreeStageVisual stage={season.current_stage} dots={dotsBySeasonId[season.id]} />
                      )}
                    </View>
                  )}
                </Card>
              );
            })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow: { flexDirection: "row", gap: theme.spacing.s2 },
  tabButton: {
    flex: 1,
    paddingVertical: theme.spacing.s3,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    alignItems: "center",
  },
  tabButtonActive: {
    backgroundColor: theme.gachaColors.accentSoft,
    borderColor: theme.gachaColors.accent,
  },
  tabTextActive: { color: theme.colors.neutralTextPrimary, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s3 },
  gridItem: {
    width: 84,
    minHeight: 84,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.s1,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentLg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    padding: theme.spacing.s2,
  },
  gridItemSelected: { borderColor: theme.gachaColors.accent, borderWidth: 2, backgroundColor: theme.gachaColors.accentSoft },
  gridEmoji: { fontSize: 32 },
  gridCaption: { textAlign: "center" },
  detailRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s3 },
  detailEmoji: { fontSize: 40 },
  emptyWrap: { alignItems: "center", paddingVertical: theme.spacing.s6 },
  emptyEmoji: { fontSize: 40, marginBottom: theme.spacing.s2 },
  emptyText: { textAlign: "center" },
  seasonHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  seasonToggle: { color: theme.colors.brandPrimaryStrong },
});

export default CollectorShelfPanel;
