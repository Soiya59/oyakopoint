import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import { EmptyState } from "@/components/StatusViews";
import ChoreExamplesModal from "@/components/ChoreExamplesModal";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import type { Chore } from "@/types/domain";
import { groupDuplicateRows, resolveAssigneeLabel } from "@/lib/groupDuplicateRows";
import {
  buildChoreCompletionFamilyTotalsLookup,
  keyChoreCompletionTotal,
  useChoreCompletionTotals,
} from "@/hooks/useChoreCompletionTotals";

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
  // [2026-09-20改訂・主要画面ワイヤーフレーム.md 54章決定1〜6、開発部への申し送り
  // 54.11節1.] 旧「🌱 おやくそくの型から選ぶ」テキストリンク（suggestionsVisible）と
  // 旧「🔍 おすすめを見る」ボタン（skillTemplatesVisible）を、統合モーダル
  // ChoreExamplesModal 1つ・1状態にまとめた。表示条件（0件時はEmptyState直下＋
  // 案内文、1件以上時は＋新規追加の直下に常時表示）は旧「🔍 おすすめを見る」
  // ボタンのものをそのまま踏襲する（54.1節決定3）。
  const [examplesVisible, setExamplesVisible] = useState(false);
  // [2026-09-19追加・やること.md 4-55、主要画面ワイヤーフレーム.md 53.2.2節]
  // クエストごとの「これまで何回やったか」。家族ぶんをまとめて1回で取得する
  // （56.4章決定56-6、N+1にしない）。この画面はマウント時の取得のみでよい
  // （P10自体は完了報告・取消を行わない画面のため）。
  const { loadState: totalsLoadState, lookup: totalsLookup, entries: totalsEntries } = useChoreCompletionTotals();
  // [2026-09-20追加・要件定義書07-31章決定1、主要画面ワイヤーフレーム.md 53.11.9節5]
  // 担当「誰でも実行可」の行向け、chore_id単位の家族合計。totalsEntries（既存の
  // 家族ぶん取得）をクライアント側で合算するだけで、新しい問い合わせは発生しない。
  const familyTotalsLookup = buildChoreCompletionFamilyTotalsLookup(totalsEntries);

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
  // [2026-09-22追加・要件定義書07-24章決定11／主要画面ワイヤーフレーム.md 38.15節
  // 決定9] 折りたたみ見出し「1pt・計◯回（件数）」の合計実施回数を、renderRow
  // （行単位の「・計◯回」「・家族で計◯回」）と同じ数値の出どころから算出するための
  // 共通ヘルパー。新しい問い合わせは発生しない（38.15.2節「クライアント側で単純に
  // 合計するだけ」）。
  const completionCountFor = (c: Chore): number =>
    c.assigned_to !== null ? totalsLookup[keyChoreCompletionTotal(c.id, c.assigned_to)] ?? 0 : familyTotalsLookup[c.id] ?? 0;

  const renderRow = (c: Chore, dimmed: boolean, indent = false) => {
    // [2026-09-20改訂・統括指示／実装メモ264章] 管理一覧は行を押せば編集画面
    // （全設定を確認できる）が開くため、回数上限（「1日◯回」）は一覧側では
    // 省略する。「誰でも実行可」は「誰でも」に短縮する（意味は変わらない）。
    const assigneeLabel = resolveAssigneeLabel(c.assigned_to, state.members, "誰でも");
    // [2026-09-20改訂・要件定義書07-31章決定1、主要画面ワイヤーフレーム.md 53.11.1節
    // 決定8・53.11.9節3] 担当が特定の1人に決まっている行はその人の回数のまま
    // （旧53.1節決定2）。担当「誰でも実行可」（assigned_to===null）の行も、
    // 旧53.1節決定2の除外を撤回し、家族合計「・家族で計◯回」を追記する（0回でも
    // 表示、決定11）。取得に失敗したときは回数の部分だけ出さない（53.7節）。
    const completionTotalSuffix =
      totalsLoadState === "error" ? "" : c.assigned_to !== null ? `・計${completionCountFor(c)}回` : `・家族で計${completionCountFor(c)}回`;
    return (
      <Pressable key={c.id} onPress={() => router.push({ pathname: "/parent/chore-edit", params: { id: c.id } })}>
        <Card
          style={{
            marginTop: theme.spacing.s3,
            flexDirection: "row",
            // [2026-09-20改訂・実装メモ264.9章／統括差し戻し] flex:1（basis:0）で
            // 題名側を常に「残り幅ぶんだけ」に切り詰めていたため、短い題名の行まで
            // 巻き添えで7文字ほどに削られていた。flexWrapを足し、題名側からは
            // flex指定を外す（後述）ことで、「1行に収まるときはそのまま横並び、
            // 収まらないときだけ右側を2行目に落とす」という段組みに変える。
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            // 題名とポイント以降の間の余白（横）、2行になったときの行間（縦）を
            // 兼ねる。割合(%)ではなく固定トークンで確保する（幅が変わっても
            // 崩れないため、実装メモ261.10章の教訓）。
            gap: theme.spacing.s2,
            ...(indent ? { marginLeft: theme.spacing.s3 } : null),
            ...(dimmed ? { opacity: 0.6 } : null),
          }}
        >
          {/* [2026-09-20改訂・実装メモ264.9章] 題名側にはflexGrow・flexBasisを
              与えない（=既定の内容幅）。1行に収まる短い題名はそのままの幅で
              左寄せに描画され、収まらない長い題名だけが1行を単独で占有し
              （右側は自動的に2行目へ回る）、その占有幅の中で
              numberOfLines={1}+ellipsizeModeにより省略記号に切り替わる。
              flexShrink:1は保険（通常は発火しない。行の折り返し判定自体が
              「収まるかどうか」を先に決めるため）。 */}
          <Text style={{ flexShrink: 1 }} numberOfLines={1} ellipsizeMode="tail">
            {c.emoji} {c.title}
            {resolveRegistrantSuffix(c)}
          </Text>
          <Text style={{ color: theme.colors.neutralTextSecondary, flexShrink: 0 }}>
            {c.points}pt{" "}
            {c.is_repeatable ? "" : dimmed ? "・単発（済）" : "・単発"}
            {assigneeLabel ? `・${assigneeLabel}` : ""}
            {completionTotalSuffix}
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
      // [2026-09-22追加・要件定義書07-24章決定11／主要画面ワイヤーフレーム.md
      // 38.15節決定9] 見出しに「・計◯回」（中に入っている行の合計実施回数）を
      // 追加する。「誰でも実行可」の行を含め、各行が既に持つ回数をここで合算
      // するだけであり、新しい問い合わせは発生しない（38.15.2節）。取得に
      // 失敗したときは既存行と同じく回数の部分自体を出さない（53.7節と同じ扱い）。
      const groupCompletionTotalSuffix =
        totalsLoadState === "error" ? "" : `・計${g.items.reduce((sum, c) => sum + completionCountFor(c), 0)}回`;
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
                {head.points}pt{groupCompletionTotalSuffix}（{g.items.length}）
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

      {/* [2026-09-20改訂・主要画面ワイヤーフレーム.md 54章決定1〜4、開発部への申し送り
          54.11節1.] 旧「🌱 おやくそくの型から選ぶ」テキストリンクと旧「🔍 おすすめを
          見る」ボタンを「💡 見本から選ぶ」1つに統合した。位置（実装メモ147章の
          「＋新規追加」直下）・表示条件は旧「🔍 おすすめを見る」ボタンをそのまま
          踏襲する（54.1節決定3）。 */}
      {!(active.length === 0 && finished.length === 0) && (
        <AppButton
          label="💡 見本から選ぶ"
          variant="secondary"
          style={{ marginTop: theme.spacing.s3 }}
          onPress={() => setExamplesVisible(true)}
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
              （変更なし）の直下にセカンダリボタンとして追加する。
              [2026-09-20改訂・54章決定3] 文言の「おすすめ」を「見本」に置換。 */}
          <Text style={[theme.typography.parentBody, styles.suggestionsIntro]}>
            迷ったら、見本から選んでみませんか？
          </Text>
          <AppButton
            label="💡 見本から選ぶ"
            variant="secondary"
            onPress={() => setExamplesVisible(true)}
          />
        </>
      )}

      {/* [2026-09-20新設・主要画面ワイヤーフレーム.md 54章決定5〜8、54.11節2.]
          ChoreSuggestionsModal（おすすめ18件）とSkillChoreTemplatesModal（おやくそく
          10件）を統合した新モーダル。内部は🧹お手伝い区分→🌱おやくそく区分の順の
          1本の縦スクロール（タブにはしない、決定5）。 */}
      <ChoreExamplesModal
        visible={examplesVisible}
        onClose={() => setExamplesVisible(false)}
        onSelect={(id) => {
          setExamplesVisible(false);
          router.push({ pathname: "/parent/chore-edit", params: { recId: id } });
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
