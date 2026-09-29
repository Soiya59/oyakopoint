/**
 * P11（クエストの登録・編集）の「おねがい版」。おねがいの行を開いたときだけ表示する簡素な画面。
 *
 * 参照: 要件定義書07-43章決定13の2、設計部/成果物/API仕様.md 38.4章、主要画面ワイヤーフレーム.md 70.8節
 * （D15）、開発部/成果物/実装メモ.md 335章。
 *
 * - 出すのは「おねがい先（変えられない）」「ポイントは付きません。」「なにを？（題名）」「保存する」
 *   「おねがいを取り下げる」だけ。ポイント・繰り返し・上限・カテゴリー・絵文字・担当・NFC・コピー・見本の欄は出さない。
 * - **やってくれたあと（済）のおねがいは、題名の変更も取り下げもできない**（D15。DBも
 *   `insufficient_privilege`＋HINT `chore_request_completed`で拒否する。古いアプリ版・別経路への最終防衛線）。
 *   済のときは「そらさんがやってくれました」と、もどるボタンだけを出す。
 * - 担当が空のおねがい（担当だった子どもがいなくなった行）は、取り下げだけできる（放っておくと消せない
 *   行が残るのを防ぐ）。題名は文字で出すだけ。
 * - 題名を直しても、子どもへの通知は再送されない。取り下げても子どもには知らせない。
 *   取り下げの確認は`Alert`を使わず、その場の2段階確認（既存の削除と同じ作り）。
 * - 保存・取り下げの失敗は、原因別の文言＋目印（331章の`useFailureNotice`）。
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import FailureRefText from "@/components/FailureRefText";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { deleteChore, updateChoreRequestTitle } from "@/data/api";
import { useChoreCompletionTotals } from "@/hooks/useChoreCompletionTotals";
import { useFailureNotice } from "@/hooks/useFailureNotice";
import { FAMILY_DATA_NOT_READY_MESSAGE } from "@/lib/errorMessages";
import { normalizeRequestTitle, requestTitleCounter } from "@/lib/requestChore";
import {
  CHORE_LIST_REQUEST_NO_ASSIGNEE,
  REQUEST_CREATE_FAILED_MESSAGE,
  REQUEST_EDIT_NO_POINTS,
  REQUEST_EDIT_SAVE_LABEL,
  REQUEST_EDIT_TITLE,
  REQUEST_EDIT_TITLE_DONE,
  REQUEST_EDIT_WITHDRAW_LABEL,
  REQUEST_TITLE_HEADING,
  REQUEST_WITHDRAW_CANCEL_LABEL,
  REQUEST_WITHDRAW_CONFIRM_LABEL,
  requestDoneNote,
  requestEditTarget,
  requestWithdrawConfirmBody,
  requestWithdrawConfirmTitle,
} from "@/lib/requestChoreText";

export default function ChoreRequestEdit({ choreId }: { choreId: string }) {
  const { state, refresh } = useAppData();
  const { client } = useSession();
  const chore = state.chores.find((c) => c.id === choreId);
  const { isOneOffFinished } = useChoreCompletionTotals();

  const [title, setTitle] = useState(chore?.title ?? "");
  const [saving, setSaving] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { errorMessage, errorRef, setErrorMessage, showFailure } = useFailureNotice("parent");

  if (!chore) {
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentBody}>クエストが見つかりませんでした</Text>
        <AppButton label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s4 }} onPress={() => router.back()} />
      </Screen>
    );
  }

  const finished = isOneOffFinished(chore);
  const assigneeName = chore.assigned_to ? state.members.find((m) => m.id === chore.assigned_to)?.display_name ?? null : null;
  // やってくれた子（完了報告の報告者）。見つからなければおねがい先の名前。
  const doneByName =
    state.members.find((m) => m.id === state.completions.find((c) => c.chore_id === chore.id)?.reported_by)?.display_name ??
    assigneeName ??
    "";
  const canEditTitle = !finished && assigneeName !== null;
  const trimmed = normalizeRequestTitle(title);
  const counter = requestTitleCounter(title, theme.requestLimit.titleMaxLength, theme.requestLimit.titleWarningThreshold);
  const changed = trimmed !== chore.title && trimmed.length >= 1;
  const busy = saving || withdrawing;

  const save = async () => {
    if (!changed || busy) return;
    if (!state.family.id) {
      setErrorMessage(FAMILY_DATA_NOT_READY_MESSAGE);
      return;
    }
    setErrorMessage(null);
    setSaving(true);
    const res = await updateChoreRequestTitle(client, chore.id, trimmed);
    setSaving(false);
    if (!res.ok) {
      showFailure(res.error, { fallback: REQUEST_CREATE_FAILED_MESSAGE });
      return;
    }
    await refresh();
    router.replace("/parent/chores");
  };

  const withdraw = async () => {
    if (busy) return;
    setErrorMessage(null);
    setWithdrawing(true);
    const res = await deleteChore(client, chore.id);
    setWithdrawing(false);
    if (!res.ok) {
      showFailure(res.error, { fallback: REQUEST_CREATE_FAILED_MESSAGE });
      return;
    }
    await refresh();
    router.replace("/parent/chores");
  };

  // ---- 済のおねがい: 題名の変更も取り下げも出さない ----
  if (finished) {
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentTitle}>{REQUEST_EDIT_TITLE_DONE}</Text>
        <Text style={[theme.typography.parentBodyMedium, styles.line]}>
          {chore.emoji ?? "💌"} {chore.title}
        </Text>
        <Text style={[theme.typography.parentBody, styles.line]}>{requestDoneNote(doneByName)}</Text>
        <Text style={[theme.typography.parentCaption, styles.caption]}>{requestEditTarget(assigneeName ?? CHORE_LIST_REQUEST_NO_ASSIGNEE)}</Text>
        <AppButton label="もどる" variant="secondary" fullWidth style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>{REQUEST_EDIT_TITLE}</Text>
      <Text style={[theme.typography.parentBody, styles.line]}>
        {requestEditTarget(assigneeName ?? CHORE_LIST_REQUEST_NO_ASSIGNEE)}
      </Text>
      <Text style={[theme.typography.parentCaption, styles.caption]}>{REQUEST_EDIT_NO_POINTS}</Text>

      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>{REQUEST_TITLE_HEADING}</Text>
      {canEditTitle ? (
        <>
          <TextInput
            value={title}
            onChangeText={setTitle}
            multiline={false}
            maxLength={theme.requestLimit.titleMaxLength}
            editable={!busy}
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
        </>
      ) : (
        // 担当が空のおねがい: 題名は文字で出すだけ（取り下げだけできる）。
        <Text style={[theme.typography.parentBody, styles.line]}>{chore.title}</Text>
      )}

      {errorMessage && <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>}
      <FailureRefText value={errorRef} tone="parent" />

      {canEditTitle && (
        <AppButton
          label={saving ? "保存しています…" : REQUEST_EDIT_SAVE_LABEL}
          fullWidth
          loading={saving}
          disabled={!changed || busy}
          style={{ marginTop: theme.spacing.s4 }}
          onPress={() => void save()}
        />
      )}

      {/* 取り下げ（danger）。その場の2段階確認。お知らせはしない。「枠」「3つ」の語は出さない。 */}
      {!confirming ? (
        <AppButton
          label={REQUEST_EDIT_WITHDRAW_LABEL}
          variant="danger"
          fullWidth
          disabled={busy}
          style={{ marginTop: theme.spacing.s6 }}
          onPress={() => setConfirming(true)}
        />
      ) : (
        <View style={styles.confirmBox}>
          <Text style={theme.typography.parentBodyMedium}>{requestWithdrawConfirmTitle(chore.title)}</Text>
          <Text style={[theme.typography.parentBody, styles.line]}>{requestWithdrawConfirmBody(assigneeName)}</Text>
          <View style={styles.confirmRow}>
            <AppButton
              label={REQUEST_WITHDRAW_CANCEL_LABEL}
              variant="secondary"
              disabled={withdrawing}
              style={{ flex: 1 }}
              numberOfLines={2}
              onPress={() => setConfirming(false)}
            />
            <AppButton
              label={withdrawing ? "取り下げています…" : REQUEST_WITHDRAW_CONFIRM_LABEL}
              variant="danger"
              loading={withdrawing}
              disabled={withdrawing}
              style={{ flex: 1 }}
              numberOfLines={2}
              onPress={() => void withdraw()}
            />
          </View>
        </View>
      )}

      <Pressable onPress={() => router.back()} style={styles.backLink} hitSlop={8} disabled={busy}>
        <Text style={theme.typography.parentBody}>← もどる</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { marginTop: theme.spacing.s2 },
  caption: { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary },
  fieldLabel: { marginTop: theme.spacing.s4 },
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
  confirmBox: {
    marginTop: theme.spacing.s6,
    padding: theme.spacing.s4,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  // 横に並べる2つのボタンは等分（flex: 1）・2行まで折り返し（328・329章）。
  confirmRow: { flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s3 },
  backLink: { marginTop: theme.spacing.s6, paddingVertical: theme.spacing.s2 },
});
