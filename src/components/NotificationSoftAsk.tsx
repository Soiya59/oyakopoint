/**
 * プッシュ通知のソフトアスク（要件定義書07-37章6章、UIUXデザイン部/成果物/
 * 主要画面ワイヤーフレーム.md 63.4節）＋ 端末トークンの自動登録。
 *
 * [表示条件・63.4.0節で1つの条件に統合済み] 次の4つをすべて満たすとき、
 * アプリ起動・フォアグラウンド復帰のたびに1回だけモーダルを表示する。
 *   (a) families.push_notifications_enabled が true
 *   (b) 現在のロールが保護者・副管理者・みまもりメンバー（子どもは対象外）
 *   (c) この端末のOS許可状態が未回答（undetermined）
 *   (d) この端末に「あとで」の印が無い（端末ローカル、DBには持たない）
 *
 * [子どものPINログイン中は一切出さない・6-2節必須要件] 上記(b)の判定
 * （session.status）で子どもは構造的に除外される。子ども向け画面には
 * 本コンポーネントの呼び出し自体を作らない設計にはしていない（ルート
 * レイアウト1箇所に置く、63.9節3の申し送りどおり）が、(b)の判定により
 * 子どものセッション中はモーダルもOSダイアログも表示されない。
 *
 * [ソフトアスクの表示位置] 特定の画面に紐づけず、ルートのレイアウト
 * （app/_layout.tsx）でPushSoftAskProviderとしてSlotの外側に1回だけ配線する
 * （63.9節3の申し送りどおり）。
 *
 * [端末トークンの自動登録] 63.4.2節「許可された」の直後だけでなく、
 * ログイン中のメンバーが変わるたび（保護者⇄みまもり⇄子どものPIN切り替え
 * を含む）に、既にOS許可が"granted"であれば登録する
 * （設計部/成果物/スキーマ設計.sql 74.13章「開発部へ」2番）。
 *
 * [2026-09-22追加・実装メモ283章 欠落③] 通知をタップしたときの遷移
 * （要件定義書07-37章2-1節「タップ先で本文を読む導線」必須要件、
 * ワイヤーフレーム63.2.3節「タップ先は投稿履歴一覧」）。
 * `addNotificationResponseReceivedListener`（アプリ起動中にタップした場合）と
 * `getLastNotificationResponseAsync`（アプリが完全終了した状態からタップで
 * 起動した場合）の両方を拾う。タップ先はログイン中のロールに応じて
 * P32/C27/S20（家族の掲示板）を出し分ける。**未ログイン・ロール未確定の間は
 * 何もしない**（自動ログイン誘導は作らない。落ちないことのみを保証する）。
 * 63.2.3節が求める「対象の投稿の行を数秒だけハイライト表示する」は本追加の
 * 対象外（一覧画面側の改修が要るため。実装メモ283章に申し送り済み）。
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import AppButton from "@/components/AppButton";
import Card from "@/components/Card";
import theme from "@/theme/theme";
import { useSession } from "@/lib/session";
import type { SessionStatus } from "@/lib/session";
import { useAppData } from "@/data/store";
import { useBackgroundAutoRefresh } from "@/hooks/useBackgroundAutoRefresh";
import {
  computeDeviceNotificationRowState,
  getOsPermissionStatus,
  isSoftAskDeferred,
  openDeviceNotificationSettings,
  registerPushTokenForMember,
  requestPushPermissionAndRegister,
  setSoftAskDeferred,
} from "@/lib/pushNotifications";

type Phase = "ask" | "denied" | "granted";

/** 掲示板の投稿通知のペイロード（Edge Function側の型と対応。
 * `supabase/functions/notify-family-board-post/index.ts`の`data`参照）。 */
type FamilyBoardPushData = { type?: string; post_id?: string };

/**
 * [2026-09-23追加・要件定義書07章隣接の2026-09-23決定「コメントが付いたら
 * 書いた人にだけ通知」、07-38章4章、開発部/成果物/実装メモ.md 293章]
 * コメント通知（`notify-comment`）・お絵かきの公開通知
 * （`notify-drawing-published`）のペイロード。
 */
