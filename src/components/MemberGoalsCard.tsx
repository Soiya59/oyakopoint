/**
 * 「いまの目標」保護者向けカード＋編集モーダル（要件定義書07-36章「自分で目標を
 * 決める」、主要画面ワイヤーフレーム.md 61章）。
 *
 * [決定7] 1枚のカードの中に、子ども全員分の行を`family_members.created_at`
 * 昇順（ソート機能なし、07-10章必須3条件と同じ考え方）で並べる。目標が無い
 * 子どもの行には「まだ目標がありません」＋「目標を決める →」を表示する。
 * [決定8] 各行のタップ先は、その子ども専用の編集モーダル。新しい一覧画面・
 * 新しい詳細画面は作らない。
 * [決定9] 新しい画面は作らず、カードの行タップから開くインラインモーダル。
 * [決定10] 入力項目は「目標（自由記述、必須）」「紐づけるクエスト（任意）」の2つのみ。
 * [決定11] クエストの紐づけは縦積みリストから1件選ぶ方式。「紐づけない」を
 * 既定の選択肢として先頭に置く。新しいプルダウン部品は作らない。
 * [決定12] 保存すると即座にカードへ反映。置き換えの是非を問う確認ダイアログは出さない。
 *
 * [文言について] 具体的な文言はUIUXデザイン部の判断に委ねられている
 * （要件定義書07-36章。本コンポーネントの文言は開発部の仮置き）。
 */
import React, { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Card from "./Card";
import AppButton from "./AppButton";
import { ErrorState, SkeletonList } from "./StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useFamilyMemberGoals, useSetMemberGoalAction } from "@/hooks/useMemberGoals";
import { useChoreCompletionTotals, keyChoreCompletionTotal } from "@/hooks/useChoreCompletionTotals";
import type { Chore, FamilyMember, MemberGoal } from "@/types/domain";

const GOAL_TEXT_MAX_LENGTH = 200; // member_goals.goal_text の CHECK 制約（スキーマ設計.sql 71.1章）と揃える。

function MemberGoalEditModal({
  visible,
  onClose,
  child,
  existingGoal,
  chores,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  child: FamilyMember | null;
  existingGoal: MemberGoal | null;
  chores: Chore[];
  onSaved: (goal: { memberId: string; goalText: string; linkedChoreId: string | null }) => void;
}) {
  const [goalText, setGoalText] = useState("");
  const [linkedChoreId, setLinkedChoreId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const { saving, save } = useSetMemberGoalAction();

  useEffect(() => {
    if (visible) {
      setGoalText(existingGoal?.goal_text ?? "");
      setLinkedChoreId(existingGoal?.linked_chore_id ?? null);
      setErrorText(null);
    }
    // existingGoalは開いた瞬間の値だけを反映すればよい（依存に含めるとタイプ中に上書きされる）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!child) return null;

  const handleSave = async () => {
    const trimmed = goalText.trim();
    if (!trimmed) {
      setErrorText("目標を入力してください");
      return;
    }
    setErrorText(null);
    const res = await save(child.id, trimmed, linkedChoreId);
    if (!res.ok) {
      setErrorText("保存できませんでした。もういちど試してください");
      return;
    }
    onSaved({ memberId: child.id, goalText: trimmed, linkedChoreId });
    onClose();
  };

  // [決定11] 家族のクエスト一覧（scope='family'）から選ぶ。個人専用・みまもり共通の
  // クエストは対象外（07-36章4節「みまもりメンバーは対象外」と同じ範囲の考え方）。
  const selectableChores = chores.filter((c) => c.is_active && c.scope === "family");

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Card style={styles.card}>
          <Text style={theme.typography.parentTitle}>{child.display_name}の目標を編集する</Text>
          {/* [2026-09-23改訂・実装メモ.md 289.4章・本部長差し戻し] keyboardShouldPersistTaps
              が無いと、キーボード表示中に「保存する」を押しても1回目はキーボードが閉じる
              だけになる。背景をKeyboardAvoidingViewで包むのはやめ、
              automaticallyAdjustKeyboardInsets（iOS専用）に一本化した。 */}
          <ScrollView
            style={styles.body}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios" ? true : undefined}
          >
            <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s3 }]}>目標</Text>
            <TextInput
              value={goalText}
              onChangeText={setGoalText}
              placeholder="はやね はやおき"
              multiline
              maxLength={GOAL_TEXT_MAX_LENGTH}
              style={styles.textArea}
            />

            <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s4 }]}>
              クエストと紐づける（任意）
            </Text>
            <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s1 }}>
              <Pressable onPress={() => setLinkedChoreId(null)} style={styles.choiceRow}>
                <Text style={theme.typography.parentBody}>{linkedChoreId === null ? "✓ " : "　"}紐づけない</Text>
              </Pressable>
              {selectableChores.map((c) => (
                <Pressable key={c.id} onPress={() => setLinkedChoreId(c.id)} style={styles.choiceRow}>
                  <Text style={theme.typography.parentBody}>
                    {linkedChoreId === c.id ? "✓ " : "　"}
                    {c.emoji} {c.title}
                  </Text>
                </Pressable>
              ))}
            </View>

            {errorText && (
              <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorText}</Text>
            )}

            <AppButton
              label={saving ? "保存中…" : "保存する"}
              loading={saving}
              disabled={saving}
              style={{ marginTop: theme.spacing.s4 }}
              onPress={handleSave}
            />
            <AppButton label="やめておく" variant="ghost" style={{ marginTop: theme.spacing.s2 }} onPress={onClose} disabled={saving} />
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}

