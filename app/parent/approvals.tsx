import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListRenderItemInfo, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import ListScreen from "@/components/ListScreen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useMarkSeen } from "@/hooks/useLastSeen";
import { formatDateTimeFullJp, formatDateTimeShort, isWithinCancelWindow } from "@/lib/calendarDates";
import { cancelCompletionErrorText, CANCEL_SUCCESS_TEXT } from "@/lib/cancelChoreCompletion";
import { STAMP_SEND_ERROR_MESSAGE, COMMENT_SEND_ERROR_MESSAGE } from "@/lib/errorMessages";
import type { ChoreCompletion, FamilyDrawingLineData, FamilyMember, StampKey } from "@/types/domain";

/**
 * P8 完了報告一覧・リアクション ＋ P9 完了報告詳細・リアクション（モーダルに統合）
 * 参照: 主要画面ワイヤーフレーム.md 3章、画面一覧・遷移図.md P8/P9・3.4章
 *
 * [2026-08-15全面書き換え] 要件定義書.md v0.5 07章・スキーマ設計.sql v2.0
 * （chore_reactions新設、chore_completionsのUPDATEポリシー全廃）を受け、旧
 * 「承認待ち一覧」（承認/差し戻しボタン）を全面的に置き換えた。保護者ができる操作は
 * 「見る」と「（任意で）スタンプ／コメントを贈る」の2つのみで、承認・却下・差し戻しに
 * 相当するボタン・状態はこの画面のどこにも存在しない。
 *
 * カードは「処理待ちのタスクを片付ける」画面ではなく「家族のがんばりを眺めて、
 * 気が向いたら反応する」フィード画面であるため、リアクション付与後も一覧から
 * 消えない・未読/既読の概念も持たない（画面一覧・遷移図.md 3.4章）。
 *
 * 状態: 読み込み中 / 空状態 / 通常 / 通信エラー をワイヤーフレームどおりに実装。
 *
 * [2026-09-19改訂・実装メモ.md 255章、やること.md 4-47] `ScrollView`＋`completions.map()`
 * （家族の全履歴を毎回すべてDOMへマウントする実装）を`FlatList`（仮想化）へ置き換えた。
 * 完了報告が数千件ある家族で「保護者ホームの『最近の報告』を押してから、この画面が
 * 操作できるようになるまで」が数秒かかる不具合（228・240・254章の対処では直らなかった）の
 * 原因が、通信ではなくこの画面の描画（1,000件で約1.3秒のDOMコミット＋ペイント）だったと
 * 実測で確認できたための変更。**見た目・操作・データの取得範囲は変えていない**
 * （表示件数を絞る・ページ分けする等の変更は含まない。255章参照）。
 *
 * ⚠️ **この画面はS2（`app/supporter/activity.tsx`）と写しの関係にある。片方だけ直さないこと。**
 * 見た目のトーン（parent/supporter）と取消の権限だけが違い、画面の骨組み・状態の持ち方・
 * 一覧の描き方は同じに保つ。実際に255章（2026-09-19）でこの画面だけを`FlatList`化し、
 * S2が全件描画のまま取り残されて遅いままだった（2026-09-20・実装メモ266章、やること4-66で解消）。
 * 速さに効く骨組みは`@/components/ListScreen`に集約してあるので、**一覧の描き方を変えるときは
 * その部品を直す**こと（P8・S2・C18の3画面に同時に効く）。
 */
type LoadState = "loading" | "error" | "ready";

/**
 * [2026-09-19新設・255章] 1行分のカード。`React.memo`で分離し、他の行の状態変化
 * （スタンプ送信中・取消確認モーダル・コメント入力など）で無関係な行まで
 * 再レンダーされないようにする。`FlatList`化により初回マウント時に実際にDOMへ
 * 乗る行数自体は画面に映る分だけ（既定`initialNumToRender`程度）に絞られているため、
 * このメモ化の効果は主に「一覧を開いたあとの操作（スタンプ送信・コメント入力等）で
 * 表示中の数十行が毎回すべて再計算される」ケースを減らすことにある
 * （255章、行の初回マウント自体を軽くする主対策は仮想化そのもの）。
 *
 * [既知の制約] `hasReactedWithStamp`はコンテキスト（`src/data/store.tsx`）から
 * 渡された関数で、そのモジュールの`value`の`useMemo`依存が`state`全体であるため、
 * リアクション以外の家族データが変わったときも関数の参照が変わり得る。その場合
 * この行のメモ化は素通りして再レンダーされるが、`FlatList`仮想化により影響は
 * 画面に見えている行数だけに閉じるため実害は小さいと判断した（store.tsx側の
 * メモ化見直しは本修正の対象外・255章参照）。
 */
