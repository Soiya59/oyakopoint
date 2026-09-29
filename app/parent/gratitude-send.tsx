import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import ChoreRequestPanel from "@/components/ChoreRequestPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { fetchMyGratitudeGiveableBalance, PG_ERRCODE, sendGratitudePoints } from "@/data/api";
import { gratitudeSendErrorText } from "@/lib/gratitudeSendError";
import { formatPgFailureRef } from "@/lib/pgFailureRef";
import { useNgWordGuard } from "@/hooks/useNgWordGuard";
import NgWordWarningText from "@/components/NgWordWarningText";
import {
  gratitudeLimitBackLabel,
  gratitudeLimitBackRoute,
  isGratitudeAllowanceConflict,
  parseGratitudeSendParams,
  shouldShowGratitudeLimitCard,
  type GratitudeBalanceState,
  type GratitudeSendTab,
} from "@/lib/requestChore";
import {
  GRATITUDE_BALANCE_ERROR_TEXT,
  GRATITUDE_BALANCE_RETRY_LABEL,
  GRATITUDE_LIMIT_CARD_LINES,
  TAB_LABEL_REQUEST,
  TAB_LABEL_THANKS,
} from "@/lib/requestChoreText";

/**
 * P22 感謝ポイントを贈る（保護者）
 * 参照: 主要画面ワイヤーフレーム.md 10.2章、画面一覧・遷移図.md P22・3.10章
 *
 * 決定2（10.0章）: ポイント数はステッパー式（自由入力欄にしない）。上限は
 * my_gratitude_giveable_balance()の返り値に固定し、check_violationがほぼ発生しない
 * 設計にする。
 * 決定3: 贈り先選択UIから自分自身をあらかじめ除外する。
 * 決定4: 子ども・保護者を区別せず同一の並びで表示する（family_membersの登録順）。
 *
 * [2026-09-07修正・実装メモ.md 141章] みまもりメンバーを候補から除外するフィルタは
 * 元々実装されていなかった（`candidates`は`is_active && id !== myId`のみ。スキーマ
 * 設計.sql 48.11章で確認済み）。この画面自体のバグ修正は、送信エラー時に
 * `res.error.message`（PostgrestErrorの生メッセージ）をそのまま表示していた点のみ
 * （RLS違反時にPostgresの英語メッセージが利用者に見えていた）。`gratitudeSendErrorText`
 * （`src/lib/gratitudeSendError.ts`）を通した日本語文言に置き換えた。
 *
 * [2026-09-30改訂・要件定義書07-43章、主要画面ワイヤーフレーム.md 70章、実装メモ.md 335章]
 * 上に「ありがとうを贈る｜おねがいする」の切り替えを置いた（D1。新しい画面・独立したURLは
 * 作らない。利用者から見て「感謝ポイントの画面の中」）。「おねがいする」タブの中身は
 * `ChoreRequestPanel`（保護者だけの機能。みまもり・子どもの贈る画面には切り替えを出さない）。
 * あわせて次を足した（送信・上限・取消・ひとことの必須／任意・NGワード確認・原資の計算は
 * 変更していない）:
 * - D13: URLの引数`to`（相手のメンバーID）・`draft`（ひとことの下書き）・`tab`（`thanks`が既定・
 *   `request`）・`from`（`approvals`など）を受け取る。開いたときに1回だけ反映し、あとから
 *   引数が変わっても入力中の文字を上書きしない。やりとりスイッチがOFFのときは下書きを捨てる。
 * - D14: 「ありがとうを贈る」タブで残りが0と分かったら、フォームの代わりに案内カードと戻る導線
 *   だけを出す（押せない灰色のボタンを残さない）。上の切り替えは出したまま（「おねがいする」へ
 *   移れる）。残りの取得に失敗したときは「残りを確認できません」＋「もういちど」（今までは
 *   無言で「贈る」が無効のままだった）。競合（別の保護者が最後の1ptを贈った直後）で原資超過の
 *   エラーが返ったときは、DBの生の文言を出さず、残りを0に置き換えて案内カードを出す。
 * - 「きょうあと◯pt贈れます」は「ありがとうを贈る」タブのときだけ出す（おねがいにポイントが
 *   要るように見えないため）。
 */
