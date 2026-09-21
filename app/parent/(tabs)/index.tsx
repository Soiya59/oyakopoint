import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import MemberAvatar from "@/components/MemberAvatar";
import ParentTabHeader from "@/components/ParentTabHeader";
import TabIntroBubble from "@/components/TabIntroBubble";
import { countRecentInbox } from "@/components/InboxPanel";
import { useUnreadSince } from "@/hooks/useLastSeen";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { formatDateTimeShort } from "@/lib/calendarDates";
import { useFamilyHomeCard } from "@/hooks/useFamilyBoard";
import { useWeeklyReviewCardVisible } from "@/hooks/useWeeklyReview";
import MemberGoalsCard from "@/components/MemberGoalsCard";

/**
 * かぞく区画の入口（保護者。旧P7ホームの「まとめ」要素のうち家族向けの部分を吸収）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 35章（35.1節・35.6.1節）、
 * 実装メモ.md 187章
 *
 * [2026-09-10新規追加・実装メモ.md 187章] 保護者のタブ化（P7ホーム廃止）に伴う新設画面。
 * みまもりメンバー（`app/supporter/(tabs)/family.tsx`、実装メモ182・183・186章）と
 * 同じ作り方で、旧`app/parent/home.tsx`から「かぞく」区画に属する要素だけを移設した。
 * - ヘッダー（アバター＋自分の名前・タップで子ども選択画面へ／家族名／🔔）
 * - 家族の掲示板カード
 * - 完了報告（新着◯件）カード → `/parent/approvals`
 * - 最近の報告（5件）
 * ポイント通帳・家族の木ミニウィジェット・ガチャは、それぞれ「じぶん」「木」タブへ
 * 移設したためここには置かない（本部長指示の区画表どおり）。
 *
 * **最近の報告は3件→5件に変更した。** 旧P7ホームは`slice(0, 3)`だったが、本部長の
 * 依頼文にある区画表が「最近の報告5件」と明記しており、みまもりの「かぞく」タブ
 * （実装メモ183章、`completions.slice(0, 5)`）に揃える指示と判断した。表示件数を
 * 増やす以外の変更（並び順・スタンプ等の付与）はしていない。5件を超える分は
 * 従来どおり「完了報告」カードから`/parent/approvals`（全件・リアクション可）で見られる。
 *
 * **ファイル名を`index.tsx`にした理由（`family.tsx`にしなかった理由）。**
 * みまもりでは「かぞく」タブのファイル名は`family.tsx`（→`/supporter/family`）だが、
 * 保護者では`app/parent/family.tsx`が既にP14「家族の管理」（旧「設定」統合先、
 * `/parent/family`）として存在しており、同名にすると同一URLの二重定義になる
 * （expo-routerの`(tabs)`はURLセグメントを追加しないグループのため、
 * `app/parent/(tabs)/family.tsx`と`app/parent/family.tsx`はどちらも`/parent/family`に
 * 解決してしまう）。既存のP14（家族の管理、多数の画面から参照済み）を動かすより、
 * 新設側のファイル名を変える方が影響範囲が小さいと判断し、`index.tsx`
 * （`(tabs)`グループの既定ルート、`app/index.tsx`が`/`に解決するのと同じ仕組みで
 * `/parent`に解決する）を採用した。かんりタブも同様の理由で`manage.tsx`
 * （→`/parent/manage`）にした（`app/parent/(tabs)/manage.tsx`参照）。
 *
 * 旧`app/parent/home.tsx`（`/parent/home`）は`<Redirect href="/parent" />`の
 * スタブとして残し、外部からの古いリンクを生かした。アプリ内の遷移コードは
 * 本改修ですべて`/parent`へ直接書き換えている（`grep -rn '"/parent/home"' app/ src/`が
 * 0件であることを確認済み、実装メモ187章参照）。
 */
