/**
 * タップ先「シール帳」画面の中身（P38・保護者／S26・みまもりメンバー／子どもは
 * 軽量モーダル、主要画面ワイヤーフレーム.md 49-B.5章決定45〜46、全面改訂）。
 *
 * 役割を「進行中の内訳」に絞る（決定45）: ①進行中の冊の詳しい進捗（段階
 * ゲージ・いまの10マス・数字、帯から移設）、②進行中の内訳（多い順上位5件＋
 * ほか◯件）、③絵柄の選び直し（累計0件のときのみ）、④他メンバーの閲覧
 * （決定12・18を維持）。「しまった冊」の一覧・「おわりにする」操作は置かない
 * （コレクションへ移設、依頼文決定11／手動終了は撤去、決定27）。
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import HabitCardKindPicker from "./HabitCardKindPicker";
import MemberAvatar from "./MemberAvatar";
import { ErrorState, SkeletonList } from "./StatusViews";
import { groupHabitFigureCatalogByKind, useChooseHabitCardKindAction, computeHabitCardTierInfo } from "@/hooks/useHabitCards";
import {
  computeCurrentPageFilledCells,
  computeHabitCardPageTier,
  formatHabitCardProgressText,
  getHabitCardKindInfo,
  summarizeHabitCardBreakdown,
} from "@/lib/habitCardDisplay";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import type { Chore, FamilyMember, HabitCard, HabitCardChoreBreakdownRow, HabitFigureCatalogItem, HabitFigureGrantWithCatalog } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";

const TIER_LABEL_ADULT: Record<string, string> = { bronze: "銅", silver: "銀", gold: "金", crystal: "クリスタル" };
const TIER_LABEL_CHILD: Record<string, string> = { bronze: "どう", silver: "ぎん", gold: "きん", crystal: "クリスタル" };

export interface HabitCardBoardProps {
  tone: Tone;
  members: FamilyMember[];
  myMemberId: string;
  selectedMemberId: string;
  onSelectMember: (id: string) => void;
  chores: Chore[];
  catalog: HabitFigureCatalogItem[];
  loadState: LoadState;
  card: HabitCard | null;
  breakdown: HabitCardChoreBreakdownRow[];
  totalCount: number;
  /**
   * 【2026-09-19差分修正・主要画面ワイヤーフレーム.md 49-B.4章決定60】
   * 進行中の冊（`card`）に紐づく獲得済みフィギュア。選び直し可否は
   * `totalCount === 0`ではなく、この配列が空かどうか（存在チェック）で
   * 判定する。`count < 10`等の数値比較は使わない（決定60必須要件）。
   */
  grants: HabitFigureGrantWithCatalog[];
  onRetry: () => void;
  /** 絵柄の選び直しが成功したら呼ぶ（呼び出し元が再取得する）。 */
  onKindChosen: () => void;
}

/** 決定11-A「段階の目盛り」。銅(10)・銀(30)・金(50)・クリスタル(100)の4点を横一列に置く。 */
function TierGauge({ tone, count }: { tone: Tone; count: number }) {
  const { currentTier } = computeHabitCardTierInfo(count);
  const isChild = tone === "child";
  const order: ("bronze" | "silver" | "gold" | "crystal")[] = ["bronze", "silver", "gold", "crystal"];
  const label = isChild ? TIER_LABEL_CHILD : TIER_LABEL_ADULT;
  return (
    <View style={styles.gaugeRow}>
      {order.map((tier) => {
        const reached = currentTier != null && order.indexOf(tier) <= order.indexOf(currentTier);
        return (
          <Text key={tier} style={[styles.gaugeItem, reached && styles.gaugeItemReached]}>
            {label[tier]}
          </Text>
        );
      })}
    </View>
  );
}