export function MemberGoalsCard() {
  const { state } = useAppData();
  const familyId = state.family.id;
  const { loadState, goals, reload } = useFamilyMemberGoals(familyId);
  const { lookup: totalsLookup } = useChoreCompletionTotals();
  const [editingChildId, setEditingChildId] = useState<string | null>(null);

  // [決定7] created_at昇順。ソート機能は持たせない（07-10章必須3条件と同じ考え方）。
  const children = [...state.members]
    .filter((m) => m.is_active && m.role === "child")
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  if (children.length === 0) return null; // 子どもが1人もいない場合はカード自体を表示しない。

  const editingChild = children.find((c) => c.id === editingChildId) ?? null;
  const editingGoal = editingChildId ? goals.find((g) => g.member_id === editingChildId) ?? null : null;

  return (
    <>
      <Card style={{ marginTop: theme.spacing.s4 }}>
        <Text style={theme.typography.parentBodyMedium}>いまの目標</Text>
        {loadState === "loading" && <SkeletonList count={children.length} />}
        {loadState === "error" && <ErrorState title="読み込みに失敗しました" onRetry={reload} />}
        {loadState === "ready" && (
          <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
            {children.map((child) => {
              const goal = goals.find((g) => g.member_id === child.id) ?? null;
              const chore = goal?.linked_chore_id ? state.chores.find((c) => c.id === goal.linked_chore_id) : undefined;
              const count = goal?.linked_chore_id
                ? totalsLookup[keyChoreCompletionTotal(goal.linked_chore_id, child.id)] ?? 0
                : null;
              return (
                <Pressable key={child.id} onPress={() => setEditingChildId(child.id)} style={styles.row}>
                  <Text style={theme.typography.parentBody} numberOfLines={2}>
                    {child.display_name}：
                    {goal ? (
                      <>
                        {goal.goal_text}
                        {chore && count !== null ? `（${chore.emoji} ${chore.title} ${count}回）` : ""}
                      </>
                    ) : (
                      "まだ目標がありません [決める →]"
                    )}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </Card>

      <MemberGoalEditModal
        visible={editingChildId !== null}
        onClose={() => setEditingChildId(null)}
        child={editingChild}
        existingGoal={editingGoal}
        chores={state.chores}
        onSaved={() => void reload()}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: theme.tapTarget.parent, justifyContent: "center" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  card: { width: "100%", maxWidth: 480, maxHeight: "85%" },
  body: { marginTop: theme.spacing.s3 },
  choiceRow: { minHeight: theme.tapTarget.parent, justifyContent: "center" },
  textArea: {
    marginTop: theme.spacing.s2,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    padding: theme.spacing.s3,
    minHeight: 72,
    textAlignVertical: "top",
    backgroundColor: theme.colors.neutralBg,
  },
});

export default MemberGoalsCard;