type CommentPushData = { type?: string; kind?: string; comment_id?: string };
type DrawingPublishedPushData = { type?: string; drawing_id?: string };

type FamilyBoardRoute = "/parent/family-board" | "/supporter/family-board" | "/child/family-board";
type ChoreActivityRoute = "/parent/approvals" | "/supporter/activity" | "/child/family";
type CollectorShelfRoute = "/parent/collector-shelf" | "/supporter/collector-shelf" | "/child/collector-shelf";

/** ログイン中のロールから、家族の掲示板の遷移先ルートを決める。
 * ロールが確定していない（"loading"）・ログインしていない（"signedOut"）・
 * 家族に未所属（"parentNoFamily"）の間はnullを返し、呼び出し側は何もしない。 */
function familyBoardRouteForStatus(status: SessionStatus): FamilyBoardRoute | null {
  if (status === "parent") return "/parent/family-board";
  if (status === "supporter") return "/supporter/family-board";
  if (status === "child") return "/child/family-board";
  return null;
}

/**
 * [2026-09-23追加] 完了報告へのコメント通知（`chore_reaction_comment`）の
 * タップ先。「とどいたリアクション」一覧を持つ既存画面（P9/S2/かぞくタブ）を
 * 流用する。対象の行を特定して自動でハイライトする導線までは作らない
 * （283章が掲示板投稿通知で同じ理由により見送った「一覧を開くところまで」と
 * 同じ判断。設計部76.13章「タップ先の導線は未確定」）。
 */
function choreActivityRouteForStatus(status: SessionStatus): ChoreActivityRoute | null {
  if (status === "parent") return "/parent/approvals";
  if (status === "supporter") return "/supporter/activity";
  if (status === "child") return "/child/family";
  return null;
}

/**
 * [2026-09-23追加・要件定義書07-38章4-5節・6-5節] お絵かきの公開通知・
 * コメント通知のタップ先。コレクション「集めたもの」画面を開く
 * （対象アイテムの自動ハイライトは65.4.5節がUIUXデザイン部の判断で
 * 「一覧＋利用者の能動的なタップ」に具体化したものだが、その一覧側の
 * ハイライト実装自体は本タスクのスコープ外——283章と同じ「一覧を開く
 * ところまで」の判断。設計部76.13章にも同旨の申し送りがある）。
 */
function collectorShelfRouteForStatus(status: SessionStatus): CollectorShelfRoute | null {
  if (status === "parent") return "/parent/collector-shelf";
  if (status === "supporter") return "/supporter/collector-shelf";
  if (status === "child") return "/child/collector-shelf";
  return null;
}

interface PushSoftAskContextValue {
  /** 63.5.1節/63.5.2節「今すぐ設定する」から、条件チェックを経ずに直接開く。 */
  openManually: () => void;
}

const PushSoftAskContext = createContext<PushSoftAskContextValue | null>(null);

/** ソフトアスクの対象ロールか（要件定義書07-37章3章・6-2節。子どもは対象外）。 */
function isEligibleRole(status: string): boolean {
  return status === "parent" || status === "supporter";
}

/** いまログイン中のメンバーid（ロールに応じて取得元が異なる）。 */
function useCurrentMemberId(): string | null {
  const { status, parentMember, childSession } = useSession();
  if (status === "parent" || status === "supporter") return parentMember?.id ?? null;
  if (status === "child") return childSession?.member.member_id ?? null;
  return null;
}