// [2026-09-20差し戻し対応その2・実装メモ261.10章] 当初は1つ目のセル自身に
// `onLayout`を付けて実測していたが、そのセルの幅自体が`width: "18%"`という
// 相対値・`aspectRatio: 1`という比率指定に依存しており、Android実機では
// レイアウト計算のタイミング（Yogaの解決順）が異なるらしく、実測が一度も
// 走らずフォールバック値に固定されたまま、しかも枠自体の高さが0に潰れる
// 不具合が発生した（Web版では再現しなかった、詳細は実装メモ261.10章）。
// 対策として、①測る対象をセルではなく「入れ物」（cellsWrap、幅は親からの
// stretchで確定済み）に変える、②セルの大きさは`width`/`height`ともpx値を
// 明示し、`aspectRatio`・`%`指定を一切使わない、③5列×2行を`flexWrap`による
// 自動折り返しに頼らず、行を2つの明示的なViewとして分ける（折り返しタイミングに
// 依存する余地そのものを無くす）、の3点で「環境によって解決のされ方が違う」
// 指定を排除した。
const HABIT_CARD_GRID_COLUMNS = 5;
const HABIT_CARD_GRID_ROWS = 2;
const HABIT_CARD_CELL_GAP_PX = theme.spacing.s2; // 列・行とも8px（決定64「列間の余白を差し引いた比率」を固定pxの隙間として具体化した値）
const CELL_BORDER_RADIUS_RATIO = 0.25; // 決定69「一辺の約25%」
const CELL_EMOJI_SIZE_RATIO = 0.45; // 差し戻し指示「マスの半分弱（35〜40px程度）」

/**
 * 決定11-B「いまの10マス」。5×2のマス目で表示する。
 * [2026-09-20改訂・主要画面ワイヤーフレーム.md 49-B.14章決定64〜69、同日本部長差し戻し
 * 対応、実装メモ261.10章で再修正] 円（⬤/◯）から角丸四角形へ変更（決定69）。埋まって
 * いるマスは、いまの頁が目指す段階の色（決定66・67）で塗り、中央にその種類の絵文字
 * （決定65）を表示する。未到達マスは形はそのまま、塗りを透明にし縁取りだけ
 * neutralBorderにする（決定68、絵文字は出さない）。borderRadius・絵文字サイズは
 * 実測した「入れ物」の幅から算出したpxのセル幅に追従する（aspectRatio・%は不使用）。
 */
function TenCellsGrid({
  filled,
  kindEmoji,
  pageTier,
}: {
  filled: number;
  kindEmoji: string | null;
  pageTier: "bronze" | "silver" | "gold" | "crystal";
}) {
  // [261.10章] セルではなく「入れ物」の幅を測る。cellsWrapは親（Card内のView、
  // column方向のflexで既定alignItems:"stretch"）から横幅いっぱいにstretchされる
  // ため、セル自身の相対値と違い、この時点で確定済みのpx幅を持つ。
  const [wrapWidthPx, setWrapWidthPx] = useState<number | null>(null);
  const cellSizePx =
    wrapWidthPx != null
      ? Math.floor((wrapWidthPx - HABIT_CARD_CELL_GAP_PX * (HABIT_CARD_GRID_COLUMNS - 1)) / HABIT_CARD_GRID_COLUMNS)
      : null;
  const borderRadius = cellSizePx != null ? Math.round(cellSizePx * CELL_BORDER_RADIUS_RATIO) : 0;
  const emojiFontSize = cellSizePx != null ? Math.round(cellSizePx * CELL_EMOJI_SIZE_RATIO) : 0;

  const cells = Array.from({ length: 10 }, (_, i) => i < filled);
  const fillColor = theme.habitCardCellColors[pageTier];
  const rows = [cells.slice(0, HABIT_CARD_GRID_COLUMNS), cells.slice(HABIT_CARD_GRID_COLUMNS, HABIT_CARD_GRID_COLUMNS * HABIT_CARD_GRID_ROWS)];

  return (
    <View
      style={styles.cellsWrap}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && w !== wrapWidthPx) setWrapWidthPx(w);
      }}
    >
      {/* [261.10章決定4] 幅を測り終える（cellSizePxが決まる）前は、崩れて見えうる
          マスを一切描画しない。入れ物のonLayoutは初回レンダリング直後に発火するため、
          未測定の状態が画面に見える時間は実質無い。 */}
      {cellSizePx != null &&
        rows.map((rowCells, rowIndex) => (
          <View
            key={rowIndex}
            style={[styles.cellRow, rowIndex < rows.length - 1 && { marginBottom: HABIT_CARD_CELL_GAP_PX }]}
          >
            {rowCells.map((isFilled, colIndex) => {
              const i = rowIndex * HABIT_CARD_GRID_COLUMNS + colIndex;
              const isLastColumn = colIndex === rowCells.length - 1;
              return (
                <View
                  key={i}
                  style={[
                    styles.cell,
                    {
                      width: cellSizePx,
                      height: cellSizePx,
                      borderRadius,
                      marginRight: isLastColumn ? 0 : HABIT_CARD_CELL_GAP_PX,
                    },
                    isFilled
                      ? { backgroundColor: fillColor, borderColor: theme.habitCardCellBorderColor }
                      : { backgroundColor: "transparent", borderColor: theme.colors.neutralBorder },
                  ]}
                >
                  {isFilled && <Text style={[styles.cellEmoji, { fontSize: emojiFontSize }]}>{kindEmoji ?? "🏳️"}</Text>}
                </View>
              );
            })}
          </View>
        ))}
    </View>
  );
}

