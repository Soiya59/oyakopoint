import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import { EmptyState } from "@/components/StatusViews";
import ChoreSuggestionsModal from "@/components/ChoreSuggestionsModal";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import type { Chore } from "@/types/domain";

/**
 * P10 お手伝い管理一覧（スタブ／簡易実装）
 * 参照: 画面一覧・遷移図.md P10、API仕様.md 3章
 *
 * [2026-08-27追加・本部長] 実施済みの「単発」を通常一覧から折りたたみセクションへ移した。
 * ユーザーの指摘「単発が同じ感じで残り続けるので見にくい」への対応。
 * 単発のchoreには「終わり」という状態が無く、実施後も is_active=true のまま繰り返し系と
 * 同じ見た目で並び続けていた（本番でも単発4件すべてが完了済みのまま、最長12日間残っていた）。
 * 判定は src/data/store.tsx の isOneOffFinished に集約し、子どもホームと同じ基準を使う。
 * DBは変更していないので、記録を消さない限りこの状態が勝手に戻ることはない。
 */
export default function ChoresListScreen() {
  const { state, isOneOffFinished } = useAppData();
  const [finishedOpen, setFinishedOpen] = useState(false);
  // [2026-09-02追加] クエストのおすすめ集（要件定義書07-16章、主要画面ワイヤーフレーム.md
  // 27.1・27.2節）。P10の空状態限定で開くモーダル。選択するとP11へプレフィル遷移する
  // だけで、モーダル側にDB書き込みは一切発生しない。
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);

  // [2026-08-29修正・本部長／軽微変更ルート] 家族共有（scope='family'）のみを対象にする。
  //
  // 本画面は2026-08-15時点、まだ「自分専用」という概念が無かった頃に作られており、
  // 8/22にみまもりメンバーと `scope='personal'` を追加した際にここを見直していなかった。
  // その結果、**保護者が編集も削除もできないもの（みまもりメンバーの自分専用クエスト）が
  // 管理一覧に並んでいた**。ユーザーが「jijiを消しても消えない」と実機で発見した件の
  // 根本原因がこれで、RLS（chores_write_personal_by_creator＝作成者本人のみ）は正しく、
  // 一覧側が管理できないものまで見せていたのが誤りだった。
  //
  // みまもりメンバーの登録内容は専用画面「👀 みまもりの記録」（P25）で引き続き見られるため、
  // ここから外しても情報は失われない。役割を「管理するもの＝ここ／見るもの＝P25」に分ける。
  const managed = state.chores.filter((c) => c.scope === "family");
  // [2026-09-02追加・統括指示] みまもりメンバーのクエストへの導線をこの画面に置く。
  // 従来は保護者ホームに「みまもりの記録」タイルとして独立していたが、統括の指摘
  // 「見守りの記録は見守りのクエストの内容だから、（名前が）あっていない」のとおり、
  // 中身は記録ではなくクエスト一覧である。クエストの話はクエスト管理に集める。
  // 表示条件は従来のタイルと同じ（画面一覧・遷移図.md P25「家族にみまもりメンバーが
  // 1人もいない場合は導線自体を表示しない」）。
  const hasAnySupporter = state.members.some((m) => m.role === "supporter" && m.is_active);
  const active = managed.filter((c) => !isOneOffFinished(c));
  const finished = managed.filter((c) => isOneOffFinished(c));

  // [2026-08-30追加] 要件定義書07-15章・主要画面ワイヤーフレーム.md 24章（決定1・
  // 決定2・決定5）。「終わった単発のクエスト」折りたたみは対象にせず、有効な
  // クエスト（active）のみを「わたしが登録」「かぞくが登録」の2グループに分ける
  // （先に有効/終了で分け、有効な行だけをわたし/かぞくで分ける＝決定5）。
  // 判定は created_by === 自分のfamily_member_id のみ（役割・人数に依存しない、
  // 07-15章前提5）。登録者不明（created_by===null）・他の保護者の行は「かぞくが登録」
  // 側に混ぜる（07-15章4章）。一覧の各行には登録者を示す表示を一切追加しない（決定1）。
  const myMemberId = state.activeParentMemberId;
  const mine = active.filter((c) => c.created_by === myMemberId);
  const others = active.filter((c) => c.created_by !== myMemberId);

  const renderRow = (c: Chore, dimmed: boolean) => (
    <Pressable key={c.id} onPress={() => router.push({ pathname: "/parent/chore-edit", params: { id: c.id } })}>
      <Card
        style={{
          marginTop: theme.spacing.s3,
          flexDirection: "row",
          justifyContent: "space-between",
          ...(dimmed ? { opacity: 0.6 } : null),
        }}
      >
        <Text>
          {c.emoji} {c.title}
        </Text>
        <Text style={{ color: theme.colors.neutralTextSecondary }}>
          {c.points}pt {c.is_repeatable ? `・1日${c.daily_limit ?? "∞"}回` : dimmed ? "・単発（済）" : "・単発"}
        </Text>
      </Card>
    </Pressable>
  );

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/home")} />
      <View style={styles.header}>
        <Text style={theme.typography.parentTitle}>クエスト管理</Text>
        <AppButton label="＋ 新規追加" variant="secondary" onPress={() => router.push("/parent/chore-edit")} />
      </View>

      {/* [2026-09-02追加・本部長] クエストが0件のとき何も表示されない状態だった
          （主要画面ワイヤーフレーム.md 24章が定めていた空状態が未実装。2026-09-01の
          文書照合で発見）。統括判断「商用化の時に何かしらあったほうが良い」により実装。
          新規の家族は必ず0件から始まるため、最初に開いた画面が無言だと次の一歩が
          分からない（実装メモ110章）。 */}
      {mine.length === 0 && others.length === 0 && finished.length === 0 && (
        <>
          <EmptyState emoji="📝" title="まだクエストが登録されていません。「＋ 新規追加」から最初のクエストを作ってみましょう" />
          {/* [2026-09-02追加] 要件定義書07-16章7.「クエストが1件でもある状態では表示しない」。
              主要画面ワイヤーフレーム.md 27.1節どおり、EmptyState（変更なし）の直下に
              セカンダリボタンとして追加する。 */}
          <Text style={[theme.typography.parentBody, styles.suggestionsIntro]}>
            迷ったら、おすすめから選んでみませんか？
          </Text>
          <AppButton
            label="🔍 おすすめを見る"
            variant="secondary"
            onPress={() => setSuggestionsVisible(true)}
          />
        </>
      )}

      <ChoreSuggestionsModal
        visible={suggestionsVisible}
        onClose={() => setSuggestionsVisible(false)}
        onSelect={(s) => {
          setSuggestionsVisible(false);
          router.push({ pathname: "/parent/chore-edit", params: { recId: s.id } });
        }}
      />

      {mine.length > 0 && (
        <View>
          <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>わたしが登録</Text>
          {mine.map((c) => renderRow(c, false))}
        </View>
      )}

      {others.length > 0 && (
        <View>
          <Text style={[theme.typography.parentBodyMedium, styles.sectionHeading]}>かぞくが登録</Text>
          {others.map((c) => renderRow(c, false))}
        </View>
      )}

      {finished.length > 0 && (
        <View style={{ marginTop: theme.spacing.s6 }}>
          {/* 折りたたみ。既定は閉じておき、必要なときだけ開いて内容を確認・編集できるようにする。 */}
          <Pressable onPress={() => setFinishedOpen((v) => !v)} style={styles.finishedToggle} hitSlop={8}>
            <Text style={theme.typography.parentBodyMedium}>
              {finishedOpen ? "▾" : "▸"} 終わった単発のクエスト（{finished.length}）
            </Text>
          </Pressable>
          {!finishedOpen && (
            <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1 }]}>
              一度実施されたので、子どもの画面にも表示されなくなっています。
            </Text>
          )}
          {finishedOpen && finished.map((c) => renderRow(c, true))}
        </View>
      )}

      {/* [2026-09-02追加・統括指示] みまもりメンバーのクエスト一覧（P25）への導線。
          保護者ホームの「みまもりの記録」タイルをここへ移した。中身は記録ではなく
          クエスト一覧なので、クエストの話はこの画面に集める。 */}
      {hasAnySupporter && (
        <Pressable
          onPress={() => router.push("/parent/supporter-chores")}
          style={{ marginTop: theme.spacing.s6 }}
          hitSlop={8}
        >
          <Card>
            <Text style={theme.typography.parentBodyMedium}>👀 みまもりのクエスト →</Text>
            <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1 }]}>
              みまもりメンバーが自分用に登録しているクエストを見られます。
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
  finishedToggle: { paddingVertical: theme.spacing.s2 },
  // [2026-09-02追加] 主要画面ワイヤーフレーム.md 27.1節。既存EmptyStateの主役を保ち、
  // おすすめ導線は補助的な位置づけ（27.4節トーン設計メモ）にとどめる。
  suggestionsIntro: {
    marginTop: theme.spacing.s4,
    marginBottom: theme.spacing.s2,
    textAlign: "center",
    color: theme.colors.neutralTextSecondary,
  },
  // [2026-08-30追加] 主要画面ワイヤーフレーム.md 24.0節決定3。app/parent/home.tsxの
  // sectionHeadingと同じスタイルを流用する（新規トークンを増やさない）。
  sectionHeading: {
    marginTop: theme.spacing.s6,
    marginBottom: theme.spacing.s2,
    color: theme.colors.brandPrimaryStrong,
  },
});
