import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ListRenderItemInfo, Pressable, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import ListScreen from "@/components/ListScreen";
import AppButton from "@/components/AppButton";
import ChildCompletionCard from "@/components/ChildCompletionCard";
import ChildCompletionDetailModal from "@/components/ChildCompletionDetailModal";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import type { ChoreCompletion, StampKey } from "@/types/domain";

/**
 * C18 かぞくのがんばり（子ども・全件） — 完了報告一覧・スタンプ・ひとこと
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 55章、画面一覧・遷移図.md 2.4節C18、
 * P8（app/parent/approvals.tsx）・S2（app/supporter/activity.tsx）と同じ位置づけ
 *
 * [2026-09-10〜2026-09-20の経緯] 2026-09-10の子ども下部タブ4区画化（36章・実装メモ188章）で、
 * 本ファイルの中身は `app/child/(tabs)/family.tsx`（かぞくタブ）へ統合され、本ファイルは
 * `<Redirect href="/child/family" />` だけのスタブになっていた（古い外部リンクを404にしない
 * ため、`app/parent/home.tsx`（187章）と同じ扱い）。
 *
 * [2026-09-20復活・主要画面ワイヤーフレーム.md 55章、やること.md 4-64、実装メモ.md 265章]
 * 36.12節決定3「かぞくタブは5件に絞る。…3ロールで同じ形にする」（2026-09-10・本部長決定）が
 * 子ども側だけ未反映だったことが判明し、統括が「3ロールを揃える」と判断した。かぞくタブを
 * 新着5件のプレビューに絞るにあたり、6件目以降にスタンプを送る道が必要になったため、本ファイルを
 * 全件一覧として復活させた。みまもりメンバー側で同じ経緯をたどった
 * `app/supporter/activity.tsx`（実装メモ183章）と同型であり、URLも当時の `/child/family-activity`
 * をそのまま使う（新URLは作らない。55.3節決定6）。
 *
 * 子どもには承認・取消の操作が無いため、P8/S2が持つ「取消」リンク・確認モーダル・取消成功表示、
 * および「新着◯件」の件数表示は持ち込まない（55.3節決定8）。一覧の対象は かぞくタブと同じく
 * 自分以外の家族全員の完了報告（07-23章決定1・決定2）。
 *
 * [実装の前提] 一覧は FlatList（仮想化）で描くこと。ScrollView＋.map() で全件を描くと、
 * P8が踏んだのと同じ描画の重さになる（実装メモ255章、やること.md 4-47）。55.8節参照。
 *
 * [カードとモーダルの共通化・265章] 55.10節手順7は「共通部品へ抽出（推奨）／2ファイルに写す」の
 * どちらでもよいとしていたが、抽出を選んだ。カード本体は`@/components/ChildCompletionCard`、
 * 詳細モーダルは`@/components/ChildCompletionDetailModal`にあり、かぞくタブ
 * （`app/child/(tabs)/family.tsx`）と**同じ実体**を描いている。どちらか片方だけ見た目が
 * ずれることが起き得ない形にしてある（P8とS2が写しの関係で実装が分かれた前例・55.11節(3)）。
 */
type LoadState = "loading" | "error" | "ready";

export default function ChildFamilyActivityScreen() {
  const { state, dispatch, reactionsForCompletion, hasReactedWithStamp, loading, loadError, memberAvatars } = useAppData();

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [detailTarget, setDetailTarget] = useState<ChoreCompletion | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);

  const myId = state.activeChildMemberId;
  const memberOf = useCallback((id: string) => state.members.find((m) => m.id === id), [state.members]);

  useEffect(() => {
    if (!loading) setLoadState(loadError ? "error" : "ready");
  }, [loading, loadError]);

  // かぞくタブ（`app/child/(tabs)/family.tsx`）と同じ対象・同じ並び。違いは
  // `.slice(0, 5)`をしないことだけ（55.3節決定8「件数だけが全件になる」）。
  // [2026-09-19・255章と同じ理由] 無関係な再レンダーのたびに家族の全履歴を
  // filter+sortし直さないようuseMemoにする。
  const completions = useMemo(
    () =>
      [...state.completions]
        .filter((c) => c.reported_by !== myId)
        .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()),
    [state.completions, myId]
  );

  // [2026-09-10改訂・実装メモ.md 157章] おくったスタンプをもういちど押すと取消、
  // ちがうスタンプを押すと切替になる。文言はかぞくタブと同一（55.5節）。
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

  const listHeader = (
    <>
      {/* 戻るリンク（55.3節決定8）。行き先は`router.back()`ではなくかぞくタブに固定する
          （履歴次第で行き先が変わるのを避ける。ScreenBackLinkの冒頭コメント・86章と同じ理由）。 */}
      <Pressable onPress={() => router.replace("/child/family")} hitSlop={8} style={styles.back}>
        <Text style={theme.typography.childBody}>← もどる</Text>
      </Pressable>

      <Text style={[theme.typography.childHeadline, styles.title]}>かぞくのがんばり</Text>
      <Text style={[theme.typography.childBody, styles.subtitle]}>いままでの ぶんも ぜんぶ あるよ</Text>

      {loadState === "loading" && <SkeletonList count={3} />}

      {loadState === "error" && (
        <ErrorState tone="child" title="よみこめなかったよ。もういちど ためしてね" onRetry={() => setLoadState("ready")} />
      )}

      {/* 空状態の文言はかぞくタブと同一（`app/child/(tabs)/family.tsx`のEmptyState）。 */}
      {loadState === "ready" && completions.length === 0 && (
        <EmptyState tone="child" emoji="🌱" title="まだ きろくが ないよ" />
      )}
    </>
  );

  // 上下2か所で戻れるようにする（C29「とどいたよ」`app/child/inbox.tsx`と同じ形）。
  const listFooter = (
    <AppButton
      label="もどる"
      variant="ghost"
      tone="child"
      style={{ marginTop: theme.spacing.s6 }}
      onPress={() => router.replace("/child/family")}
    />
  );

  const renderItem = ({ item: c }: ListRenderItemInfo<ChoreCompletion>) => {
    const member = memberOf(c.reported_by);
    return (
      <ChildCompletionCard
        completion={c}
        member={member}
        memberAvatarLineData={member ? memberAvatars[member.id] : undefined}
        myChildId={myId}
        onOpenDetail={openDetail}
        onSendStamp={sendStamp}
        hasReactedWithStamp={hasReactedWithStamp}
      />
    );
  };

  return (
    // [2026-09-20改訂・266章] 一覧の骨組み（`Screen`を`scroll={false}`にして`FlatList`自身を
    // 唯一のスクロールコンテナにする・`Screen`と同じpaddingを`contentContainerStyle`へ移す・
    // 仮想化の設定〈55.8節〉）は`@/components/ListScreen`へ集約した。P8・S2も同じ部品を使う。
    <ListScreen
      tone="child"
      data={loadState === "ready" ? completions : []}
      keyExtractor={(c) => c.id}
      renderItem={renderItem}
      ListHeaderComponent={listHeader}
      ListFooterComponent={listFooter}
    >

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
        onSendStamp={sendStamp}
        onSendComment={sendComment}
        onClose={() => setDetailTarget(null)}
      />
    </ListScreen>
  );
}

const styles = StyleSheet.create({
  back: { minHeight: theme.tapTarget.child, justifyContent: "center", alignSelf: "flex-start" },
  title: { marginTop: theme.spacing.s3, textAlign: "center" },
  subtitle: { marginTop: theme.spacing.s2, textAlign: "center", color: theme.colors.neutralTextSecondary },
});
