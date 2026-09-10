import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import { EmptyState } from "@/components/StatusViews";
import RewardSuggestionsModal from "@/components/RewardSuggestionsModal";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { groupDuplicateRows, resolveAssigneeLabel } from "@/lib/groupDuplicateRows";

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
  // [2026-09-11削除・要件定義書07-26章決定5／主要画面ワイヤーフレーム.md 39.0節]
  // 「かぞくが登録」の折りたたみ（othersOpen、07-20章決定2）は役目を終えた。
  // 「わたしが登録／かぞくが登録」という区分自体が無くなったため（07-26章決定1）、
  // 開閉する対象がそもそも存在しない。
  // [2026-09-11追加・要件定義書07-24章／主要画面ワイヤーフレーム.md 38章] 「同じ内容」
  // まとめ(c)の開閉状態。app/parent/chores.tsxと同じ仕組み（画面固有useState・
  // 永続化しない）。キーは「区分名:グルーピングキー」。
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  // [2026-08-29修正・本部長] 家族共有（scope='family'）のみ。理由は
  // app/parent/chores.tsx の同じ修正のコメントを参照（みまもりメンバーの自分専用の
  // ごほうびは保護者が編集・削除できないのに一覧へ出ていた）。
  const managed = state.rewards.filter((r) => r.scope === "family");
  // [2026-09-02追加・統括指示] みまもりメンバーのごほうびへの導線。統括の指摘
  // 「クエストは見守りのクエストに飛べるけど、ご褒美は飛べない」。P25画面は
  // クエストとごほうびの両方を出すのに、入口がクエスト管理（P10）にしか
  // なかった（2026-09-02、本部長がP10側だけに導線を付けたため）。
  // 表示条件はP10側と同じ（みまもりメンバーがいる家庭のみ）。

  // [2026-09-11削除・要件定義書07-26章決定1／主要画面ワイヤーフレーム.md 39.1.1節]
  // 「わたしが登録」「かぞくが登録」の2グループへの分割（mine/others）は廃止した。
  // managedをそのまま単一配列として描画する（P12は「終わった単発」相当の区分を
  // 持たないため、区分の廃止によりP12は完全に区分を持たない単一リストになる、
  // 07-26章決定6）。
  const myMemberId = state.activeParentMemberId;

  // [2026-09-11追加・要件定義書07-26章決定3／主要画面ワイヤーフレーム.md 39.1.2節]
  // 登録者の行内表示（左側テキストの末尾に「・登録:◯◯」）。app/parent/chores.tsxと
  // 全く同じロジック。グループ見出し(c)には出さない（決定5）ため、renderRowにのみ
  // 実装する。
  const resolveRegistrantSuffix = (r: (typeof managed)[number]): string => {
    if (r.created_by === myMemberId) return "";
    const label = r.creator?.display_name ?? "記録なし";
    return `・登録:${label}`;
  };

  // [2026-09-11改訂・要件定義書07-24章決定2／主要画面ワイヤーフレーム.md 38.5節決定4]
  // 担当者名を既存の右側テキスト（{cost}pt）の末尾に「・」区切りで追記する。
  // まとめられていない単独の行にも常に表示する（indentはfalseのまま）。
  // indent=trueは(c)を開いたときの内訳行専用（38.5節決定6、marginLeft: s3で一段字下げ）。
  const renderRow = (r: (typeof managed)[number], indent = false) => {
    const assigneeLabel = resolveAssigneeLabel(r.assigned_to, state.members, "誰でも交換可");
    return (
      <Pressable key={r.id} onPress={() => router.push({ pathname: "/parent/reward-edit", params: { id: r.id } })}>
        <Card
          style={{
            marginTop: theme.spacing.s3,
            flexDirection: "row",
            justifyContent: "space-between",
            ...(indent ? { marginLeft: theme.spacing.s3 } : null),
          }}
        >
          <Text>
            {r.emoji} {r.name}
            {resolveRegistrantSuffix(r)}
          </Text>
          <Text style={{ color: theme.colors.neutralTextSecondary }}>
            {r.cost}pt{assigneeLabel ? `・${assigneeLabel}` : ""}
          </Text>
        </Card>
      </Pressable>
    );
  };

  // [2026-09-11追加・要件定義書07-24章／主要画面ワイヤーフレーム.md 38.3節・38.4節
  // （39.1.3節がP12向けに上書き）] 「同じ内容」まとめ(c)。区分自体を持たないため、
  // sectionKeyは全件を表す固定文字列を渡す。グルーピング判定は名前・ポイントの
  // 完全一致（07-24章決定1）。
  const renderSection = (items: typeof managed, sectionKey: string) => {
    const groups = groupDuplicateRows(items, (r) => `${r.name.trim()} ${r.cost}`, state.members);
    return groups.map((g) => {
      if (g.items.length < 2) {
        return renderRow(g.items[0]);
      }
      const groupKey = `${sectionKey}:${g.key}`;
      const isOpen = !!openGroups[groupKey];
      const head = g.items[0];
      return (
        <View key={groupKey}>
          <Pressable onPress={() => toggleGroup(groupKey)}>
            <Card style={{ marginTop: theme.spacing.s3, flexDirection: "row", justifyContent: "space-between" }}>
              <Text>
                {isOpen ? "▾" : "▸"} {head.emoji} {head.name}
              </Text>
              <Text style={{ color: theme.colors.neutralTextSecondary }}>
                {head.cost}pt（{g.items.length}）
              </Text>
            </Card>
          </Pressable>
          {isOpen && g.items.map((r) => renderRow(r, true))}
        </View>
      );
    });
  };

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent")} />
      <View style={styles.header}>
        <Text style={theme.typography.parentTitle}>ごほうび管理</Text>
        <AppButton label="＋ 新規追加" variant="secondary" onPress={() => router.push("/parent/reward-edit")} />
      </View>

      {/* [2026-09-07移動・統括指示／実装メモ147章] 146章で「＋新規追加」ボタンの下に常設化
          したが、一覧の一番下に置いたため、クエストやごほうびの件数が増えるほど埋もれる
          という指摘を受け、「＋新規追加」の直下（一覧より上）へ移動した。見た目・文言・
          variant="secondary"は変更していない。位置のみの変更。 */}
      {managed.length > 0 && (
        <AppButton
          label="🎁 おすすめを見る"
          variant="secondary"
          style={{ marginTop: theme.spacing.s3 }}
          onPress={() => setSuggestionsVisible(true)}
        />
      )}

      {/* [2026-09-06追加・本部長／主要画面ワイヤーフレーム.md 31.0節決定2・24.1節]
          ごほうびが0件のとき何も表示されない状態だった（P10側は2026-09-02に実装済み）。
          既存文言「まだごほうびが登録されていません」はそのまま変更しない（決定2）。 */}
      {/* [2026-09-07改訂・統括指示／実装メモ146章] 従来は「ごほうびが1件でもある状態
          では表示しない」（31.1節・要件定義書07-16章7.相当）に従い空状態限定だったが、
          この方針は本件で統括判断により変更された（該当記述はこの変更で古くなった。
          文書更新は企画部に依頼中）。0件時の見せ方自体は変更しない。 */}
      {managed.length === 0 && (
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

      {/* [2026-09-11改訂・要件定義書07-26章決定1／主要画面ワイヤーフレーム.md 39.1節]
          「わたしが登録」「かぞくが登録」の見出し・区切りを外し、1本の一覧に統合する。
          P12は「終わった単発」相当の区分を持たないため、折りたたみは(c)のみになる。 */}
      {managed.length > 0 && renderSection(managed, "managed")}

      {/* [2026-09-11削除・統括指示／実装メモ.md 191章] みまもりメンバーのクエスト・
          ごほうび一覧（P25）への導線は、かんりタブの「👀 みまもり（参考）」へ移した。
          P25はクエストとごほうびの両方を1画面で見せるため、この画面とごほうび管理の
          両方にぶら下がっており、同じ画面への入口が2つある状態だった。 */}

      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/parent")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  // [2026-09-06追加] 主要画面ワイヤーフレーム.md 31.1節。app/parent/chores.tsxの
  // suggestionsIntroと同じスタイル（既存EmptyStateの主役を保ち、おすすめ導線は
  // 補助的な位置づけにとどめる、31.5節トーン設計メモ）。
  suggestionsIntro: {
    marginTop: theme.spacing.s4,
    marginBottom: theme.spacing.s2,
    textAlign: "center",
    color: theme.colors.neutralTextSecondary,
  },
});
