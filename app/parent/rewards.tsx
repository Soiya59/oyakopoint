import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import { EmptyState } from "@/components/StatusViews";
import RewardSuggestionsModal from "@/components/RewardSuggestionsModal";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * P12 ごほうび管理一覧（スタブ／簡易実装）
 * 参照: 画面一覧・遷移図.md P12、API仕様.md 7章
 *
 * [2026-09-06追加・本部長／主要画面ワイヤーフレーム.md 31.0節決定2] 24.1節が定める
 * 空状態（`EmptyState`）が実装されておらず、0件時は見出しと「＋新規追加」ボタンだけが
 * 残っていた（app/parent/chores.tsxは2026-09-02の27章対応時に実装済みだったが、
 * P12側は着手されないまま残っていた文書と実装のズレ）。本節でP10と同じ形で実装し、
 * その直下にごほうびのおすすめ集（31章）への導線を追加する。
 */
export default function RewardsListScreen() {
  const { state } = useAppData();
  // [2026-09-06追加] ごほうびのおすすめ集（主要画面ワイヤーフレーム.md 31.1・31.2節）。
  // P12の空状態限定で開くモーダル。選択するとP13へプレフィル遷移するだけで、
  // モーダル側にDB書き込みは一切発生しない（クエスト版と同型、app/parent/chores.tsx参照）。
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);

  // [2026-09-03追加] 保護者代理でのごほうび交換（P36）成功後の完了スナックバー
  // （主要画面ワイヤーフレーム.md 5.5.0節決定5・5.5.4節）。app/parent/my-rewards.tsx
  // （P15）のjustRewardId/justName/justCostと同じ仕組みに、交換対象の子の表示名
  // （justChildName）を足しただけ。完了演出画面（C11相当）は新設しない。
  const params = useLocalSearchParams<{ justRewardId?: string; justChildName?: string; justCost?: string }>();
  const [snackbarText, setSnackbarText] = useState<string | null>(null);

  useEffect(() => {
    if (params.justRewardId && params.justChildName && params.justCost) {
      setSnackbarText(`${params.justChildName}さんの代わりに交換しました -${params.justCost}pt`);
      const t = setTimeout(() => setSnackbarText(null), 1500);
      return () => clearTimeout(t);
    }
  }, [params.justRewardId, params.justChildName, params.justCost]);

  // [2026-08-29修正・本部長] 家族共有（scope='family'）のみ。理由は
  // app/parent/chores.tsx の同じ修正のコメントを参照（みまもりメンバーの自分専用の
  // ごほうびは保護者が編集・削除できないのに一覧へ出ていた）。
  const managed = state.rewards.filter((r) => r.scope === "family");
  // [2026-09-02追加・統括指示] みまもりメンバーのごほうびへの導線。統括の指摘
  // 「クエストは見守りのクエストに飛べるけど、ご褒美は飛べない」。P25画面は
  // クエストとごほうびの両方を出すのに、入口がクエスト管理（P10）にしか
  // なかった（2026-09-02、本部長がP10側だけに導線を付けたため）。
  // 表示条件はP10側と同じ（みまもりメンバーがいる家庭のみ）。
  const hasAnySupporter = state.members.some((m) => m.role === "supporter" && m.is_active);

  // [2026-08-30追加] 要件定義書07-15章・主要画面ワイヤーフレーム.md 24章（決定1・
  // 決定2）。「わたしが登録」「かぞくが登録」の2グループに分ける。判定は
  // created_by === 自分のfamily_member_id のみ（役割・人数に依存しない、07-15章前提5）。
  // 登録者不明・他の保護者の行は「かぞくが登録」側に混ぜる（07-15章4章）。
  // 一覧の各行には登録者を示す表示を一切追加しない（決定1）。P12には
  // 「終わった単発」相当の折りたたみが存在しないため決定5は適用されない。
  const myMemberId = state.activeParentMemberId;
  const mine = managed.filter((r) => r.created_by === myMemberId);
  const others = managed.filter((r) => r.created_by !== myMemberId);

  const renderRow = (r: (typeof managed)[number]) => (
    <Pressable key={r.id} onPress={() => router.push({ pathname: "/parent/reward-edit", params: { id: r.id } })}>
      <Card style={{ marginTop: theme.spacing.s3, flexDirection: "row", justifyContent: "space-between" }}>
        <Text>
          {r.emoji} {r.name}
        </Text>
        <Text style={{ color: theme.colors.neutralTextSecondary }}>{r.cost}pt</Text>
      </Card>
    </Pressable>
  );

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/home")} />
      <View style={styles.header}>
        <Text style={theme.typography.parentTitle}>ごほうび管理</Text>
        <AppButton label="＋ 新規追加" variant="secondary" onPress={() => router.push("/parent/reward-edit")} />
      </View>

      {snackbarText && (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText}>{snackbarText}</Text>
        </View>
      )}

      {/* [2026-09-06追加・本部長／主要画面ワイヤーフレーム.md 31.0節決定2・24.1節]
          ごほうびが0件のとき何も表示されない状態だった（P10側は2026-09-02に実装済み）。
          既存文言「まだごほうびが登録されていません」はそのまま変更しない（決定2）。 */}
      {/* [2026-09-07改訂・統括指示／実装メモ146章] 従来は「ごほうびが1件でもある状態
          では表示しない」（31.1節・要件定義書07-16章7.相当）に従い空状態限定だったが、
          この方針は本件で統括判断により変更された（該当記述はこの変更で古くなった。
          文書更新は企画部に依頼中）。0件時の見せ方自体は変更しない。 */}
      {mine.length === 0 && others.length === 0 && (
        <>
          <EmptyState emoji="🎁" title="まだごほうびが登録されていません。「＋ 新規追加」から最初のごほうびを作ってみましょう" />
          {/* [2026-09-06追加] 主要画面ワイヤーフレーム.md 31.1節。EmptyState（変更なし）の
              直下にセカンダリボタンとして追加する。 */}
          <Text style={[theme.typography.parentBody, styles.suggestionsIntro]}>
            迷ったら、おすすめから選んでみませんか？
          </Text>
          <AppButton
            label="🎁 おすすめを見る"
            variant="secondary"
            onPress={() => setSuggestionsVisible(true)}
          />
        </>
      )}

      <RewardSuggestionsModal
        visible={suggestionsVisible}
        onClose={() => setSuggestionsVisible(false)}
        onSelect={(s) => {
          setSuggestionsVisible(false);
          router.push({ pathname: "/parent/reward-edit", params: { recId: s.id } });
        }}
      />

      {mine.length > 0 && (
        <View>
          <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>わたしが登録</Text>
          {mine.map(renderRow)}
        </View>
      )}

      {others.length > 0 && (
        <View>
          <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>かぞくが登録</Text>
          {others.map(renderRow)}
        </View>
      )}

      {/* [2026-09-07追加・統括指示／実装メモ146章] ごほうびが1件以上ある状態でも
          おすすめ集への導線を表示する（従来は空状態限定。31.1節・要件定義書07-16章7.
          相当の記述はこの変更で古くなった）。案内文は0件時の専用の言い回しのため省き、
          ボタンのみを一覧の下・控えめなセカンダリボタンとして置く（主役は既存の一覧と
          「＋新規追加」のまま、31.5節トーン設計メモに準じる）。 */}
      {!(mine.length === 0 && others.length === 0) && (
        <AppButton
          label="🎁 おすすめを見る"
          variant="secondary"
          style={{ marginTop: theme.spacing.s6 }}
          onPress={() => setSuggestionsVisible(true)}
        />
      )}

      {hasAnySupporter && (
        <Pressable
          onPress={() => router.push("/parent/supporter-chores")}
          style={{ marginTop: theme.spacing.s6 }}
          hitSlop={8}
        >
          <Card>
            <Text style={theme.typography.parentBodyMedium}>🎁 みまもりのごほうび →</Text>
            <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1 }]}>
              みまもりメンバーが登録しているごほうびを見られます。
            </Text>
          </Card>
        </Pressable>
      )}


      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/parent/home")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  // [2026-08-30追加] app/parent/chores.tsxと同じスタイル（主要画面ワイヤーフレーム.md
  // 24.0節決定3、app/parent/home.tsxのsectionHeading流用）。
  sectionHeading: {
    marginTop: theme.spacing.s6,
    marginBottom: theme.spacing.s2,
    color: theme.colors.brandPrimaryStrong,
  },
  // [2026-09-06追加] 主要画面ワイヤーフレーム.md 31.1節。app/parent/chores.tsxの
  // suggestionsIntroと同じスタイル（既存EmptyStateの主役を保ち、おすすめ導線は
  // 補助的な位置づけにとどめる、31.5節トーン設計メモ）。
  suggestionsIntro: {
    marginTop: theme.spacing.s4,
    marginBottom: theme.spacing.s2,
    textAlign: "center",
    color: theme.colors.neutralTextSecondary,
  },
  // [2026-09-03追加] app/parent/my-rewards.tsxのスナックバーと同型。
  snackbar: {
    marginTop: theme.spacing.s3,
    backgroundColor: theme.colors.neutralTextPrimary,
    borderRadius: theme.radius.parentMd,
    paddingVertical: theme.spacing.s3,
    paddingHorizontal: theme.spacing.s4,
    alignItems: "center",
  },
  snackbarText: { color: "#FFFFFF", fontWeight: "600" },
});
