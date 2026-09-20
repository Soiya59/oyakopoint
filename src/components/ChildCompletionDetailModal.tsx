import React from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { formatDateTimeShort } from "@/lib/calendarDates";
import type { ChoreCompletion, ChoreReaction, FamilyMember, StampKey } from "@/types/domain";

/**
 * 子ども向け 完了報告の詳細モーダル（とどいたリアクション一覧・スタンプ・ひとこと）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 55章（55.3節決定8）、
 * 開発部/成果物/実装メモ.md 265章
 *
 * [2026-09-20新設・実装メモ.md 265章、やること.md 4-64] かぞくタブ
 * （`app/child/(tabs)/family.tsx`）とC18全件一覧（`app/child/family-activity.tsx`）が
 * 同じモーダルを出すため、`app/child/(tabs)/family.tsx` 200〜291行目（2026-09-20時点）の
 * markupと対応するstyleをそのままここへ移した。**中身は変えていない**
 * （55.9節「詳細モーダルの中身の変更」は対象外）。
 *
 * 入力中の文字（`commentDraft`）・送信中フラグ・エラー文言は呼び出し側が持つ。
 * 2画面で同じ文言（「おくれなかったよ。もういちどためしてね」）を使う。
 */
export type ChildCompletionDetailModalProps = {
  /** null のときモーダルは閉じている。 */
  target: ChoreCompletion | null;
  /** いま操作している子どものfamily_member_id。 */
  myChildId: string;
  memberOf: (id: string) => FamilyMember | undefined;
  /** `target`に届いているリアクション（呼び出し側で`reactionsForCompletion`を引く）。 */
  reactions: ChoreReaction[];
  hasReactedWithStamp: (completionId: string, reactedBy: string, stampKey: StampKey) => boolean;
  commentDraft: string;
  onChangeCommentDraft: (value: string) => void;
  sendingComment: boolean;
  /** スタンプ・ひとことの送信失敗の文言（55.5節）。 */
  reactionError: string | null;
  onSendStamp: (completionId: string, stampKey: StampKey) => void;
  onSendComment: () => void;
  onClose: () => void;
};

export function ChildCompletionDetailModal({
  target,
  myChildId,
  memberOf,
  reactions,
  hasReactedWithStamp,
  commentDraft,
  onChangeCommentDraft,
  sendingComment,
  reactionError,
  onSendStamp,
  onSendComment,
  onClose,
}: ChildCompletionDetailModalProps) {
  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Card tone="child" style={styles.modalCard}>
          {target &&
            (() => {
              const member = memberOf(target.reported_by);
              return (
                <>
                  <Text style={theme.typography.childHeadline}>
                    {target.chore_emoji} {target.chore_title}
                  </Text>
                  <Text style={{ marginTop: theme.spacing.s2 }}>{member?.display_name}が きろくしたよ</Text>
                  <Text style={{ marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }}>
                    {formatDateTimeShort(target.reported_at)}
                  </Text>

                  <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4 }]}>とどいたリアクション</Text>
                  {reactions.length === 0 ? (
                    <Text style={{ marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }}>
                      まだだれもリアクションしてないよ
                    </Text>
                  ) : (
                    <View style={{ marginTop: theme.spacing.s1, gap: theme.spacing.s1 }}>
                      {reactions.map((r) => {
                        const reactor = memberOf(r.reacted_by);
                        const stampDef = theme.stampDefinitions.find((s) => s.key === r.stamp_key);
                        return (
                          <Text key={r.id} style={theme.typography.childBody}>
                            {r.kind === "stamp" ? stampDef?.emoji : "💬"} {reactor?.display_name}より
                            {r.kind === "stamp" ? `「${stampDef?.label}」` : `「${r.comment_body}」`}
                          </Text>
                        );
                      })}
                    </View>
                  )}

                  <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4 }]}>スタンプをおくる</Text>
                  <View style={styles.stampGrid}>
                    {theme.stampDefinitions.map((s) => {
                      const sent = hasReactedWithStamp(target.id, myChildId, s.key as StampKey);
                      return (
                        <Pressable
                          key={s.key}
                          onPress={() => onSendStamp(target.id, s.key as StampKey)}
                          style={[styles.stampChip, sent && styles.stampChipSent]}
                        >
                          <Text>
                            {s.emoji} {s.label}
                            {sent ? " ✓" : ""}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4 }]}>ひとことおくる（にんい）</Text>
                  <TextInput
                    value={commentDraft}
                    onChangeText={onChangeCommentDraft}
                    placeholder="がんばったね！"
                    multiline
                    maxLength={200}
                    style={styles.textArea}
                  />
                  <AppButton
                    label={sendingComment ? "おくっています…" : "おくる"}
                    tone="child"
                    loading={sendingComment}
                    style={{ marginTop: theme.spacing.s2 }}
                    onPress={onSendComment}
                    disabled={!commentDraft.trim() || sendingComment}
                  />

                  {reactionError && (
                    <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>
                      {reactionError}
                    </Text>
                  )}

                  <AppButton
                    label="もどる"
                    variant="ghost"
                    style={{ marginTop: theme.spacing.s3 }}
                    onPress={onClose}
                  />
                </>
              );
            })()}
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  modalCard: { width: "100%", maxWidth: 420 },
  stampGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s2 },
  stampChip: {
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.childXl,
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  stampChipSent: { backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  textArea: {
    marginTop: theme.spacing.s2,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.childXl,
    padding: theme.spacing.s3,
    minHeight: 72,
    textAlignVertical: "top",
    backgroundColor: theme.colors.neutralBg,
  },
});

export default ChildCompletionDetailModal;
