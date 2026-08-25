import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import GachaHomeWidget from "@/components/GachaHomeWidget";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import MemberAvatar from "@/components/MemberAvatar";
import { useFamilyTreeSummary } from "@/hooks/useFamilyTree";
import { useGachaProgress } from "@/hooks/useGacha";

/**
 * C5 やることリスト（ホーム）（主要5画面のひとつ）
 * 参照: 主要画面ワイヤーフレーム.md 1章
 * 状態: 読み込み中・空・通常・上限到達（個別カード）・通信エラー を実装。
 * 上限到達カードは赤・グレーアウトにせず達成トーンで表現する（デザイントークン.md 1.4）。
 */
type LoadState = "loading" | "error" | "ready";

export default function ChildHomeScreen() {
  const { state, memberPoints, isChoreLimitReached, dispatch } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  // [2026-08-23追加] 家族の木ミニウィジェット（07-9章、主要画面ワイヤーフレーム.md
  // 20.6章決定7）。段階名のみを軽く添える（内訳・件数までは表示しない、C5行の設計）。
  const { season: treeSeason } = useFamilyTreeSummary();
  // [2026-08-26追加・第3段階] ガチャ「あと◯回」ウィジェット（07-13-1章、主要画面
  // ワイヤーフレーム.md 21.0節決定1「特に子ども向け（C5）では最も目立つ専用カード」・
  // 21.1節「残高表示のすぐ下、他の全リンクより上に配置」）。
  const { loadState: gachaLoadState, remaining: gachaRemaining, canDrawNow: gachaCanDrawNow } =
    useGachaProgress(state.activeChildMemberId);

  useEffect(() => {
    const t = setTimeout(() => setLoadState("ready"), 500);
    return () => clearTimeout(t);
  }, []);

  const me = state.members.find((m) => m.id === state.activeChildMemberId)!;
  const myPoints = memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0;

  // [変更] 2026-08-15改訂: 承認フロー廃止によりc.status（審査待ち件数）は廃止された。
  // 代わりに、自分の完了報告に直近24時間で届いた保護者リアクション件数を「お知らせ」として
  // 表示する（主要画面ワイヤーフレーム.md 4章「新着リアクションあり」の考え方をC5ヘッダーにも
  // 適用。催促ではなく届いたお知らせという位置づけ、デザイントークン.md 1.4節参照）。
  const myCompletionIds = new Set(state.completions.filter((c) => c.reported_by === me.id).map((c) => c.id));
  const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
  const newReactionCount = state.reactions.filter(
    (r) => myCompletionIds.has(r.completion_id) && new Date(r.created_at).getTime() >= oneDayAgoMs
  ).length;

  const chores = state.chores.filter(
    (c) => c.is_active && (c.assigned_to === null || c.assigned_to === me.id)
  );

  // [2026-08-22追加] 「まいにち」個人設定（chore_daily_flags）。ユーザーから
  // 「やることリストに毎日タスクを入れたい、区分けしたい」との依頼があったが、
  // 既存のis_repeatable（くり返す設定）とは「毎日やる」という意味が異なる
  // （繰り返し可能≠毎日）ため、chore全体の設定ではなく子ども・保護者それぞれが
  // 個人的に設定できるようにした（同じchoreでも人によってON/OFFを変えられる）。
  // 対になるラベル（「とくべつ」等）は作らず、「まいにち」の印だけを付ける方針。
  const toggleDaily = (choreId: string, flagged: boolean) => {
    void dispatch({ type: "SET_DAILY_FLAG", memberId: me.id, choreId, flagged });
  };

  return (
    <Screen tone="child">
      {/* [2026-08-23修正・本部長] 「ベルマークがアカウント切り替えにつながっていて、
          新着のお知らせだと思っていたので分かりにくい」とユーザーが実機で発見した。
          ベル（🔔・新着リアクション件数）は「きろく」タブ（届いたリアクションを
          確認できる）へ、左上のアバター・名前はアカウント切り替えへ、と役割を
          入れ替えた（ベル＝お知らせ、自分の名前をタップ＝自分の切り替え、という
          一般的なアプリの配置パターンに合わせた）。 */}
      <View style={styles.headerRow}>
        <Pressable style={styles.headerLeft} onPress={() => router.push("/child/profile-switch")}>
          <MemberAvatar name={me.display_name} color={me.avatar_color} size={36} />
          <Text style={theme.typography.childBody}>{me.display_name}</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/child/history")}>
          <Text style={styles.notifBadge}>🔔{newReactionCount}</Text>
        </Pressable>
      </View>

      <View style={styles.pointsRow}>
        <Text style={theme.typography.childHeadline}>🌟 いま {myPoints}pt</Text>
      </View>

      <GachaHomeWidget
        tone="child"
        loadState={gachaLoadState}
        remaining={gachaRemaining}
        canDrawNow={gachaCanDrawNow}
        onPress={() => router.push("/child/gacha")}
      />

      {/* [2026-08-20追加] 双方向リアクション（子→親）への導線。
          app/child/family-activity.tsx参照。 */}
      <Pressable onPress={() => router.push("/child/family-activity")}>
        <Text style={[theme.typography.childBody, styles.familyActivityLink]}>
          👨‍👩‍👧‍👦 かぞくのがんばりを見る →
        </Text>
      </Pressable>

      {/* [2026-08-23追加] 家族の木ミニウィジェット（07-9章、主要画面ワイヤーフレーム.md
          20.6章）。段階名のみを添える軽量表示。タップでC20へ。 */}
      <Pressable onPress={() => router.push("/child/family-tree")}>
        <Text style={[theme.typography.childBody, styles.familyActivityLink]}>
          🌳 かぞくの木を見る（いま「{theme.treeStages[treeSeason?.current_stage ?? 0].name}」）→
        </Text>
      </Pressable>

      {/* [2026-08-26追加] お絵かき（07-13-2章、第2段階）。画面一覧・遷移図.md 3.15節
          「子ども: [C5 やることリスト]から ──▶ [C24 おえかき]」。 */}
      <Pressable onPress={() => router.push("/child/drawing")}>
        <Text style={[theme.typography.childBody, styles.familyActivityLink]}>🎨 おえかきする →</Text>
      </Pressable>

      <View style={{ marginTop: theme.spacing.s2 }}>
        {loadState === "loading" && <SkeletonList count={4} />}
        {loadState === "error" && (
          <ErrorState
            tone="child"
            title="つうしんがおやすみ中みたい"
            onRetry={() => setLoadState("ready")}
          />
        )}
        {loadState === "ready" && chores.length === 0 && (
          <EmptyState tone="child" emoji="🌱" title="まだやることがないよ。おうちの人にきいてみてね" />
        )}
        {/* [2026-08-20修正・本部長] まだ・きろくずみが1つのグリッドに混在し見分けにくいと
            ユーザーが実機で発見したため、app/parent/my-chores.tsx（46章）と同じ考え方で
            2グループに分けた。
            [2026-08-22追加] 「まいにちにする」の小さい文字だけでは分かりにくい、
            やることリスト/きろくずみのような専用セクションにしたいとの依頼を受け、
            「まいにち」設定されたchoreを別セクションに切り出した（残りは従来どおり
            未実施/きろくずみで分ける。まいにち設定分は重複させない）。 */}
        {loadState === "ready" && chores.length > 0 && (() => {
          const withDaily = chores.map((chore) => ({
            chore,
            done: isChoreLimitReached(chore, me.id),
            isDaily: state.dailyFlaggedChoreIds.includes(chore.id),
          }));
          const daily = withDaily.filter((x) => x.isDaily);
          const rest = withDaily.filter((x) => !x.isDaily);
          const todo = rest.filter((x) => !x.done);
          const done = rest.filter((x) => x.done);
          const renderCard = ({ chore, done }: { chore: (typeof withDaily)[number]["chore"]; done: boolean }) => {
            const isDaily = state.dailyFlaggedChoreIds.includes(chore.id);
            return (
              <View key={chore.id} style={[styles.card, done && styles.cardDone]}>
                <Pressable
                  disabled={done}
                  onPress={() => router.push({ pathname: "/child/report", params: { choreId: chore.id } })}
                  style={styles.cardMain}
                >
                  <Text style={{ fontSize: 32 }}>{chore.emoji}</Text>
                  <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s1 }]}>{chore.title}</Text>
                  {done ? (
                    // 「1回だけ」設定（is_repeatable=false）のchoreは実施済みなら日付を問わず
                    // 永久にlimitReached=trueになる（src/data/store.tsxのisChoreLimitReachedFor
                    // 参照）。「きょうは」固定の文言だと、実際は別の日に完了報告した場合でも
                    // 「今日やった」ように見えてしまうとユーザーが実機で発見したため、
                    // is_repeatableで文言を出し分けた（「くり返す」設定は本当にその日の
                    // 上限到達なので従来どおり）。
                    <Text style={styles.doneLabel}>
                      {chore.is_repeatable ? "✅ きょうは\nがんばったね" : "✅ おわったよ"}
                    </Text>
                  ) : (
                    <Text style={styles.pointLabel}>+{chore.points}pt</Text>
                  )}
                </Pressable>
                <Pressable onPress={() => toggleDaily(chore.id, !isDaily)} hitSlop={8}>
                  <Text style={[styles.dailyToggle, isDaily && styles.dailyToggleOn]}>
                    {isDaily ? "☀️ まいにち" : "☀️ まいにちにする"}
                  </Text>
                </Pressable>
              </View>
            );
          };
          return (
            <>
              {daily.length > 0 && (
                <>
                  <Text style={[theme.typography.childBody, styles.sectionHeading, styles.dailySectionHeading]}>
                    ☀️ まいにちのお手伝い
                  </Text>
                  <View style={styles.grid}>{daily.map(renderCard)}</View>
                </>
              )}
              {todo.length > 0 && (
                <>
                  <Text style={[theme.typography.childBody, styles.sectionHeading]}>やることリスト</Text>
                  <View style={styles.grid}>{todo.map(renderCard)}</View>
                </>
              )}
              {done.length > 0 && (
                <>
                  <Text style={[theme.typography.childBody, styles.sectionHeading]}>きろくずみ</Text>
                  <View style={styles.grid}>{done.map(renderCard)}</View>
                </>
              )}
            </>
          );
        })()}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  notifBadge: { fontSize: 16, fontWeight: "700" },
  pointsRow: { alignItems: "center", marginTop: theme.spacing.s4 },
  familyActivityLink: {
    textAlign: "center",
    marginTop: theme.spacing.s2,
    color: theme.colors.brandPrimaryStrong,
  },
  sectionHeading: { marginTop: theme.spacing.s4, marginBottom: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  dailySectionHeading: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s3 },
  card: {
    width: "47%",
    minHeight: theme.tapTarget.childPrimary,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    alignItems: "center",
    padding: theme.spacing.s4,
  },
  cardMain: { flex: 1, alignItems: "center", justifyContent: "center" },
  cardDone: {
    backgroundColor: theme.colors.brandPrimarySoft,
  },
  pointLabel: { marginTop: theme.spacing.s1, color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  doneLabel: { marginTop: theme.spacing.s1, textAlign: "center", color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  dailyToggle: { marginTop: theme.spacing.s1, fontSize: 11, color: theme.colors.neutralTextSecondary },
  dailyToggleOn: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
});
