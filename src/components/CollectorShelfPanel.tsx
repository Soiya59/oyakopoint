/**
 * コレクター棚（P31／C26／S19）本体の3ロール共通コンポーネント。
 * 参照: 要件定義書07-13-3章、主要画面ワイヤーフレーム.md 21.0節決定6・21.6節・
 * 32.0a節（決定19〜25）・32.2a節。
 *
 * [2026-09-07改訂・本部長／実装メモ152章] 画面に出す呼び名は「メダル」に統一した
 * （統括判断）。コンポーネント名・DBの`sticker_key`・本コメントの「シール」
 * 「ステッカー」はそのまま変更していない。
 *
 * [2026-09-07全面改訂・統括フィードバック（本部長経由）・32.0a節/32.2a節]
 * 「区画3：自分のステッカー」という独立タブは廃止し、タブは「集めたもの」
 * 「過去の木」の2つに戻した（決定19）。「集めたもの」タブの中にメンバー選択
 * チップ（全員＋各メンバー、決定20・決定22「既定は全員」）を新設し、個別メンバーを
 * 選ぶと「バッジ」（決定24・達成済みのみ）「つくった・あつめたもの」（決定21・
 * このメンバーが獲得/描いたものへの絞り込み）「シール」（決定23・所有数0の行は
 * 表示しない）の3区分をまとめて見せる。
 *
 * 決定6「木に飾る」「並べ替える」ボタンを一切配置しない、という原則は区画1
 * 「集めたもの」（全員選択時）・区画2「過去の木」には引き続きそのまま適用する。
 * シール区分（個別メンバー・自分選択時のみ）は例外的に「木に飾る」「うごかす」
 * 「シールを買いに行く」を持つ（決定25「自分を選んでいるときだけ表示」）。
 *
 * 「集めたもの」: 家族共有・永久保管の景品一覧。タップで詳細（獲得した人・日付、
 *   家族の絵の場合は描いた人の名前も表示）。未公開の絵はそもそもこの一覧に
 *   含まれない（`gacha_draws`経由でのみ取得するため。src/data/api.ts参照）。
 * 「過去の木」: シーズンごとの家族の木を、その月に飾られた景品・自由配置ステッカーが
 *   乗った状態のまま再現表示する。読み取り専用（タップ操作を持たない）。
 */
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import BadgeList from "./BadgeList";
import Card from "./Card";
import { DrawingThumbnail } from "./DrawingCanvas";
import { TreeStageVisual, FamilyTreeWeeklyList, buildFamilyTreeWeeklyItems } from "./FamilyTree";
import { MemberAvatar } from "./MemberAvatar";
import { StickerIcon } from "./StickerIcon";
import { ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";
import type { StickerRarity, StickerShape } from "@/theme/theme";
import type { BadgeRow } from "@/hooks/useBadges";
import type { CollectedGachaDraw, FamilyTreeCompletionDot, FamilyTreeStickerPlacement } from "@/data/api";
import type { FamilyMember, FamilyTreeSeason, FamilyTreeWeeklyCompletionCount, StickerPurchaseWithCatalog } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";
type ShelfTab = "collected" | "pastTrees";

/** メンバー選択チップの「全員」を表す番兵値（実在のmember_idと衝突しない）。 */
export const ALL_MEMBERS_ID = "__all__";

const stickerShapeLabel: Record<StickerShape, { child: string; parent: string }> = {
  beetle: { child: "カブトムシ", parent: "カブトムシ" },
  butterfly: { child: "ちょうちょ", parent: "ちょうちょ" },
  flower: { child: "はな", parent: "小さな花" },
};

const stickerRarityLabel: Record<StickerRarity, { child: string; parent: string }> = {
  bronze: { child: "どう", parent: "銅" },
  silver: { child: "ぎん", parent: "銀" },
  gold: { child: "きん", parent: "金" },
  // [2026-09-08改訂・本部長／実装メモ173章] 統括判断で「虹」から「クリスタル」に
  // 改称（StickerShopPanel.tsxと同じ表記統一の理由）。
  crystal: { child: "クリスタル", parent: "クリスタル" },
};

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
   * [2026-09-08追加・スキーマ設計.sql 49章] 過去シーズンの自由配置ステッカー
   * （decoration_source='sticker'）。dotsBySeasonIdと同じ「見る」展開のタイミングで
   * 取得され、TreeStageVisualのstickerPlacementsプロパティにそのまま渡す。
   */
  stickerPlacementsBySeasonId: Record<string, FamilyTreeStickerPlacement[]>;
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

  /** いま操作中の自分自身のmember_id（メンバー選択チップの「自分」表記・操作導線の出し分けに使う）。 */
  myMemberId: string;

  // [2026-09-08新設・主要画面ワイヤーフレーム.md 32.0a節決定19〜22]
  // 「集めたもの」区画内のメンバー選択チップ。ALL_MEMBERS_IDが「全員」（既定）。
  selectedMemberId: string;
  onSelectMember: (memberId: string) => void;

  /** 個別メンバー選択時の「バッジ」区分（決定24、達成済みのみ）。 */
  badgesLoadState: LoadState;
  badgeRows: BadgeRow[];
  onRetryBadges: () => void;

  /** 個別メンバー選択時の「シール」区分（決定23）。 */
  stickersLoadState: LoadState;
  stickerPurchases: StickerPurchaseWithCatalog[];
  onRetryStickers: () => void;
  /**
   * [2026-09-08追加・実装メモ158章] 「全員」選択時の「メダル」区分。家族全員分の
   * メダル所有状況をまとめて受け取る（`member_id`で誰の物かを判別する）。
   */
  familyStickersLoadState: LoadState;
  familyStickerPurchases: StickerPurchaseWithCatalog[];
  onRetryFamilyStickers: () => void;
  /** 自分選択時のみ: 「シールを かいに いく」導線（→購入画面、決定25）。 */
  onGoToStickerShop: () => void;
  /** 自分選択時のみ: 「木に かざる」導線（→ドラッグ配置画面、決定25）。 */
  onPlaceSticker: (purchaseId: string, shape: StickerShape, rarity: StickerRarity) => void;
  /** 自分選択時のみ: 「うごかす」導線（→ドラッグ移動画面、49.12章統括判断）。 */
  onMoveSticker: (decorationId: string, shape: StickerShape, rarity: StickerRarity, posX: number, posY: number) => void;
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
 *
 * [2026-09-08改訂] 「全員」ビューと個別メンバーの「つくった・あつめたもの」の
 * 両方から使う共通ロジックとして、コンポーネント外の純関数に切り出した。
 */
function buildShelfEntries(items: CollectedGachaDraw[]): { key: string; item: CollectedGachaDraw; count: number }[] {
  const entries: { key: string; item: CollectedGachaDraw; count: number }[] = [];
  const presetIndexByName = new Map<string, number>();
  for (const item of items) {
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
}

/**
 * 景品一覧グリッド＋タップで開く詳細カード（「集めたもの」全員ビュー・個別メンバーの
 * 「つくった・あつめたもの」の両方で使う共通表示）。`items`が空配列のときは何も
 * 描画しない（空状態の文言は呼び出し側が個別に出す。全員ビューと個別ビューで
 * 空状態の文言・導線が異なるため、02.2a節決定23と同じくここでは共通化しない）。
 */
function ShelfItemsGrid({ tone, items }: { tone: Tone; items: CollectedGachaDraw[] }) {
  const isChild = tone === "child";
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const shelfEntries = useMemo(() => buildShelfEntries(items), [items]);
  const selectedEntry = shelfEntries.find((e) => e.key === selectedItemId) ?? null;
  const selectedItem = selectedEntry?.item ?? null;

  if (shelfEntries.length === 0) return null;

  return (
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
            // [2026-09-09拡大・統括の実機確認からの指摘「絵をタップしたときに大きく
            // 表示してほしい。今は大きく表示されない」] グリッド（48pt）とほぼ同じ
            // 大きさ（72pt）のサムネイルでは絵の中身が見えなかったため、詳細カード内で
            // 大きく（220pt）表示する。新しい画面・新しいモーダルは増やさず、既存の
            // 詳細カードの表示サイズだけを変える。横並び（絵＋テキスト）だと大きな絵の
            // 隣にテキストが収まらないため、この分岐だけ縦積み（絵を中央上、テキストを
            // その下に中央寄せ）のレイアウトに変える。`DrawingThumbnail`
            // （`src/components/DrawingCanvas.tsx`）は`size`を渡せる実装のため、
            // サイズの変更のみで対応できた。
            <View style={styles.detailDrawingWrap}>
              <DrawingThumbnail lineData={selectedItem.drawing.line_data} size={220} />
              <View style={styles.detailDrawingTextWrap}>
                <Text style={[bodyMediumStyle, styles.detailDrawingCenterText]}>
                  {isChild ? `「${selectedItem.drawing.artistName}」の絵` : `「${selectedItem.drawing.artistName}」が描いた絵`}
                </Text>
                {/* [2026-09-02追加] お絵かきの題名（要件定義書07-13-2a章、
                    主要画面ワイヤーフレーム.md 21.0節決定17）。「描いた人の名前」の
                    直後に、独立した1行のラベル付き表示として追加する。無い絵は
                    この行自体が無い（プレースホルダは出さない）。 */}
                {selectedItem.drawing.title && (
                  <Text style={[captionStyle, styles.detailDrawingCenterText, { marginTop: theme.spacing.s1 }]}>
                    {isChild ? "だいめい：" : "題名："}
                    {selectedItem.drawing.title}
                  </Text>
                )}
                {/* [2026-08-29修正・本部長] 既製の飾りには「◯◯が獲得」と出るのに、
                    絵には**描いた人しか出ておらず、ガチャで引き当てた人が分からなかった**
                    （ユーザーの実機指摘）。collectorNameは既に取得済みで使っていないだけ
                    だった。絵は「描いた人」と「見つけた人」が別人になりうるので、
                    日付と一緒に見つけた人も出す。 */}
                <Text style={[captionStyle, styles.detailDrawingCenterText, { marginTop: theme.spacing.s1 }]}>
                  {formatShortDate(selectedItem.drawnAt)} {selectedItem.collectorName}
                  {isChild ? "が みつけたよ" : "が獲得"}
                </Text>
              </View>
            </View>
          ) : null}
        </Card>
      )}
    </>
  );
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