type ScreenState = "form" | "sending";

export default function ParentGratitudeSendScreen() {
  const { state, memberAvatars } = useAppData();
  const { client } = useSession();
  const myId = state.activeParentMemberId;
  // [2026-09-20追加・やること.md 4-71] 保護者トグル「家族のやりとりを使う」
  // （設計部/成果物/スキーマ設計.sql 67章）。トグルの設定画面はまだ無いため
  // 列の値を読むだけにしておく（次回、画面対応時にここへ配線する）。
  const interactionsEnabled = state.family.social_interactions_enabled ?? true;

  const candidates = state.members.filter((m) => m.is_active && m.id !== myId);

  // [D13] 開いたときの相手・下書き・タブ・戻り先を、URLの引数から**1回だけ**決める
  // （useStateの初期化子。あとから引数が変わっても入力中の文字を上書きしない）。
  const params = useLocalSearchParams<{ to?: string; draft?: string; tab?: string; from?: string }>();
  const [initial] = useState(() =>
    parseGratitudeSendParams(
      params,
      candidates.map((m) => m.id),
      interactionsEnabled
    )
  );

  const [tab, setTab] = useState<GratitudeSendTab>(initial.tab);
  // 「おねがいする」タブは、最初に開いたときに作る（使わない人に完了の集計の取得を走らせない）。
  // 一度開いたあとは作りっぱなしにして、切り替えても入力が消えないようにする。
  const [requestVisited, setRequestVisited] = useState(initial.tab === "request");
  const [requestBusy, setRequestBusy] = useState(false);

  const [balance, setBalance] = useState<number | null>(null);
  const [balanceState, setBalanceState] = useState<GratitudeBalanceState>("loading");
  const [recipientId, setRecipientId] = useState<string | null>(initial.recipientId);
  const [note, setNote] = useState(initial.draft);
  const [points, setPoints] = useState(1);
  const [screenState, setScreenState] = useState<ScreenState>("form");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // [2026-09-27新設・ワイヤーフレーム67章決定7順位2] 原因追跡用の識別子
  // （個人情報を含まない）。保護者・みまもり画面のみ（決定5・6、子ども向け
  // 画面 app/child/gratitude-send.tsx には出さない）。
  const [errorRef, setErrorRef] = useState<string | null>(null);
  const ngGuard = useNgWordGuard();

  const loadBalance = useCallback(async () => {
    setBalanceState("loading");
    const res = await fetchMyGratitudeGiveableBalance(client);
    if (res.ok) {
      setBalance(res.data);
      setBalanceState("ready");
    } else {
      setBalanceState("error");
    }
  }, [client]);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  const maxPoints = balance ?? 0;
  const trimmedNote = note.trim();
  // トグルがオンの間はこれまでどおり自由記述必須。オフのときはひとこと
  // が空でも贈れる（67.3章。感謝ポイントを贈ること自体は止めない）。
  const noteBlocksSend = interactionsEnabled && !trimmedNote;
  // 保存中・送信中は切り替えを押せない（二重送信・途中切り替えの防止）。
  const busy = screenState === "sending" || requestBusy;
  const showLimitCard = shouldShowGratitudeLimitCard(balanceState, balance);

  const switchTab = (next: GratitudeSendTab) => {
    if (busy || next === tab) return;
    if (next === "request") setRequestVisited(true);
    setTab(next);
  };

  const goBackOr = (fallback: "/parent/approvals" | "/parent/gratitude") => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  };

  // おねがいを頼み終えた（または「ここまでの分でよい」）: 前の画面へ戻る（戻れないときは感謝ポイント）。
  const finishRequest = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/parent/gratitude");
  }, []);

  const send = async () => {
    if (!myId || !recipientId || points < 1 || noteBlocksSend) return;
    if (ngGuard.guard(trimmedNote)) return;
    setScreenState("sending");
    setErrorMessage(null);
    setErrorRef(null);
    const res = await sendGratitudePoints(client, {
      sender_id: myId,
      recipient_id: recipientId,
      points,
      note: trimmedNote ? trimmedNote : null,
    });
    setScreenState("form");
    if (!res.ok) {
      // [D14] 競合（別の保護者が最後の1ptを贈った直後など）は、DBの生の文言を出さず、
      // 残りを0に置き換えて案内カードを出す。
      if (isGratitudeAllowanceConflict(res.error, PG_ERRCODE.checkViolation)) {
        setBalance(0);
        setBalanceState("ready");
        return;
      }
      setErrorMessage(gratitudeSendErrorText("parent", res.error));
      setErrorRef(formatPgFailureRef(res.error));
      return;
    }
    const recipientName = state.members.find((m) => m.id === recipientId)?.display_name ?? "";
    router.replace({
      pathname: "/parent/gratitude",
      params: { toastName: recipientName, toastPoints: String(points) },
    });
  };

  return (
    <Screen tone="parent">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.parentBody}>← もどる</Text>
        </Pressable>
        {/* 「きょうあと◯pt贈れます」は感謝ポイントの話。「おねがいする」タブ・残り0の案内のときは出さない。 */}
        {tab === "thanks" && !showLimitCard && balanceState !== "error" && (
          <Text style={[theme.typography.parentBody, styles.headerRight]}>
            きょうあと{balance ?? "…"}pt贈れます
          </Text>
        )}
        {tab === "thanks" && balanceState === "error" && (
          <View style={styles.headerRightBox}>
            <Text style={[theme.typography.parentCaption, styles.headerRight]}>{GRATITUDE_BALANCE_ERROR_TEXT}</Text>
            <Pressable onPress={() => void loadBalance()} hitSlop={8}>
              <Text style={styles.linkText}>{GRATITUDE_BALANCE_RETRY_LABEL}</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* 上の切り替え（D1）。等分（flex: 1）・2行まで折り返し・選択中は枠と淡い背景＋太字。 */}
      <View style={styles.tabRow}>
        {(
          [
            { key: "thanks", label: TAB_LABEL_THANKS },
            { key: "request", label: TAB_LABEL_REQUEST },
          ] as const
        ).map((t) => {
          const selected = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => switchTab(t.key)}
              disabled={busy}
              style={[styles.tabButton, selected && styles.tabButtonSelected, busy && !selected && styles.tabButtonBusy]}
              accessibilityRole="tab"
              accessibilityState={{ selected, disabled: busy }}
            >
              <Text
                style={[theme.typography.parentBody, styles.tabLabel, selected && styles.tabLabelSelected]}
                numberOfLines={2}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ---- 「ありがとうを贈る」タブ ---- */}
      <View style={tab === "thanks" ? undefined : styles.hidden}>
        {showLimitCard ? (
          // [D14] 残り0: フォームの代わりに案内カードと戻る導線だけを出す。赤は使わない。
          <View>
            <View style={styles.limitCard}>
              {GRATITUDE_LIMIT_CARD_LINES.map((line) => (
                <Text key={line} style={[theme.typography.parentBody, styles.limitCardText]}>
                  {line}
                </Text>
              ))}
            </View>
            <AppButton
              label={gratitudeLimitBackLabel(initial.from)}
              fullWidth
              style={{ marginTop: theme.spacing.s4 }}
              onPress={() => goBackOr(gratitudeLimitBackRoute(initial.from))}
            />
          </View>
        ) : (
          <>
            <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>だれに？</Text>
            <View style={styles.chipRow}>
              {candidates.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setRecipientId(m.id)}
                  style={[styles.memberChip, recipientId === m.id && styles.memberChipSelected]}
                >
                  <MemberAvatar name={m.display_name} color={m.avatar_color} size={28} lineData={memberAvatars[m.id]} />
                  <Text style={{ marginLeft: theme.spacing.s2, flexShrink: 1 }}>{m.display_name}</Text>
                </Pressable>
              ))}
            </View>

            {/* [2026-09-21追加・要件定義書07-32章決定17、主要画面ワイヤーフレーム.md 56.4節
                決定20] 保護者トグル「家族のやりとりを使う」がオフの間は、この欄ごと描かない
                （感謝ポイントを贈ること自体は止めない）。 */}
            {interactionsEnabled && (
              <>
                <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>
                  なにをしてくれた？（必須）
                </Text>
                <TextInput
                  value={note}
                  onChangeText={(t) => {
                    setNote(t);
                    ngGuard.clear();
                  }}
                  placeholder="例：帰り道に荷物を持ってくれた"
                  multiline
                  maxLength={200}
                  style={styles.noteInput}
                />
                {ngGuard.blocked && <NgWordWarningText tone="parent" />}
              </>
            )}

            <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>なんpt贈る？</Text>
            <View style={styles.stepperRow}>
              <Pressable
                onPress={() => setPoints((p) => Math.max(1, p - 1))}
                disabled={points <= 1}
                style={styles.stepperBtn}
              >
                <Text style={styles.stepperBtnText}>−</Text>
              </Pressable>
              <Text style={styles.stepperValue}>{points}pt</Text>
              <Pressable
                onPress={() => setPoints((p) => Math.min(maxPoints, p + 1))}
                disabled={points >= maxPoints}
                style={styles.stepperBtn}
              >
                <Text style={styles.stepperBtnText}>＋</Text>
              </Pressable>
            </View>

            {errorMessage && (
              <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
            )}
            {/* [2026-09-27新設・ワイヤーフレーム67章決定4] 何の文字列か分かるよう「目印」を添える。 */}
            {errorRef && (
              <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
                目印 {errorRef}
              </Text>
            )}

            <AppButton
              label={screenState === "sending" ? "贈っています…" : "贈る"}
              fullWidth
              loading={screenState === "sending"}
              disabled={screenState === "sending" || !recipientId || noteBlocksSend || maxPoints < 1}
              style={{ marginTop: theme.spacing.s6 }}
              onPress={send}
            />
          </>
        )}
      </View>

      {/* ---- 「おねがいする」タブ（残りの取得を待たない。感謝ポイントの上限とも関係ない） ---- */}
      {requestVisited && (
        <View style={tab === "request" ? undefined : styles.hidden}>
          <ChoreRequestPanel onBusyChange={setRequestBusy} onFinished={finishRequest} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerRight: { flexShrink: 1, textAlign: "right", marginLeft: theme.spacing.s3 },
  headerRightBox: { flexShrink: 1, alignItems: "flex-end", marginLeft: theme.spacing.s3 },
  linkText: { marginTop: theme.spacing.s1, color: theme.colors.brandPrimaryStrong, textDecorationLine: "underline" },
  hidden: { display: "none" },
  tabRow: { flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s3 },
  tabButton: {
    flex: 1,
    minHeight: theme.tapTarget.parent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.s2,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  tabButtonSelected: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
  tabButtonBusy: { opacity: 0.5 },
  tabLabel: { textAlign: "center" },
  tabLabelSelected: { fontWeight: "700" },
  limitCard: {
    marginTop: theme.spacing.s6,
    padding: theme.spacing.s4,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.brandPrimary,
    backgroundColor: theme.colors.brandPrimarySoft,
  },
  limitCardText: { textAlign: "center" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s2 },
  memberChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  memberChipSelected: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
  noteInput: {
    marginTop: theme.spacing.s2,
    minHeight: 72,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    padding: theme.spacing.s3,
    textAlignVertical: "top",
  },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s4, marginTop: theme.spacing.s2 },
  stepperBtn: {
    width: theme.tapTarget.parent,
    height: theme.tapTarget.parent,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperBtnText: { fontSize: 20, fontWeight: "700" },
  stepperValue: { fontSize: 20, fontWeight: "700", minWidth: 60, textAlign: "center" },
});
