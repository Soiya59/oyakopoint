/**
 * クエストの見本モーダル（P10拡張・入口統合、2026-09-20新設）
 * 参照: 要件定義書.md 07-16章・07-28章決定13、主要画面ワイヤーフレーム.md 54章
 * （決定1〜8）、開発部への申し送り54.11節。
 *
 * 従来別々だった2つのモーダル——ChoreSuggestionsModal（クエストのおすすめ集、
 * 07-16章、18件）とSkillChoreTemplatesModal（スキルの型付きクエストひな形、
 * 07-28章決定13、10件）——を1つに統合したもの。2つが分かれていた理由（報酬の種類
 * ＝ポイント／シール帳の違い）は、2026-09-20に本番適用したシール帳の全面作り替え
 * （要件定義書07-28章決定25）で消えた。いまはどちらも「見本からクエストを作る」と
 * いう同じ機能であり（54章冒頭）、本モーダルはP10「クエスト管理一覧」の入口を
 * 1つ（「💡 見本から選ぶ」）にするために新設した。
 *
 * 中身は🧹お手伝い区分（18件、対象フィルタつき）→🌱おやくそく区分（10件、3グループ）
 * の順の1本の縦スクロール（タブにはしない、54.2節決定5・6）。区分をまたぐ共通の
 * フィルタ・分類は作らない（54.3節決定7・8。対象フィルタは🧹区分の直下にのみ置く）。
 * 見本の中身（28件そのもの）・データファイルの分割（choreSuggestions.ts／
 * skillChoreTemplates.ts）は変更しない（54.11節2.）。
 *
 * 行タップで即座に呼び出し元へ選択結果（id）を返すのみで、モーダル内に「追加する」
 * 等の確定ボタンは置かない（27.0節決定5・49.7節決定21を踏襲）。呼び出し側は
 * 従来どおりrouter.pushのrecIdパラメータへこのidをそのまま渡せる
 * （app/parent/chore-edit.tsxの解決順序＝findChoreSuggestionById→
 * findSkillChoreTemplateByIdは変更不要、54.11節3.）。
 *
 * 旧ChoreSuggestionsModal.tsx・SkillChoreTemplatesModal.tsxは削除していない。
 * SkillChoreTemplatesModal.tsxはapp/supporter/my-chores.tsx（S5）が引き続き
 * 単独で使用するため（54.7節決定10、S5は対象外）。ChoreSuggestionsModal.tsxは
 * 本統合後どこからも呼ばれなくなるが、ファイルの削除・保持は開発部の裁量に
 * 委ねられており（54.11節7.）、影響範囲を最小にするため削除せず残した。
 */
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import Card from "./Card";
import theme from "@/theme/theme";
import { CHORE_SUGGESTIONS, CHORE_SUGGESTION_FILTERS } from "@/data/choreSuggestions";
import { SKILL_CHORE_CATEGORIES, SKILL_CHORE_TEMPLATES } from "@/data/skillChoreTemplates";

type FilterValue = (typeof CHORE_SUGGESTION_FILTERS)[number];

export interface ChoreExamplesModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * 選ばれた見本のid（お手伝い区分は"quest-xx"、おやくそく区分は"skill-xx"。
   * どちらも呼び出し側でrouter.pushのrecIdへそのまま渡せる）。
   */
  onSelect: (id: string) => void;
}

export function ChoreExamplesModal({ visible, onClose, onSelect }: ChoreExamplesModalProps) {
  // [54.3節決定8] 対象フィルタは🧹お手伝い区分にのみ効く。🌱おやくそく区分は
  // この状態の影響を受けない。
  const [filter, setFilter] = useState<FilterValue>("すべて");

  const filteredSuggestions = useMemo(
    () => (filter === "すべて" ? CHORE_SUGGESTIONS : CHORE_SUGGESTIONS.filter((s) => s.target === filter)),
    [filter]
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Card style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={theme.typography.parentTitle}>クエストの見本</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={theme.typography.parentBody}>×</Text>
            </Pressable>
          </View>

          {/* [54.4節] 27.0節決定4・49.7節の案内文を1本に統合。 */}
          <Text style={[theme.typography.parentBody, styles.intro]}>
            ポイントは目安です。えらぶと、そのまま登録画面に入力された状態でひらきます。内容は自由に変えられます。
          </Text>

          <ScrollView style={styles.list}>
            {/* 🧹 お手伝い区分（54.1節決定6で先に表示、54.3節決定7で既存targetを流用） */}
            <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>🧹 日々のおてつだい</Text>
            <View style={styles.filterRow}>
              {CHORE_SUGGESTION_FILTERS.map((f) => (
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
            {filteredSuggestions.length === 0 && (
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
            {filteredSuggestions.map((s) => (
              <Pressable key={s.id} onPress={() => onSelect(s.id)} style={styles.row}>
                <Text style={theme.typography.parentBody}>
                  {s.emoji} {s.title}
                </Text>
                <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
                  {s.points}pt（目安）
                </Text>
              </Pressable>
            ))}

            {/* 🌱 おやくそく区分（54.1節決定6で後に表示、54.3節決定7で既存categoryを流用） */}
            <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading, styles.secondSectionHeading]}>
              🌱 まいにちのおやくそく
            </Text>
            {SKILL_CHORE_CATEGORIES.map((category) => (
              <View key={category} style={styles.group}>
                <Text style={[theme.typography.parentCaption, styles.groupHeading]}>{category}</Text>
                {SKILL_CHORE_TEMPLATES.filter((t) => t.category === category).map((t) => (
                  <Pressable key={t.id} onPress={() => onSelect(t.id)} style={styles.row}>
                    <Text style={theme.typography.parentBody}>
                      {t.emoji} {t.title}
                    </Text>
                    <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
                      {t.points}pt（目安）
                    </Text>
                  </Pressable>
                ))}
              </View>
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
  // [54.9節トーン設計メモ] 🧹・🌱の2区分見出しは優劣を示さないよう、文字の大きさ・
  // 太さ・視覚的な重みを揃える（片方だけ強調しない）。
  sectionHeading: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  secondSectionHeading: { marginTop: theme.spacing.s6 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s3 },
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
  list: { marginTop: theme.spacing.s3, maxHeight: 480 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: theme.spacing.s2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.neutralBorder,
  },
  emptyWrap: { alignItems: "center", paddingVertical: theme.spacing.s6 },
  group: { marginTop: theme.spacing.s3 },
  groupHeading: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
});

export default ChoreExamplesModal;