/**
 * メンバー選択チップ（主要画面ワイヤーフレーム.md 32.2a節「メンバー選択チップ」）。
 * 「全員」を先頭に、以降は`members`の順（`created_at`昇順、呼び出し元が既に
 * その順で渡す前提）。ソート・並び替え機能は持たせない（07-10章必須3条件）。
 */
function MemberSelectionChips({
  tone,
  members,
  myMemberId,
  selectedMemberId,
  onSelectMember,
}: {
  tone: Tone;
  members: FamilyMember[];
  myMemberId: string;
  selectedMemberId: string;
  onSelectMember: (id: string) => void;
}) {
  const isChild = tone === "child";
  const captionStyle = captionStyleFor(tone);

  return (
    <View style={styles.stickerMemberRow}>
      <Pressable
        onPress={() => onSelectMember(ALL_MEMBERS_ID)}
        style={[styles.stickerMemberChip, selectedMemberId === ALL_MEMBERS_ID && styles.stickerMemberChipActive]}
        accessibilityRole="button"
        accessibilityState={{ selected: selectedMemberId === ALL_MEMBERS_ID }}
      >
        <Text style={captionStyle}>{isChild ? "ぜんいん" : "全員"}</Text>
      </Pressable>
      {members
        .filter((m) => m.is_active)
        .map((m) => (
          <Pressable
            key={m.id}
            onPress={() => onSelectMember(m.id)}
            style={[styles.stickerMemberChip, m.id === selectedMemberId && styles.stickerMemberChipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: m.id === selectedMemberId }}
          >
            <MemberAvatar name={m.display_name} color={m.avatar_color} size={20} />
            <Text style={captionStyle}>{m.id === myMemberId ? (isChild ? "じぶん" : "自分") : m.display_name}</Text>
          </Pressable>
        ))}
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
  stickerPlacementsBySeasonId,
  weeklyBySeasonId,
  loadingSeasonIds,
  errorSeasonIds,
  onExpandSeason,
  members,
  myMemberId,
  selectedMemberId,
  onSelectMember,
  badgesLoadState,
  badgeRows,
  onRetryBadges,
  stickersLoadState,
  stickerPurchases,
  onRetryStickers,
  familyStickersLoadState,
  familyStickerPurchases,
  onRetryFamilyStickers,
  onGoToStickerShop,
  onPlaceSticker,
  onMoveSticker,
}: CollectorShelfPanelProps) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const [tab, setTab] = useState<ShelfTab>("collected");
  const [expandedSeasonId, setExpandedSeasonId] = useState<string | null>(null);

  const collectedLabel = isChild ? "あつめたもの" : "集めたもの";
  const pastTreesLabel = isChild ? "まえの木" : "過去の木";
  const isViewingSelf = selectedMemberId === myMemberId;
  const selectedMember = members.find((m) => m.id === selectedMemberId);

  const toggleSeason = (season: FamilyTreeSeason) => {
    const next = expandedSeasonId === season.id ? null : season.id;
    setExpandedSeasonId(next);
    if (next && !dotsBySeasonId[season.id]) onExpandSeason(season);
  };

  // 個別メンバー選択時「つくった・あつめたもの」（決定21）。絞り込みは既存の
  // 表示項目（獲得した人・描いた人のmember_id）による閲覧フィルタにすぎず、
  // 07-13-3章「景品は引いた人ではなく家族の所有物」という家族共有の原則は
  // 変えない（一時的に絞り込んで見せているだけ）。
  //
  // [2026-09-09修正・統括の実機確認からの指摘] 家族の絵（`item.drawing`が存在する
  // 行）は「描いた人（artistId）」だけで絞り込む。従来は`collectorId === selectedMemberId
  // || item.drawing?.artistId === selectedMemberId`という「引いた人 or 描いた人」の
  // OR条件だったため、自分が描いていなくても自分が引き当てた絵まで「じぶんの
  // つくった・あつめたもの」に出てしまっていた。既製の飾り（`item.drawing`が無い行）は
  // 描いた人が存在しないため、従来どおり「引いた人（collectorId）」で絞り込む。
  const memberMadeOrCollected = useMemo(() => {
    if (selectedMemberId === ALL_MEMBERS_ID) return [];
    return collectedItems.filter((item) =>
      item.drawing ? item.drawing.artistId === selectedMemberId : item.collectorId === selectedMemberId
    );
  }, [collectedItems, selectedMemberId]);

  return (
    <View style={{ marginTop: theme.spacing.s4 }}>
      <View style={styles.tabRow}>
        <Pressable
          onPress={() => setTab("collected")}
          style={[styles.tabButton, tab === "collected" && styles.tabButtonActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: tab === "collected" }}
        >
          <Text style={[bodyMediumStyleFor(tone), tab === "collected" && styles.tabTextActive]}>{collectedLabel}</Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("pastTrees")}
          style={[styles.tabButton, tab === "pastTrees" && styles.tabButtonActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: tab === "pastTrees" }}
        >
          <Text style={[bodyMediumStyleFor(tone), tab === "pastTrees" && styles.tabTextActive]}>{pastTreesLabel}</Text>
        </Pressable>
      </View>

      {tab === "collected" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          {/* [2026-09-08新設・主要画面ワイヤーフレーム.md 32.2a節] メンバー選択チップ。
              「集めたもの」タブの中にのみ置く（決定20）。既定は「全員」（決定22）。 */}
          <MemberSelectionChips
            tone={tone}
            members={members}
            myMemberId={myMemberId}
            selectedMemberId={selectedMemberId}
            onSelectMember={onSelectMember}
          />

          {selectedMemberId === ALL_MEMBERS_ID ? (
            // 「全員」選択時: 既存の家族共有プールドビューをそのまま表示する（決定21、変更なし）。
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
              {collectedLoadState === "ready" && collectedItems.length > 0 && <ShelfItemsGrid tone={tone} items={collectedItems} />}

              {/* --- メダル区分（「全員」選択時。実装メモ158章・統括の実機確認「あつめたものに
                  メダルも入れてほしい」対応） --- */}
              <View style={{ marginTop: theme.spacing.s6 }}>
                <Text style={[captionStyle, styles.legendHeading]}>メダル</Text>
                <FamilyMedalSection
                  tone={tone}
                  members={members}
                  loadState={familyStickersLoadState}
                  purchases={familyStickerPurchases}
                  onRetry={onRetryFamilyStickers}
                />
              </View>
            </View>
          ) : (
            // 個別メンバー選択時: バッジ・つくった/あつめたもの・シールの3区分（決定21・22）。
            <View style={{ marginTop: theme.spacing.s4, gap: theme.spacing.s6 }}>
              {/* --- バッジ区分（決定24。達成済みのみ、進捗は出さない） --- */}
              <View>
                <Text style={[captionStyle, styles.legendHeading]}>バッジ</Text>
                {badgesLoadState === "loading" && <SkeletonList count={1} />}
                {badgesLoadState === "error" && (
                  <ErrorState tone={isChild ? "child" : "parent"} title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"} onRetry={onRetryBadges} />
                )}
                {badgesLoadState === "ready" && badgeRows.every((r) => r.achievedTier === null) && (
                  <Text style={bodyStyle}>{isChild ? "まだ ないよ" : "まだありません"}</Text>
                )}
                {badgesLoadState === "ready" && (
                  <BadgeList isChild={isChild} loadState={badgesLoadState} rows={badgeRows} achievedOnly hideHeading />
                )}
              </View>

              {/* --- つくった・あつめたもの区分（決定21） --- */}
              <View>
                <Text style={[captionStyle, styles.legendHeading]}>つくった・あつめたもの</Text>
                {collectedLoadState === "loading" && <SkeletonList count={2} />}
                {collectedLoadState === "ready" && memberMadeOrCollected.length === 0 && (
                  <Text style={bodyStyle}>{isChild ? "まだ なにも あつまっていないよ" : "まだ何も集まっていません"}</Text>
                )}
                {collectedLoadState === "ready" && memberMadeOrCollected.length > 0 && (
                  <ShelfItemsGrid tone={tone} items={memberMadeOrCollected} />
                )}
              </View>

              {/* --- シール区分（決定23。所有数0の行は表示しない） --- */}
              <StickerShelfSection
                tone={tone}
                isViewingSelf={isViewingSelf}
                selectedMemberName={selectedMember?.display_name ?? "?"}
                loadState={stickersLoadState}
                purchases={stickerPurchases}
                onRetry={onRetryStickers}
                onGoToShop={onGoToStickerShop}
                onPlace={onPlaceSticker}
                onMove={onMoveSticker}
              />
            </View>
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
                    <Text style={bodyMediumStyleFor(tone)}>
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
                          <TreeStageVisual
                            stage={season.current_stage}
                            dots={dotsBySeasonId[season.id]}
                            stickerPlacements={stickerPlacementsBySeasonId[season.id]}
                          />
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

/**
 * 「シール」区分（主要画面ワイヤーフレーム.md 32.2a節「シール」区分・決定23）。
 * 所有している種類（形×レアリティ）だけを列挙する。所有数0の組み合わせは
 * 表示しない（旧32.2節の12マス固定グリッドは廃止）。
 *
 * [2026-09-08・木への配置が自由配置化（スキーマ設計.sql 49章）したことに伴う
 * 開発部の実装判断] UIUXデザイン部32.2a節は「木に飾る」ボタンのみを想定していたが
 * （旧・色丸との交換方式が前提）、49章により配置後の「うごかす」操作が新設された
 * （統括判断49.12章）。UIUXデザイン部からはこの「うごかす」導線のUI配置について
 * 別タスクとしての発注が申し送られている（49.17章）ため、開発部の判断として、
 * 各エントリ（形×レアリティ）に「うごかす」を併設する。同じ形×レアリティを
 * 複数個所有し、かつ複数月にわたって購入した場合、過去シーズンに配置済み
 * （凍結・移動不可）のインスタンスと今シーズンに配置済み（移動可）のインスタンスが
 * 混在しうるが、「うごかす」は今シーズンの配置がある場合にのみ出す
 * （過去シーズンの配置は移動対象外）。
 *
 * [2026-09-11改訂・本部長経由の統括指摘（実装メモ151章）] 従来は横1行の文字列
 * （小さな`StickerIcon` 28pt＋テキスト＋ボタンを1行に並べる表示）だったが、統括の
 * 指摘「同じ自分の持ち物なのに見た目も操作もバラバラで、せっかくのメダルの絵が
 * 見えない」（『お絵かきと同じ感じで並べて、同様に押したら拡大されるように』）を
 * 受け、上の「つくった・あつめたもの」区分（`ShelfItemsGrid`）と同じ
 * カードグリッド＋タップで開く詳細カードの形に統一した。カードの大きさ・間隔・
 * 角丸は`ShelfItemsGrid`と共通の`styles.grid`/`styles.gridItem`/`styles.gridItemSelected`
 * /`styles.gridCaption`をそのまま流用し、新規スタイルは追加していない。
 * 「木に飾る」「うごかす」は行から詳細カード（`StickerDetailCard`）の中へ移した
 * （決定25「自分を選んでいるときだけ表示」は維持）。詳細・迷った点は実装メモ151章参照。
 */
function buildStickerShelfEntries(
  purchases: StickerPurchaseWithCatalog[]
): { key: string; shape: StickerShape; rarity: StickerRarity; owned: StickerPurchaseWithCatalog[] }[] {
  const entries: { key: string; shape: StickerShape; rarity: StickerRarity; owned: StickerPurchaseWithCatalog[] }[] = [];
  theme.stickerShapes.forEach((shape) => {
    theme.stickerRarities.forEach((rarity) => {
      const owned = purchases.filter((p) => p.sticker_catalog?.shape === shape && p.sticker_catalog?.rarity === rarity);
      if (owned.length === 0) return; // 決定23: 所有数0の組み合わせは表示しない
      entries.push({ key: `${shape}-${rarity}`, shape, rarity, owned });
    });
  });
  return entries;
}

function stickerEntryLabel(tone: Tone, shape: StickerShape, rarity: StickerRarity): string {
  const isChild = tone === "child";
  return `${isChild ? stickerShapeLabel[shape].child : stickerShapeLabel[shape].parent} ${
    isChild ? stickerRarityLabel[rarity].child : stickerRarityLabel[rarity].parent
  }`;
}

function StickerShelfSection({
  tone,
  isViewingSelf,
  selectedMemberName,
  loadState,
  purchases,
  onRetry,
  onGoToShop,
  onPlace,
  onMove,
}: {
  tone: Tone;
  isViewingSelf: boolean;
  selectedMemberName: string;
  loadState: LoadState;
  purchases: StickerPurchaseWithCatalog[];
  onRetry: () => void;
  onGoToShop: () => void;
  onPlace: (purchaseId: string, shape: StickerShape, rarity: StickerRarity) => void;
  onMove: (decorationId: string, shape: StickerShape, rarity: StickerRarity, posX: number, posY: number) => void;
}) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const totalOwned = purchases.length;
  const entries = useMemo(() => buildStickerShelfEntries(purchases), [purchases]);
  const selectedEntry = entries.find((e) => e.key === selectedKey) ?? null;

  return (
    <View>
      {/* [2026-09-07改訂・本部長／実装メモ152章] 呼び名を「メダル」に統一（統括判断）。
          DBの`sticker_key`・コンポーネント名・コメント中の「シール」「ステッカー」は変更しない。 */}
      <Text style={[captionStyle, styles.legendHeading]}>メダル</Text>

      {loadState === "loading" && <SkeletonList count={2} />}
      {loadState === "error" && (
        <ErrorState tone={isChild ? "child" : "parent"} title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"} onRetry={onRetry} />
      )}

      {loadState === "ready" && totalOwned === 0 && (
        <>
          {isViewingSelf ? (
            <>
              <Text style={bodyStyle}>{isChild ? "まだ メダルを もっていないよ。かってみよう→" : "まだメダルを購入していません。購入する→"}</Text>
              <AppButton
                label={isChild ? "メダルを かいに いく →" : "購入する →"}
                tone={tone}
                onPress={onGoToShop}
                style={{ marginTop: theme.spacing.s3 }}
              />
            </>
          ) : (
            <Text style={bodyStyle}>{isChild ? `${selectedMemberName}さんは まだ もっていないよ` : `${selectedMemberName}さんはまだ持っていません`}</Text>
          )}
        </>
      )}

      {loadState === "ready" && totalOwned > 0 && (
        <>
          <View style={styles.grid}>
            {entries.map((entry) => {
              const selected = entry.key === selectedKey;
              return (
                <Pressable
                  key={entry.key}
                  onPress={() => setSelectedKey(selected ? null : entry.key)}
                  style={[styles.gridItem, selected && styles.gridItemSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <StickerIcon shape={entry.shape} rarity={entry.rarity} size={48} />
                  <Text style={[captionStyle, styles.gridCaption]}>
                    {stickerEntryLabel(tone, entry.shape, entry.rarity)}
                    {entry.owned.length > 1 ? ` ×${entry.owned.length}` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {selectedEntry && (
            <StickerDetailCard tone={tone} isViewingSelf={isViewingSelf} entry={selectedEntry} onPlace={onPlace} onMove={onMove} />
          )}

          {isViewingSelf && (
            <Pressable onPress={onGoToShop} style={{ marginTop: theme.spacing.s3 }}>
              <Text style={[bodyStyle, { color: theme.colors.brandPrimaryStrong }]}>
                {isChild ? "→ メダルを かいに いく" : "→ メダルを買いに行く"}
              </Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

/**
 * シール詳細カード（グリッドをタップすると開く）。`ShelfItemsGrid`の家族の絵の
 * 詳細（`DrawingThumbnail size={220}`で拡大表示する分岐）と同じ縦積みレイアウト
 * （`styles.detailDrawingWrap`/`detailDrawingTextWrap`/`detailDrawingCenterText`を
 * 流用）を使い、`StickerIcon`は`size={220}`・`highRes`指定で512px画像を使う。
 * 名前・必要ポイント・今シーズンに飾ってあるかどうか・「うごかす」「木に飾る」の
 * 導線をここにまとめる（従来は一覧の行に出ていた。統括指摘・実装メモ151章）。
 *
 * [必要ポイントの出典について・迷った点] `sticker_catalog`の`points_cost`
 * （カタログの現在価格）ではなく、`owned`配列の先頭（＝最も新しい購入。
 * `fetchMyStickerPurchases`が`purchased_at`降順で返すため）の`points_spent`
 * （その購入インスタンスが実際に支払った額）を表示する。カタログの現在価格を
 * 出すにはAPI側のselect文とドメイン型（`StickerPurchaseWithCatalog.sticker_catalog`の
 * Pick）を拡張する必要があり、今回は「DBの変更は無い」指示の範囲を画面側の
 * 表示ロジックだけに留めるため、既に取得済みの`points_spent`で代替した。
 * カタログ価格が改定されない前提なら両者は一致する（価格改定機能は現状無い）。
 */
function StickerDetailCard({
  tone,
  isViewingSelf,
  entry,
  onPlace,
  onMove,
}: {
  tone: Tone;
  isViewingSelf: boolean;
  entry: { shape: StickerShape; rarity: StickerRarity; owned: StickerPurchaseWithCatalog[] };
  onPlace: (purchaseId: string, shape: StickerShape, rarity: StickerRarity) => void;
  onMove: (decorationId: string, shape: StickerShape, rarity: StickerRarity, posX: number, posY: number) => void;
}) {
  const isChild = tone === "child";
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);

  const { shape, rarity, owned } = entry;
  const unplaced = owned.filter((p) => !p.placement);
  const currentSeasonPlaced = owned.find((p) => p.placement?.isCurrentSeason);
  const pointsCost = owned[0]?.points_spent;

  return (
    <Card tone={tone} style={{ marginTop: theme.spacing.s4 }}>
      <View style={styles.detailDrawingWrap}>
        <StickerIcon shape={shape} rarity={rarity} size={220} highRes />
        <View style={styles.detailDrawingTextWrap}>
          <Text style={[bodyMediumStyle, styles.detailDrawingCenterText]}>{stickerEntryLabel(tone, shape, rarity)}</Text>
          {pointsCost != null && (
            <Text style={[captionStyle, styles.detailDrawingCenterText, { marginTop: theme.spacing.s1 }]}>{pointsCost}pt</Text>
          )}
          <Text style={[captionStyle, styles.detailDrawingCenterText, { marginTop: theme.spacing.s1 }]}>
            {currentSeasonPlaced
              ? isChild
                ? "いまの きに かざってあるよ"
                : "いまの木にかざってあります"
              : isChild
              ? "いまの きには かざっていないよ"
              : "いまの木にはかざっていません"}
          </Text>
          {isViewingSelf && (
            <View style={{ marginTop: theme.spacing.s3, alignItems: "center", gap: theme.spacing.s2 }}>
              {currentSeasonPlaced && currentSeasonPlaced.placement && (
                <Pressable
                  onPress={() =>
                    onMove(
                      currentSeasonPlaced.placement!.decorationId,
                      shape,
                      rarity,
                      currentSeasonPlaced.placement!.posX,
                      currentSeasonPlaced.placement!.posY
                    )
                  }
                  hitSlop={8}
                >
                  <Text style={[captionStyle, styles.stickerRowMoveLink]}>うごかす</Text>
                </Pressable>
              )}
              {unplaced.length > 0 && (
                <AppButton
                  label={isChild ? "木に かざる" : "木に飾る"}
                  tone={tone}
                  variant="secondary"
                  onPress={() => onPlace(unplaced[0].id, shape, rarity)}
                />
              )}
            </View>
          )}
        </View>
      </View>
    </Card>
  );
}

/**
 * 「メダル」区分（「全員」選択時。実装メモ158章）。統括の実機確認「あつめたものに、
 * メダルも入れてほしい」への対応で、個別メンバー選択時の`StickerShelfSection`とは
 * 別に、家族全員分のメダル所有状況を1つのグリッドにまとめて表示する。
 *
 * 表示グリッドは`StickerShelfSection`（個別メンバー版）と完全に同じスタイル
 * （`styles.grid`/`gridItem`/`gridCaption`）を使い、「つくった・あつめたもの」の
 * グリッドとも見た目を揃える（統括指摘・実装メモ151章で揃えたばかりのため）。
 * ただし「木に飾る」「うごかす」「メダルを買いに行く」などの操作導線は一切持たない
 * （決定6「全員選択時に並べ替え等のボタンを一切配置しない」・決定25「自分を
 * 選んでいるときだけ操作を表示」。全員ビューは特定の「自分」を持たないため）。
 */
function FamilyMedalSection({
  tone,
  members,
  loadState,
  purchases,
  onRetry,
}: {
  tone: Tone;
  members: FamilyMember[];
  loadState: LoadState;
  purchases: StickerPurchaseWithCatalog[];
  onRetry: () => void;
}) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const entries = useMemo(() => buildStickerShelfEntries(purchases), [purchases]);
  const selectedEntry = entries.find((e) => e.key === selectedKey) ?? null;

  if (loadState === "loading") return <SkeletonList count={2} />;
  if (loadState === "error") {
    return (
      <ErrorState
        tone={isChild ? "child" : "parent"}
        title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"}
        onRetry={onRetry}
      />
    );
  }
  if (entries.length === 0) {
    return <Text style={bodyStyle}>{isChild ? "まだ ないよ" : "まだありません"}</Text>;
  }

  return (
    <>
      <View style={styles.grid}>
        {entries.map((entry) => {
          const selected = entry.key === selectedKey;
          return (
            <Pressable
              key={entry.key}
              onPress={() => setSelectedKey(selected ? null : entry.key)}
              style={[styles.gridItem, selected && styles.gridItemSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <StickerIcon shape={entry.shape} rarity={entry.rarity} size={48} />
              <Text style={[captionStyle, styles.gridCaption]}>
                {stickerEntryLabel(tone, entry.shape, entry.rarity)}
                {entry.owned.length > 1 ? ` ×${entry.owned.length}` : ""}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {selectedEntry && <FamilyStickerDetailCard tone={tone} members={members} entry={selectedEntry} />}
    </>
  );
}

/**
 * 「メダル」区分（全員選択時）の詳細カード。個別メンバー版の`StickerDetailCard`とは
 * 異なり、木への配置状況・操作導線は持たず、「誰が何個持っているか」の内訳のみを示す。
 * 家族の絵の詳細（誰が描いたか）に倣い、「全員」ビューでも誰の物かを詳細タップで
 * 追えるようにする（本節冒頭コメント参照）。
 *
 * 並び順は`members`順（`PastTreeColorLegend`と同じ、決定5の内訳表示と揃える）で、
 * 件数の多い順には並べ替えない（07-10章必須3条件「ランキングを作らない」）。
 */
function FamilyStickerDetailCard({
  tone,
  members,
  entry,
}: {
  tone: Tone;
  members: FamilyMember[];
  entry: { shape: StickerShape; rarity: StickerRarity; owned: StickerPurchaseWithCatalog[] };
}) {
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const { shape, rarity, owned } = entry;

  const ownerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    owned.forEach((p) => counts.set(p.member_id, (counts.get(p.member_id) ?? 0) + 1));
    return members.filter((m) => counts.has(m.id)).map((m) => ({ member: m, count: counts.get(m.id)! }));
  }, [owned, members]);

  return (
    <Card tone={tone} style={{ marginTop: theme.spacing.s4 }}>
      <View style={styles.detailDrawingWrap}>
        <StickerIcon shape={shape} rarity={rarity} size={220} highRes />
        <View style={styles.detailDrawingTextWrap}>
          <Text style={[bodyMediumStyle, styles.detailDrawingCenterText]}>{stickerEntryLabel(tone, shape, rarity)}</Text>
          <View style={[styles.legendRows, { marginTop: theme.spacing.s3, justifyContent: "center" }]}>
            {ownerCounts.map(({ member, count }) => (
              <View key={member.id} style={styles.legendRow}>
                <MemberAvatar name={member.display_name} color={member.avatar_color} size={20} />
                <Text style={captionStyle}>
                  {member.display_name}
                  {count > 1 ? ` ×${count}` : ""}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </Card>
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
  // [2026-09-09新設] 家族の絵の詳細表示専用（拡大サムネイル＋縦積みレイアウト）。
  detailDrawingWrap: { alignItems: "center" },
  detailDrawingTextWrap: { marginTop: theme.spacing.s3, alignItems: "center" },
  detailDrawingCenterText: { textAlign: "center" },
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
  // [2026-09-08改訂] メンバー選択チップ（旧「区画3」時代のスタイルを流用）。
  stickerMemberRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2 },
  stickerMemberChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.s1,
    paddingHorizontal: theme.spacing.s2,
    paddingVertical: theme.spacing.s1,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  stickerMemberChipActive: { borderColor: theme.gachaColors.accent, backgroundColor: theme.gachaColors.accentSoft },
  // [2026-09-11改訂] 旧・横1行表示（stickerRow等）はグリッド化に伴い廃止し、
  // 「うごかす」リンクのスタイルのみ残す（実装メモ151章）。
  stickerRowMoveLink: { color: theme.colors.brandPrimaryStrong, textDecorationLine: "underline" },
});

export default CollectorShelfPanel;
