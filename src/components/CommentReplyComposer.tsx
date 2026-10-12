/**
 * 完了報告のコメントへの「返信」の入口と、その場で開く入力欄（モーダルにしない）。
 *
 * [2026-10-13新設・要件定義書07-48章 決定1〜10、UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md
 * 74.2・74.7・74.10・74.13節、設計部/成果物/API仕様.md 42章、開発部/成果物/実装メモ.md 364章]
 *
 * 使う場所：`ChoreReactionsList`（P9・S2・C18の詳細・子どもの「きろく」）と `InboxPanel`（ベル）。
 * **この部品を描くかどうか（返信の入口を出す条件）は呼び出し側が `canShowReplyEntry`
 * （src/lib/commentReply.ts）で決める**。ここは「出すと決まったあと」の見た目と送信だけを持つ。
 *
 *  - 閉じている：小さな下線リンクだけ（12px・`neutralTextSecondary`。鍵・バッジ・色づけ・説明は置かない）。
 *    押せる範囲は子ども56・保護者44・みまもり48dp以上（`theme.tapTarget`）、`hitSlop`つき。
 *  - 開いている：ラベル（「（にんい）」つき）＋入力欄（200字）＋カウンター＋「やめる」「おくる」。
 *    開いたら入力欄にフォーカス。2つのボタンが横に収まらないときは折り返して縦に並ぶ。
 *  - NGワード：「おくる」を押した瞬間にだけ判定し、当たれば送らない（通信しない）。入力欄の直下に
 *    常駐の文（`NgWordWarningText`。赤・⚠は使わない）。文字が変わった瞬間に消える。
 *  - 送信中：「おくる」は「おくっています…」（大人「送信中…」）で押せず、入力欄も編集できない。
 *    連打は`ref`でも止める。**楽観更新はしない**（見た目は取り直しの結果で変わる）。
 *  - 成功：入力欄が閉じるだけ。トースト・ダイアログ・アニメーション・触覚・「送りました」の文字は出さない
 *    （71章E3と同じ）。読み上げの利用者にだけ短く伝える（`announceForAccessibility`）。
 *  - 失敗：入力欄の直下に小さく一文＋目印。**赤を使わない**（`neutralTextSecondary`。責めない・急がせない）。
 *    書いた文は残り、そのまま押し直せる。元のコメントが消えていたときは入力欄を閉じ、
 *    呼び出し側の `onParentGone` に一文を渡す（入力欄のあった場所は消えるため、呼び出し側が出す）。
 *  - 別の端末で先に返信されていた（23505）：取り直し済み（store）。入力欄を閉じ、書きかけは捨てる。
 */
import React from "react";
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AppButton from "./AppButton";
import NgWordWarningText from "./NgWordWarningText";
import FailureRefText from "./FailureRefText";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { deleteFamilyComment, PG_ERRCODE } from "@/data/api";
import { useSession } from "@/lib/session";
import { formatTimeShort } from "@/lib/calendarDates";
import { isWithinReplyCancelWindow } from "@/lib/commentReply";
import { useNgWordGuard } from "@/hooks/useNgWordGuard";
import { useFailureNotice } from "@/hooks/useFailureNotice";
import type { ChoreReaction } from "@/types/domain";
import {
  ownReplyLineText,
  REPLY_ALREADY_DELETED_TEXT,
  REPLY_CANCEL_BUTTON,
  REPLY_CANCEL_LABEL,
  REPLY_ENTRY_LABEL,
  REPLY_INPUT_LABEL,
  REPLY_INPUT_PLACEHOLDER,
  REPLY_PARENT_GONE_MESSAGE,
  REPLY_SEND_BUTTON,
  REPLY_SEND_ERROR_MESSAGE,
  REPLY_SENDING_LABEL,
  REPLY_SENT_ANNOUNCEMENT,
  replyCounterText,
  replyEntryAccessibility,
} from "@/lib/commentReplyText";

type Tone = "parent" | "child" | "supporter";

const MAX_LENGTH = 200;

export interface CommentReplyComposerProps {
  tone: Tone;
  /** 返信先のコメントが付いている完了報告のid。 */
  completionId: string;
  /** 返信先のコメントのid。 */
  parentId: string;
  /** 返信先のコメントを書いた人の名前（読み上げ用）。 */
  commenterName: string;
  /** いま操作している本人（=報告者）のfamily_member_id。 */
  myMemberId: string;
  /**
   * 入口と同じ行の右に並べる要素（取消・削除のリンクなど）。閉じていても開いていても、入口の行に残す。
   */
  trailing?: React.ReactNode;
  /** 送る前に元のコメントが削除されていたとき、一度だけ出す一文を渡す（呼び出し側が表示する）。 */
  onParentGone?: (message: string) => void;
}

