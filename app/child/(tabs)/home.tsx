import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import GachaHomeWidget from "@/components/GachaHomeWidget";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import MemberAvatar from "@/components/MemberAvatar";
import { useGachaProgress } from "@/hooks/useGacha";
import { useFamilyHomeCard } from "@/hooks/useFamilyBoard";
import { countRecentInbox } from "@/components/InboxPanel";
import { isWithinCancelWindow } from "@/lib/calendarDates";
import { cancelCompletionErrorText, CANCEL_SUCCESS_TEXT } from "@/lib/cancelChoreCompletion";

/**
 * C5 やることリスト（ホーム）（主要5画面のひとつ）
 * 参照: 主要画面ワイヤーフレーム.md 1章
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
  // [2026-08-28追加・家族の書き込みボード07-14章第1段階] 「かぞくのけいじばん」カード
  // （主要画面ワイヤーフレーム.md 22.1.2節、C5新規）。07-8章の週次まとめメッセージは
  // 元々C5に無かった（大人向けの文体だったため対象外）が、07-14章により書き込み内容は
  // 家族自身の言葉になったため子ども向け画面にも表示できるようになった
  // （22.1.2節「07-8章のコンセプト自体は『大人向け』だったが…」）。P7と同じ
  // `family_home_card` Viewを同一クエリで使う（API仕様.md 13.3章）。
  const { loadState: cardLoadState, card } = useFamilyHomeCard(state.family.id);
  const cardMessage =
    cardLoadState === "error"
      ? "かぞくのけいじばんは、またあとでみてね"
      : cardLoadState === "loading"
      ? null
      : card?.message ?? "かぞくのけいじばんは、またあとでみてね";
  const cardAuthorName =
    card?.source === "board_post"
      ? state.members.find((m) => m.id === card.board_post_author_member_id)?.display_name ?? null
      : null;

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
      {/* [2026-08-23修正・本部長] 「ベルマークがアカウント切り替えにつながっていて、
          新着のお知らせだと思っていたので分かりにくい」とユーザーが実機で発見した。
          ベル（🔔・新着リアクション件数）は「きろく」タブ（届いたリアクションを
          確認できる）へ、左上のアバター・名前はアカウント切り替えへ、と役割を
          入れ替えた（ベル＝お知らせ、自分の名前をタップ＝自分の切り替え、という
          一般的なアプリの配置パターンに合わせた）。 */}
      <View style={styles.headerRow}>
        <Pressable style={styles.headerLeft} onPress={() => router.push("/child/profile-switch")}>
          <MemberAvatar name={me.display_name} color={me.avatar_color} size={36} />
          <Text style={theme.typography.childBody}>{me.display_name}</Text>
        </Pressable>
        {/* [2026-08-29変更] 飛び先を「きろく」から「とどいたよ」（C29）へ。きろくには
            リアクションしか出ず、感謝ポイントを数に入れると押しても何のことか分からなく
            なるため、もらったものだけを1本にまとめた専用画面を用意した。 */}
        <Pressable onPress={() => router.push("/child/inbox")}>
          <Text style={styles.notifBadge}>🔔{newReactionCount}</Text>
        </Pressable>
      </View>

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

      {/* [2026-08-28追加] 「かぞくのできごと」カード（主要画面ワイヤーフレーム.md
          22.1.2節）。ガチャウィジェットほどの視覚的重みは持たせない控えめなカードに
          とどめる（22.1.2節「配置場所」）。通信エラー時のみタップ不可。 */}
      <Pressable disabled={cardLoadState === "error"} onPress={() => router.push("/child/family-board")}>
        <Card tone="child" style={styles.familyBoardCard}>
          <View style={styles.cardHeaderRow}>
            <Text style={theme.typography.childBody}>💬 かぞくのけいじばん</Text>
            {cardLoadState !== "error" && <Text style={theme.typography.childBody}>›</Text>}
          </View>
          {cardMessage === null ? (
            <View style={styles.digestSkeleton} />
          ) : (
            <>
              {cardAuthorName !== null && (
                <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s2 }]}>{cardAuthorName}</Text>
              )}
              <Text style={{ marginTop: theme.spacing.s1 }}>{cardMessage}</Text>
            </>
          )}
        </Card>
      </Pressable>

      {/* [2026-08-27整理・本部長] 第2〜5段階で機能を足すたびに文字リンクを1行ずつ
          継ぎ足した結果、リンク4行が画面の中央を占め、**子どもの一番の仕事である
          「お手伝いの報告」が画面の下へ押し出されていた**（ユーザーの実機指摘）。
          あわせて、UIUXデザイン部CLAUDE.mdの「子ども向け画面は文字よりアイコン・色を
          優先する」という原則にも反していた（4行とも素の文字リンクだった）。
          アイコンを主役にした横1列に集約し、4行を1行に減らす。 */}
      <View style={styles.shortcutRow}>
        {[
          // [2026-09-08変更・本部長／実装メモ.md 166章] 統括指示により並び順を
          // 「よく使うものを左に」へ変更（かぞく→木→おえかき→コレクション から
          // おえかき→木→コレクション→かぞく へ）。
          { emoji: "🎨", label: "おえかき", path: "/child/drawing" },
          // [2026-08-29変更・本部長] ラベルを段階名（種／芽／若木／花／実）から「木」固定へ。
          // 「いまどこまで育ったか」をホームで見せる狙いで段階名を出していたが、実機では
          // 「🌳 花」と表示され、**何のボタンなのかが分からない**とユーザーが指摘した
          // （ボタンのラベルは行き先を示すもので、状態を示すものではない）。
          // 段階名は遷移先のC20と、保護者ホームの木ウィジェットで引き続き確認できる。
          { emoji: "🌳", label: "木", path: "/child/family-tree" },
          { emoji: "🗄️", label: "コレクション", path: "/child/collector-shelf" },
          { emoji: "👨‍👩‍👧‍👦", label: "かぞく", path: "/child/family-activity" },
        ].map((s2) => (
          <Pressable key={s2.path} onPress={() => router.push(s2.path as never)} style={styles.shortcutItem}>
            <Text style={styles.shortcutEmoji}>{s2.emoji}</Text>
            <Text style={styles.shortcutLabel}>{s2.label}</Text>
          </Pressable>
        ))}
      </View>

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
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  notifBadge: { fontSize: 16, fontWeight: "700" },
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
  familyBoardCard: { marginTop: theme.spacing.s3 },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  digestSkeleton: {
    marginTop: theme.spacing.s2,
    height: 18,
    borderRadius: theme.radius.childXl,
    backgroundColor: theme.colors.neutralBorder,
    opacity: 0.6,
  },
  // [2026-08-27追加] 4本の文字リンクを置き換えた横1列のショートカット。
  // 子ども向けタップ領域56dp（デザイントークン.md 1.7節）を高さで確保する。
  // [2026-09-08改訂・本部長／軽微変更ルート] 統括の実機確認「お絵かきとか少し窮屈かも」。
  // 従来はspace-aroundで、白い四角が中身の文字幅ちょうどに縮んでいた。そのため
  // 「おえかき」「木」「かぞく」は文字が枠にぴったり接する一方、「コレクション」だけ
  // 幅広という不揃いな並びになっていた。flex:1で4つを等幅にし、余っていた横方向の
  // 空白を4枚に配り直す。「コレクション」が今の幅（画面の約1/4）で収まっているので、
  // 等幅にしても文字が入らなくなることはなく、他の3枚だけが広くなる。
  shortcutRow: {
    flexDirection: "row",
    gap: theme.spacing.s2,
    marginTop: theme.spacing.s3,
  },
  // [2026-09-08変更・本部長／実装メモ.md 166章] 統括指示「背景と同じで押せると
  // 分かりにくいので、1つずつ白のしかくで囲んでもよいかも」に対応。既存のCard
  // コンポーネント（src/components/Card.tsx）のbaseスタイルと同じ背景色・枠線色・
  // 角丸（子ども向けはchildXl）を流用した。4つをまとめて1つの箱にはせず、1つずつ
  // 個別に囲む（統括指示「押せるものが4つあることがはっきりします」）。
  // minWidth/minHeightは変更前と同じtheme.tapTarget.child（56dp）を維持しており、
  // 白い四角にしたことでタップ領域が変更前より狭くなってはいない。
  shortcutItem: {
    // [2026-09-08改訂] 等幅（上のshortcutRowのコメント参照）。上下にも余白を入れて、
    // 絵文字とラベルが枠の上下に接しないようにする。minHeightは従来どおり
    // theme.tapTarget.child（56dp）で、タップ領域は狭くなっていない。
    flex: 1,
    minWidth: theme.tapTarget.child,
    minHeight: theme.tapTarget.child,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing.s2,
    paddingHorizontal: theme.spacing.s1,
    backgroundColor: theme.colors.neutralSurface,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.childXl,
  },
  shortcutEmoji: { fontSize: 30 },
  shortcutLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.brandPrimaryStrong,
    marginTop: 2,
  },
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