export function PushSoftAskProvider({ children }: { children: React.ReactNode }) {
  const { status, client } = useSession();
  const { state } = useAppData();
  const memberId = useCurrentMemberId();

  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<Phase>("ask");

  const eligible = isEligibleRole(status);
  // [2026-09-23追加・要件定義書07-37章4章、UIUXデザイン部/成果物/主要画面
  // ワイヤーフレーム.md 64.8節「決定4」、開発部/成果物/実装メモ.md 292章]
  // 掲示板の通知トグル（families.push_notifications_enabled）だけでなく、
  // 「メッセージ」の少なくとも1つの枠が「そうしんする」状態（enabled=true
  // かつmessageが設定済み）で保存されていれば、この条件も成立させる
  // （OR条件）。**63.4.0節・63.5.1節・63.5.2節の本文（掲示板のみを前提と
  // した記述）は書き換えない——64.8節が実測済みの決定どおり「本節を実装時の
  // 最新条件として参照する」形を取る。掲示板の通知だけを使っている家族の
  // 挙動は変わらない（scheduledAnnouncementsが空配列、またはすべて
  // enabled=falseの家族は、この行がfalseになりOR条件全体は従来どおり
  // familyToggleOnだけで決まるため）。**
  const hasActiveScheduledAnnouncement = state.scheduledAnnouncements.some(
    (a) => a.enabled && !!a.message
  );
  const familyToggleOn = state.family.push_notifications_enabled || hasActiveScheduledAnnouncement;

  // [63.4.0節の1条件] 対象ロール・家族トグルON・端末が未回答・「あとで」印が
  // 無い、の4つを満たすときだけ表示する。
  const checkAndMaybeShow = useCallback(async () => {
    if (!eligible || !familyToggleOn) return;
    const deferred = await isSoftAskDeferred();
    if (deferred) return;
    const osStatus = await getOsPermissionStatus();
    if (osStatus !== "undetermined") return;
    setPhase("ask");
    setVisible(true);
  }, [eligible, familyToggleOn]);

  // 起動時・対象ロールや家族トグルが変わったときに1回確認する。
  useEffect(() => {
    void checkAndMaybeShow();
  }, [checkAndMaybeShow]);

  // アプリのフォアグラウンド復帰・画面遷移のたびに再確認する
  // （src/hooks/useBackgroundAutoRefresh.ts、6-1節「次にアプリを開いたとき」）。
  useBackgroundAutoRefresh(() => void checkAndMaybeShow(), { enabled: eligible && familyToggleOn });

  // [設計部/成果物/スキーマ設計.sql 74.13章「開発部へ」2番] ログイン中の
  // メンバーが変わるたび（子どものPIN切り替えを含む）に、既にOS許可が
  // 済んでいれば端末トークンを登録し直す。ソフトアスクの表示条件とは独立
  // （このeffectはeligibleでなくても——子どもでも——動く。子どもの端末にも
  // 通知は届く設計のため、74.1章の端末単位の除外にはこの登録が必須）。
  useEffect(() => {
    if (!memberId) return;
    void registerPushTokenForMember(client, memberId);
  }, [client, memberId]);

  // [2026-09-22追加・実装メモ283章 欠落③、2026-09-23拡張・実装メモ293章]
  // 通知タップ時の遷移。タップされた事実は`pendingRouteResolverRef`に
  // 「ロールから遷移先を決める関数」として保持し、ロールが確定していなければ
  // `status`が変わるたびに再評価する（コールドスタート直後は`status`が
  // "loading"のことがあるため）。掲示板投稿通知（家族の掲示板）・コメント
  // 通知（種類ごとに遷移先が異なる）・お絵かきの公開通知（コレクション）の
  // 4種類のdata.typeをここで振り分ける。
  const pendingRouteResolverRef = useRef<((status: SessionStatus) => string | null) | null>(null);
  const statusRef = useRef(status);

  useEffect(() => {
    const resolverForData = (
      data: (FamilyBoardPushData & CommentPushData & DrawingPublishedPushData) | undefined
    ): ((status: SessionStatus) => string | null) | null => {
      if (data?.type === "family_board_post") return familyBoardRouteForStatus;
      if (data?.type === "drawing_published") return collectorShelfRouteForStatus;
      if (data?.type === "comment") {
        if (data.kind === "family_board_comment") return familyBoardRouteForStatus;
        if (data.kind === "chore_reaction_comment") return choreActivityRouteForStatus;
        if (data.kind === "family_drawing_comment") return collectorShelfRouteForStatus;
      }
      return null;
    };

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as
        | (FamilyBoardPushData & CommentPushData & DrawingPublishedPushData)
        | undefined;
      const resolver = resolverForData(data);
      if (!resolver) return;
      pendingRouteResolverRef.current = resolver;
      // このeffectはstatusに依存させたくない（購読の張り直しを避ける）ため、
      // 下のeffectに評価を委ねずここでも即時に試す（起動中のタップは大抵
      // ロールが既に確定しているため、ここで即座に遷移できる）。
      const route = resolver(statusRef.current);
      if (route) {
        pendingRouteResolverRef.current = null;
        router.push(route as import("expo-router").Href);
      }
    };

    // アプリが完全終了した状態から、通知タップで起動した場合。
    // [Web版での制約・★正直に書く] Web版は`NotificationsEmitterModule`に
    // `getLastNotificationResponse`が無く（`.web.js`が存在せず既定の
    // no-op実装が使われる。`node_modules/expo-notifications/build/
    // NotificationsEmitterModule.js`で確認済み）、呼ぶと`UnavailabilityError`
    // で拒否される。catchせずに投げると未処理のPromise拒否になるため、
    // 他の関数（`getOsPermissionStatus`等）と同じく黙って握りつぶす。
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleResponse(response);
      })
      .catch((err: unknown) => {
        console.warn("NotificationSoftAsk: getLastNotificationResponseAsync failed", err);
      });

    // アプリ起動中（フォアグラウンド・バックグラウンド問わず）にタップした場合。
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => sub.remove();
  }, []);

  // 上のeffectが起動した瞬間にロールがまだ確定していなかった場合
  // （例: コールドスタート直後で`status`が"loading"）、statusが変わるたびに
  // 再評価する。ロールが最後まで確定しない（未ログインのまま）場合は何も
  // 起きない＝落ちない、で意図どおり。
  useEffect(() => {
    statusRef.current = status;
    if (!pendingRouteResolverRef.current) return;
    const route = pendingRouteResolverRef.current(status);
    if (!route) return;
    pendingRouteResolverRef.current = null;
    router.push(route as import("expo-router").Href);
  }, [status]);

  const later = useCallback(async () => {
    await setSoftAskDeferred();
    setVisible(false);
  }, []);

  const askOs = useCallback(async () => {
    // [63.4.2節] モーダルは閉じ、OS標準の許可ダイアログへ続く
    // （アプリ側で独自の待機表示は作らない）。
    setVisible(false);
    if (!memberId) return;
    const result = await requestPushPermissionAndRegister(client, memberId);
    if (result === "granted") {
      setPhase("granted");
      setVisible(true);
      // [63.4.2節「追加の演出はしない」] 数秒で自動的に消える。
      setTimeout(() => setVisible(false), 2500);
    } else if (result === "denied") {
      setPhase("denied");
      setVisible(true);
    }
    // undeterminedのまま返ることは想定していない（OSダイアログを実際に
    // 見せた直後のため）。念のため何もしない。
  }, [client, memberId]);

  const openManually = useCallback(() => {
    setPhase("ask");
    setVisible(true);
  }, []);

  return (
    <PushSoftAskContext.Provider value={{ openManually }}>
      {children}
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.backdrop}>
          <Card style={styles.card}>
            {phase === "ask" && (
              <>
                <Text style={styles.emoji}>{"\u{1F514}"}</Text>
                <Text style={theme.typography.parentTitle}>書き込みが届いたら、{"\n"}通知しましょうか</Text>
                <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s3 }]}>
                  家族の掲示板に書き込みがあったとき、{"\n"}
                  スマホへ通知を送ります。{"\n"}
                  届いた通知をタップすると、{"\n"}
                  その書き込みをすぐに読めます。
                </Text>
                <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s3 }]}>
                  あとから、家族の設定でいつでも止められます。
                </Text>
                <View style={styles.buttonRow}>
                  <AppButton label="あとで" variant="secondary" onPress={() => void later()} style={styles.buttonHalf} />
                  <AppButton label="通知してほしい" onPress={() => void askOs()} style={styles.buttonHalf} />
                </View>
              </>
            )}

            {phase === "denied" && (
              <>
                <Text style={styles.emoji}>{"\u{1F514}"}</Text>
                <Text style={theme.typography.parentTitle}>
                  この端末の通知が、{"\n"}OSの設定で止まっています
                </Text>
                <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s3 }]}>
                  いちどOSに「許可しない」を伝えると、{"\n"}
                  アプリからはもう一度お願いできません。{"\n"}
                  端末の「設定」アプリから、この{"\n"}
                  アプリの通知を「オン」にすると、{"\n"}
                  また使えるようになります。
                </Text>
                <View style={styles.buttonRow}>
                  <AppButton label="とじる" variant="secondary" onPress={() => setVisible(false)} style={styles.buttonHalf} />
                  <AppButton
                    label="設定を開く"
                    onPress={() => void openDeviceNotificationSettings()}
                    style={styles.buttonHalf}
                  />
                </View>
              </>
            )}

            {phase === "granted" && (
              <>
                <Text style={styles.emoji}>{"\u{1F514}"}</Text>
                <Text style={theme.typography.parentBody}>通知を設定しました</Text>
              </>
            )}
          </Card>
        </View>
      </Modal>
    </PushSoftAskContext.Provider>
  );
}

