import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import { EmptyState } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * C29 とどいたよ（子ども向け・もらったものだけをまとめる画面）
 *
 * [2026-08-29新設・本部長／軽微変更ルート] ユーザーの指摘
 * 「子供のこの通知、感謝ポイントかリアクションをもらった時の通知のほうがよいと思う」
 * →「リアクションと感謝のみを示すものがあればと思ったけど、難しいかな？
 *    感謝とリアクションが見逃される懸念ある」への対応。
 *
 * それまでのベル（🔔）は「直近24時間に自分の報告へ届いたリアクション件数」だけを数えており、
 * **感謝ポイントをもらっても出なかった**。押した先も「きろく」タブで、そこにはリアクション
 * しか出ないため、感謝ポイントは受け取っても気づけない導線になっていた。
 *
 * 本画面は「自分が**もらったもの**」だけを新しい順に1本のリストで見せる。
 * 新しい通信・テーブルは不要で、すでに読み込み済みの `state.reactions` と
 * `state.gratitude` を混ぜて並べているだけである。
 *
 * 01章3原則に従い、件数の多寡を competition に見せる表現（累計・ランキング・
 * 「今月◯個もらった」等の集計）は置かない。届いたものを、届いた順に見せるだけ。
 */
type InboxItem = {
  id: string;
  kind: "reaction" | "gratitude";
  fromMemberId: string;
  at: string;
  /** リアクションなら「👏 すごい！」、感謝なら「💌 ありがとう +1pt」 */
  headline: string;
  /** コメント本文・感謝のメモ。無いこともある。 */
  body: string | null;
  /** リアクションのとき、どのクエストへのものか。 */
  choreLabel: string | null;
};

export default function ChildInboxScreen() {
  const { state } = useAppData();
  const me = state.members.find((m) => m.id === state.activeChildMemberId);

  const memberName = (id: string) => state.members.find((m) => m.id === id)?.display_name ?? "だれか";
  const memberColor = (id: string) => state.members.find((m) => m.id === id)?.avatar_color ?? null;

  const items: InboxItem[] = React.useMemo(() => {
    if (!me) return [];

    // 自分の完了報告に届いたリアクション
    const myCompletions = new Map(
      state.completions.filter((c) => c.reported_by === me.id).map((c) => [c.id, c])
    );
    const reactionItems: InboxItem[] = state.reactions
      .filter((r) => myCompletions.has(r.completion_id))
      .map((r) => {
        const c = myCompletions.get(r.completion_id)!;
        const stamp = r.stamp_key ? theme.stampDefinitions.find((s) => s.key === r.stamp_key) : undefined;
        return {
          id: `reaction:${r.id}`,
          kind: "reaction" as const,
          fromMemberId: r.reacted_by,
          at: r.created_at,
          headline: stamp ? `${stamp.emoji} ${stamp.label}` : "💬 コメント",
          body: r.comment_body,
          choreLabel: `${c.chore_emoji ?? "📝"} ${c.chore_title}`,
        };
      });

    // 自分あての感謝ポイント（取消されたものは出さない）
    const gratitudeItems: InboxItem[] = state.gratitude
      .filter((g) => g.recipient_id === me.id && g.revoked_at === null)
      .map((g) => ({
        id: `gratitude:${g.id}`,
        kind: "gratitude" as const,
        fromMemberId: g.sender_id,
        at: g.created_at,
        headline: `💌 ありがとう +${g.points}pt`,
        body: g.note,
        choreLabel: null,
      }));

    return [...reactionItems, ...gratitudeItems].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
    );
  }, [me, state.completions, state.reactions, state.gratitude, state.members]);

  const formatWhen = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}`;
  };

  return (
    <Screen tone="child">
      <Pressable onPress={() => router.replace("/child/home")} hitSlop={8} style={styles.back}>
        <Text style={theme.typography.childBody}>← もどる</Text>
      </Pressable>

      <Text style={[theme.typography.childHeadline, styles.title]}>💌 とどいたよ</Text>
      <Text style={[theme.typography.childBody, styles.sub]}>
        かぞくから もらった スタンプ・コメント・ありがとうポイント
      </Text>

      {items.length === 0 ? (
        <View style={{ marginTop: theme.spacing.s6 }}>
          <EmptyState
            tone="child"
            emoji="📭"
            title="まだ なにも とどいていないよ。クエストを ほうこくすると、かぞくから とどくかも！"
          />
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((it) => (
            <Card key={it.id} tone="child" style={styles.card}>
              <View style={styles.row}>
                <MemberAvatar name={memberName(it.fromMemberId)} color={memberColor(it.fromMemberId)} size={32} />
                <View style={{ flex: 1, marginLeft: theme.spacing.s2 }}>
                  <Text style={theme.typography.childBody}>
                    {memberName(it.fromMemberId)}から
                  </Text>
                  <Text style={[theme.typography.childBody, styles.headline]}>{it.headline}</Text>
                  {it.choreLabel && <Text style={styles.meta}>{it.choreLabel}</Text>}
                  {it.body && <Text style={styles.body}>「{it.body}」</Text>}
                  <Text style={styles.meta}>{formatWhen(it.at)}</Text>
                </View>
              </View>
            </Card>
          ))}
        </View>
      )}

      <AppButton
        label="やることリストへもどる"
        tone="child"
        variant="secondary"
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => router.replace("/child/home")}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { minHeight: theme.tapTarget.child, justifyContent: "center", alignSelf: "flex-start" },
  title: { marginTop: theme.spacing.s2 },
  sub: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  list: { marginTop: theme.spacing.s4, gap: theme.spacing.s2 },
  card: { padding: theme.spacing.s3 },
  row: { flexDirection: "row", alignItems: "flex-start" },
  headline: { marginTop: 2, color: theme.colors.brandPrimaryStrong },
  body: { marginTop: theme.spacing.s1 },
  meta: { marginTop: theme.spacing.s1, fontSize: 12, color: theme.colors.neutralTextSecondary },
});
