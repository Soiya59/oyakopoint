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
import { groupDuplicateRows, resolveAssigneeLabel } from "@/lib/groupDuplicateRows";

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
  // [2026-09-11削除・要件定義書07-26章決定5／主要画面ワイヤーフレーム.md 39.0節]
  // 「かぞくが登録」の折りたたみ（othersOpen、07-20章決定2）はP10については役目を
  // 終えた。「わたしが登録／かぞくが登録」という区分自体が無くなったため
  // （07-26章決定1）、開閉する対象がそもそも存在しない。S5・S8側は対象外のまま
  // 変更していない（07-26章決定7）。
  // [2026-09-11追加・要件定義書07-24章／主要画面ワイヤーフレーム.md 38章] 「同じ内容」
  // まとめ(c)の開閉状態。既存の「終わった単発のクエスト」と同じく画面固有の
  // useStateで持ち、永続化しない（画面遷移のたびにリセットしてよい、07-24章「対象外」）。
  // キーは「区分名:グルーピングキー」（例: "active:はみがき 1"）とし、(a)の開閉状態
  // （finishedOpen）とは独立に管理する（38.4節「入れ子構造」）。
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (key: string) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
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
  const active = managed.filter((c) => !isOneOffFinished(c));
  const finished = managed.filter((c) => isOneOffFinished(c));

  // [2026-09-11削除・要件定義書07-26章決定1／主要画面ワイヤーフレーム.md 39.1.1節]
  // 「わたしが登録」「かぞくが登録」の2グループへの分割（mine/others）は廃止した。
  // activeをそのまま単一配列として描画する。並び順は変更しない（取得元クエリが
  // 既に.order("created_at")のため、区分の分割をやめれば自然に古い順の1本に戻る、
  // 07-26章決定4）。
  const myMemberId = state.activeParentMemberId;

  // [2026-09-11追加・要件定義書07-26章決定3／主要画面ワイヤーフレーム.md 39.1.2節]
  // 登録者の行内表示（左側テキストの末尾に「・登録:◯◯」）。自分の場合は省略、
  // 自分以外の特定メンバーはその表示名、不明（created_by IS NULL）は「記録なし」。
  // グループ見出し(c)には出さない（決定5）ため、renderRowにのみ実装する。
  const resolveRegistrantSuffix = (c: Chore): string => {
    if (c.created_by === myMemberId) return "";
    const label = c.creator?.display_name ?? "記録なし";
    return `・登録:${label}`;
  };

  // [2026-09-11改訂・要件定義書07-24章決定2／主要画面ワイヤーフレーム.md 38.5節決定4]
  // 担当者名を、既存の右側テキスト（「・単発」「・1日◯回」等）の末尾に「・」区切りで
  // 追記する。まとめられていない単独の行にも常に表示する（indentはfalseのまま）。
  // indent=trueは(c)を開いたときの内訳行専用（38.5節決定6、marginLeft: s3で一段字下げ）。
  const renderRow = (c: Chore, dimmed: boolean, indent = false) => {
    const assigneeLabel = resolveAssigneeLabel(c.assigned_to, state.members, "誰でも実行可");
    return (
      <Pressable key={c.id} onPress={() => router.push({ pathname: "/parent/chore-edit", params: { id: c.id } })}>
        <Card
          style={{
            marginTop: theme.spacing.s3,
            flexDirection: "row",
            justifyContent: "space-between",
            ...(indent ? { marginLeft: theme.spacing.s3 } : null),
            ...(dimmed ? { opacity: 0.6 } : null),
          }}
        >
          <Text>
            {c.emoji} {c.title}
            {resolveRegistrantSuffix(c)}
          </Text>
          <Text style={{ color: theme.colors.neutralTextSecondary }}>
            {c.points}pt {c.is_repeatable ? `・1日${c.daily_limit ?? "∞"}回` : dimmed ? "・単発（済）" : "・単発"}
            {assigneeLabel ? `・${assigneeLabel}` : ""}
          </Text>
        </Card>
      </Pressable>
    );
  };

  // [2026-09-11追加・要件定義書07-24章／主要画面ワイヤーフレーム.md 38.3節・38.4節
  // （39.1.3節がP10向けに上書き）] 「同じ内容」まとめ(c)。sectionKeyは「実施中の
  // 全件（active）」「終わった単発のクエスト（finished）」いずれかの区分名で、
  // 区分の内側だけでグルーピングする（区分をまたがない、38.2節）。グルーピング判定は
  // 名前・ポイントの完全一致（07-24章決定1）。
  const renderSection = (items: Chore[], dimmed: boolean, sectionKey: string) => {
    const groups = groupDuplicateRows(items, (c) => `${c.title.trim()} ${c.points}`, state.members);
    return groups.map((g) => {
      if (g.items.length < 2) {
        return renderRow(g.items[0], dimmed);
      }
      const groupKey = `${sectionKey}:${g.key}`;
      const isOpen = !!openGroups[groupKey];
      const head = g.items[0];
      return (
        <View key={groupKey}>
          <Pressable onPress={() => toggleGroup(groupKey)}>
            <Card
              style={{
                marginTop: theme.spacing.s3,
                flexDirection: "row",
                justifyContent: "space-between",
                ...(dimmed ? { opacity: 0.6 } : null),
              }}
            >
              <Text>
                {isOpen ? "▾" : "▸"} {head.emoji} {head.title}
              </Text>
              <Text style={{ color: theme.colors.neutralTextSecondary }}>
                {head.points}pt（{g.items.length}）
              </Text>
            </Card>
          </Pressable>
          {isOpen && g.items.map((c) => renderRow(c, dimmed, true))}
        </View>
      );
    });
  };

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent")} />
      <View style={styles.header}>
        <Text style={theme.typography.parentTitle}>クエスト管理</Text>
        <AppButton label="＋ 新規追加" variant="secondary" onPress={() => router.push("/parent/chore-edit")} />
      </View>

      {/* [2026-09-07移動・統括指示／実装メモ147章] 146章で「＋新規追加」ボタンの下に常設化
          したが、一覧の一番下に置いたため、クエストやごほうびの件数が増えるほど埋もれる
          という指摘を受け、「＋新規追加」の直下（一覧より上）へ移動した。見た目・文言・
          variant="secondary"は変更していない。位置のみの変更。 */}
      {!(active.length === 0 && finished.length === 0) && (
        <AppButton
          label="🔍 おすすめを見る"
          variant="secondary"
          style={{ marginTop: theme.spacing.s3 }}
          onPress={() => setSuggestionsVisible(true)}
        />
      )}

      {/* [2026-09-02追加・本部長] クエストが0件のとき何も表示されない状態だった
          （主要画面ワイヤーフレーム.md 24章が定めていた空状態が未実装。2026-09-01の
          文書照合で発見）。統括判断「商用化の時に何かしらあったほうが良い」により実装。
          新規の家族は必ず0件から始まるため、最初に開いた画面が無言だと次の一歩が
          分からない（実装メモ110章）。 */}
      {/* [2026-09-07改訂・統括指示／実装メモ146章] 従来は要件定義書07-16章7.「クエストが
          1件でもある状態では表示しない」に従い空状態限定だったが、この方針は本件で
          統括判断により変更された（07-16章7.の記述はこの変更で古くなった。文書更新は
          企画部に依頼中）。0件時の見せ方（EmptyState＋案内文＋ボタン）自体は変更しない。 */}
      {active.length === 0 && finished.length === 0 && (
        <>
          <EmptyState emoji="📝" title="まだクエストが登録されていません。「＋ 新規追加」から最初のクエストを作ってみましょう" />
          {/* [2026-09-02追加] 主要画面ワイヤーフレーム.md 27.1節どおり、EmptyState
              （変更なし）の直下にセカンダリボタンとして追加する。 */}
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

      {/* [2026-09-11改訂・要件定義書07-26章決定1／主要画面ワイヤーフレーム.md 39.1節]
          「わたしが登録」「かぞくが登録」の見出し・区切りを外し、1本の一覧に統合する。 */}
      {active.length > 0 && renderSection(active, false, "active")}

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
          {finishedOpen && renderSection(finished, true, "finished")}
        </View>
      )}

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
  finishedToggle: { paddingVertical: theme.spacing.s2 },
  // [2026-09-02追加] 主要画面ワイヤーフレーム.md 27.1節。既存EmptyStateの主役を保ち、
  // おすすめ導線は補助的な位置づけ（27.4節トーン設計メモ）にとどめる。
  suggestionsIntro: {
    marginTop: theme.spacing.s4,
    marginBottom: theme.spacing.s2,
    textAlign: "center",
    color: theme.colors.neutralTextSecondary,
  },
});