export function usePushSoftAsk(): PushSoftAskContextValue {
  const ctx = useContext(PushSoftAskContext);
  if (!ctx) throw new Error("usePushSoftAsk must be used within PushSoftAskProvider");
  return ctx;
}

/**
 * 63.5.1節（P40）・63.5.2節（S13）共通の「この端末の状態」1行。
 * 行動が必要なとき（あとで選択済み／OSで拒否済み）だけ表示する。
 * 呼び出し元が家族トグルの状態に応じて`visible`を渡すこと（63.5.2節
 * 「家族の通知トグルがオフ」のときは何も表示しない、というロールごとの
 * 条件が異なるため、本コンポーネント自体は家族トグルを見ない）。
 */
export function NotificationDeviceStatusRow({
  visible,
  tone,
}: {
  visible: boolean;
  tone: "parent" | "supporter";
}) {
  const { openManually } = usePushSoftAsk();
  const [rowState, setRowState] = useState<"granted" | "deferred" | "denied" | "undetermined" | null>(null);

  const refresh = useCallback(async () => {
    if (!visible) return;
    setRowState(await computeDeviceNotificationRowState());
  }, [visible]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useBackgroundAutoRefresh(() => void refresh(), { enabled: visible });

  if (!visible || rowState === null || rowState === "granted" || rowState === "undetermined") return null;

  const bodyStyle = tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;

  if (rowState === "deferred") {
    return (
      <View style={{ marginTop: theme.spacing.s3 }}>
        <Text style={bodyStyle}>この端末では、まだ通知を受け取る設定になっていません。</Text>
        <Pressable onPress={openManually} style={{ marginTop: theme.spacing.s1 }}>
          <Text style={[bodyStyle, { textDecorationLine: "underline" }]}>今すぐ設定する</Text>
        </Pressable>
      </View>
    );
  }

  // rowState === "denied"
  return (
    <View style={{ marginTop: theme.spacing.s3 }}>
      <Text style={bodyStyle}>この端末の通知が、OSの設定で止まっています。</Text>
      <Pressable onPress={() => void openDeviceNotificationSettings()} style={{ marginTop: theme.spacing.s1 }}>
        <Text style={[bodyStyle, { textDecorationLine: "underline" }]}>設定を開く</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  card: { width: "100%", maxWidth: 480, alignItems: "center" },
  emoji: { fontSize: 40, marginBottom: theme.spacing.s2 },
  buttonRow: { flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s6, width: "100%" },
  buttonHalf: { flex: 1 },
});