type CompletionRowProps = {
  completion: ChoreCompletion;
  member?: FamilyMember;
  memberAvatarLineData?: FamilyDrawingLineData | null;
  myParentId: string;
  isCanceling: boolean;
  cancelErrorMessage?: string;
  onOpenDetail: (c: ChoreCompletion) => void;
  onCancelTap: (c: ChoreCompletion) => void;
  onSendStamp: (completionId: string, stampKey: StampKey) => void;
  hasReactedWithStamp: (completionId: string, reactedBy: string, stampKey: StampKey) => boolean;
};

const CompletionRow = React.memo(function CompletionRow({
  completion: c,
  member,
  memberAvatarLineData,
  myParentId,
  isCanceling,
  cancelErrorMessage,
  onOpenDetail,
  onCancelTap,
  onSendStamp,
  hasReactedWithStamp,
}: CompletionRowProps) {
  // [2026-08-16追加] 主要画面ワイヤーフレーム.md 3.1章「保護者自身の完了報告（07-4章）
  // もこのフィードに時系列で混在表示する」。トーンの書き分けはAPI仕様.md 4b章・
  // 主要画面ワイヤーフレーム.md 9.3章のとおり、reported_by先family_members.roleで
  // 判定する（chore側に区分列は無い。スキーマ設計.sql 12章確認5）。
  const isChildCard = member?.role === "child";
  // [2026-08-23改訂] 🤝/🎯バッジ（旧デザイントークン.md 1.7節）は要件定義書
  // 07-7章4回目のスコープ変更（家族共有choreへの参加機能の撤回）に伴い廃止した。
  // [2026-08-23再改訂・5回目のスコープ変更] 自分専用choreの公開方針の撤回により、
  // みまもりメンバーの完了報告も再びこのフィードに表示されるようになった
  // （chore_completions_select_scoped RLSがfamily_id一致のみに単純化されたため）。
  // バッジは復活させないが、`color-supporter-accent-soft`の控えめな配色で
  // 区別する（画面一覧・遷移図.md P8行参照）。
  const isSupporterCard = member?.role === "supporter";
  // 自分自身の完了報告カードにはリアクションボタン自体を表示しない
  // （3.1章「自己リアクションは要件定義書に無い操作のため、UI側で選択肢自体を出さない」）。
  const isOwnCard = c.reported_by === myParentId;
  // [2026-09-19追加・255章] `setCancelTick`は親（1分以内の行がある間だけ動く。下記
  // 参照）が変わるたびにこの行も再評価されるため、ここで毎回`isWithinCancelWindow`を
  // 呼んでも無期限の家族全履歴ではなく画面に見えている行数ぶんで済む。
  const showCancelLink = !isSupporterCard && isWithinCancelWindow(c.reported_at);

  return (
    <Pressable onPress={() => onOpenDetail(c)}>
      <Card
        style={
          isChildCard
            ? { ...styles.card, ...styles.cardChildTint }
            : isSupporterCard
            ? { ...styles.card, ...styles.cardSupporterTint }
            : styles.card
        }
      >
        <View style={styles.cardTop}>
          <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={32} lineData={memberAvatarLineData} expandOnTap />
          <Text style={theme.typography.parentBodyMedium}>{member?.display_name}</Text>
          <Text style={{ flex: 1 }} />
          <Text style={theme.typography.parentBodyMedium}>
            {/* [2026-09-17改訂・要件定義書07-28章決定9] 台紙型はpoints=NULL
                のため何も添えない。 */}
            {c.chore_emoji} {c.chore_title} {c.points != null ? `+${c.points}pt` : ""}
          </Text>
        </View>
        <View style={[styles.cardMeta, styles.cardMetaRow]}>
          <Text style={theme.typography.parentCaption}>
            {formatDateTimeShort(c.reported_at)}{" "}
            {isChildCard ? "とどいた" : "きろくした"}
          </Text>
          {/* [2026-09-03追加] 28.4節。みまもりメンバーの完了報告（scope='personal'
              またはscope='supporter_shared'）には保護者の取消権限が無いため
              リンク自体を出さない。[2026-09-06追記・要件定義書07-18章決定2・3、
              スキーマ設計.sql 45.12章] supporter_shared新設後も、報告者が
              supporterロールであれば personal/supporter_shared のいずれでも
              保護者は取り消せない（cancel_chore_completion側でも同じ判定に
              統一済み）ため、role判定のみで引き続き足りる。 */}
          {showCancelLink && (
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                onCancelTap(c);
              }}
              disabled={isCanceling}
              hitSlop={8}
            >
              <Text style={styles.cancelLink}>{isCanceling ? "処理中…" : "取消"}</Text>
            </Pressable>
          )}
        </View>
        {cancelErrorMessage && (
          <Text style={[theme.typography.parentCaption, styles.cancelRowError]}>{cancelErrorMessage}</Text>
        )}
        {/* カード上のクイックスタンプ。タップで即座にトグルRPCを呼ぶ（3.1章、
            2026-09-10改訂・実装メモ.md 157章）。自分自身の完了報告カードには
            表示しない。[2026-09-10改訂] 送信済み（sent）でもdisabledにしない。
            もう一度タップすると取消、違うスタンプをタップすると切替になる。 */}
        {!isOwnCard && (
          <View style={styles.stampRow}>
            {theme.stampDefinitions.map((s) => {
              const sent = hasReactedWithStamp(c.id, myParentId, s.key as StampKey);
              return (
                <Pressable
                  key={s.key}
                  onPress={() => onSendStamp(c.id, s.key as StampKey)}
                  style={[styles.stampBtn, sent && styles.stampBtnSent]}
                >
                  <Text style={styles.stampEmoji}>
                    {s.emoji}
                    {sent ? "✓" : ""}
                  </Text>
                </Pressable>
              );
            })}
            <Text style={{ flex: 1 }} />
            <Pressable onPress={() => onOpenDetail(c)}>
              <Text style={styles.commentLink}>＋コメント</Text>
            </Pressable>
          </View>
        )}
      </Card>
    </Pressable>
  );
});

