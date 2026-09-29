/**
 * P22（感謝ポイントの画面）の「おねがいする」タブの中身（保護者専用）。
 *
 * 参照: 要件定義書07-43章決定9・10・決定17・統括の追加決定（未完了は子ども1人につき3つまで）、
 * 設計部/成果物/API仕様.md 38.2章、UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 70.3節
 * （D2〜D5・D19）・70.11節（文字が大きい端末で崩れないこと）、開発部/成果物/実装メモ.md 335章。
 *
 * 入力は「だれに」と「なにを」だけ。ポイント・繰り返し・絵文字などの入力欄は画面に存在しない
 * （決定9。「先にポイントを決めない」ことを、入力欄が存在しないという形で担保する）。
 * 保存は子どもごとに別々のINSERT（`createChoreRequest`）。1人の失敗が他の人の成功を巻き戻さない。
 * 判定（選べる子・満杯・結果のまとめ）は`src/lib/requestChore.ts`の純粋関数（`node`で検証済み）。
 *
 * 失敗の表示は331章の仕組み（`useFailureNotice`＝原因別の文言＋目印）。「3つまで」は専用の
 * SQLSTATE `RQ001`（`PG_ERRCODE.chore_request_limit`）で見分け、通信の文言ではなく理由の文を出す。
 *
 * [文字が大きい端末・328・329章] 横に並べる部品は`flex: 1`の等分＋2行まで折り返し。チップは
 * `flexWrap`。理由の文・案内文は横幅いっぱいの`Text`。`adjustsFontSizeToFit`は使わない。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import FailureRefText from "@/components/FailureRefText";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { createChoreRequest, PG_ERRCODE, type ApiError } from "@/data/api";
import { useChoreCompletionTotals } from "@/hooks/useChoreCompletionTotals";
import { useFailureNotice } from "@/hooks/useFailureNotice";
import { describeApiFailure } from "@/lib/apiFailureDisplay";
import {
  buildRequestChildOptions,
  canSubmitRequest,
  fullChildNames,
  initialRequestSelection,
  isAllRequestFull,
  normalizeRequestTitle,
  pruneRequestSelection,
  requestFailureStatus,
  requestTitleCounter,
  summarizeRequestOutcomes,
  toggleRequestSelection,
  type RequestOutcome,
} from "@/lib/requestChore";
import {
  REQUEST_CREATE_FAILED_MESSAGE,
  REQUEST_FULL_OPEN_MANAGE_LABEL,
  REQUEST_NO_CHILD_ACTION,
  REQUEST_NO_CHILD_TITLE,
  REQUEST_RESULT_DONE_LABEL,
  REQUEST_SUCCESS_TITLE,
  REQUEST_TAB_INTRO,
  REQUEST_TITLE_HEADING,
  REQUEST_TITLE_PLACEHOLDER,
  requestFullReasonText,
  requestResultFailedLine,
  requestResultFullLine,
  requestResultOkLine,
  requestRetryLabel,
  requestSelectedCaption,
  requestSubmitLabel,
  requestSuccessDetail,
  requestWhoHeading,
} from "@/lib/requestChoreText";
import { EmptyState } from "@/components/StatusViews";

interface Props {
  /** 保存中は上の切り替えを押せないようにするため、親（P22）へ知らせる。 */
  onBusyChange: (busy: boolean) => void;
  /** 全員分の保存が成功し、1.5秒の確認を出したあとに呼ぶ（前の画面へ戻る）。 */
  onFinished: () => void;
}

