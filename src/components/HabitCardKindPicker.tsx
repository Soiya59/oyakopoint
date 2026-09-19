/**
 * シール帳の絵柄選び直し一覧（要件定義書07-28章決定29、主要画面ワイヤーフレーム.md
 * 49-B.4章決定43〜44）。既存のメダル購入画面（32.1節）と同型の縦積みリストで、
 * 現在選択中の絵柄にチェックを付ける。1行1種類・種類が増えても崩れない
 * （旧49.3節決定6を踏襲）。
 *
 * 呼び出し元は2箇所（49-B.4章決定42）:
 *   1. 主経路: クリスタル到達演出（HabitFigureGrantBanner）の直後の追加ステップ
 *   2. 副経路: タップ先の画面（HabitCardBoard.tsx）の「えらびなおす →」リンク
 * いずれも「進行中の冊の累計が0件のときだけ」呼び出し可能（57.6章決定57-12）。
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import theme from "@/theme/theme";
import type { HabitKindGroup } from "@/hooks/useHabitCards";

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
      <Text style={[bodyStyle, styles.heading]}>{isChild ? "シール帳の えを えらぶ" : "シール帳の絵を選ぶ"}</Text>
      <View style={styles.list}>
        {groups.map((g) => {
          const selected = g.kindKey === currentKindKey;
          return (
            <Pressable
              key={g.kindKey}
              disabled={choosing}
              onPress={() => onChoose(g.kindKey)}
            >
              <Card tone={tone} style={selected ? { ...styles.rowCard, ...styles.rowCardSelected } : styles.rowCard}>
                <Text style={bodyStyle}>
                  {selected ? "✓ " : "  "}
                  {g.kindEmoji ?? "🏳️"} {g.kindDisplayName}
                  {/* [決定44] is_free===falseの行にのみ印を付ける。ベータ期間中は
                      選択の可否そのものをDB側で強制していない（暫定）。 */}
                  {!g.isFree && <Text style={[captionStyle, { color: theme.colors.neutralTextSecondary }]}> ・有料</Text>}
                </Text>
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
});

export default HabitCardKindPicker;