export function HabitCardBoard({
  tone,
  members,
  myMemberId,
  selectedMemberId,
  onSelectMember,
  chores,
  catalog,
  loadState,
  card,
  breakdown,
  totalCount,
  grants,
  onRetry,
  onKindChosen,
}: HabitCardBoardProps) {
  const isChild = tone === "child";
  const bodyStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  const captionStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;
  const { memberAvatars } = useAppData();
  const { choosing, choose } = useChooseHabitCardKindAction();
  const [kindPickerOpen, setKindPickerOpen] = useState(false);
  const [chooseError, setChooseError] = useState<string | null>(null);

  const kindGroups = groupHabitFigureCatalogByKind(catalog);

  const handleChoose = async (kindKey: string) => {
    if (!card) return;
    setChooseError(null);
    const res = await choose(card.id, kindKey);
    if (!res.ok) {
      setChooseError(res.error.message);
      return;
    }
    setKindPickerOpen(false);
    onKindChosen();
  };

  if (loadState === "loading") return <SkeletonList count={3} />;
  if (loadState === "error") {
    return <ErrorState tone={isChild ? "child" : "parent"} title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"} onRetry={onRetry} />;
  }

  const kindInfo = getHabitCardKindInfo(card, catalog, isChild);
  const filled = card ? computeCurrentPageFilledCells(totalCount) : 0;
  const pageTier = computeHabitCardPageTier(totalCount);
  const progressText = card
    ? formatHabitCardProgressText(totalCount, (tier) => (isChild ? TIER_LABEL_CHILD[tier] : TIER_LABEL_ADULT[tier]))
    : "";
  const summary = summarizeHabitCardBreakdown(breakdown, chores, 5);
  const isViewingSelf = selectedMemberId === myMemberId;
  // [決定60・必須] 判定は`habit_figure_grants`の存在チェックで行う。
  // `totalCount === 0`（完了報告の累計）や`count < 10`のような数値比較には
  // 戻さないこと（銅のしきい値が将来変わると直し忘れる事故になる）。
  const canChooseKind = isViewingSelf && card != null && grants.length === 0;

  return (
    <View>
      {/* 決定18: メンバーチップは家族全員（本人1人のみならチップ行自体を出さない）。 */}
      {members.filter((m) => m.is_active).length > 1 && (
        <View style={styles.memberRow}>
          {members
            .filter((m) => m.is_active)
            .map((m) => (
              <Pressable
                key={m.id}
                onPress={() => onSelectMember(m.id)}
                style={[styles.memberChip, m.id === selectedMemberId && styles.memberChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: m.id === selectedMemberId }}
              >
                <MemberAvatar name={m.display_name} color={m.avatar_color} size={20} lineData={memberAvatars[m.id]} />
                <Text style={captionStyle}>{m.id === myMemberId ? (isChild ? "じぶん" : "自分") : m.display_name}</Text>
              </Pressable>
            ))}
        </View>
      )}

      {!card ? (
        <Text style={[bodyStyle, { marginTop: theme.spacing.s4 }]}>
          {isChild ? "また あとで みてみてね" : "読み込めませんでした"}
        </Text>
      ) : (
        <>
          <View style={{ marginTop: theme.spacing.s3 }}>
            <Text style={bodyStyle}>
              {kindInfo.kindEmoji ?? "🏳️"} {kindInfo.kindDisplayName}　{totalCount}/100
            </Text>
            <TierGauge tone={tone} count={totalCount} />
            <TenCellsGrid filled={filled} kindEmoji={kindInfo.kindEmoji} pageTier={pageTier} />
            <Text style={[captionStyle, { marginTop: theme.spacing.s1 }]}>{progressText}</Text>

            {/* [決定42②副経路・決定45③・決定60] まだフィギュアを1体も獲得していない
                間だけ、絵柄の選び直しリンクを常設する（habit_figure_grantsの
                存在チェック。決定61の気づける案内をリンクの直前に置く）。 */}
            {canChooseKind && !kindPickerOpen && (
              <>
                <Text style={[captionStyle, { marginTop: theme.spacing.s2 }]}>
                  {isChild
                    ? "まだ 1こも もらってないから、えを かえられるよ（かえなくても いいよ）"
                    : "まだフィギュアを1体も獲得していないため、絵柄を変えられます（変えなくても大丈夫です）"}
                </Text>
                <Pressable onPress={() => setKindPickerOpen(true)}>
                  <Text style={[captionStyle, styles.link]}>えらびなおす →</Text>
                </Pressable>
              </>
            )}
            {canChooseKind && kindPickerOpen && (
              <View style={{ marginTop: theme.spacing.s3 }}>
                <HabitCardKindPicker
                  tone={tone}
                  groups={kindGroups}
                  currentKindKey={card.kind_key}
                  onChoose={handleChoose}
                  choosing={choosing}
                  error={chooseError}
                />
                <Pressable onPress={() => setKindPickerOpen(false)}>
                  <Text style={[captionStyle, styles.link]}>とじる</Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* [決定45②・46] 進行中の内訳。多い順上位5件＋ほか◯件。 */}
          <View style={{ marginTop: theme.spacing.s4 }}>
            <Text style={[bodyStyle, { fontWeight: "700" }]}>
              {isViewingSelf
                ? isChild
                  ? "いま やっていること"
                  : "いま やっていること"
                : `${members.find((m) => m.id === selectedMemberId)?.display_name ?? ""}の いま やっていること`}
            </Text>
            {summary.total === 0 ? (
              <Text style={[captionStyle, { marginTop: theme.spacing.s2 }]}>
                {isChild ? "まだ なにも やっていないよ" : "まだ実施記録がありません"}
              </Text>
            ) : (
              <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s1 }}>
                {summary.top.map((entry) => (
                  <View key={entry.choreId ?? entry.title} style={styles.breakdownRow}>
                    <Text style={bodyStyle} numberOfLines={1}>
                      {entry.emoji ?? "📝"} {entry.title}
                    </Text>
                    <Text style={captionStyle}>{isChild ? `${entry.count}かい` : `${entry.count}回`}</Text>
                  </View>
                ))}
                {summary.otherCount > 0 && (
                  <Text style={captionStyle}>{isChild ? `ほか${summary.otherCount}けん` : `ほか${summary.otherCount}件`}</Text>
                )}
              </View>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  memberRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginBottom: theme.spacing.s3 },
  memberChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.s1,
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  memberChipActive: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
  gaugeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: theme.spacing.s1 },
  gaugeItem: { fontSize: 11, color: theme.colors.neutralTextSecondary },
  gaugeItemReached: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  // [決定64、2026-09-20実装メモ261.10章で再修正] 固定110px幅を廃止し、5列×2行の
  // 並びは維持したままコンテナ幅いっぱいに敷き詰める。当初は`justifyContent:
  // "space-between"`＋セル側`width:"18%"`で実現していたが、Android実機で
  // レイアウトが崩れる不具合が発生したため撤回した（実装メモ261.10章）。
  // 列・行の並びは`TenCellsGrid`内で2つの明示的な行Viewとして組み、この
  // コンテナは「入れ物」として幅を`onLayout`で測るためだけに使う（column方向）。
  cellsWrap: { marginTop: theme.spacing.s1 },
  // [261.10章] 1行=5マスを横に並べるだけの入れ物。マス自体の幅・高さは
  // TenCellsGrid内で実測px値をインライン指定する（%・aspectRatioは使わない）。
  cellRow: { flexDirection: "row" },
  // [決定69・2026-09-20本部長差し戻し対応、261.10章で再修正] 丸ではなく角丸四角形。
  // width/height/borderRadiusはいずれもTenCellsGrid内で実測pxからインライン指定する
  // （ここでは実測に依存しない部分〈枠線・中央寄せ〉のみ定義する。width・aspectRatio
  // は指定しない。261.10章の原因になった相対値指定を再導入しないための意図的な省略）。
  cell: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // fontSizeはTenCellsGrid内で実測セル幅から算出しインライン指定する（ここでは指定しない）。
  cellEmoji: {},
  link: { color: theme.colors.brandPrimaryStrong, marginTop: theme.spacing.s2 },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});

export default HabitCardBoard;
