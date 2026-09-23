import React, { useEffect } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import AndroidKeyboardAvoidingPadding from "@/components/AndroidKeyboardAvoidingPadding";
import theme from "@/theme/theme";
import { formatDateTimeShort } from "@/lib/calendarDates";
import type { ChoreCompletion, ChoreReaction, FamilyMember, StampKey } from "@/types/domain";
import { useNgWordGuard } from "@/hooks/useNgWordGuard";
import NgWordWarningText from "@/components/NgWordWarningText";

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
  /**
   * [2026-09-21追加・要件定義書07-32章 決定20〜24、主要画面ワイヤーフレーム.md
   * 56.4節決定20] 保護者トグル「家族のやりとりを使う」。falseの間は
   * 「ひとことおくる」欄・送信ボタンを描かない（スタンプ・過去のコメントは
   * そのまま表示する）。既定はtrue。
   */
  commentsEnabled?: boolean;
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
  commentsEnabled = true,
}: ChildCompletionDetailModalProps) {
  // [2026-09-21追加・要件定義書07-32章決定15〜19] NGワードフィルタ。「ひとことおくる」
  // 欄はcommentDraft自体を呼び出し側が持つため、判定フラグだけをこの部品で持つ
  // （送信ボタンを押した瞬間だけ判定し、当たれば呼び出し側のonSendComment自体を呼ばない）。
  const ngGuard = useNgWordGuard();
  // Modalはvisible切替のみで内部はマウントされ続けるため、対象（target）が
  // 変わる＝モーダルを開き直すたびに前回の表示を持ち越さないようにする。
  useEffect(() => {
    ngGuard.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);
  const handleSend = () => {
    if (ngGuard.guard(commentDraft)) return;
    onSendComment();
  };
  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={onClose}>
      {/* [2026-09-23・289.4章改訂→289.7章2回目の差し戻しで再改訂]
          iOSは背景をKeyboardAvoidingViewで包むのをやめ、ScrollView自身の
          automaticallyAdjustKeyboardInsetsに一本化した（289.4章）。
          **Androidはそれだけでは直っていなかった**（統括の実機報告、289.7章）。
          edge-to-edgeでSOFT_INPUT_ADJUST_RESIZEが効かないため、Androidにだけ
          KeyboardAvoidingView(padding)を足す（AndroidKeyboardAvoidingPadding、
          iOSでは素のViewのまま）。 */}
      <AndroidKeyboardAvoidingPadding style={styles.modalBackdrop}>
        <Card tone="child" style={styles.modalCard}>
        {/* keyboardShouldPersistTapsが無いと、キーボード表示中に送信ボタンを
            1回目タップしてもキーボードが閉じるだけになる。 */}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios" ? true : undefined}
        >
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

                  {/* [2026-09-21追加・要件定義書07-32章 決定20〜24、主要画面
                      ワイヤーフレーム.md 56.4節決定20] 保護者トグルがオフの間は
                      この欄・送信ボタンごと描かない（スタンプ・過去のコメントは
                      そのまま残る）。 */}
                  {commentsEnabled && (
                    <>
                      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4 }]}>ひとことおくる（にんい）</Text>
                      <TextInput
                        value={commentDraft}
                        onChangeText={(t) => {
                          onChangeCommentDraft(t);
                          ngGuard.clear();
                        }}
                        placeholder="がんばったね！"
                        multiline
                        maxLength={200}
                        style={styles.textArea}
                      />
                      {ngGuard.blocked && <NgWordWarningText tone="child" />}
                      <AppButton
                        label={sendingComment ? "おくっています…" : "おくる"}
                        tone="child"
                        loading={sendingComment}
                        style={{ marginTop: theme.spacing.s2 }}
                        onPress={handleSend}
                        disabled={!commentDraft.trim() || sendingComment}
                      />
                    </>
                  )}

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
        </ScrollView>
        </Card>
      </AndroidKeyboardAvoidingPadding>
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
  // [2026-09-23追加・実装メモ.md 289章] maxHeightを付けたのは、内側に足した
  // ScrollViewが「あふれたら止まってスクロールする」ために親の高さを
  // 確定させる必要があるため（RNのScrollViewは親の高さが無限だとスクロール
  // 自体が発生しない。MemberGoalsCard.tsxのmodalCard/cardと同じ考え方）。
  modalCard: { width: "100%", maxWidth: 420, maxHeight: "85%" },
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
