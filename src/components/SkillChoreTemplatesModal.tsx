/**
 * スキルの型付きクエストひな形モーダル（P10/S6拡張・モーダル、新設）
 * 参照: 要件定義書.md 07-28章決定13、主要画面ワイヤーフレーム.md 49.7章決定19〜21。
 *
 * 07-16章「クエストのおすすめ集」（ChoreSuggestionsModal.tsx）とは独立した
 * 別モーダル（決定20。既存モーダルは無変更）。フィルタは持たず、3つの型を
 * 見出しにした3グループ・計10件を縦スクロールリストで表示する。行タップで
 * 即座にP11/S6へプレフィル遷移する（確認画面を挟まない、決定21）。
 */
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import Card from "./Card";
import theme from "@/theme/theme";
import { SKILL_CHORE_CATEGORIES, SKILL_CHORE_TEMPLATES, type SkillChoreTemplate } from "@/data/skillChoreTemplates";

export interface SkillChoreTemplatesModalProps {
  visible: boolean;
  /** 保護者(parent)/みまもり(supporter)で見出しの型を出し分ける（既存フォームと同じ考え方）。 */
  tone?: "parent" | "supporter";
  onClose: () => void;
  onSelect: (template: SkillChoreTemplate) => void;
}

export function SkillChoreTemplatesModal({ visible, tone = "parent", onClose, onSelect }: SkillChoreTemplatesModalProps) {
  const titleStyle = tone === "supporter" ? theme.typography.supporterTitle : theme.typography.parentTitle;
  const bodyStyle = tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  const captionStyle = tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Card style={styles.card} tone={tone}>
          <View style={styles.headerRow}>
            <Text style={titleStyle}>🌱 せいかつ・きもちの型</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={bodyStyle}>×</Text>
            </Pressable>
          </View>

          <Text style={[bodyStyle, styles.intro]}>
            えらぶと、ないようが入った状態でひらきます。あとから自由に変えられます。
          </Text>

          <ScrollView style={styles.list}>
            {SKILL_CHORE_CATEGORIES.map((category) => (
              <View key={category} style={styles.group}>
                <Text style={[captionStyle, styles.groupHeading]}>{category}</Text>
                {SKILL_CHORE_TEMPLATES.filter((t) => t.category === category).map((t) => (
                  <Pressable key={t.id} onPress={() => onSelect(t)} style={styles.row}>
                    <Text style={bodyStyle}>
                      {t.emoji} {t.title}
                    </Text>
                    <Text style={[captionStyle, { color: theme.colors.neutralTextSecondary }]}>
                      {t.rewardMode === "habit_card" ? "台紙" : `${t.points}pt（目安）`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>

          <AppButton tone={tone} label="閉じる" variant="secondary" style={{ marginTop: theme.spacing.s4 }} onPress={onClose} />
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
  list: { marginTop: theme.spacing.s3, maxHeight: 400 },
  group: { marginTop: theme.spacing.s3 },
  groupHeading: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: theme.spacing.s2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutralBorder,
  },
});

export default SkillChoreTemplatesModal;
