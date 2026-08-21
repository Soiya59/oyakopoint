import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import { EmptyState } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import type { ChoreCompletion, StampKey } from "@/types/domain";
import { formatDateChildJp, toJstDateString } from "@/lib/calendarDates";

/**
 * かぞくのがんばり（子ども向け、双方向リアクション・子→親方向）
 * 参照: 設計部/成果物/スキーマ設計.sql 15章「双方向リアクション（子→親、次フェーズ）」、
 * 要件定義書.md v0.6 07-6章。
 *
 * [2026-08-20新設・本部長] ユーザーが実機テストを経て「こどもからも他の人に
 * リアクションできるようにしたい」と依頼。15章の設計方針メモ（着手前提2点は
 * 満たされている: 07-4章の親の完了報告はリリース済み、少数家族での実機ベータ
 * テストも実施中）に従い実装した。
 *
 * 15章の方針どおり、対象は**保護者の完了報告のみ**（子ども同士の相互リアクションは
 * 07-6章の対象外のため含めない）。app/parent/approvals.tsx（P8/P9）と同じ
 * 「見る」「（任意で）スタンプ／コメントを贈る」の2操作のみのフィード構成を踏襲しつつ、
 * 子ども向けの見た目・言葉づかいに合わせた。
 */
export default function FamilyActivityScreen() {
  const { state, dispatch, reactionsForCompletion, hasReactedWithStamp } = useAppData();
  const [detailTarget, setDetailTarget] = useState<ChoreCompletion | null>(null);
  const [commentDraft, setCommentDraft] = useState("");

  const myId = state.activeChildMemberId;
  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  // 保護者の完了報告のみを対象にする（15章「roleがparentの場合のみ子どもも
  // リアクション可」）。新しい順。
  const parentCompletions = [...state.completions]
    .filter((c) => memberOf(c.reported_by)?.role === "parent")
    .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime());

  const sendStamp = async (completionId: string, stampKey: StampKey) => {
    if (hasReactedWithStamp(completionId, myId, stampKey)) return;
    await dispatch({ type: "ADD_REACTION", completionId, reactedBy: myId, kind: "stamp", stampKey });
  };

  const openDetail = (c: ChoreCompletion) => {
    setCommentDraft("");
    setDetailTarget(c);
  };

  const sendComment = async () => {
    if (!detailTarget) return;
    const body = commentDraft.trim();
    if (!body) return;
    await dispatch({ type: "ADD_REACTION", completionId: detailTarget.id, reactedBy: myId, kind: "comment", commentBody: body });
    setCommentDraft("");
  };

  return (
    <Screen tone="child">
      <Text style={theme.typography.childHeadline}>👨‍👩‍👧‍👦 かぞくのがんばり</Text>
      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        おうちのひとにも「がんばったね」をおくってみよう
      </Text>

      {parentCompletions.length === 0 && (
        <EmptyState tone="child" emoji="🌱" title="まだきろくがないよ" />
      )}

      {parentCompletions.map((c) => {
        const member = memberOf(c.reported_by);
        return (
          <Pressable key={c.id} onPress={() => openDetail(c)}>
            <Card tone="child" style={styles.card}>
              <View style={styles.cardTop}>
                <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={32} />
                <Text style={theme.typography.childBody}>{member?.display_name}</Text>
                <Text style={{ flex: 1 }} />
                <Text style={theme.typography.childBody}>
                  {c.chore_emoji} {c.chore_title}
                </Text>
              </View>
              <Text style={styles.dateLabel}>
                {formatDateChildJp(toJstDateString(c.reported_at))}
                {" "}
                {new Date(c.reported_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
              </Text>
              <View style={styles.stampRow}>
                {theme.stampDefinitions.map((s) => {
                  const sent = hasReactedWithStamp(c.id, myId, s.key as StampKey);
                  return (
                    <Pressable
                      key={s.key}
                      disabled={sent}
                      onPress={() => sendStamp(c.id, s.key as StampKey)}
                      style={[styles.stampBtn, sent && styles.stampBtnSent]}
                    >
                      <Text style={styles.stampEmoji}>
                        {s.emoji}
                        {sent ? "✓" : ""}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          </Pressable>
        );
      })}

      <AppButton label="やることリストへもどる" variant="secondary" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/child/home")} />

      <Modal visible={!!detailTarget} transparent animationType="fade" onRequestClose={() => setDetailTarget(null)}>
        <View style={styles.modalBackdrop}>
          <Card tone="child" style={styles.modalCard}>
            {detailTarget &&
              (() => {
                const member = memberOf(detailTarget.reported_by);
                const reactions = reactionsForCompletion(detailTarget.id);
                return (
                  <>
                    <Text style={theme.typography.childHeadline}>
                      {detailTarget.chore_emoji} {detailTarget.chore_title}
                    </Text>
                    <Text style={{ marginTop: theme.spacing.s2 }}>{member?.display_name}が きろくしたよ</Text>
                    <Text style={{ marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }}>
                      {formatDateChildJp(toJstDateString(detailTarget.reported_at))}
                      {" "}
                      {new Date(detailTarget.reported_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
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
                        const sent = hasReactedWithStamp(detailTarget.id, myId, s.key as StampKey);
                        return (
                          <Pressable
                            key={s.key}
                            disabled={sent}
                            onPress={() => sendStamp(detailTarget.id, s.key as StampKey)}
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
                      onChangeText={setCommentDraft}
                      placeholder="がんばったね！"
                      multiline
                      maxLength={200}
                      style={styles.textArea}
                    />
                    <AppButton
                      label="おくる"
                      tone="child"
                      style={{ marginTop: theme.spacing.s2 }}
                      onPress={sendComment}
                      disabled={!commentDraft.trim()}
                    />

                    <AppButton
                      label="もどる"
                      variant="ghost"
                      style={{ marginTop: theme.spacing.s3 }}
                      onPress={() => setDetailTarget(null)}
                    />
                  </>
                );
              })()}
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: theme.spacing.s3 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  dateLabel: { marginTop: theme.spacing.s1, fontSize: 12, color: theme.colors.neutralTextSecondary },
  stampRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2, marginTop: theme.spacing.s3 },
  stampBtn: {
    width: theme.tapTarget.child,
    height: theme.tapTarget.child,
    borderRadius: theme.radius.childXl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  stampBtnSent: { backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  stampEmoji: { fontSize: 18 },
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
