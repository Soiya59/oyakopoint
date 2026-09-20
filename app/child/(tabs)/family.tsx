import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import ChildCompletionCard from "@/components/ChildCompletionCard";
import ChildCompletionDetailModal from "@/components/ChildCompletionDetailModal";
import { EmptyState } from "@/components/StatusViews";
import ChildTabHeader from "@/components/ChildTabHeader";
import TabIntroBubble from "@/components/TabIntroBubble";
import { countRecentInbox } from "@/components/InboxPanel";
import { useUnreadSince } from "@/hooks/useLastSeen";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useFamilyHomeCard } from "@/hooks/useFamilyBoard";
import type { ChoreCompletion, StampKey } from "@/types/domain";

/**
 * かぞく区画の入口（子ども。旧C18「かぞくのがんばり」に、旧C5が持っていた
 * かぞくのけいじばんカードを吸収）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 36章（36.5.2節）・55章、
 * 開発部/成果物/実装メモ.md 188章・265章
 *
 * [2026-09-10新規追加・実装メモ.md 188章] 子ども下部タブ4区画化に伴う新設タブ。
 * 「新しい画面は作らない。既存の`app/child/family-activity.tsx`（C18）を
 * `(tabs)/family.tsx`相当へ移設し、C27の既存カードmarkupを上部に追加するだけで
 * 成立する」（36.5.2節・36.11節2）という設計方針のとおり、C18本体（完了報告一覧・
 * スタンプ・コメント）のロジックは変更していない。
 *
 * 旧`app/child/(tabs)/home.tsx`が持っていた「💬 かぞくのけいじばん」カード
 * （`useFamilyHomeCard`フック、C27）を、このタブの入口カードとしてそのまま移設した。
 * ヘッダーは4タブ共通の`ChildTabHeader`（36.4節）。
 *
 * **末尾にあった「もどる」ボタン（`router.replace("/child/home")`）は削除した。**
 * 常設タブになったため、他タブへは下部タブバーで移動でき、ボタンによる「戻る」は
 * 不要になった（保護者・みまもりメンバーの「かぞく」タブ入口にも同種のボタンは無い、
 * `app/parent/(tabs)/index.tsx`・`app/supporter/(tabs)/family.tsx`参照）。
 *
 * URLは`/child/family`（新設）。
 *
 * [2026-09-20改訂・主要画面ワイヤーフレーム.md 55章、実装メモ.md 265章、やること.md 4-64]
 * 完了報告の一覧を**新着5件のプレビュー**に絞った（36.12節決定3「かぞくタブは5件に
 * 絞る。…3ロールで同じ形にする」の子ども側への反映。保護者`app/parent/(tabs)/index.tsx`・
 * みまもりメンバー`app/supporter/(tabs)/family.tsx`と同じ形になった）。6件目以降は、
 * 一覧の直後に出る「もっと みる →」からC18全件一覧へ行く。
 * **旧URL`/child/family-activity`は、2026-09-20にC18全件一覧として復活した**
 * （55.3節決定6。以前はこのタブへ送るリダイレクトスタブだった）。この
 * 「もっと みる →」の行き先である。
 *
 * カードと詳細モーダルは全件一覧と共通の部品（`@/components/ChildCompletionCard`・
 * `@/components/ChildCompletionDetailModal`）へ切り出した。見た目・中身は変えていない。
 */
