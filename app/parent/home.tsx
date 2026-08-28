import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import GachaHomeWidget from "@/components/GachaHomeWidget";
import MemberAvatar from "@/components/MemberAvatar";
import MyPointsCard from "@/components/MyPointsCard";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
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
  const myShortcuts: { emoji: string; label: string; path: string }[] = [
    { emoji: "🧹", label: "じぶんのお手伝い", path: "/parent/my-chores" },
    { emoji: "🎁", label: "じぶんのごほうび", path: "/parent/my-rewards" },
    { emoji: "💌", label: "感謝ポイント", path: "/parent/gratitude" },
    { emoji: "🎨", label: "お絵かき", path: "/parent/drawing" },
    // [2026-08-27追加・第5段階（最終段階）] コレクター棚（07-13-3章、画面一覧・
    // 遷移図.md「P7ホームのメニュー『コレクター棚』──▶P31」）。
  ];

  const familyShortcuts: { emoji: string; label: string; path: string }[] = [
    { emoji: "📋", label: "完了報告", path: "/parent/approvals" },
    { emoji: "📅", label: "きろく", path: "/parent/history" },
    { emoji: "🧺", label: "お手伝い", path: "/parent/chores" },
    // 「じぶんのごほうび」と🎁が重複していたため、管理側を🏆に変更した。
    { emoji: "🏆", label: "ごほうび", path: "/parent/rewards" },
    // [2026-08-29移動・本部長] 通帳とコレクター棚を「私の管理」から移した。
    // 通帳（P16）はメンバー切り替えを持ち家族の誰の記録も見られる画面であり、
    // コレクター棚（07-13-3章）は家族共有・永久保管の棚なので、どちらも
    // 「自分だけのもの」ではなかった。ホーム上部の「じぶんのポイント」カードが
    // 既に通帳への近道になっている点も踏まえた。
    { emoji: "📔", label: "通帳", path: "/parent/points" },
    { emoji: "🗄️", label: "コレクター棚", path: "/parent/collector-shelf" },
    // [2026-08-29統合] 旧「家族」タイルと「設定」タイルを1つにまとめた（統合先はP14）。
    { emoji: "⚙️", label: "設定", path: "/parent/family" },
  ];
  if (hasAnySupporter) {
    // ラベルが1行に収まらず折り返していたため短縮した（遷移先は変更なし）。
    familyShortcuts.push({ emoji: "👀", label: "みまもりの記録", path: "/parent/supporter-chores" });
  }

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>{state.family.name} の ホーム</Text>

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
              <Text style={{ color: theme.colors.neutralTextSecondary }}>
                +{c.points}pt
              </Text>
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
            <Text style={theme.typography.parentBody}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>かぞくの管理</Text>
      <View style={styles.grid}>
        {familyShortcuts.map((s) => (
          <Pressable key={s.path} onPress={() => router.push(s.path as never)} style={styles.gridItem}>
            <View style={styles.tileEmojiCircle}>
              <Text style={{ fontSize: 26 }}>{s.emoji}</Text>
            </View>
            <Text style={theme.typography.parentBody}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  tileEmojiCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.brandPrimarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  gridItem: {
    width: "30%",
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
