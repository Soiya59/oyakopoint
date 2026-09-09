import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import GachaHomeWidget from "@/components/GachaHomeWidget";
import ChildTabHeader from "@/components/ChildTabHeader";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useGachaProgress } from "@/hooks/useGacha";
import { countRecentInbox } from "@/components/InboxPanel";
import { isWithinCancelWindow } from "@/lib/calendarDates";
import { cancelCompletionErrorText, CANCEL_SUCCESS_TEXT } from "@/lib/cancelChoreCompletion";

/**
 * クエストタブの入口（旧C5「やることリスト（ホーム）」、主要5画面のひとつ）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 36章（36.5.1節）、
 * 開発部/成果物/実装メモ.md 188章
 *
 * [2026-09-10改訂・実装メモ.md 188章] 子ども下部タブ4区画化（36章）に伴い、
 * 旧「やる」タブから、かぞく・じぶん・木タブへ移った要素（かぞくのけいじばん
 * カード、4タイル＝おえかき・木・コレクション・かぞく）を取り除き、
 * 「🎁 ごほうびを みにいく」ウィジェット（36.3節決定2）を1つ追加した。
 * ファイル名・URL（`/child/home`）は変更していない（36.11節1）。
 *
 * ヘッダーは`ChildTabHeader`（4タブ共通部品、36.4節）に差し替えた。
 * 🌟残高の軽量表示（`pointsRow`）は36.12節・本部長回答の決定1のとおり、
 * じぶんタブに残高カードを新設したあとも**そのまま残す**（削除しない）。
 * クエストをやる→ポイントが増える、という結びつきがこの仕組みの中心であり、
 * じぶんタブと数字が2か所に出るのは重複ではなく意味が違う
 * （クエスト側＝いま増えた実感、じぶん側＝残高の確認と通帳への入口）。
 *
 * 状態: 読み込み中・空・通常・上限到達（個別カード）・通信エラー を実装。
 * 上限到達カードは赤・グレーアウトにせず達成トーンで表現する（デザイントークン.md 1.4）。
 */
type LoadState = "loading" | "error" | "ready";