export default function ParentFamilyTabScreen() {
  const { state, memberAvatars } = useAppData();

  // [2026-09-21追加・要件定義書07-35章「振り返る機会」、主要画面ワイヤーフレーム.md
  // 60.1節決定1] 家族作成から最初の暦週がまだ終わっていない間はカード自体を出さない
  // （60.3節決定5）。
  const weeklyReviewCardVisible = useWeeklyReviewCardVisible();

  const { loadState: cardLoadState, card } = useFamilyHomeCard(state.family.id);
  const cardMessage =
    cardLoadState === "error"
      ? "家族の掲示板は、また後で見てみてね"
      : cardLoadState === "loading"
      ? null
      : card?.message ?? "家族の掲示板は、また後で見てみてね";
  const cardAuthorName =
    card?.source === "board_post"
      ? state.members.find((m) => m.id === card.board_post_author_member_id)?.display_name ?? null
      : null;
  const cardExcerpt =
    cardMessage !== null && cardMessage.length > 40 ? `${cardMessage.slice(0, 40)}…` : cardMessage;
  const cardTime =
    card?.source === "board_post" && card.board_post_created_at
      ? new Date(card.board_post_created_at).toLocaleString("ja-JP", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  // [2026-09-11変更・実装メモ.md 190章] 「24時間以内の件数」→「最後に見てからの未読件数」。
  // ベル（とどいたよ）と完了報告は行き先も中身も違うため、基準時刻を別々に持つ。
  // 片方を開いただけでもう片方まで消える、という事故を避けるため（統括と確認済み）。
  const inboxSince = useUnreadSince("inbox", state.activeParentMemberId);
  const completionsSince = useUnreadSince("completions", state.activeParentMemberId);
  const inboxCount = countRecentInbox(state, state.activeParentMemberId, inboxSince);
  const newCount = state.completions.filter(
    (c) => new Date(c.reported_at).getTime() >= completionsSince
  ).length;
  // [2026-09-10・実装メモ187章] 「最近の報告5件」（本部長指示の区画表どおり。旧P7は3件だった）。
  const recent = [...state.completions]
    .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime())
    .slice(0, 5);
  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  // [2026-09-16追加・UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 45.1〜45.6節、
  // 実装メモ.md 227章] 保護者ホームの「はじめの3つ」。「もう見た」を覚える保存領域は
  // 新設せず、state.members/state.chores/state.rewards（既存useAppData()）の実件数
  // のみで毎回判定し直す（45.2節。AsyncStorage・DB列いずれの新設も無い）。1件以上
  // できた項目から消え、3項目とも消えたら欄自体を描画しない（45.1節）。並び順は
  // こども→クエスト→ごほうび（45.4節の提案を45.11節1.で本部長が採用）。
  const hasActiveChild = state.members.some((m) => m.is_active && m.role === "child");
  const hasFamilyChore = state.chores.some((c) => c.scope === "family");
  const hasFamilyReward = state.rewards.some((r) => r.scope === "family");
  const starterItems: { key: string; emoji: string; label: string; path: string }[] = [
    ...(hasActiveChild ? [] : [{ key: "child", emoji: "👦", label: "こどもを1人登録する", path: "/parent/child-profile" }]),
    ...(hasFamilyChore ? [] : [{ key: "chore", emoji: "📝", label: "クエストを1つ作る", path: "/parent/chore-edit" }]),
    ...(hasFamilyReward ? [] : [{ key: "reward", emoji: "🎁", label: "ごほうびを1つ作る", path: "/parent/reward-edit" }]),
  ];

  // [旧app/parent/home.tsxからそのまま移設・実装メモ92.2章/108章/167章] 左上の
  // 「いま誰として使っているか」。タップで子ども選択画面へ（子どもが0人なら非タップ）。
  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const childProfiles = state.members
    .filter((m) => m.is_active && m.role === "child")
    .map((m) => ({ member_id: m.id, display_name: m.display_name, avatar_color: m.avatar_color }));
  const goToChildSwitch = () =>
    router.push({
      pathname: "/child-auth/profile-select",
      params: {
        inviteCode: state.family.invite_code,
        childrenJson: JSON.stringify(childProfiles),
      },
    });

  return (
    <Screen tone="parent">
      {/* [2026-09-10] 4タブ共通のヘッダー部品に統一（src/components/ParentTabHeader.tsx）。
          統括の実機確認「じぶんとかんりの左上のアイコンから、子供モードに飛べない」を受け、
          ここにだけあった子どもモードへの導線を共通部品へ移した。 */}
      <ParentTabHeader inboxCount={inboxCount} />

      {/* [2026-09-18追加・主要画面ワイヤーフレーム.md 50.2.2節決定6、実装メモ.md 247章]
          このタブに限り、45.1節「はじめの3つ」よりさらに上に置く（タブそのものの
          説明のほうが、その中で何をするかの説明より粒度が粗いため先に読ませる）。 */}
      <TabIntroBubble
        tabKey="parent.family"
        tone="parent"
        memberId={state.activeParentMemberId}
        text="👋 家族みんなの完了報告や掲示板をまとめて見るタブです。スタンプやひとことで応援してあげてください。"
      />

      {/* [2026-09-16追加・主要画面ワイヤーフレーム.md 45.1節決定1] ParentTabHeaderの
          直後、「家族の掲示板」Cardの直前に配置する。3項目とも完了済みならstarterItemsは
          空配列になり、このCardごと描画されない（高さ0の空Viewも残さない）ため、
          3つ終わった家族ではこの下のレイアウトが変更前と完全に同じになる。 */}
      {starterItems.length > 0 && (
        <Card style={{ marginTop: theme.spacing.s4 }}>
          <Text style={theme.typography.parentBodyMedium}>🌱 はじめに、この3つをやってみましょう</Text>
          <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
            {starterItems.map((item) => (
              <Pressable key={item.key} onPress={() => router.push(item.path as never)}>
                <Card style={styles.starterRow}>
                  <Text style={theme.typography.parentBody}>
                    {item.emoji} {item.label}
                  </Text>
                  <Text style={theme.typography.parentBody}>›</Text>
                </Card>
              </Pressable>
            ))}
          </View>
        </Card>
      )}

      {/* [2026-09-21追加・要件定義書07-32章 決定20〜24、主要画面ワイヤーフレーム.md
          56.4節決定21] 保護者トグル「家族のやりとりを使う」がオフの間はカードを
          出さない（過去の投稿を読む道はP14「家族のやりとりの設定」の直下に
          「これまでの書き込みを読む」の1行として残す）。 */}
      {state.family.social_interactions_enabled && (
        <Pressable disabled={cardLoadState === "error"} onPress={() => router.push("/parent/family-board")}>
          <Card style={{ marginTop: theme.spacing.s4 }}>
            <View style={styles.cardHeaderRow}>
              <Text style={theme.typography.parentBodyMedium}>家族の掲示板</Text>
              {cardLoadState !== "error" && <Text style={theme.typography.parentBodyMedium}>›</Text>}
            </View>
            {cardMessage === null ? (
              <View style={styles.digestSkeleton} />
            ) : (
              <>
                {cardAuthorName !== null && (
                  <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s2 }]}>{cardAuthorName}</Text>
                )}
                <Text style={{ marginTop: theme.spacing.s1 }}>{cardExcerpt}</Text>
                {cardTime !== null && (
                  <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
                    {cardTime}
                  </Text>
                )}
              </>
            )}
          </Card>
        </Pressable>
      )}

      {/* [2026-09-21追加・要件定義書07-35章「振り返る機会」、主要画面ワイヤーフレーム.md
          60.1節決定1・60.2節決定3] 📮かぞくのけいじばんカードの直後に隣接配置。
          表側には数字を一切出さない（決定3、タップ先の専用画面にのみ数字が現れる）。 */}
      {weeklyReviewCardVisible && (
        <Pressable onPress={() => router.push("/parent/weekly-review")}>
          <Card style={{ marginTop: theme.spacing.s4 }}>
            <View style={styles.cardHeaderRow}>
              <Text style={theme.typography.parentBodyMedium}>先週のふりかえり</Text>
              <Text style={theme.typography.parentBodyMedium}>›</Text>
            </View>
          </Card>
        </Pressable>
      )}

      {/* [2026-09-21追加・要件定義書07-36章「自分で目標を決める」、主要画面
          ワイヤーフレーム.md 61.1節決定1] 60章「先週のふりかえり」カードの直後・
          完了報告一覧の直前に配置。子どもが1人もいない場合はカード自体を出さない
          （MemberGoalsCard内部で判定）。 */}
      <MemberGoalsCard />

      <Pressable onPress={() => router.push("/parent/approvals")}>
        <Card style={styles.pendingCard}>
          <Text style={theme.typography.parentBodyMedium}>完了報告</Text>
          <Text style={styles.pendingCount}>新着{newCount}件</Text>
        </Card>
      </Pressable>

      <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>最近の報告</Text>
      <View style={{ gap: theme.spacing.s2, marginTop: theme.spacing.s2 }}>
        {recent.map((c) => {
          const member = memberOf(c.reported_by);
          return (
            <Pressable key={c.id} onPress={() => router.push("/parent/approvals")}>
              <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                  <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={24} lineData={member ? memberAvatars[member.id] : undefined} expandOnTap />
                  <Text style={{ marginLeft: theme.spacing.s2 }}>
                    {member?.display_name} {c.chore_emoji} {c.chore_title}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  {/* [2026-09-17改訂・要件定義書07-28章決定9] 台紙型はpoints=NULLの
                      ため何も添えない。 */}
                  {c.points != null && <Text style={{ color: theme.colors.neutralTextSecondary }}>+{c.points}pt</Text>}
                  <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
                    {formatDateTimeShort(c.reported_at)}
                  </Text>
                </View>
              </Card>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerMe: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  headerFamilyName: { flex: 1, marginLeft: theme.spacing.s3 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  bellHit: { minHeight: theme.tapTarget.parent, justifyContent: "center", paddingLeft: theme.spacing.s2 },
  notifBadge: { fontSize: 16, fontWeight: "700" },
  sectionHeading: {
    marginTop: theme.spacing.s6,
    marginBottom: theme.spacing.s2,
    color: theme.colors.brandPrimaryStrong,
  },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  // [2026-09-16追加・主要画面ワイヤーフレーム.md 45.6節] 「はじめの3つ」内の1行。
  // app/parent/(tabs)/manage.tsxのrowスタイルと同型（新しい部品は作らない）。
  starterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  digestSkeleton: {
    marginTop: theme.spacing.s2,
    height: 18,
    borderRadius: theme.radius.parentMd,
    backgroundColor: theme.colors.neutralBorder,
    opacity: 0.6,
  },
  pendingCard: {
    marginTop: theme.spacing.s4,
    backgroundColor: theme.colors.statusPendingSoft,
    borderColor: theme.colors.statusPending,
  },
  pendingCount: { fontSize: 28, fontWeight: "700", color: theme.colors.statusPending, marginTop: theme.spacing.s1 },
});