export function CommentReplyComposer({
  tone,
  completionId,
  parentId,
  commenterName,
  myMemberId,
  trailing,
  onParentGone,
}: CommentReplyComposerProps) {
  const { dispatch } = useAppData();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  // stateだけだと、同じフレーム内の2回目のタップを止められないため、refでも持つ。
  const sendingRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const entryRef = React.useRef<View>(null);
  const ngGuard = useNgWordGuard();
  const { errorMessage, errorRef, setErrorMessage, showFailure } = useFailureNotice(tone);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      // 返信が付くと入口ごと消える（このコンポーネントが外される）。消えたあとにstateを触らない。
      mountedRef.current = false;
    };
  }, []);

  const isChild = tone === "child";
  const bodyStyle =
    tone === "child"
      ? theme.typography.childBody
      : tone === "supporter"
      ? theme.typography.supporterBody
      : theme.typography.parentBody;
  const entryMinHeight =
    tone === "child" ? theme.tapTarget.child : tone === "supporter" ? theme.tapTarget.supporterPrimary : theme.tapTarget.parent;
  const a11y = replyEntryAccessibility(tone, commenterName);

  // 「やめる」「おくる」のあとは、入口のリンクにフォーカスを戻す（読み上げの利用者が迷わないため）。
  const focusEntry = React.useCallback(() => {
    if (Platform.OS === "web") return;
    const node = findNodeHandle(entryRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);

  const clearNgGuard = ngGuard.clear;
  const closeAndReset = React.useCallback(() => {
    setOpen(false);
    setDraft("");
    clearNgGuard();
    setErrorMessage(null);
  }, [clearNgGuard, setErrorMessage]);

  const handleCancel = () => {
    if (sendingRef.current) return;
    closeAndReset();
    // 開いている間は入口のリンクが描かれていないので、閉じたあとの描画を待ってからフォーカスを戻す。
    setTimeout(focusEntry, 0);
  };

  const handleSend = async () => {
    if (sendingRef.current) return;
    const text = draft.trim();
    if (!text) return;
    // NGワードは「おくる」を押した瞬間にだけ判定する（決定16）。当たれば通信しない。
    if (ngGuard.guard(text)) return;

    sendingRef.current = true;
    setSending(true);
    setErrorMessage(null);
    const res = await dispatch({
      type: "ADD_REACTION",
      completionId,
      reactedBy: myMemberId,
      kind: "comment",
      commentBody: text,
      replyToReactionId: parentId,
    });
    sendingRef.current = false;

    if (res.ok) {
      // 画面には何も出さない。読み上げの利用者にだけ短く伝える。
      AccessibilityInfo.announceForAccessibility(REPLY_SENT_ANNOUNCEMENT[tone]);
      if (!mountedRef.current) return;
      setSending(false);
      closeAndReset();
      return;
    }

    // 以降は失敗。取り直し（store）で入口ごと消えて、このコンポーネントが外れていることがある。
    if (!mountedRef.current) {
      if (res.error.code === PG_ERRCODE.noDataFound) onParentGone?.(REPLY_PARENT_GONE_MESSAGE[tone]);
      return;
    }
    setSending(false);
    if (res.error.code === PG_ERRCODE.noDataFound) {
      // 送る前に元のコメントが削除されていた。入力欄を閉じ、一度だけ一文（呼び出し側が出す）。
      closeAndReset();
      onParentGone?.(REPLY_PARENT_GONE_MESSAGE[tone]);
      return;
    }
    if (res.error.code === PG_ERRCODE.uniqueViolation) {
      // 別の端末で先に返信されていた。取り直し済みなので本当の状態が見える。食い違いの説明は出さない。
      closeAndReset();
      return;
    }
    // 通信・混み合い・ログイン切れ・権限・その他：書いた文は残し、そのまま押し直せる。
    showFailure(res.error, { fallback: REPLY_SEND_ERROR_MESSAGE[tone], useDbMessage: false });
  };

  const empty = draft.trim().length === 0;
  const atLimit = draft.length >= MAX_LENGTH;

  return (
    <View>
      <View style={styles.entryRow}>
        {!open && (
          <Pressable
            ref={entryRef}
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={a11y.label}
            accessibilityHint={a11y.hint}
            hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
            style={[styles.entry, { minHeight: entryMinHeight }]}
          >
            <Text style={styles.entryText}>{REPLY_ENTRY_LABEL[tone]}</Text>
          </Pressable>
        )}
        {trailing}
      </View>

      {open && (
        <View style={styles.composer}>
          <Text style={bodyStyle} accessibilityRole="text">
            {REPLY_INPUT_LABEL[tone]}
          </Text>
          <TextInput
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              ngGuard.clear();
              setErrorMessage(null);
            }}
            placeholder={REPLY_INPUT_PLACEHOLDER[tone]}
            accessibilityLabel={REPLY_INPUT_LABEL[tone]}
            multiline
            maxLength={MAX_LENGTH}
            autoFocus
            editable={!sending}
            style={[
              styles.textArea,
              { borderRadius: isChild ? theme.radius.childXl : theme.radius.parentMd },
              sending && { opacity: 0.6 },
            ]}
          />
          {/* 文字数のカウンターは読み上げから外す（1文字ごとに読まない。上限はmaxLengthが止める）。
              上限に着いたら太字にするだけ（警告色・文言なし）。 */}
          <Text
            accessible={false}
            importantForAccessibility="no"
            style={[styles.counter, atLimit && { fontWeight: "700" }]}
          >
            {replyCounterText(tone, draft.length)}
          </Text>
          {ngGuard.blocked && <NgWordWarningText tone={tone} />}
          {errorMessage ? (
            <View style={{ marginTop: theme.spacing.s1 }}>
              <Text style={styles.failureText}>{errorMessage}</Text>
              <FailureRefText value={errorRef} tone={tone} />
            </View>
          ) : null}
          <View style={styles.buttons}>
            <AppButton
              label={REPLY_CANCEL_BUTTON}
              variant="ghost"
              tone={tone}
              onPress={handleCancel}
              disabled={sending}
            />
            <AppButton
              label={sending ? REPLY_SENDING_LABEL[tone] : REPLY_SEND_BUTTON}
              tone={tone}
              onPress={() => void handleSend()}
              disabled={empty || sending}
            />
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * ベルのコメントのカードの中に添える、自分の返信の1行（独立した行ではない。件数にも並びにも影響しない）。
 * 返信した直後の取消を押せる場所が要るため（きろく・詳細は別画面で遠い）。5分を過ぎたら「取消」だけが
 * 静かに消え、返信の文は残る。主要画面ワイヤーフレーム.md 74.5節 R7。
 */
export function OwnReplyLine({ tone, reply }: { tone: Tone; reply: ChoreReaction }) {
  const { client } = useSession();
  const { refresh } = useAppData();
  const [processing, setProcessing] = React.useState(false);
  const processingRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  const { errorMessage, errorRef, setErrorMessage, showFailure } = useFailureNotice(tone);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const bodyStyle =
    tone === "child"
      ? theme.typography.childBody
      : tone === "supporter"
      ? theme.typography.supporterBody
      : theme.typography.parentBody;
  const canCancel = isWithinReplyCancelWindow(reply.created_at, Date.now());

  const cancel = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    setErrorMessage(null);
    // コメントの取消と同じコード（本人5分以内は確認なしで消える）を通す。
    const res = await deleteFamilyComment(client, "chore_reaction_comment", reply.id);
    processingRef.current = false;
    if (!mountedRef.current) return;
    setProcessing(false);
    if (!res.ok) {
      if (res.error.code === PG_ERRCODE.checkViolation && res.error.message.includes("削除されています")) {
        void refresh();
        return;
      }
      showFailure(res.error, { fallback: REPLY_ALREADY_DELETED_TEXT[tone], useDbMessage: false });
      return;
    }
    void refresh();
  };

  return (
    <View style={styles.ownReply}>
      <Text style={bodyStyle}>{ownReplyLineText(tone, reply.comment_body ?? "")}</Text>
      <View style={styles.ownReplyMeta}>
        <Text style={styles.ownReplyTime}>{formatTimeShort(reply.created_at)}</Text>
        {canCancel && (
          <Pressable onPress={() => void cancel()} disabled={processing} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.entryText}>{processing ? "…" : REPLY_CANCEL_LABEL[tone]}</Text>
          </Pressable>
        )}
      </View>
      {errorMessage ? (
        <View>
          <Text style={styles.failureText}>{errorMessage}</Text>
          <FailureRefText value={errorRef} tone={tone} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ownReply: {
    marginTop: theme.spacing.s2,
    paddingLeft: theme.spacing.s2,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.neutralBorder,
  },
  ownReplyMeta: { flexDirection: "row", alignItems: "center", columnGap: theme.spacing.s3, marginTop: 2 },
  ownReplyTime: { fontSize: 12, color: theme.colors.neutralTextSecondary },
  entryRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: theme.spacing.s3 },
  entry: { justifyContent: "center" },
  // 既存の「取消」「削除」リンクと同じ見た目（12px・下線・neutralTextSecondary）。
  entryText: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline", fontSize: 12 },
  composer: { marginTop: theme.spacing.s1 },
  textArea: {
    marginTop: theme.spacing.s2,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    padding: theme.spacing.s3,
    minHeight: 72,
    textAlignVertical: "top",
    backgroundColor: theme.colors.neutralBg,
  },
  counter: {
    marginTop: theme.spacing.s1,
    alignSelf: "flex-end",
    fontSize: 12,
    color: theme.colors.neutralTextSecondary,
  },
  // 赤・アンバーは使わない（責めない・急がせない。74.7節）。
  failureText: { fontSize: 12, color: theme.colors.neutralTextSecondary },
  // 2つのボタンが横に収まらないときは折り返して縦に並ぶ（文字が大きい端末。74.10節）。
  buttons: {
    marginTop: theme.spacing.s2,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: theme.spacing.s2,
  },
});

export default CommentReplyComposer;
