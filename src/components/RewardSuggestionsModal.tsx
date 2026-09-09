/**
 * ごほうびのおすすめ集モーダル（P12拡張・モーダル）
 * 参照: 主要画面ワイヤーフレーム.md 31.2節。src/components/ChoreSuggestionsModal.tsx
 * （クエスト版、27.2節）と同型。
 *
 * P12ごほうび管理一覧の空状態限定（31.1節）で開く。10件（2026-09-07全面差し替え）は
 * 静的データ（DBに置かない、
 * src/data/rewardSuggestions.ts）。フィルタは層ラベルの単一選択（すべて／権利／体験／もの、
 * 決定4）。行タップで即座にP13へプレフィル遷移する（確認画面を挟まない、決定7）。
 * モーダル内に「追加する」等の確定ボタンは置かない。クエスト版と異なり頻度表示は持たない
 * （決定5、rewardsテーブルに頻度相当の属性が無いため）。
 */
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import Card from "./Card";
import theme from "@/theme/theme";
import { REWARD_SUGGESTIONS, REWARD_SUGGESTION_FILTERS, type RewardSuggestion } from "@/data/rewardSuggestions";

type FilterValue = (typeof REWARD_SUGGESTION_FILTERS)[number];

export interface RewardSuggestionsModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (suggestion: RewardSuggestion) => void;
}

export function RewardSuggestionsModal({ visible, onClose, onSelect }: RewardSuggestionsModalProps) {
  const [filter, setFilter] = useState<FilterValue>("すべて");

  const filtered = useMemo(
    () => (filter === "すべて" ? REWARD_SUGGESTIONS : REWARD_SUGGESTIONS.filter((s) => s.layer === filter)),
    [filter]
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Card style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={theme.typography.parentTitle}>ごほうびのおすすめ集</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={theme.typography.parentBody}>×</Text>
            </Pressable>
          </View>

          <Text style={[theme.typography.parentBody, styles.intro]}>
            ポイントは目安です。おうちに合わせて選んだあと、自由に変えられます。
          </Text>

          <View style={styles.filterRow}>
            {REWARD_SUGGESTION_FILTERS.map((f) => (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[styles.filterChip, filter === f && styles.filterChipSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === f }}
              >
                <Text style={[theme.typography.parentCaption, filter === f && styles.filterChipTextSelected]}>{f}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView style={styles.list}>
            {filtered.length === 0 && (
              <View style={styles.emptyWrap}>
                <Text style={theme.typography.parentBody}>このカテゴリーには、いまおすすめがありません</Text>
                <AppButton
                  label="すべてに戻す"
                  variant="secondary"
                  style={{ marginTop: theme.spacing.s3 }}
                  onPress={() => setFilter("すべて")}
                />
              </View>
            )}
            {filtered.map((s) => (
              <Pressable key={s.id} onPress={() => onSelect(s)} style={styles.row}>
                <Text style={theme.typography.parentBody}>
                  {s.emoji} {s.title}
                </Text>
                <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
                  {s.points}pt（目安）
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <AppButton label="閉じる" variant="secondary" style={{ marginTop: theme.spacing.s4 }} onPress={onClose} />
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  card: { width: "100%", maxWidth: 480, maxHeight: "85%" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  intro: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s4 },
  filterChip: {
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  filterChipSelected: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
  filterChipTextSelected: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  list: { marginTop: theme.spacing.s3, maxHeight: 360 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: theme.spacing.s2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutralBorder,
  },
  emptyWrap: { alignItems: "center", paddingVertical: theme.spacing.s6 },
});

export default RewardSuggestionsModal;