export default function ApprovalsScreen() {
  const { state, dispatch, reactionsForCompletion, hasReactedWithStamp, loading, loadError, refresh, memberAvatars } = useAppData();
  // [2026-09-11追加・実装メモ.md 190章] この画面を開いたことを記録し、
  // ベル／新着件数を未読方式で数えられるようにする。**入口がどこであったかは問わない**
  // （統括の指摘。「新着◯件」カードからでも「最近の報告」の行からでも同じ画面に来る）。
  useMarkSeen("completions", state.activeParentMemberId);

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [detailTarget, setDetailTarget] = useState<ChoreCompletion | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  // [2026-08-20修正・本部長] sendStamp/sendCommentがdispatch()の戻り値を確認せず、
  // 失敗時に何もフィードバックが無いままだった（ユーザーが「文字を入力しないと
  // リアクションおくれない？？」と誤解した一因と考えられる。実際はAPI直接検証で
  // スタンプ送信自体は正常に動くことを確認済みのため、たまたま失敗した際に
  // 気づけない設計だったことが問題）。また送信成功後もモーダルが閉じず
  // 「そのUIが消えない」との指摘もあったため、送信失敗時のエラー表示と、
  // コメント送信成功時にモーダルを閉じる処理を追加した。
  const [reactionError, setReactionError] = useState<string | null>(null);

  // [2026-09-03追加] 要件定義書07-17章「完了報告の直後の取消」・UIUXデザイン部/成果物/
  // 主要画面ワイヤーフレーム.md 28.4節。
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelRowError, setCancelRowError] = useState<{ id: string; message: string } | null>(null);
  const [cancelConfirmTarget, setCancelConfirmTarget] = useState<ChoreCompletion | null>(null);
  const [cancelFlashMessage, setCancelFlashMessage] = useState<string | null>(null);

  // 自分（いま操作している保護者）のfamily_member_id。実接続時は
  // current_family_member_id()相当（session.parentMember.id）がstate.activeParentMemberIdに
  // すでに反映されている（src/data/store.tsx RealDataProviderImpl参照）。
  const myParentId = state.activeParentMemberId;

  useEffect(() => {
    if (!loading) setLoadState(loadError ? "error" : "ready");
  }, [loading, loadError]);

  // [2026-09-19改訂・255章] 家族の全履歴を毎レンダー並べ替え直していた（`state.completions`
  // が変わらない限り同じ結果なのに、スタンプ送信・コメント入力・取消チックなど無関係な
  // 再レンダーのたびに数千件のsort+filterをやり直していた）。実測ではこの部分自体は
  // 1,000件でも1〜2ms程度で体感の遅さの主因ではなかった（実装メモ255章）が、
  // 無駄な再計算を避けるためuseMemoに揃える。
  const completions = useMemo(
    () => [...state.completions].sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime()),
    [state.completions]
  );

  // 「新着◯件」は消化すべきタスク数ではなく、直近24時間に届いた報告のお知らせという
  // 位置づけ（主要画面ワイヤーフレーム.md 3.1章）。未処理バッジの概念は持たない。
  const newCount = useMemo(() => {
    const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
    return completions.filter((c) => new Date(c.reported_at).getTime() >= oneDayAgoMs).length;
  }, [completions]);

  // [2026-09-19改訂・255章] 1分の経過でリンクごと消すため10秒間隔で再評価する
  // （28.0節決定4）点は変えないが、**直近の報告が1分以内のときだけ動かす**ように
  // した。以前は画面を開いている間ずっと（1分以内の報告が1件も無くても）無条件で
  // 動き続けており、そのたびに家族の全履歴ぶんsort+filter・全行再レンダーの引き金に
  // なっていた。`completions`は`reported_at`降順のため先頭（最新）だけを見れば足りる。
  // intervalは「まだ必要か」をtickのたびに自分で確認し、不要になれば自分で止める
  // （`completions`が変わらない限りこのeffectは再購読されないため、依存側からの
  // 停止だけでは「1分経過したのに動き続ける」ケースを防げない）。
  const [, setCancelTick] = useState(0);
  useEffect(() => {
    const newest = completions[0];
    if (!newest || !isWithinCancelWindow(newest.reported_at)) return;
    const id = setInterval(() => {
      const stillNewest = completions[0];
      if (!stillNewest || !isWithinCancelWindow(stillNewest.reported_at)) {
        clearInterval(id);
        return;
      }
      setCancelTick((n) => n + 1);
    }, 10_000);
    return () => clearInterval(id);
  }, [completions]);

  const memberOf = useCallback((id: string) => state.members.find((m) => m.id === id), [state.members]);

  // [2026-09-10改訂・実装メモ.md 157章] 送信済みのスタンプをもう一度タップすると
  // 取消、違うスタンプをタップすると切替になる（統括指示）。以前あった
  // 「送信済みなら何もしない」ガードは撤去した（もう一度押したい操作そのものが
  // 取消の入口になったため）。
  // [2026-09-19・255章] 行コンポーネント（CompletionRow）へ安定した関数参照として
  // 渡すためuseCallback化（React.memoが効くようにするため）。
  const sendStamp = useCallback(
    async (completionId: string, stampKey: StampKey) => {
      setReactionError(null);
      const result = await dispatch({ type: "TOGGLE_REACTION_STAMP", completionId, reactedBy: myParentId, stampKey });
      if (!result.ok) setReactionError(STAMP_SEND_ERROR_MESSAGE);
    },
    [dispatch, myParentId]
  );

  const openDetail = useCallback((c: ChoreCompletion) => {
    setCommentDraft("");
    setReactionError(null);
    setDetailTarget(c);
  }, []);

  // [2026-09-03追加] 28.4節「決定5」：自分の報告は確認なしで即取消、自分以外
  // （子ども・配偶者）の報告は確認ダイアログを挟む。
  const runCancel = useCallback(
    async (completionId: string) => {
      setCancelingId(completionId);
      setCancelRowError(null);
      const result = await dispatch({ type: "CANCEL_COMPLETION", completionId });
      setCancelingId(null);
      if (!result.ok) {
        setCancelRowError({ id: completionId, message: cancelCompletionErrorText("parent", result.error) });
        return;
      }
      setCancelConfirmTarget(null);
      setCancelFlashMessage(CANCEL_SUCCESS_TEXT.parent);
      setTimeout(() => setCancelFlashMessage(null), 1500);
    },
    [dispatch]
  );

  const handleCancelTap = useCallback(
    (c: ChoreCompletion) => {
      if (c.reported_by === myParentId) {
        void runCancel(c.id);
      } else {
        setCancelConfirmTarget(c);
      }
    },
    [myParentId, runCancel]
  );

  const sendComment = async () => {
    if (!detailTarget) return;
    const body = commentDraft.trim();
    if (!body) return;
    setReactionError(null);
    setSendingComment(true);
    const result = await dispatch({
      type: "ADD_REACTION",
      completionId: detailTarget.id,
      reactedBy: myParentId,
      kind: "comment",
      commentBody: body,
    });
    setSendingComment(false);
    if (!result.ok) {
      setReactionError(COMMENT_SEND_ERROR_MESSAGE);
      return;
    }
    setCommentDraft("");
    setDetailTarget(null);
  };

  const listHeader = (
    <>
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent")} />
      <View style={styles.header}>
        <Text style={theme.typography.parentTitle}>完了報告</Text>
        <Text style={{ color: theme.colors.neutralTextSecondary }}>新着{newCount}件</Text>
      </View>

      {loadState === "loading" && <SkeletonList count={3} />}

      {loadState === "error" && (
        <ErrorState title="読み込みに失敗しました" onRetry={() => setLoadState("ready")} />
      )}

      {loadState === "ready" && completions.length === 0 && (
        <EmptyState emoji="📮" title="まだ完了報告がありません。クエストがはじまると、ここに届きます" />
      )}
    </>
  );

  const listFooter = (
    <>
      {/* [2026-09-03追加] 28.4節「取消成功」のスナックバー相当（1.5秒で自動消滅）。 */}
      {cancelFlashMessage && (
        <Text style={[theme.typography.parentCaption, styles.cancelFlash]}>{cancelFlashMessage}</Text>
      )}

      {/* [2026-08-16修正・本部長] P16・P18と同じ理由でホームへ戻るボタンを追加した。 */}
      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/parent")} />
    </>
  );

  const renderItem = ({ item: c }: ListRenderItemInfo<ChoreCompletion>) => {
    const member = memberOf(c.reported_by);
    return (
      <CompletionRow
        completion={c}
        member={member}
        memberAvatarLineData={member ? memberAvatars[member.id] : undefined}
        myParentId={myParentId}
        isCanceling={cancelingId === c.id}
        cancelErrorMessage={cancelRowError?.id === c.id ? cancelRowError.message : undefined}
        onOpenDetail={openDetail}
        onCancelTap={handleCancelTap}
        onSendStamp={sendStamp}
        hasReactedWithStamp={hasReactedWithStamp}
      />
    );
  };

  return (
    // [2026-09-20改訂・266章] 一覧の骨組み（`Screen`を`scroll={false}`にして`FlatList`自身を
    // 唯一のスクロールコンテナにする・`Screen`と同じpaddingを`contentContainerStyle`へ
    // 移す・仮想化の設定）は255章でこのファイルに直接書いていたが、S2・C18にも同じものが
    // 要るため`@/components/ListScreen`へ移した（見た目・設定値は255章のまま）。
    <ListScreen
      tone="parent"
      data={loadState === "ready" ? completions : []}
      keyExtractor={(c) => c.id}
      renderItem={renderItem}
      ListHeaderComponent={listHeader}
      ListFooterComponent={listFooter}
    >
      {/* [2026-09-03追加] 28.4節「確認モーダル（自分以外の報告を取り消す場合）」。
          22.4節の削除確認モーダルと同じ構成・トーン。 */}
      <Modal
        visible={!!cancelConfirmTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelConfirmTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard}>
            {cancelConfirmTarget &&
              (() => {
                const member = memberOf(cancelConfirmTarget.reported_by);
                return (
                  <>
                    <Text style={theme.typography.parentTitle}>
                      {member?.display_name ?? "?"}さんの「{cancelConfirmTarget.chore_title}」の報告を取り消しますか？
                    </Text>
                    <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }}>
                      {formatDateTimeFullJp(cancelConfirmTarget.reported_at)}
                      {cancelConfirmTarget.points != null ? ` ・ +${cancelConfirmTarget.points}pt` : ""}
                    </Text>
                    <Text style={{ marginTop: theme.spacing.s2 }}>
                      取り消すと、たまったポイントや家族の木・ガチャの回数も1つ戻ります。元に戻せません。
                    </Text>
                    {cancelRowError?.id === cancelConfirmTarget.id && (
                      <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.statusBlocking }}>
                        {cancelRowError.message}
                      </Text>
                    )}
                    <View style={styles.confirmButtonRow}>
                      <AppButton
                        variant="secondary"
                        label="やめる"
                        onPress={() => setCancelConfirmTarget(null)}
                        disabled={cancelingId === cancelConfirmTarget.id}
                        style={{ flex: 1, marginRight: theme.spacing.s2 }}
                      />
                      <AppButton
                        variant="danger"
                        label={cancelingId === cancelConfirmTarget.id ? "取り消しています…" : "取り消す"}
                        onPress={() => void runCancel(cancelConfirmTarget.id)}
                        disabled={cancelingId === cancelConfirmTarget.id}
                        style={{ flex: 1 }}
                      />
                    </View>
                  </>
                );
              })()}
          </Card>
        </View>
      </Modal>

      {/* P9 完了報告詳細・リアクション */}
      <Modal visible={!!detailTarget} transparent animationType="fade" onRequestClose={() => setDetailTarget(null)}>
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard}>
            {detailTarget &&
              (() => {
                const member = memberOf(detailTarget.reported_by);
                const reactions = reactionsForCompletion(detailTarget.id);
                // [2026-08-16追加] P8カードと同じ役割判定（9.3章「トーンの書き分けルール」）。
                const isChildCard = member?.role === "child";
                const isOwnCard = detailTarget.reported_by === myParentId;
                return (
                  <>
                    <Text style={theme.typography.parentTitle}>
                      {detailTarget.chore_emoji} {detailTarget.chore_title}
                    </Text>
                    <Text style={{ marginTop: theme.spacing.s2 }}>
                      {member?.display_name} さんから
                      {detailTarget.points != null ? ` ・ +${detailTarget.points}pt` : ""}
                    </Text>
                    <Text style={{ marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }}>
                      {formatDateTimeFullJp(detailTarget.reported_at)}{" "}
                      {isChildCard ? "とどいた" : "きろくした"}
                    </Text>
                    {detailTarget.note ? (
                      <Text style={{ marginTop: theme.spacing.s2 }}>ひとことメモ: {detailTarget.note}</Text>
                    ) : null}

                    <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s4 }]}>
                      とどいたリアクション
                    </Text>
                    {reactions.length === 0 ? (
                      <Text
                        style={[
                          theme.typography.parentCaption,
                          { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary },
                        ]}
                      >
                        まだ誰も反応していないよ
                      </Text>
                    ) : (
                      <View style={{ marginTop: theme.spacing.s1, gap: theme.spacing.s1 }}>
                        {reactions.map((r) => {
                          const reactor = memberOf(r.reacted_by);
                          const stampDef = theme.stampDefinitions.find((s) => s.key === r.stamp_key);
                          return (
                            <Text key={r.id} style={theme.typography.parentBody}>
                              {r.kind === "stamp" ? stampDef?.emoji : "💬"} {reactor?.display_name}より
                              {r.kind === "stamp" ? `「${stampDef?.label}」` : `「${r.comment_body}」`}{" "}
                              <Text style={theme.typography.parentCaption}>
                                {new Date(r.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                              </Text>
                            </Text>
                          );
                        })}
                      </View>
                    )}

                    {/* [2026-08-16追加] 3.1章「自分自身の完了報告カードにはリアクション
                        ボタン自体を表示しない」。受け取ったリアクション一覧（上のブロック）は
                        自分の完了報告でも表示したままにする。 */}
                    {!isOwnCard && (
                      <>
                        <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s4 }]}>
                          スタンプを贈る
                        </Text>
                        <View style={styles.stampGrid}>
                          {theme.stampDefinitions.map((s) => {
                            const sent = hasReactedWithStamp(detailTarget.id, myParentId, s.key as StampKey);
                            return (
                              <Pressable
                                key={s.key}
                                onPress={() => sendStamp(detailTarget.id, s.key as StampKey)}
                                style={[styles.stampChip, sent && styles.stampChipSent]}
                              >
                                <Text>
                                  {s.emoji} {s.label}
                                  {sent ? " ✓" : ""}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>

                        <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s4 }]}>
                          ひとことおくる（にんい・200文字まで）
                        </Text>
                        <TextInput
                          value={commentDraft}
                          onChangeText={setCommentDraft}
                          placeholder="あわ、上手にできてたよ"
                          multiline
                          maxLength={200}
                          style={styles.textArea}
                        />
                        <AppButton
                          label={sendingComment ? "送信中…" : "おくる"}
                          loading={sendingComment}
                          style={{ marginTop: theme.spacing.s2 }}
                          onPress={sendComment}
                          disabled={!commentDraft.trim() || sendingComment}
                        />
                      </>
                    )}

                    {reactionError && (
                      <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>
                        {reactionError}
                      </Text>
                    )}

                    <AppButton
                      label="もどる"
                      variant="ghost"
                      style={{ marginTop: theme.spacing.s3 }}
                      onPress={() => setDetailTarget(null)}
                    />
                  </>
                );
              })()}
          </Card>
        </View>
      </Modal>
    </ListScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  card: { marginTop: theme.spacing.s3 },
  // [2026-08-16追加] 3.1章「子どものカード：…背景色は淡い彩色／保護者自身のカード：
  // 背景色はcolor-neutral-surfaceのまま（淡い彩色を加えない）」。子どものカードにのみ
  // 淡い彩色を追加し、保護者のカード（自分・配偶者いずれも）はCardデフォルトのまま。
  cardChildTint: { backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  // [2026-08-23追加・5回目のスコープ変更] みまもりメンバーの完了報告カードの控えめな配色。
  cardSupporterTint: { backgroundColor: theme.colors.supporterAccentSoft, borderColor: theme.colors.supporterAccent },
  cardTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  cardMeta: { marginTop: theme.spacing.s2 },
  // [2026-09-03追加] 28.4節。報告日時の右に取消リンクを置く。
  cardMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cancelLink: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  cancelRowError: { marginTop: 2, color: theme.colors.statusBlocking },
  cancelFlash: { marginTop: theme.spacing.s3, textAlign: "center", color: theme.colors.neutralTextSecondary },
  confirmButtonRow: { flexDirection: "row", marginTop: theme.spacing.s3 },
  stampRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2, marginTop: theme.spacing.s3 },
  stampBtn: {
    width: theme.tapTarget.parent,
    height: theme.tapTarget.parent,
    borderRadius: theme.radius.parentMd,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  stampBtnSent: {
    backgroundColor: theme.colors.brandPrimarySoft,
    borderColor: theme.colors.brandPrimary,
  },
  stampEmoji: { fontSize: 18 },
  commentLink: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  modalCard: { width: "100%", maxWidth: 420 },
  stampGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.s2,
    marginTop: theme.spacing.s2,
  },
  stampChip: {
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  stampChipSent: {
    backgroundColor: theme.colors.brandPrimarySoft,
    borderColor: theme.colors.brandPrimary,
  },
  textArea: {
    marginTop: theme.spacing.s2,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    padding: theme.spacing.s3,
    minHeight: 72,
    textAlignVertical: "top",
    backgroundColor: theme.colors.neutralBg,
  },
});
