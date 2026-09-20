import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "@/components/Card";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { formatDateTimeShort } from "@/lib/calendarDates";
import type { ChoreCompletion, FamilyDrawingLineData, FamilyMember, StampKey } from "@/types/domain";

/**
 * 子ども向け 完了報告カード（1件ぶん）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 55章（55.1節決定1・55.3節決定8）、
 * 開発部/成果物/実装メモ.md 265章
 *
 * [2026-09-20新設・実装メモ.md 265章、やること.md 4-64] かぞくタブ
 * （`app/child/(tabs)/family.tsx`・新着5件プレビュー）とC18全件一覧
 * （`app/child/family-activity.tsx`）の2画面で同じカードを描くため、
 * `app/child/(tabs)/family.tsx` 157〜198行目（2026-09-20時点）のmarkupと
 * 対応するstyleをそのままここへ移した。**見た目は1ドットも変えていない。**
 *
 * 55.10節手順7は「共通部品として抽出する（推奨）／2ファイルに写す」の
 * どちらでもよいとしているが、抽出を選んだ。P8（`app/parent/approvals.tsx`）と
 * S2（`app/supporter/activity.tsx`）が写しの関係にあり、片方だけ`FlatList`化されて
 * 実装が分かれた前例（55.11節(3)）を子ども側で繰り返さないため。
 *
 * `React.memo`で分離してあるのは、全件一覧（`FlatList`）で表示中の行が
 * 他の行の状態変化（スタンプ送信中・ひとこと入力など）で再レンダーされないように
 * するため（55.8節、実装メモ255章のP8と同じ理由）。メモ化を効かせるため、
 * 呼び出し側は`onOpenDetail`・`onSendStamp`を`useCallback`で安定させること。
 */
export type ChildCompletionCardProps = {
  completion: ChoreCompletion;
  member?: FamilyMember;
  memberAvatarLineData?: FamilyDrawingLineData | null;
  /** いま操作している子どものfamily_member_id（スタンプ送信済み判定に使う）。 */
  myChildId: string;
  onOpenDetail: (c: ChoreCompletion) => void;
  onSendStamp: (completionId: string, stampKey: StampKey) => void;
  hasReactedWithStamp: (completionId: string, reactedBy: string, stampKey: StampKey) => boolean;
};

export const ChildCompletionCard = React.memo(function ChildCompletionCard({
  completion: c,
  member,
  memberAvatarLineData,
  myChildId,
  onOpenDetail,
  onSendStamp,
  hasReactedWithStamp,
}: ChildCompletionCardProps) {
  // みまもりメンバーの完了報告は控えめな配色で区別する（P8と同じ判定）。
  const isSupporterCard = member?.role === "supporter";
  return (
    <Pressable onPress={() => onOpenDetail(c)}>
      <Card tone="child" style={isSupporterCard ? { ...styles.card, ...styles.cardSupporterTint } : styles.card}>
        <View style={styles.cardTop}>
          <MemberAvatar
            name={member?.display_name ?? "?"}
            color={member?.avatar_color}
            size={32}
            lineData={memberAvatarLineData}
            expandOnTap
          />
          <Text style={theme.typography.childBody}>{member?.display_name}</Text>
          <Text style={{ flex: 1 }} />
          <Text style={theme.typography.childBody}>
            {c.chore_emoji} {c.chore_title}
          </Text>
        </View>
        <Text style={styles.dateLabel}>{formatDateTimeShort(c.reported_at)}</Text>
        {/* カード上のクイックスタンプ。もういちど押すと取消、ちがうスタンプを押すと切替
            （実装メモ.md 157章）。子どもには`+◯pt`・取消リンクを出さない（55.3節決定8）。 */}
        <View style={styles.stampRow}>
          {theme.stampDefinitions.map((s) => {
            const sent = hasReactedWithStamp(c.id, myChildId, s.key as StampKey);
            return (
              <Pressable
                key={s.key}
                onPress={() => onSendStamp(c.id, s.key as StampKey)}
                style={[styles.stampBtn, sent && styles.stampBtnSent]}
              >
                <Text style={styles.stampEmoji}>
                  {s.emoji}
                  {sent ? "✓" : ""}
                </Text>
              </Pressable>
            );
          })}
          <Text style={{ flex: 1 }} />
          <Pressable onPress={() => onOpenDetail(c)} hitSlop={8}>
            <Text style={styles.commentLink}>＋ひとこと</Text>
          </Pressable>
        </View>
      </Card>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { marginTop: theme.spacing.s3 },
  cardSupporterTint: { backgroundColor: theme.colors.supporterAccentSoft, borderColor: theme.colors.supporterAccent },
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
  commentLink: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
});

export default ChildCompletionCard;
