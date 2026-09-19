/**
 * シール帳の絵柄選び直し一覧（要件定義書07-28章決定29・34、主要画面ワイヤーフレーム.md
 * 49-B.4章決定43〜44・62〜63）。既存のメダル購入画面（32.1節）と同型の縦積みリストで、
 * 現在選択中の絵柄にチェックを付ける。1行1種類・種類が増えても崩れない
 * （旧49.3節決定6を踏襲）。
 *
 * 呼び出し元は2箇所（49-B.4章決定42）:
 *   1. 主経路: クリスタル到達演出（HabitFigureGrantBanner）の直後の追加ステップ
 *   2. 副経路: タップ先の画面（HabitCardBoard.tsx）の「えらびなおす →」リンク
 * いずれも「その冊でまだフィギュアを1体も獲得していない間だけ」呼び出し可能
 * （57.6章決定57-12改訂、49-B.4章決定60。habit_figure_grantsの存在チェック）。
 *
 * 【2026-09-19差分修正・決定62・63】各行に、その種類の「銅」1体だけを
 * `FigureIcon`で絵として表示する（選ぶときの手がかり）。銀・金・クリスタルは
 * 実際に到達するまで、既存の`FigureFrame`（五角形の枠）を絵を入れずに空の
 * まま表示する（グレーアウト・「未達成」ラベル等は使わない。新しいシルエット
 * 画像は作らない）。この制限は本画面（絵柄を選ぶ画面）のみが対象で、コレクション
 * ・タップ先の獲得状況では既獲得のフィギュアは通常どおりそのまま見える
 * （適用範囲を広く解釈しない、要件定義書07-28章決定34）。
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import FigureFrame from "./FigureFrame";
import FigureIcon from "./FigureIcon";
import theme from "@/theme/theme";
import { resolveChildFriendlyKindDisplayName } from "@/lib/habitCardDisplay";
import type { HabitKindGroup } from "@/hooks/useHabitCards";

/** 決定62・63の絵柄プレビュー1マスの直径。既存のFigureFrame利用例（48px系）を踏襲。 */
const FIGURE_FRAME_SIZE = 40;
const FIGURE_ICON_SIZE = FIGURE_FRAME_SIZE * 0.5;

type Tone = "parent" | "child" | "supporter";

export interface HabitCardKindPickerProps {
  tone: Tone;
  groups: HabitKindGroup[];
  currentKindKey: string | null;
  onChoose: (kindKey: string) => void;
  choosing: boolean;
  error: string | null;
}

export function HabitCardKindPicker({ tone, groups, currentKindKey, onChoose, choosing, error }: HabitCardKindPickerProps) {
  const isChild = tone === "child";
  const bodyStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  const captionStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;

  return (
    <View>
      <Text style={[bodyStyle, styles.heading]}>{isChild ? "シールちょうの えを えらぶ" : "シール帳の絵を選ぶ"}</Text>
      <View style={styles.list}>
        {groups.map((g) => {
          const selected = g.kindKey === currentKindKey;
          // [決定62・63] tiersはbronze/silver/gold/crystalの順（useHabitCards.ts
          // groupHabitFigureCatalogByKind）。銅だけ絵を見せ、残り3段階は空の枠。
          const bronze = g.tiers.find((t) => t.tier === "bronze");
          const otherTiers = g.tiers.filter((t) => t.tier !== "bronze");
          return (
            <Pressable
              key={g.kindKey}
              disabled={choosing}
              onPress={() => onChoose(g.kindKey)}
            >
              <Card tone={tone} style={selected ? { ...styles.rowCard, ...styles.rowCardSelected } : styles.rowCard}>
                <Text style={bodyStyle}>
                  {selected ? "✓ " : "  "}
                  {g.kindEmoji ?? "🏳️"} {isChild ? resolveChildFriendlyKindDisplayName(g.kindDisplayName, g.kindDisplayNameChild) : g.kindDisplayName}
                  {/* [決定44] is_free===falseの行にのみ印を付ける。ベータ期間中は
                      選択の可否そのものをDB側で強制していない（暫定）。 */}
                  {!g.isFree && <Text style={[captionStyle, { color: theme.colors.neutralTextSecondary }]}> ・有料</Text>}
                </Text>
                {/* [決定62・63] 銅の1体だけ絵で見せ、銀・金・クリスタルは空の
                    五角形の枠（FigureFrame）のまま見せる。「まだ手に入っていない」
                    ことを責める見え方（グレーアウト・ラベル等）は付けない。 */}
                <View style={styles.figureRow}>
                  {bronze && (
                    <FigureFrame size={FIGURE_FRAME_SIZE} ringColor={null}>
                      <FigureIcon figureKey={bronze.figure_key} kindEmoji={g.kindEmoji} size={FIGURE_ICON_SIZE} />
                    </FigureFrame>
                  )}
                  {otherTiers.map((t) => (
                    <FigureFrame key={t.id} size={FIGURE_FRAME_SIZE} ringColor={null}>
                      {null}
                    </FigureFrame>
                  ))}
                </View>
              </Card>
            </Pressable>
          );
        })}
      </View>
      {error && <Text style={[captionStyle, { color: theme.colors.statusBlocking, marginTop: theme.spacing.s2 }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: theme.spacing.s2 },
  list: { gap: theme.spacing.s2 },
  rowCard: { width: "100%" },
  rowCardSelected: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
  figureRow: { flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s2 },
});

export default HabitCardKindPicker;