export default function ChildFamilyTabScreen() {
  const { state, dispatch, reactionsForCompletion, hasReactedWithStamp, memberAvatars } = useAppData();
  const [detailTarget, setDetailTarget] = useState<ChoreCompletion | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);

  const myId = state.activeChildMemberId;
  const memberOf = useCallback((id: string) => state.members.find((m) => m.id === id), [state.members]);

  const inboxSince = useUnreadSince("inbox", myId);
  const inboxCount = countRecentInbox(state, myId, inboxSince);

  // [2026-09-10移設・実装メモ.md 188章] 旧`app/child/(tabs)/home.tsx`の
  // 「かぞくのけいじばん」カード（C27、22.1.2節）。P7/S2と同じ`family_home_card`
  // Viewを同一クエリで使う（API仕様.md 13.3章）。36.5.2節の表記どおり、
  // 子ども向けはひらがな表記（「かぞくのけいじばん」）を維持する
  // （183章の漢字表記統一は保護者・みまもり向けのみで子ども向けは対象外）。
  const { loadState: cardLoadState, card } = useFamilyHomeCard(state.family.id);
  const cardMessage =
    cardLoadState === "error"
      ? "かぞくのけいじばんは、またあとでみてね"
      : cardLoadState === "loading"
      ? null
      : card?.message ?? "かぞくのけいじばんは、またあとでみてね";
  const cardAuthorName =
    card?.source === "board_post"
      ? state.members.find((m) => m.id === card.board_post_author_member_id)?.display_name ?? null
      : null;

  // [2026-09-09改訂・要件定義書07-23章決定1] 家族内の全員（保護者・みまもり
  // メンバー・他の子ども）の完了報告を対象にする。[決定2・自己リアクション禁止]
  // 自分自身の完了報告は`c.reported_by !== myId`で一覧から除外する。
  const reactableCompletions = [...state.completions]
    .filter((c) => c.reported_by !== myId)
    .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime());

  // [2026-09-20追加・主要画面ワイヤーフレーム.md 55.1節決定2] `filter`（自分を除く）
  // →`sort`（新しい順）→`slice(0, 5)`の順で5件を取る。自分の報告を含めたまま5件を
  // 取ってから除外すると、表示が5件に満たない日が出るため。変数名はS1・P7と同じ
  // `recentCompletions`に揃えた。`reactableCompletions`（全件）は「もっと みる →」を
  // 出すかどうかの判定に使うので消さないこと。
  const recentCompletions = reactableCompletions.slice(0, 5);

  // [2026-09-10改訂・実装メモ.md 157章] おくったスタンプをもういちど押すと取消、
  // ちがうスタンプを押すと切替になる（統括指示）。
  // [2026-09-20・265章] 共通部品`ChildCompletionCard`（React.memo）へ安定した関数
  // 参照として渡すため`useCallback`化した（挙動は変えていない）。
  const sendStamp = useCallback(
    async (completionId: string, stampKey: StampKey) => {
      setReactionError(null);
      const result = await dispatch({ type: "TOGGLE_REACTION_STAMP", completionId, reactedBy: myId, stampKey });
      if (!result.ok) setReactionError("おくれなかったよ。もういちどためしてね");
    },
    [dispatch, myId]
  );

  const openDetail = useCallback((c: ChoreCompletion) => {
    setCommentDraft("");
    setReactionError(null);
    setDetailTarget(c);
  }, []);

  const sendComment = async () => {
    if (!detailTarget) return;
    const body = commentDraft.trim();
    if (!body) return;
    setReactionError(null);
    setSendingComment(true);
    const result = await dispatch({ type: "ADD_REACTION", completionId: detailTarget.id, reactedBy: myId, kind: "comment", commentBody: body });
    setSendingComment(false);
    if (!result.ok) {
      setReactionError("おくれなかったよ。もういちどためしてね");
      return;
    }
    setCommentDraft("");
    setDetailTarget(null);
  };

  return (
    <Screen tone="child">
      <ChildTabHeader inboxCount={inboxCount} />

      {/* [2026-09-18追加・主要画面ワイヤーフレーム.md 50.2.1節決定18、実装メモ.md 247章] */}
      <TabIntroBubble
        tabKey="child.family"
        tone="child"
        memberId={myId}
        text="👋 かぞくの がんばりが みえるよ。"
      />

      {/* [2026-09-10移設・実装メモ.md 188章] 旧C5「かぞくのけいじばん」カード。
          [2026-09-21追加・要件定義書07-32章 決定20〜24、主要画面ワイヤーフレーム.md
          56.4節 決定20] 保護者トグル「家族のやりとりを使う」がオフの間はカード
          そのものを描かない（グレーアウト・理由の案内は出さない。下部タブは
          4つのまま・かぞくタブ自体は空にならない＝下のがんばり一覧は残る）。 */}
      {state.family.social_interactions_enabled && (
        <Pressable disabled={cardLoadState === "error"} onPress={() => router.push("/child/family-board")}>
          <Card tone="child" style={styles.familyBoardCard}>
            <View style={styles.cardHeaderRow}>
              <Text style={theme.typography.childBody}>💬 かぞくのけいじばん</Text>
              {cardLoadState !== "error" && <Text style={theme.typography.childBody}>›</Text>}
            </View>
            {cardMessage === null ? (
              <View style={styles.digestSkeleton} />
            ) : (
              <>
                {cardAuthorName !== null && (
                  <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s2 }]}>{cardAuthorName}</Text>
                )}
                <Text style={{ marginTop: theme.spacing.s1 }}>{cardMessage}</Text>
              </>
            )}
          </Card>
        </Pressable>
      )}

      <View style={[styles.titleRow, { marginTop: theme.spacing.s6 }]}>
        <Text style={theme.typography.childHeadline}>👨‍👩‍👧‍👦 かぞくのがんばり</Text>
        <Pressable onPress={() => router.push("/child/gratitude")} hitSlop={8}>
          <Text style={styles.gratitudeLink}>💌 ありがとうをおくる →</Text>
        </Pressable>
      </View>
      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        おうちのひとにも「がんばったね」をおくってみよう
      </Text>

      {reactableCompletions.length === 0 && (
        <EmptyState tone="child" emoji="🌱" title="まだ きろくが ないよ" />
      )}

      {/* [2026-09-20改訂・55.1節決定1] 描く対象を全件から新着5件に絞っただけで、
          カードの見た目・中身は1つも変えていない。5件は仮想化する意味が無いため、
          タブ側は`ScrollView`＋`.map()`のままにしてある（55.8節）。 */}
      {recentCompletions.map((c) => {
        const member = memberOf(c.reported_by);
        return (
          <ChildCompletionCard
            key={c.id}
            completion={c}
            member={member}
            memberAvatarLineData={member ? memberAvatars[member.id] : undefined}
            myChildId={myId}
            onOpenDetail={openDetail}
            onSendStamp={sendStamp}
            hasReactedWithStamp={hasReactedWithStamp}
            commentsEnabled={state.family.social_interactions_enabled}
          />
        );
      })}

      {/* [2026-09-20追加・55.2節決定3〜5] 一覧の直後（下）に置く。報告が6件以上
          あるときだけ出し、件数・新着バッジは添えない。5件以下ではボタン自体を
          描画しない（案内文もグレーアウトのボタンも置かない）。 */}
      {reactableCompletions.length > 5 && (
        <AppButton
          tone="child"
          variant="secondary"
          fullWidth
          label="もっと みる →"
          style={{ marginTop: theme.spacing.s3 }}
          onPress={() => router.push("/child/family-activity")}
        />
      )}

      <ChildCompletionDetailModal
        target={detailTarget}
        myChildId={myId}
        memberOf={memberOf}
        reactions={detailTarget ? reactionsForCompletion(detailTarget.id) : []}
        hasReactedWithStamp={hasReactedWithStamp}
        commentDraft={commentDraft}
        onChangeCommentDraft={setCommentDraft}
        sendingComment={sendingComment}
        reactionError={reactionError}
        commentsEnabled={state.family.social_interactions_enabled}
        onSendStamp={sendStamp}
        onSendComment={sendComment}
        onClose={() => setDetailTarget(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  familyBoardCard: { marginTop: theme.spacing.s3 },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  digestSkeleton: {
    marginTop: theme.spacing.s2,
    height: 18,
    borderRadius: theme.radius.childXl,
    backgroundColor: theme.colors.neutralBorder,
    opacity: 0.6,
  },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: theme.spacing.s2 },
  gratitudeLink: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
});
