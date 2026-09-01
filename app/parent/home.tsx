import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import GachaHomeWidget from "@/components/GachaHomeWidget";
import MemberAvatar from "@/components/MemberAvatar";
import MyPointsCard from "@/components/MyPointsCard";
import { countRecentInbox } from "@/components/InboxPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { formatDateTimeShort } from "@/lib/calendarDates";
import { useFamilyTreeSummary } from "@/hooks/useFamilyTree";
import { useGachaProgress } from "@/hooks/useGacha";
import { useFamilyHomeCard } from "@/hooks/useFamilyBoard";

/**
 * P7 ホーム（保護者ダッシュボード）
 * 参照: 画面一覧・遷移図.md P7、3.4章「保護者の日常利用」
 *
 * [2026-08-15改訂] 承認フロー廃止に伴い、「承認待ち件数バッジ」を廃止した。保護者が
 * 行う操作は「見る」「（任意で）スタンプ／コメントを贈る」の2つのみで、対応漏れを
 * 想起させる未処理バッジは表示しない（画面一覧・遷移図.md 3.4章）。代わりに
 * 直近24時間の「新着」件数（催促ではなくお知らせという位置づけ）を表示する。
 * あわせて実施履歴カレンダー（P18、要件定義書07-3章）への「きろく」ショートカットを追加した。
 */
/** メニュータイル1枚。labelSizeは、4列の幅(75px)に収まらないラベルだけ個別に縮めるために使う。 */
type ShortcutItem = { emoji: string; label: string; path: string; labelSize?: number };

