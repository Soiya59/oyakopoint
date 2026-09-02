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
import { TreeStageVisual, FamilyTreeWeeklyList, buildFamilyTreeWeeklyItems } from "./FamilyTree";
import { MemberAvatar } from "./MemberAvatar";
import { ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";
import type { CollectedGachaDraw, FamilyTreeCompletionDot } from "@/data/api";
import type { FamilyMember, FamilyTreeSeason, FamilyTreeWeeklyCompletionCount } from "@/types/domain";

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
  /**
   * [2026-09-02追加] 週ごとの記録（要件定義書07-9章新設節「過去の木への反映」、
   * 主要画面ワイヤーフレーム.md 21.0節決定11）。dotsBySeasonIdと同じ「見る」展開の
   * タイミングで取得され、同一ビュー内に表示する。
   */
  weeklyBySeasonId: Record<string, FamilyTreeWeeklyCompletionCount[]>;
  loadingSeasonIds: Record<string, boolean>;
  errorSeasonIds: Record<string, boolean>;
  onExpandSeason: (season: FamilyTreeSeason) => void;

  /**
   * 色の凡例を作るために家族メンバー全員を受け取る（退会者を含む）。
   * [2026-09-01追加・本部長] 統括から「コレクションに入ると誰がどの色か分からない」との
   * 指摘があった。現在の木（P26/C20/S14）は「内訳を見る」のタップで誰の色かを辿れるが、
   * 21.6節のとおり過去の木は読み取り専用でタップを持たないため、辿る手段が無かった。
   * `state.members`は`is_active`で絞っていないため退会者も引ける（実装メモ99章）。
   */
  members: FamilyMember[];
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

/**
 * 過去の木の色の凡例。そのシーズンに報告した人だけを、木と同じ色丸で並べる。
 *
 * 回数は出さない。木の色丸は40スロットのreservoir sampling（20.0節決定3）を通るため、
 * 木の上に見えている丸の数と実際の報告件数が一致せず、数字を添えると嘘になるため。
 * 「誰がどの色か」という指摘に答えるには色と名前の対応だけで足りる。
 *
 * 並び順は`members`の順（`created_at`昇順で取得済み）で、決定5の内訳表示と揃えている。
 * ただし決定5と違い、そのシーズンに報告が無い人は出さない（過去の木は当時の記録であり、
 * 当時いなかった人・報告しなかった人を並べても凡例として意味を持たないため）。
 */
function PastTreeColorLegend({
  dots,
  members,
  tone,
}: {
  dots: FamilyTreeCompletionDot[];
  members: FamilyMember[];
  tone: Tone;
}) {
  const isChild = tone === "child";
  const captionStyle = captionStyleFor(tone);

  const contributors = useMemo(() => {
    const reporterIds = new Set(dots.map((d) => d.reported_by));
    return members.filter((m) => reporterIds.has(m.id));
  }, [dots, members]);

  // 同じ色が複数人に割り当たっている場合は、色だけでは見分けられない旨を添える。
  // パレットは8色しかなく、DB側のnext_member_avatar_colorも使い切ったら重複を許容する
  // 設計のため、これは異常ではなく起こり得る状態である。
  const duplicatedColors = useMemo(() => {
    const seen = new Map<string, number>();
    contributors.forEach((m) => {
      if (m.avatar_color) seen.set(m.avatar_color, (seen.get(m.avatar_color) ?? 0) + 1);
    });
    return new Set(Array.from(seen.entries()).filter(([, n]) => n > 1).map(([c]) => c));
  }, [contributors]);

  if (contributors.length === 0) return null;

  return (
    <View style={styles.legendWrap}>
      <Text style={[captionStyle, styles.legendHeading]}>{isChild ? "だれの いろ？" : "この月の色"}</Text>
      <View style={styles.legendRows}>
        {contributors.map((m) => (
          <View key={m.id} style={styles.legendRow}>
            <MemberAvatar name={m.display_name} color={m.avatar_color} size={20} />
            <Text style={captionStyle}>{m.display_name}</Text>
          </View>
        ))}
      </View>
      {duplicatedColors.size > 0 && (
        <Text style={[captionStyle, styles.legendNote]}>
          {isChild
            ? "おなじ いろの ひとが いるよ"
            : "同じ色のメンバーがいるため、色だけでは見分けられません"}
        </Text>
      )}
    </View>
  );
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
  weeklyBySeasonId,
  loadingSeasonIds,
  errorSeasonIds,
  onExpandSeason,
  members,
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
                        {/* [2026-09-02追加] お絵かきの題名（要件定義書07-13-2a章、
                            主要画面ワイヤーフレーム.md 21.0節決定17）。「描いた人の名前」の
                            直後に、独立した1行のラベル付き表示として追加する。無い絵は
                            この行自体が無い（プレースホルダは出さない）。 */}
                        {selectedItem.drawing.title && (
                          <Text style={[captionStyle, { marginTop: theme.spacing.s1 }]}>
                            {isChild ? "だいめい：" : "題名："}
                            {selectedItem.drawing.title}
                          </Text>
                        )}
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
                        <>
                          <TreeStageVisual stage={season.current_stage} dots={dotsBySeasonId[season.id]} />
                          <PastTreeColorLegend
                            dots={dotsBySeasonId[season.id]}
                            members={members}
                            tone={tone}
                          />
                          {/* [2026-09-02追加] 週ごとの記録（21.0節決定11）。「見る」展開と
                              同一ビュー内に表示し、新しいタップ操作は追加しない。過去シーズンは
                              相対呼称が意味を持たないため全週`M/D週`表記に統一し（決定11）、
                              季節カードごとの縦幅増加を抑えるためparentCaption相当（12pt）の
                              小さめの文字で表示する（21.6節「縦幅への配慮」）。 */}
                          {weeklyBySeasonId[season.id] && (
                            <View style={{ marginTop: theme.spacing.s3 }}>
                              <Text style={[captionStyle, styles.legendHeading]}>
                                {isChild ? "しゅうごとの きろく" : "週ごとのきろく"}
                              </Text>
                              <FamilyTreeWeeklyList
                                items={buildFamilyTreeWeeklyItems({
                                  weeklyCounts: weeklyBySeasonId[season.id],
                                  seasonStart: season.season_start,
                                  seasonEnd: season.season_end,
                                  isChild,
                                  useRelativeLabels: false,
                                })}
                                countLabel={isChild ? "かい" : "回"}
                                labelStyle={captionStyle}
                                countStyle={captionStyle}
                              />
                            </View>
                          )}
                        </>
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
  legendWrap: { marginTop: theme.spacing.s3 },
  legendHeading: { color: theme.colors.neutralTextSecondary, marginBottom: theme.spacing.s2 },
  legendRows: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s3 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s1 },
  legendNote: { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s2 },
  emptyEmoji: { fontSize: 40, marginBottom: theme.spacing.s2 },
  emptyText: { textAlign: "center" },
  seasonHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  seasonToggle: { color: theme.colors.brandPrimaryStrong },
});

export default CollectorShelfPanel;