export default function ChildHomeScreen() {
  const { state, memberPoints, isChoreLimitReached, isOneOffFinished, dispatch } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  // [2026-08-23追加／2026-08-29削除] 家族の木ミニウィジェット（07-9章、20.6章決定7）で
  // 段階名のみを軽く添えていたが、ラベルを「木」固定にしたため段階名が不要になった。
  // C5でシーズン情報を使う箇所が他に無くなったので、useFamilyTreeSummary()の呼び出し
  // （＝ホームを開くたびの追加の通信）ごと外している。段階名は遷移先のC20で見られる。
  // [2026-08-26追加・第3段階] ガチャ「あと◯回」ウィジェット（07-13-1章、主要画面
  // ワイヤーフレーム.md 21.0節決定1「特に子ども向け（C5）では最も目立つ専用カード」・
  // 21.1節「残高表示のすぐ下、他の全リンクより上に配置」）。
  const {
    loadState: gachaLoadState,
    remaining: gachaRemaining,
    canDrawNow: gachaCanDrawNow,
    reload: reloadGachaProgress,
  } = useGachaProgress(state.activeChildMemberId);
  // [2026-09-10削除・実装メモ.md 188章] 「かぞくのけいじばん」カードは
  // かぞくタブ（`app/child/(tabs)/family.tsx`）へ移設した（36.5.2節）。

  useEffect(() => {
    const t = setTimeout(() => setLoadState("ready"), 500);
    return () => clearTimeout(t);
  }, []);

  const me = state.members.find((m) => m.id === state.activeChildMemberId)!;
  const myPoints = memberPoints.find((m) => m.member_id === me.id)?.current_points ?? 0;

  // [2026-09-03追加] 要件定義書07-17章「完了報告の直後の取消」・UIUXデザイン部/成果物/
  // 主要画面ワイヤーフレーム.md 28.5a節「さっき とどけた ほうこく」。統括決定B対応
  // （C7の3秒自動遷移で戻ってきた先＝C5に受け皿を置く）。
  // 1分の経過でリンクごと消すため、表示中は10秒間隔で再評価する（28.0節決定4。
  // サーバー側でも同じ判定を行うため、厳密なリアルタイム性は不要）。
  // cancelTick自体の値は使わない。setCancelTickを呼ぶこと自体が再レンダーの
  // トリガーになり、下記のisWithinCancelWindow判定がその都度Date.now()で
  // 再評価される（10秒ごとに1分経過した行を静かに非表示にするため）。
  const [, setCancelTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setCancelTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  const recentSelfCompletions = state.completions
    .filter((c) => c.reported_by === me.id && isWithinCancelWindow(c.reported_at))
    .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime());

  const [cancelingCompletionId, setCancelingCompletionId] = useState<string | null>(null);
  const [cancelRowError, setCancelRowError] = useState<{ id: string; message: string } | null>(null);
  const [cancelFlashMessage, setCancelFlashMessage] = useState<string | null>(null);

  const handleCancelRecentCompletion = async (completionId: string) => {
    setCancelingCompletionId(completionId);
    setCancelRowError(null);
    const result = await dispatch({ type: "CANCEL_COMPLETION", completionId });
    setCancelingCompletionId(null);
    if (!result.ok) {
      setCancelRowError({ id: completionId, message: cancelCompletionErrorText("child", result.error) });
      return;
    }
    // [実装メモ.md 120章] 取り消し後は木・ガチャの表示が変わるため、RPCが返さない
    // 最新値を個別に再取得する（家族の木はC5に常設ウィジェットが無いため対象外。
    // ガチャ「あと◯回」ウィジェットのみ再取得する）。
    void reloadGachaProgress();
    setCancelFlashMessage(CANCEL_SUCCESS_TEXT.child);
    setTimeout(() => setCancelFlashMessage(null), 1500);
  };

  // [変更] 2026-08-15改訂: 承認フロー廃止によりc.status（審査待ち件数）は廃止された。
  // 代わりに、直近24時間で自分に届いたものの件数を「お知らせ」として表示する
  // （主要画面ワイヤーフレーム.md 4章「新着リアクションあり」の考え方をC5ヘッダーにも適用。
  // 催促ではなく届いたお知らせという位置づけ、デザイントークン.md 1.4節参照）。
  //
  // [2026-08-29修正・本部長] **感謝ポイントを数に入れていなかった。**
  // ユーザーの指摘「感謝ポイントかリアクションをもらった時の通知のほうがよい」による。
  // もらっても数字が動かず、押した先（きろく）にも出ないため、感謝ポイントは
  // 受け取っても気づけない状態だった。リアクションと同じ扱いで数える。
  //
  // [2026-09-01修正・実装メモ.md 104章] 独自に持っていた計算ロジックを
  // `InboxPanel.countRecentInbox`（保護者/みまもり側と共通の1本化された計算）へ
  // 差し替えた。これにより家族の書き込みボードへのリアクションも自動的に合算対象へ
  // 加わる（主要画面ワイヤーフレーム.md 22.2.2節「並び順・件数上限」）。
  const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
  const newReactionCount = countRecentInbox(state, me.id, oneDayAgoMs);

  // [2026-08-27修正・本部長] 実施済みの「単発」を一覧から外す。単発のchoreには「終わり」が
  // 無く、実施後も「✅ おわったよ」のまま永久に「きろくずみ」へ並び続けていた
  // （本番でも単発4件すべてが完了済みのまま最長12日間残っていた）。
  // 「くり返す」設定のchoreは今日の上限に達しただけなので、従来どおり「きろくずみ」に残す。
  const chores = state.chores.filter(
    (c) =>
      c.is_active &&
      // [2026-09-07修正・本部長] app/parent/my-chores.tsx と同じ理由。みまもり共通は
      // assigned_to が NULL のため、子どものやることリストにも混ざっていた。
      c.scope === "family" &&
      (c.assigned_to === null || c.assigned_to === me.id) &&
      !isOneOffFinished(c)
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
      {/* [2026-09-10変更・実装メモ.md 188章] 4タブ共通のヘッダー部品に統一した
          （`src/components/ChildTabHeader.tsx`、36.4節）。保護者側（187章・`645a203`）
          で「かぞく」タブにだけアバターの押し先が付いていた壊れ方の再発を避けるため、
          子どもは最初から共通部品にする。 */}
      <ChildTabHeader inboxCount={newReactionCount} />

      <View style={styles.pointsRow}>
        <Text style={theme.typography.childHeadline}>🌟 いま {myPoints}pt</Text>
      </View>

      {/* [2026-09-03追加] 28.5a節「さっき とどけた ほうこく」。該当が無ければ
          ブロックごと出さない（プレースホルダを出さない、不在を強調しない原則）。
          残高表示の直後・ガチャウィジェットの直前に置く（既存の常設要素より
          さらに一時性が高いため）。 */}
      {recentSelfCompletions.length > 0 && (
        <View style={styles.recentBlock}>
          <Text style={[theme.typography.childBody, styles.recentHeading]}>さっき とどけた ほうこく</Text>
          {recentSelfCompletions.map((c) => (
            <View key={c.id} style={styles.recentRow}>
              <View style={styles.recentRowMain}>
                <Text style={theme.typography.childBody}>
                  {c.chore_emoji} {c.chore_title} +{c.points}pt
                </Text>
                <Pressable
                  onPress={() => handleCancelRecentCompletion(c.id)}
                  disabled={cancelingCompletionId === c.id}
                  hitSlop={8}
                >
                  <Text style={styles.recentCancelLink}>
                    {cancelingCompletionId === c.id ? "とりけしています…" : "とりけす"}
                  </Text>
                </Pressable>
              </View>
              {cancelRowError?.id === c.id && (
                <Text style={[theme.typography.childBody, styles.recentRowError]}>{cancelRowError.message}</Text>
              )}
            </View>
          ))}
          {cancelFlashMessage && <Text style={styles.recentFlash}>{cancelFlashMessage}</Text>}
        </View>
      )}

      <GachaHomeWidget
        tone="child"
        loadState={gachaLoadState}
        remaining={gachaRemaining}
        canDrawNow={gachaCanDrawNow}
        onPress={() => router.push("/child/gacha")}
      />

      {/* [2026-09-10追加・実装メモ.md 188章] ごほうびウィジェット（36.3節決定2の
          一次導線）。件数計算はせず固定文言のみ（本部長回答2「まず固定文言で出して、
          物足りなければ足す」）。正式な所属先（じぶんタブのタイル先頭、`self.tsx`）も
          別途用意しており、これは頻度に応える軽量なショートカットという位置づけ。
          ガチャウィジェットの直後・★おきにいりのクエスト区分の直前に置く
          （「やる→もらう」の順に読める並び、36.5.1節ワイヤーフレーム）。 */}
      <Pressable onPress={() => router.push("/child/rewards")}>
        <Card tone="child" style={styles.rewardsWidgetCard}>
          <Text style={theme.typography.childBody}>🎁 ごほうびを みにいく →</Text>
        </Card>
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
          // [2026-09-08・統括指示] お気に入りは「★を押した順（新しいものが上）」で並べる。
          // state.dailyFlaggedChoreIds が created_at の降順で入っている（api.ts
          // fetchMyDailyFlaggedChoreIds）ので、その順に並べ替える。押し直せば
          // 一番上に来るため、上下の矢印による並べ替えは作らない（実装メモ156章）。
          const dailyOrder = state.dailyFlaggedChoreIds;
          const daily = withDaily
            .filter((x) => x.isDaily)
            .sort((a, b) => dailyOrder.indexOf(a.chore.id) - dailyOrder.indexOf(b.chore.id));
          const rest = withDaily.filter((x) => !x.isDaily);
          const todo = rest.filter((x) => !x.done);
          const done = rest.filter((x) => x.done);
          // [2026-09-08修正・本部長／実装メモ.md 154章] 2列カード→1件1行に変更。
          // 経緯: 統括より「クエスト・ごほうびの表示順を人ごとに並べ替えたい」という
          // 要望があり、上下矢印での並べ替えを検討したところ、2列グリッドでは右列で
          // 「上」を押すと左列へ移動してしまう（＝上下矢印が意図通り機能しない）ことが
          // わかった。統括提案「絵文字や文字の大きさはそのままに一列にする」で決着し、
          // 並べ替え機能そのものはまだ実装していない（この変更はその前提を整えるもの）。
          // 行全体（トグル部分を除く）をタップすると報告になる関係は、
          // app/parent/my-chores.tsx の renderRow と同じ「main用Pressable」「トグル用
          // Pressable」を兄弟要素として並べる構成をそのまま踏襲し、ネストしたPressable
          // にはしていない（押し間違い防止。同ファイルで実績のある構成）。
          // [2026-09-09修正・本部長／軽微変更ルート] 1行おきの縞模様を撤回した。
          // 2026-09-08に統括の要望「行ごとに微妙に色を変えてもいいかも」で入れた
          // ものだが、実機で見た統括から「なんか見にくい。全部白にもどしてもよいかな？」
          // との指摘があり、本部長も同意した。**行と行の間にすでに余白があり、
          // 1件ずつ分かれて見えている**ため、色を変える必要が無く、淡い生成り色の行が
          // 汚れのように見えていた。indexは受け取るが縞模様には使わない（呼び出し側の
          // `.map((x, i) => renderCard(x, i))`はそのままにし、変更範囲を広げない）。
          const renderCard = (
            { chore, done }: { chore: (typeof withDaily)[number]["chore"]; done: boolean },
            _index: number
          ) => {
            const isDaily = state.dailyFlaggedChoreIds.includes(chore.id);
            return (
              <View key={chore.id} style={[styles.row, done && styles.rowDone]}>
                <Pressable
                  disabled={done}
                  onPress={() => router.push({ pathname: "/child/report", params: { choreId: chore.id } })}
                  style={styles.rowMain}
                >
                  <Text style={styles.rowEmoji}>{chore.emoji}</Text>
                  <Text
                    style={[theme.typography.childBody, styles.rowTitle]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {chore.title}
                  </Text>
                  {done ? (
                    // [2026-08-27] 実施済みの「1回だけ」設定（is_repeatable=false）のchoreは
                    // 上のフィルタで一覧から外れるようになったため、ここへ来るのは
                    // 「くり返す」設定でその日の上限に達したものだけになった。
                    // [2026-09-08修正] 1行化にともない「✅ きょうは\nがんばったね」の
                    // 2行文言は収まらないため、状態を示す「きろくずみ」（parent/my-chores.tsx
                    // の doneLabel と同じ言い方）に短縮した。状態表示（達成済みであること）
                    // 自体は維持している。
                    <Text style={styles.doneLabel} numberOfLines={1}>
                      ✅ きろくずみ
                    </Text>
                  ) : (
                    <Text style={styles.pointLabel} numberOfLines={1}>
                      +{chore.points}pt
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => toggleDaily(chore.id, !isDaily)}
                  hitSlop={8}
                  style={styles.dailyToggleWrap}
                >
                  {/* [2026-09-08修正・本部長／実装メモ.md 155章]「まいにち」→「お気に入り」の
                      言い換え（統括決定）。印も☀️→★へ。子ども向けはひらがな表記。
                      変数名・DB列名（isDaily・chore_daily_flags等）はそのまま維持している。 */}
                  <Text style={[styles.dailyToggle, isDaily && styles.dailyToggleOn]} numberOfLines={1}>
                    {isDaily ? "★おきにいり" : "★おきにいりにする"}
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
                    ★ おきにいりのクエスト
                  </Text>
                  <View style={styles.list}>{daily.map((x, i) => renderCard(x, i))}</View>
                </>
              )}
              {todo.length > 0 && (
                <>
                  <Text style={[theme.typography.childBody, styles.sectionHeading]}>クエスト</Text>
                  <View style={styles.list}>{todo.map((x, i) => renderCard(x, i))}</View>
                </>
              )}
              {done.length > 0 && (
                <>
                  <Text style={[theme.typography.childBody, styles.sectionHeading]}>きろくずみ</Text>
                  <View style={styles.list}>{done.map((x, i) => renderCard(x, i))}</View>
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
  pointsRow: { alignItems: "center", marginTop: theme.spacing.s4 },
  // [2026-09-03追加] 28.5a節「さっき とどけた ほうこく」。達成演出（紙吹雪等）は
  // 持たせず、既存のカードと同系色にとどめる控えめなブロック（トーン設計メモ）。
  recentBlock: {
    marginTop: theme.spacing.s3,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    padding: theme.spacing.s3,
  },
  recentHeading: { color: theme.colors.neutralTextSecondary, marginBottom: theme.spacing.s1 },
  recentRow: { marginTop: theme.spacing.s1 },
  recentRowMain: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recentCancelLink: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  recentRowError: { marginTop: 2, color: theme.colors.brandPrimaryStrong },
  recentFlash: { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary },
  // [2026-09-10追加・実装メモ.md 188章] ごほうびウィジェット（36.3節）。
  // 既存のCardのbaseスタイル（背景色・枠線色・角丸）をそのまま使い、上マージンだけ足す。
  rewardsWidgetCard: { marginTop: theme.spacing.s3 },
  sectionHeading: { marginTop: theme.spacing.s4, marginBottom: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  dailySectionHeading: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  // [2026-09-08変更・実装メモ.md 154章] 2列グリッド（grid）→1件1行の縦並び（list）。
  list: { gap: theme.spacing.s2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: theme.tapTarget.childPrimary,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    paddingHorizontal: theme.spacing.s4,
    paddingVertical: theme.spacing.s2,
  },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center" },
  rowDone: {
    backgroundColor: theme.colors.brandPrimarySoft,
  },
  // [2026-09-08追加・本部長／実装メモ.md 155章] 1行おきの縞模様。新しい色は足さず、
  // 絵文字のfontSizeは変更前のcardMain内の値（32）をそのまま維持。
  rowEmoji: { fontSize: 32 },
  rowTitle: { flex: 1, marginLeft: theme.spacing.s3 },
  pointLabel: { marginLeft: theme.spacing.s2, color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  doneLabel: { marginLeft: theme.spacing.s2, color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  dailyToggleWrap: { marginLeft: theme.spacing.s3, paddingVertical: theme.spacing.s1 },
  dailyToggle: { fontSize: 11, color: theme.colors.neutralTextSecondary },
  dailyToggleOn: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
});
