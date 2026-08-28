import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import GachaHomeWidget from "@/components/GachaHomeWidget";
import MemberAvatar from "@/components/MemberAvatar";
import MyPointsCard from "@/components/MyPointsCard";
import { ErrorState } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useGachaProgress } from "@/hooks/useGacha";
import { useFamilyHomeCard } from "@/hooks/useFamilyBoard";

/**
 * S1 みまもりホーム
 * 参照: 画面一覧・遷移図.md 2.5節S1・3.12節
 *
 * 家族の様子を一目で把握し、主要導線に飛ぶ。お手伝い管理・ポイント直接操作・
 * ごほうび管理（家族共有分）・家族管理の導線は一切表示しない（07-7章「できないこと」）。
 *
 * [2026-08-23改訂] 要件定義書07-7章4回目のスコープ変更（ユーザーの要望「いっしょに
 * やるというのはいらない」）により、家族共有choreへの参加機能（「いっしょにやる」
 * 導線）を撤去した。あわせて🤝／🎯バッジ（デザイントークン.md旧1.7節）も廃止した
 * ため、最近のようすの表示からバッジを外した。
 */
export default function SupporterHomeScreen() {
  const { state, memberPoints } = useAppData();
  // [2026-08-26追加・第3段階] ガチャ「あと◯回」ウィジェット（07-13-1章、主要画面
  // ワイヤーフレーム.md 21.1節「S1みまもりホーム内。ホーム上部、既存のショートカット
  // グリッドとは別枠で配置。演出は控えめ」）。
  const { loadState: gachaLoadState, remaining: gachaRemaining, canDrawNow: gachaCanDrawNow } =
    useGachaProgress(state.activeParentMemberId);
  // [2026-08-28追加・家族の書き込みボード07-14章第1段階、主要画面ワイヤーフレーム.md
  // 22.1.3節・決定4] S1には元々「今週のできごと」相当のカードが無かった
  // （週次まとめメッセージの概念自体がS1には存在しない、画面一覧・遷移図.md S1行
  // 「今回は対象外とする」）。`family_home_card` Viewは他画面と同じ優先順位ロジックで
  // 1行を返すが、**S1はその中の`source==='board_post'`の場合のみを採用し、
  // `'weekly_digest'`（＝書き込みが無くまとめメッセージへフォールバックした状態）は
  // 「フォールバック先が存在しない」ため空状態として扱う**（本部長指示E「みまもり
  // ホームには元々まとめメッセージが無いので、書き込みが無いときのフォールバック先が
  // 存在しません」への対応。P7/C5は同じViewの`source==='weekly_digest'`をそのまま
  // 表示するが、S1だけはここで明示的に握りつぶす）。
  const { loadState: cardLoadState, card, reload: reloadCard } = useFamilyHomeCard(state.family.id);
  const hasBoardPost = card?.source === "board_post";
  const cardAuthorName = hasBoardPost
    ? state.members.find((m) => m.id === card.board_post_author_member_id)?.display_name ?? null
    : null;
  const cardTime =
    hasBoardPost && card.board_post_created_at
      ? new Date(card.board_post_created_at).toLocaleString("ja-JP", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const recent = [...state.completions]
    .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime())
    .slice(0, 3);
  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  // [2026-08-27追加・本部長] 自分の現在ポイント（P7保護者ホームと同じ。MyPointsCard参照）。
  // みまもりメンバーには通帳画面が無いため、ここでは表示専用（onPress無し）にしている。
  const myPoints =
    memberPoints.find((m) => m.member_id === state.activeParentMemberId)?.current_points ?? 0;

  const shortcuts: { emoji: string; label: string; path: string }[] = [
    { emoji: "👀", label: "かぞくのようす", path: "/supporter/activity" },
    { emoji: "🎯", label: "じぶんのお手伝い", path: "/supporter/my-chores" },
    { emoji: "🎁", label: "じぶんのごほうび", path: "/supporter/rewards" },
    { emoji: "📅", label: "きろく", path: "/supporter/history" },
    // [2026-08-23追加] 家族の木（07-9章、主要画面ワイヤーフレーム.md 20.6章
    // 「S1みまもりホーム内（既存のショートカットグリッドに1枠追加）」）。→S14。
    { emoji: "🌿", label: "家族の木", path: "/supporter/family-tree" },
    // [2026-08-26追加] お絵かき（07-13-2章、第2段階）。画面一覧・遷移図.md 3.15節
    // 「みまもりメンバー: [S1 みまもりホーム]のショートカット『お絵かき』 ──▶ [S18 お絵かき]」。
    { emoji: "🎨", label: "お絵かき", path: "/supporter/drawing" },
    // [2026-08-27追加・第5段階（最終段階）] コレクター棚（07-13-3章、画面一覧・
    // 遷移図.md「S1みまもりホームのショートカット『コレクター棚』──▶S19」）。
    { emoji: "🗄️", label: "コレクター棚", path: "/supporter/collector-shelf" },
    { emoji: "⚙️", label: "設定", path: "/supporter/settings" },
  ];

  return (
    <Screen tone="supporter">
      <Text style={theme.typography.supporterTitle}>{state.family.name} の みまもり</Text>

      <MyPointsCard tone="supporter" points={myPoints} />

      <GachaHomeWidget
        tone="supporter"
        loadState={gachaLoadState}
        remaining={gachaRemaining}
        canDrawNow={gachaCanDrawNow}
        onPress={() => router.push("/supporter/gacha")}
      />

      {/* [2026-08-28追加] 「家族の書き込み」カード（主要画面ワイヤーフレーム.md
          22.1.3節・決定4）。書き込みが無い場合は空状態文言のみ（まとめメッセージへの
          フォールバックは無い、上のコメント参照）。通信エラー時のみ専用の再試行ボタンを
          カード内に表示する（22.1.3節状態一覧「通信エラー」行）。 */}
      {cardLoadState === "error" ? (
        <Card tone="supporter" style={{ marginTop: theme.spacing.s4 }}>
          <Text style={theme.typography.supporterBodyMedium}>家族の書き込み</Text>
          <ErrorState title="読み込みに失敗しました" onRetry={reloadCard} />
        </Card>
      ) : (
        <Pressable onPress={() => router.push("/supporter/family-board")}>
          <Card tone="supporter" style={{ marginTop: theme.spacing.s4 }}>
            <View style={styles.cardHeaderRow}>
              <Text style={theme.typography.supporterBodyMedium}>家族の書き込み</Text>
              <Text style={theme.typography.supporterBodyMedium}>›</Text>
            </View>
            {cardLoadState === "loading" ? (
              <View style={styles.digestSkeleton} />
            ) : hasBoardPost ? (
              <>
                {cardAuthorName !== null && (
                  <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s2 }]}>{cardAuthorName}</Text>
                )}
                <Text style={{ marginTop: theme.spacing.s1 }}>{card.message}</Text>
                {cardTime !== null && (
                  <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
                    {cardTime}
                  </Text>
                )}
              </>
            ) : (
              <Text style={{ marginTop: theme.spacing.s2 }}>
                まだ書き込みはありません。家族のようすを、ひとことシェアしてみませんか
              </Text>
            )}
          </Card>
        </Pressable>
      )}

      <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s6 }]}>最近のようす</Text>
      <View style={{ gap: theme.spacing.s2, marginTop: theme.spacing.s2 }}>
        {recent.length === 0 && (
          <Text style={[theme.typography.supporterBody, { color: theme.colors.neutralTextSecondary }]}>
            まだ完了報告がありません
          </Text>
        )}
        {recent.map((c) => {
          const member = memberOf(c.reported_by);
          return (
            <Pressable key={c.id} onPress={() => router.push("/supporter/activity")}>
              <Card tone="supporter" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                  <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={24} />
                  <Text style={{ marginLeft: theme.spacing.s2 }}>
                    {member?.display_name} {c.chore_emoji} {c.chore_title}
                  </Text>
                </View>
                <Text style={{ color: theme.colors.neutralTextSecondary }}>+{c.points}pt</Text>
              </Card>
            </Pressable>
          );
        })}
      </View>

      <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s6 }]}>メニュー</Text>
      <View style={styles.grid}>
        {shortcuts.map((s) => (
          <Pressable key={s.path} onPress={() => router.push(s.path as never)} style={styles.gridItem}>
            <Text style={{ fontSize: 28 }}>{s.emoji}</Text>
            <Text style={theme.typography.supporterBody}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  digestSkeleton: {
    marginTop: theme.spacing.s2,
    height: 18,
    borderRadius: theme.radius.parentMd,
    backgroundColor: theme.colors.neutralBorder,
    opacity: 0.6,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.s3,
    marginTop: theme.spacing.s2,
  },
  gridItem: {
    width: "30%",
    minHeight: theme.tapTarget.supporterPrimary + 20,
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