export default function ParentHomeScreen() {
  const { state, memberPoints } = useAppData();
  // [2026-08-28改訂・家族の書き込みボード07-14章第1段階] 「家族の掲示板」カード（旧「今週のできごと」）を
  // `useWeeklyDigest`（まとめメッセージ専用）から`useFamilyHomeCard`
  // （family_home_card View、書き込み優先・無ければまとめメッセージ）へ置き換えた。
  // `useWeeklyDigest`自体は削除していない（src/hooks/useFamilyBoard.ts冒頭の
  // コメント「E. useWeeklyDigestとの関係」参照）。
  // 決定1（19章決定1の更新）「非タップ→タップして履歴一覧へ」・決定3「通信エラー時は
  // 控えめな1行に差し替え、カードはタップ不可のまま」・19章決定4「集計対象0件は
  // デフォルトメッセージで正常系として吸収する」は維持する。
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
  // 主要画面ワイヤーフレーム.md 22.1.1節「本文抜粋（40字程度＋「…」）」。
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
  // [2026-08-23追加] 家族の木ミニウィジェット（07-9章、主要画面ワイヤーフレーム.md 20.6章
  // 決定7）。段階名・今シーズンの完了報告数の2情報のみを表示し、内訳・色つき要素の
  // 密な表示はP26（→app/parent/family-tree.tsx）側で行う。
  const { season: treeSeason } = useFamilyTreeSummary();
  // [2026-08-26追加・第3段階] ガチャ「あと◯回」ウィジェット（07-13-1章、主要画面
  // ワイヤーフレーム.md 21.0節決定1・21.1節）。木ウィジェットの近く・メニューより上に
  // 配置する（依頼どおり）。専用の差し色（color-gacha-accent）を持つ独立コンポーネント。
  const { loadState: gachaLoadState, remaining: gachaRemaining, canDrawNow: gachaCanDrawNow } =
    useGachaProgress(state.activeParentMemberId);
  // [2026-08-23追加・5回目のスコープ変更] P25「かぞくのみまもりメンバーのお手伝い
  // （参考一覧）」への導線。画面一覧・遷移図.md P25行「家族にみまもりメンバーが
  // 1人もいない場合は導線自体を表示しない」に対応し、家族に有効なsupporterが
  // 1人以上いる場合のみメニューに表示する。
  const hasAnySupporter = state.members.some((m) => m.role === "supporter" && m.is_active);
  const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
  // 右上のベル。直近24時間に自分へ届いたリアクション・感謝の件数（src/components/InboxPanel.tsx）。
  const inboxCount = countRecentInbox(state, state.activeParentMemberId, oneDayAgoMs);
  const newCount = state.completions.filter(
    (c) => new Date(c.reported_at).getTime() >= oneDayAgoMs
  ).length;
  const recent = [...state.completions]
    .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime())
    .slice(0, 3);
  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  // [2026-08-27追加・本部長] 自分の現在ポイント。src/components/MyPointsCard.tsx参照。
  const myPoints =
    memberPoints.find((m) => m.member_id === state.activeParentMemberId)?.current_points ?? 0;

  // [2026-08-26整理・本部長] メニュー項目が12個に達し「多すぎる」との指摘を受けて
  // 2グループに分けた。項目自体は1つも減らしていない。
  //
  // 混雑の原因は項目数ではなく**役割の混在**だった。07-4章「親の完了報告（対等な
  // 参加）」以降、保護者は「家族を管理する人」と「自分もお手伝いをする参加者」の
  // 2つの立場を持つが、その道具が1つの列に並んでいたため、
  // 「お手伝い（管理）」と「じぶんのお手伝い（自分がやる）」、
  // 「ごほうび（管理）」と「じぶんのごほうび（自分が交換する）」が隣り合って
  // 取り違えやすくなっていた（🎁の絵文字が2項目で重複してもいた）。
  // 立場ごとに分けることで、一度に見る数が5〜6個に収まる。
  const myShortcuts: ShortcutItem[] = [
    { emoji: "🧹", label: "クエスト", path: "/parent/my-chores" },
    { emoji: "🎁", label: "ごほうび", path: "/parent/my-rewards" },
    // [2026-08-29] 4列（タイル幅75px）だと6文字は収まらず「感謝ポイン／ト」と割れて
    // 「ト」が1文字だけ次行に残っていた（ユーザーの実機指摘）。意味の切れ目で明示的に
    // 改行する。ラベル全体の文字サイズを下げる案もあったが、壊れていない他のタイルまで
    // 小さくなるため採らなかった。
    { emoji: "💌", label: "感謝\nポイント", path: "/parent/gratitude" },
    { emoji: "🎨", label: "お絵かき", path: "/parent/drawing" },
    // [2026-08-29] 「とどいたもの」はここのタイルから右上のベルへ移した（上のヘッダー参照）。
    // [2026-08-27追加・第5段階（最終段階）] コレクター棚（07-13-3章、画面一覧・
    // 遷移図.md「P7ホームのメニュー『コレクター棚』──▶P31」）。
  ];

  // [2026-08-29並べ替え・本部長] 並び順はユーザー指示。
  // クエスト → ごほうび は「私の管理」と同じ列に来るよう先頭に置き、
  // 続けて日々見るもの（コレクション・完了報告・きろく・通帳）、
  // 最後に設定という並びにしている。
  // 「みまもりの記録」は家族に有効なsupporterがいる場合のみ表示するが、
  // 以前のようにpush（＝末尾追加）ではなく、指定された位置（通帳と設定の間）へ
  // 差し込む必要があるため、条件付きの要素をfilterで落とす形にした。
  const familyShortcuts: ShortcutItem[] = (
    [
      // 「（管理）」は明示的に改行する。自動折り返しだと「クエスト（管 / 理）」のように
      // 括弧の途中で割れて読みにくかった（ユーザーの実機指摘）。
      { emoji: "🧺", label: "クエスト\n（管理）", path: "/parent/chores" },
      { emoji: "🏆", label: "ごほうび\n（管理）", path: "/parent/rewards" },
      // 「コレクション」は6文字で、4列（タイル幅75px）だと15pxのままでは折り返す。
      // このタイルだけ12pxに落として1行に収める（6×12=72px < 75px）。
      { emoji: "🗄️", label: "コレクション", path: "/parent/collector-shelf", labelSize: 12 },
      { emoji: "📋", label: "完了報告", path: "/parent/approvals" },
      { emoji: "📅", label: "きろく", path: "/parent/history" },
      { emoji: "📔", label: "通帳", path: "/parent/points" },
      // 画面一覧・遷移図.md P25「家族にみまもりメンバーが1人もいない場合は導線自体を
      // 表示しない」。ラベルは1行に収まらず折り返していたため短縮済み（遷移先は変更なし）。
      hasAnySupporter
        ? { emoji: "👀", label: "みまもりの記録", path: "/parent/supporter-chores" }
        : null,
      // [2026-08-29統合] 旧「家族」タイルと「設定」タイルを1つにまとめた（統合先はP14）。
      { emoji: "⚙️", label: "設定", path: "/parent/family" },
    ] as (ShortcutItem | null)[]
  ).filter((x): x is ShortcutItem => x !== null);

  return (
    <Screen tone="parent">
      {/* [2026-08-29変更] 「とどいたもの」への導線をメニュータイルから右上のベルへ移した
          （ユーザー指示「子供と同じように右上にベルマークで表示してほしい」）。
          子どもホーム（C5）と同じ位置・同じ数え方に揃える。 */}
      <View style={styles.headerRow}>
        <Text style={[theme.typography.parentTitle, { flex: 1 }]}>{state.family.name} の ホーム</Text>
        <Pressable onPress={() => router.push("/parent/inbox")} hitSlop={8} style={styles.bellHit}>
          <Text style={styles.notifBadge}>🔔{inboxCount}</Text>
        </Pressable>
      </View>

      <MyPointsCard tone="parent" points={myPoints} onPress={() => router.push("/parent/points")} />

      {/* [2026-08-28改訂] 家族の書き込みボード07-14章第1段階。主要画面ワイヤーフレーム.md
          22.1.1節「決定1: カードを非タップから『タップして履歴一覧へ』に変更する」。
          書き込みがあればその投稿者名＋本文抜粋＋時刻、無ければ従来のまとめメッセージ
          （19章の見出し・表示ロジックをそのまま踏襲）。通信エラー時のみタップ不可のまま
          （22.1.1節状態一覧「通信エラー」行）。 */}
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

      {/* [2026-08-23追加] 家族の木ミニウィジェット（07-9章、主要画面ワイヤーフレーム.md
          20.6章決定7）。段階名・今シーズンの完了報告数の2情報のみ。タップでP26へ。 */}
      <Pressable onPress={() => router.push("/parent/family-tree")}>
        <Card style={styles.treeWidget}>
          <Text style={theme.typography.parentBodyMedium}>
            🌿 家族の木 いま「{theme.treeStages[treeSeason?.current_stage ?? 0].name}」
          </Text>
          <Text style={{ color: theme.colors.neutralTextSecondary }}>
            今シーズン {treeSeason?.completion_count ?? 0}回 →
          </Text>
        </Card>
      </Pressable>

      <GachaHomeWidget
        tone="parent"
        loadState={gachaLoadState}
        remaining={gachaRemaining}
        canDrawNow={gachaCanDrawNow}
        onPress={() => router.push("/parent/gacha")}
      />

      <Pressable onPress={() => router.push("/parent/approvals")}>
        <Card style={styles.pendingCard}>
          <Text style={theme.typography.parentBodyMedium}>完了報告</Text>
          <Text style={styles.pendingCount}>新着{newCount}件</Text>
        </Card>
      </Pressable>

      <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>最近の報告</Text>
      <View style={{ gap: theme.spacing.s2, marginTop: theme.spacing.s2 }}>
        {recent.map((c) => {
          // [2026-08-16修正・本部長] ユーザーの実操作で、P7「最近の報告」プレビューに
          // 誰の報告かが表示されておらず、P8（完了報告一覧）と体験が食い違っていることが
          // 判明した。P8と同じmemberOf() + MemberAvatarのパターンをそのまま踏襲した。
          const member = memberOf(c.reported_by);
          return (
            <Card key={c.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={24} />
                <Text style={{ marginLeft: theme.spacing.s2 }}>
                  {member?.display_name} {c.chore_emoji} {c.chore_title}
                </Text>
              </View>
              {/* [2026-09-01追加・本部長] いつの報告か画面から分からなかったため、
                  P8と同じ「M/D HH:MM」書式で右側に添える。 */}
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: theme.colors.neutralTextSecondary }}>
                  +{c.points}pt
                </Text>
                <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
                  {formatDateTimeShort(c.reported_at)}
                </Text>
              </View>
            </Card>
          );
        })}
      </View>

      {/* [2026-08-26整理] 「わたしの」＝保護者が参加者として使うもの、
          「かぞくの管理」＝管理者として使うもの。上のconst定義のコメント参照。 */}
      <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>私の管理</Text>
      <View style={styles.grid}>
        {myShortcuts.map((s) => (
          <Pressable key={s.path} onPress={() => router.push(s.path as never)} style={styles.gridItem}>
            <View style={styles.tileEmojiCircle}>
              <Text style={{ fontSize: 26 }}>{s.emoji}</Text>
            </View>
            <Text style={[theme.typography.parentBody, styles.tileLabel, s.labelSize ? { fontSize: s.labelSize } : null]}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>家族の管理</Text>
      <View style={styles.grid}>
        {familyShortcuts.map((s) => (
          <Pressable key={s.path} onPress={() => router.push(s.path as never)} style={styles.gridItem}>
            <View style={styles.tileEmojiCircle}>
              <Text style={{ fontSize: 26 }}>{s.emoji}</Text>
            </View>
            <Text style={[theme.typography.parentBody, styles.tileLabel, s.labelSize ? { fontSize: s.labelSize } : null]}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center" },
  bellHit: { minHeight: theme.tapTarget.parent, justifyContent: "center", paddingLeft: theme.spacing.s2 },
  notifBadge: { fontSize: 16, fontWeight: "700" },
  // [2026-08-29変更・本部長] セクション見出し。
  // (a) 「わたしの」「かぞくの管理」はグレー、「最近の報告」だけ素のparentBodyMediumで黒、と
  //     **同じ役割の見出しなのに色が揃っていなかった**（ユーザーの実機指摘で判明。意図した
  //     使い分けではなく実装の行き違い）。3つとも本スタイルに統一した。
  // (b) あわせて色をneutralTextSecondary（グレー）からbrandPrimaryStrongへ。保護者向け画面は
  //     背景・カード・枠線・文字がすべて無彩色で「色が付いているのは絵文字だけ」という
  //     状態だったため、見出しをブランド色にして画面に色を戻す（デザイントークン.md 1.2節の
  //     2026-08-29改訂を参照）。07-4章「淡々とした記録」の方針は維持しており、
  //     彩度を上げるのは見出しとメニュータイルの淡色に留めている。
  sectionHeading: {
    marginTop: theme.spacing.s6,
    marginBottom: theme.spacing.s2,
    color: theme.colors.brandPrimaryStrong,
  },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  digestSkeleton: {
    marginTop: theme.spacing.s2,
    height: 18,
    borderRadius: theme.radius.parentMd,
    backgroundColor: theme.colors.neutralBorder,
    opacity: 0.6,
  },
  treeWidget: { marginTop: theme.spacing.s3 },
  pendingCard: {
    marginTop: theme.spacing.s4,
    backgroundColor: theme.colors.statusPendingSoft,
    borderColor: theme.colors.statusPending,
  },
  pendingCount: { fontSize: 28, fontWeight: "700", color: theme.colors.statusPending, marginTop: theme.spacing.s1 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.s3,
    marginTop: theme.spacing.s2,
  },
  // [2026-08-29追加・本部長] メニュータイルの絵文字を淡いブランド色の円に載せる。
  // 白いカードが9枚並ぶだけの見え方（ユーザー所感「少し色合いが無機質な感じ」）への対応。
  // 2セクションで色を変える案もあったが、色に意味があると誤読されうるため
  // （07-10章は色分けに個人の可視化という意味を与えている）、全タイル同一の淡色にした。
  // 4列にしてタイル幅が狭くなった分、ラベルは中央揃えにする
  // （「クエスト」＋「（管理）」のように改行を含む2行ラベルが、左寄せだとガタつくため）。
  tileLabel: { textAlign: "center" },
  tileEmojiCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.brandPrimarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  gridItem: {
    // [2026-08-29変更・本部長] 3列→4列（ユーザー要望「4列を試したい」）。
    // 以前4列を見送ったのは「じぶんのお手伝い」等のラベルが3列でも既に折り返して
    // いたためだが、その後ラベルを短くした（「じぶんの」を外し、管理側は
    // 「（管理）」を明示的に改行）ので4列でも読める見込みが立った。
    // 4枚 × 22% = 88%、残り12%を3つの隙間（gap: s3）が使う。
    width: "22%",
    minHeight: theme.tapTarget.parent + 20,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.s1,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentLg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    paddingVertical: theme.spacing.s3,
  },
});