export default function ChoreRequestPanel({ onBusyChange, onFinished }: Props) {
  const { state, refresh, memberAvatars } = useAppData();
  const { client } = useSession();
  const familyId = state.family.id;
  const { loadState: totalsLoadState, isOneOffFinished, reload: reloadTotals } = useChoreCompletionTotals();

  const children = useMemo(
    () => state.members.filter((m) => m.role === "child" && m.is_active),
    [state.members]
  );

  // 未完了の数は、完了の集計の取得が終わってから数える（取得中・取得に失敗したときは淡色にしない。
  // 最終の砦はDBの上限で、通ってしまった依頼はRQ001の表示になる。70.3節「数を確認中／確認できない」）。
  const options = useMemo(() => {
    const built = buildRequestChildOptions(children, state.chores, isOneOffFinished, theme.requestLimit.maxOpenPerChild);
    return totalsLoadState === "ready" ? built : built.map((o) => ({ ...o, full: false }));
  }, [children, state.chores, isOneOffFinished, totalsLoadState]);

  const [selection, setSelection] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState<string[] | null>(null); // 成功した子どもの名前（成功表示中）
  const [outcomes, setOutcomes] = useState<RequestOutcome[] | null>(null); // 一部失敗の結果カード
  const { errorMessage, errorRef, setErrorMessage, showFailure } = useFailureNotice("parent");
  const initializedRef = useRef(false);

  // 開いた直後の選択（子ども1人なら選択済み。ただし満杯なら選択済みにしない）。子どもの一覧が
  // 確定した最初の1回だけ反映し、あとから選択を上書きしない。
  useEffect(() => {
    if (initializedRef.current || children.length === 0) return;
    initializedRef.current = true;
    setSelection(initialRequestSelection(options));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children.length]);

  // 選んでいる子が満杯になった（別の保護者が同時に頼んだ・一覧を取り直した）ら、選択から外す。
  useEffect(() => {
    setSelection((prev) => {
      const next = pruneRequestSelection(prev, options);
      return next.length === prev.length ? prev : next;
    });
  }, [options]);

  // 開いたまま戻ってきたとき（P10で取り下げてきた等）も、枠の数え直しをする。
  // （最初の1回は`useChoreCompletionTotals`のマウント時の取得と重なるので飛ばす）
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      void reloadTotals();
    }, [reloadTotals])
  );

  useEffect(() => {
    onBusyChange(saving);
  }, [saving, onBusyChange]);

  // 成功の表示は1.5秒だけ出して、前の画面へ戻る（70.3節D5）。
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(onFinished, theme.requestLimit.successDisplayMs);
    return () => clearTimeout(t);
  }, [finished, onFinished]);

  const nameOf = (id: string) => children.find((c) => c.id === id)?.display_name ?? "";
  const selectedNames = selection.map(nameOf);
  const trimmedTitle = normalizeRequestTitle(title);
  const counter = requestTitleCounter(title, theme.requestLimit.titleMaxLength, theme.requestLimit.titleWarningThreshold);
  const canSubmit = canSubmitRequest({ selectedCount: selection.length, title, saving });
  const fullNames = fullChildNames(options);
  const allFull = isAllRequestFull(options);

  /** 子どもごとに別々に作る。失敗しても止めず、ほかの子の分は作る（満杯の子だけがRQ001で断られる）。 */
  const runSave = async (childIds: string[], previous: RequestOutcome[]) => {
    if (!familyId) return;
    setSaving(true);
    setErrorMessage(null);
    const results: RequestOutcome[] = [];
    let firstFailure: ApiError | null = null;
    for (const childId of childIds) {
      const res = await createChoreRequest(client, familyId, { title: trimmedTitle, assigned_to: childId });
      if (res.ok) {
        results.push({ childId, status: "ok" });
      } else {
        const status = requestFailureStatus(res.error.code, PG_ERRCODE.chore_request_limit);
        results.push({ childId, status });
        if (status === "failed" && !firstFailure) firstFailure = res.error;
      }
    }
    // 一覧・満杯の判定を取り直す（別の端末で先に作られていた場合も含めて最新にする）。
    await refresh();
    void reloadTotals();
    setSaving(false);

    // 前回の結果のうち、今回やり直した子ども以外を引き継ぐ。
    const merged = [...previous.filter((p) => !childIds.includes(p.childId)), ...results];
    const summary = summarizeRequestOutcomes(merged);

    if (summary.allOk) {
      setOutcomes(null);
      setFinished(merged.map((o) => nameOf(o.childId)));
      return;
    }

    if (summary.okIds.length === 0) {
      // 全員失敗・1人で失敗: フォームは保持したまま、入力欄の下に原因別の文言＋目印。
      setOutcomes(null);
      if (summary.onlyFull) {
        // 「3つまで」（別の保護者が同時に頼んだ等）。通信の文言ではなく理由を出す。
        setErrorMessage(requestFullReasonText(summary.fullIds.map(nameOf), theme.requestLimit.maxOpenPerChild));
      } else if (firstFailure) {
        showFailure(firstFailure, { fallback: REQUEST_CREATE_FAILED_MESSAGE, useDbMessage: false });
      } else {
        setErrorMessage(REQUEST_CREATE_FAILED_MESSAGE);
      }
      return;
    }

    // 一部だけ成功（複数選択）: フォームを固定し、結果カードを出す。
    setOutcomes(merged);
    if (firstFailure) showFailure(firstFailure, { fallback: REQUEST_CREATE_FAILED_MESSAGE, useDbMessage: false });
  };

  const submit = async () => {
    if (!canSubmit) return;
    await runSave(selection, []);
  };

  const summary = outcomes ? summarizeRequestOutcomes(outcomes) : null;

  // ---- 子どもがいない ----
  if (children.length === 0) {
    return (
      <View>
        <EmptyState emoji="💌" title={REQUEST_NO_CHILD_TITLE} />
        <AppButton
          label={REQUEST_NO_CHILD_ACTION}
          fullWidth
          onPress={() => router.push("/parent/child-profile")}
        />
      </View>
    );
  }

  // ---- 成功（1.5秒） ----
  if (finished) {
    return (
      <View style={styles.successBox}>
        <Text style={styles.successEmoji}>💌</Text>
        <Text style={[theme.typography.parentTitle, styles.successText]}>{REQUEST_SUCCESS_TITLE}</Text>
        <Text style={[theme.typography.parentBody, styles.successText]}>{requestSuccessDetail(finished)}</Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={[theme.typography.parentCaption, styles.intro]}>{REQUEST_TAB_INTRO}</Text>

      {/* 一部だけ失敗したときは、フォームを固定する（二重に作らないため。39.3.4節の型） */}
      <View pointerEvents={outcomes ? "none" : "auto"} style={outcomes ? styles.formDisabled : undefined}>
        <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>{requestWhoHeading(children.length)}</Text>
        <View style={styles.chipRow}>
          {options.map((o) => {
            const selected = selection.includes(o.id);
            const member = children.find((c) => c.id === o.id);
            return (
              <Pressable
                key={o.id}
                disabled={o.full || saving}
                onPress={() => setSelection((prev) => toggleRequestSelection(prev, options, o.id))}
                style={[styles.chip, selected && styles.chipSelected, o.full && styles.chipFull]}
                accessibilityState={{ selected, disabled: o.full }}
              >
                <MemberAvatar
                  name={o.name}
                  color={member?.avatar_color}
                  size={28}
                  lineData={member ? memberAvatars[member.id] : undefined}
                />
                {/* 選んだことを色だけで伝えない（名前の後ろに✓）。折り返しを許す。 */}
                <Text style={styles.chipText}>
                  {o.name}
                  {selected ? " ✓" : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* 満杯の子がいるときは、押して初めて分かる作りにせず、理由を常に出す（D19）。 */}
        {fullNames.length > 0 && (
          <View>
            <Text style={[theme.typography.parentCaption, styles.reason]}>
              {requestFullReasonText(fullNames, theme.requestLimit.maxOpenPerChild)}
            </Text>
            <Pressable onPress={() => router.push("/parent/chores")} hitSlop={8}>
              <Text style={styles.linkText}>{REQUEST_FULL_OPEN_MANAGE_LABEL}</Text>
            </Pressable>
          </View>
        )}

        {requestSelectedCaption(selectedNames) && (
          <Text style={[theme.typography.parentCaption, styles.reason]}>{requestSelectedCaption(selectedNames)}</Text>
        )}

        <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>{REQUEST_TITLE_HEADING}</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={REQUEST_TITLE_PLACEHOLDER}
          multiline={false}
          maxLength={theme.requestLimit.titleMaxLength}
          editable={!saving}
          style={styles.input}
        />
        <Text
          style={[
            theme.typography.parentCaption,
            styles.counter,
            { color: counter.warn ? theme.colors.statusPending : theme.colors.neutralTextSecondary },
          ]}
        >
          {counter.text}
        </Text>
      </View>

      {errorMessage && !outcomes && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}
      {!outcomes && <FailureRefText value={errorRef} tone="parent" />}

      {/* 一部失敗の結果カード（アンバー。赤は使わない）。複数を選んだときだけ出る。 */}
      {outcomes && summary && (
        <Card style={styles.resultCard} tone="parent">
          {outcomes.map((o) => (
            <Text key={o.childId} style={theme.typography.parentBody}>
              {o.status === "ok"
                ? requestResultOkLine(nameOf(o.childId))
                : o.status === "full"
                ? requestResultFullLine(nameOf(o.childId), theme.requestLimit.maxOpenPerChild)
                : requestResultFailedLine(nameOf(o.childId))}
            </Text>
          ))}
          {errorMessage && summary.failedIds.length > 0 && (
            <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
              （{errorMessage}）
            </Text>
          )}
          <FailureRefText value={errorRef} tone="parent" />
          {summary.retryIds.length > 0 && (
            <AppButton
              label={requestRetryLabel(summary.retryIds.map(nameOf))}
              fullWidth
              loading={saving}
              disabled={saving}
              style={{ marginTop: theme.spacing.s3 }}
              onPress={() => void runSave(summary.retryIds, outcomes)}
            />
          )}
          <AppButton
            label={REQUEST_RESULT_DONE_LABEL}
            variant="secondary"
            fullWidth
            disabled={saving}
            style={{ marginTop: theme.spacing.s2 }}
            onPress={onFinished}
          />
        </Card>
      )}

      {!outcomes && (
        <AppButton
          label={requestSubmitLabel(selection.length, saving)}
          fullWidth
          loading={saving}
          disabled={!canSubmit || allFull}
          style={{ marginTop: theme.spacing.s4 }}
          onPress={() => void submit()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: theme.spacing.s3, color: theme.colors.neutralTextSecondary },
  fieldLabel: { marginTop: theme.spacing.s4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: theme.tapTarget.parent,
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  chipSelected: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
  // 満杯の子は淡色にして押せなくする（名前は隠さない。「頼めない人がいる」ことが見えるように）。
  chipFull: { opacity: 0.5 },
  chipText: { marginLeft: theme.spacing.s2, flexShrink: 1 },
  reason: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  linkText: { marginTop: theme.spacing.s1, color: theme.colors.brandPrimaryStrong, textDecorationLine: "underline" },
  input: {
    marginTop: theme.spacing.s2,
    minHeight: theme.tapTarget.parent,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
  },
  counter: { marginTop: theme.spacing.s1, textAlign: "right" },
  formDisabled: { opacity: 0.5 },
  resultCard: {
    marginTop: theme.spacing.s4,
    backgroundColor: theme.colors.statusPendingSoft,
    borderColor: theme.colors.statusPending,
    gap: theme.spacing.s1,
  },
  successBox: { alignItems: "center", paddingVertical: theme.spacing.s8 },
  successEmoji: { fontSize: 48 },
  successText: { marginTop: theme.spacing.s2, textAlign: "center" },
});
