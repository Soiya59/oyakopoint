import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import {
  createChoreNfcTag,
  createSupporterSharedChore,
  deleteChore,
  fetchActiveChoreNfcTags,
  revokeChoreNfcTag,
  updatePersonalChore,
} from "@/data/api";
import { generateNfcTagToken, isNfcWriteSupported, writeNfcTag } from "@/lib/nfc";
import { toJstDateString } from "@/lib/calendarDates";
import type { ChoreNfcTagWithMember } from "@/types/domain";
import { MAX_NFC_TAGS_PER_CHORE_MEMBER } from "@/lib/nfcTags";
import { findSkillChoreTemplateById } from "@/data/skillChoreTemplates";
import {
  FAMILY_DATA_NOT_READY_MESSAGE,
  NFC_UNLINK_ERROR_MESSAGE,
  NFC_WRITE_ERROR_MESSAGE,
  NFC_WRITE_RETRY_LABEL,
} from "@/lib/errorMessages";

// [2026-09-01追加・実装メモ.md 108章] 要件定義書07-2章判断事項7「みまもりメンバー
// 自身の自分専用クエストへのタグ発行」。主要画面ワイヤーフレーム.md 7.6.2節のとおり、
// 自分専用クエストのタグの持ち主は常に作成者本人固定のため、7.6.1節（P11）の
// 「メンバー選択」ステップを完全に省略した簡易版のステップ構成にする。
type NfcModalStep = "list" | "writing" | "writeFailed" | "unsupported";

// [2026-09-04追加・実装メモ.md 127章] app/parent/chore-edit.tsxのCHORE_EMOJI_SUGGESTIONS
// （2026-08-23追加）と同じ発想の候補チップだが、保護者側の候補（勉強・掃除等の家事）を
// そのまま流用せず、みまもりメンバー自身の健康・習慣づくり用のクエストを想定した5個に
// 差し替えた（UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 14.2.1節）。
// [2026-09-04改訂・統括判断] 当初はみまもりメンバー向けに健康・習慣づくりへ寄せた
// 5個（散歩・筋トレ・食事・水分・脳トレ）を用意したが、統括より「この絵文字の意味が
// わからない」（水滴が何を指すか伝わらない）との指摘を受け、さらに「保護者のクエストと
// 見守りのクエストと同じにしてください」と決定された。P11（app/parent/chore-edit.tsx）の
// CHORE_EMOJI_SUGGESTIONS と同一の並びにする。実装メモ127章・129章。
const SUPPORTER_CHORE_EMOJI_SUGGESTIONS = ["📚", "🧹", "🛁", "🧺", "🍽️"];

/**
 * S6 クエスト登録・編集（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S6、API仕様.md 3b章・3b-2章
 *
 * app/parent/chore-edit.tsx（P11）と同じ構成の基本項目フォームだが、以下が異なる。
 * - カテゴリー・担当（assigned_to）は対象外（この画面のchoreには存在しない概念）
 * - 削除ボタンを追加（編集時のみ）
 *
 * [2026-08-29修正・本部長] 従来ここは表示が「削除」なのに実際は無効化（is_active=false）
 * だった。保護者側に完全削除を実装するにあたり、**同じ言葉で違う挙動**という状態を残さない
 * ため、こちらも完全削除に揃えた。完了履歴・ポイント・家族の木は残る
 * （src/data/api.ts deleteChore のコメント参照）。
 *
 * [2026-08-23改訂] 要件定義書07-7章4回目のスコープ変更（ユーザーの要望「いっしょに
 * やるというのはいらない」）により、「家族に共有する／しない」トグルは撤回した。
 * [2026-08-23再改訂・5回目のスコープ変更] 「常に非公開」という方針を撤回し、
 * 自分専用のお手伝いは常に家族全員に公開される（可視性を選べる設定は引き続き
 * 設けない）。
 *
 * [2026-09-06改訂・要件定義書07-18章・UIUXデザイン部30.1節決定2・30.3節]
 * 新規登録は常にscope='supporter_shared'（みまもり共通）になり、作成者を問わず
 * みまもりメンバー全員が完了報告できる（決定2）。編集・削除は引き続き作成者本人
 * のみに限定される（決定3、既存のscope='personal'行も同様）。登録時に
 * 「自分専用／みまもり共通」を選ばせる導線は作らない（統括の簡素化指示）。
 *
 * [2026-09-17追加・要件定義書07-28章決定2・24、スキーマ設計.sql 55.1章
 * 「supporter_shared分岐との関係」] たまり方＝台紙（habit_card）を選んだ場合のみ、
 * 例外的に`scope='personal'`（自分専用）で作成する。台紙型は担当者
 * （assigned_to）が必須だが、`scope='supporter_shared'`は`assigned_to`が
 * 常にNULLへ強制されるため構造的に台紙型にできない。`personal`は
 * `assigned_to=created_by`が常に成立し、担当者必須の要件と自然に両立する
 * （企画部が示した回避策そのもの）。たまり方＝ポイントのときは、従来どおり
 * `scope='supporter_shared'`のまま変更しない。
 */
export default function SupporterChoreEditScreen() {
  const { id, recId } = useLocalSearchParams<{ id?: string; recId?: string }>();
  const { state, refresh } = useAppData();
  const { client } = useSession();
  const isEditMode = !!id;
  const chore = isEditMode ? state.chores.find((c) => c.id === id) : undefined;
  // [2026-09-17追加・要件定義書07-28章決定13] スキルの型付きクエストひな形の
  // プレフィル（新規作成モードのみ）。
  const skillTemplate = !isEditMode && recId ? findSkillChoreTemplateById(recId) : undefined;

  const [title, setTitle] = useState(chore?.title ?? skillTemplate?.title ?? "");
  const [emoji, setEmoji] = useState<string | null>(chore?.emoji ?? skillTemplate?.emoji ?? null);
  const [pointsText, setPointsText] = useState(
    chore ? String(chore.points) : skillTemplate ? String(skillTemplate.points ?? "") : ""
  );
  const [isRepeatable, setIsRepeatable] = useState(chore?.is_repeatable ?? (skillTemplate ? true : false));
  const [dailyLimitText, setDailyLimitText] = useState(chore?.daily_limit != null ? String(chore.daily_limit) : "");

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // [2026-09-01追加・実装メモ.md 108章] NFCタグ管理（要件定義書07-2章判断事項7）。
  // 自分専用クエストのタグの持ち主は常に作成者本人（＝いまログイン中のみまもり
  // メンバー自身、state.activeParentMemberId）固定のため、P11のようなメンバー選択
  // ステップは無い（主要画面ワイヤーフレーム.md 7.6.2章）。
  const myMemberId = state.activeParentMemberId;
  const [modalVisible, setModalVisible] = useState(false);
  const [nfcStep, setNfcStep] = useState<NfcModalStep>("list");
  const [nfcErrorMessage, setNfcErrorMessage] = useState<string | null>(null);
  const [tags, setTags] = useState<ChoreNfcTagWithMember[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [issuedSnackbar, setIssuedSnackbar] = useState<string | null>(null);
  const [confirmingRevokeTagId, setConfirmingRevokeTagId] = useState<string | null>(null);
  const [revokingTagId, setRevokingTagId] = useState<string | null>(null);
  const [revokeErrorTagId, setRevokeErrorTagId] = useState<string | null>(null);

  const loadTags = async (choreId: string) => {
    setTagsLoading(true);
    setTagsError(null);
    const res = await fetchActiveChoreNfcTags(client, choreId);
    setTagsLoading(false);
    if (!res.ok) {
      setTagsError(res.error.message);
      return;
    }
    setTags(res.data);
  };

  useEffect(() => {
    if (chore?.id) void loadTags(chore.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chore?.id]);

  const myTagCount = tags.filter((t) => t.member_id === myMemberId).length;

  const openIssueModal = () => {
    if (!chore || myTagCount >= MAX_NFC_TAGS_PER_CHORE_MEMBER) return;
    setIssuedSnackbar(null);
    if (!isNfcWriteSupported()) {
      setNfcStep("unsupported");
      setModalVisible(true);
      return;
    }
    setNfcStep("writing");
    setModalVisible(true);
    void startWrite();
  };

  const startWrite = async () => {
    if (!chore) return;
    setNfcErrorMessage(null);
    setNfcStep("writing");
    const newToken = generateNfcTagToken();
    const result = await writeNfcTag(newToken);
    if (result.ok && result.tagValue) {
      const res = await createChoreNfcTag(client, {
        chore_id: chore.id,
        member_id: myMemberId,
        tag_value: result.tagValue,
      });
      if (res.ok) {
        await loadTags(chore.id);
        setIssuedSnackbar("タグを発行しました");
        setNfcStep("list");
      } else {
        setNfcErrorMessage(res.error.message);
        setNfcStep("writeFailed");
      }
    } else if (result.errorReason === "cancelled") {
      setModalVisible(false);
    } else {
      setNfcErrorMessage(null);
      setNfcStep("writeFailed");
    }
  };

  const startRevoke = async (tagId: string) => {
    setRevokingTagId(tagId);
    setRevokeErrorTagId(null);
    const res = await revokeChoreNfcTag(client, tagId);
    setRevokingTagId(null);
    if (!res.ok) {
      setRevokeErrorTagId(tagId);
      return;
    }
    setTags((prev) => prev.filter((t) => t.id !== tagId));
    setConfirmingRevokeTagId(null);
    setIssuedSnackbar("解除しました");
  };

  const validate = (): string | null => {
    if (!title.trim()) return "タイトルを入力してください";
    if (title.trim().length > 100) return "タイトルは100文字以内で入力してください";
    // [2026-09-19改訂・要件定義書07-28章決定26] 0ポイントのクエストを許す。
    const pointsNum = Number(pointsText);
    if (!Number.isInteger(pointsNum) || pointsNum < 0) return "ポイントは0以上の整数で入力してください";
    if (isRepeatable && dailyLimitText.trim()) {
      const limitNum = Number(dailyLimitText);
      if (!Number.isInteger(limitNum) || limitNum < 1) return "1日の上限回数は1以上の整数で入力してください（空欄で無制限）";
    }
    return null;
  };

  const save = async () => {
    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    if (!state.family.id) {
      setErrorMessage(FAMILY_DATA_NOT_READY_MESSAGE);
      return;
    }
    setErrorMessage(null);
    setSaving(true);

    const input = {
      title: title.trim(),
      emoji,
      points: Number(pointsText),
      is_repeatable: isRepeatable,
      daily_limit: isRepeatable && dailyLimitText.trim() ? Number(dailyLimitText) : null,
    };

    // 新規作成は常にscope='supporter_shared'（みまもり共通）。編集時は
    // updatePersonalChoreがどちらのscopeにもそのまま使える（既存の仕様）。
    const res = chore
      ? await updatePersonalChore(client, chore.id, input)
      : await createSupporterSharedChore(client, state.family.id, input);

    setSaving(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    await refresh();
    router.replace("/supporter/my-chores");
  };

  const remove = async () => {
    if (!chore) return;
    setDeleting(true);
    const res = await deleteChore(client, chore.id);
    setDeleting(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    await refresh();
    router.replace("/supporter/my-chores");
  };

  if (isEditMode && !chore) {
    return (
      <Screen tone="supporter">
        <Text style={theme.typography.supporterBody}>クエストが見つかりませんでした</Text>
        <AppButton tone="supporter" label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s4 }} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen tone="supporter">
      <Text style={theme.typography.supporterTitle}>
        {chore ? `${chore.emoji ?? "🎯"} クエストを編集` : "クエストを新規登録"}
      </Text>

      {/* [2026-09-20新設・主要画面ワイヤーフレーム.md 54章決定9、開発部への申し送り
          54.11節5.] P11（app/parent/chore-edit.tsx）と同じ位置・同じ文言のプレフィル
          通知Card。従来S6には「おやくそくの型」経由でプレフィルされても説明が一切
          無かった（54.0節5.）。S6は`recommendation`を持たないため`skillTemplate`のみ
          で判定する（決定10）。編集モードでは表示しない。 */}
      {!chore && skillTemplate && (
        <Card style={styles.metaCard} tone="supporter">
          <Text style={theme.typography.supporterBody}>
            🍀 見本の「{skillTemplate.title}」をもとに入力しました。内容は自由に変えられます
          </Text>
        </Card>
      )}

      <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>タイトル（必須）</Text>
      <TextInput value={title} onChangeText={setTitle} placeholder="例：ウォーキング30分" maxLength={100} style={styles.input} />

      <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>絵文字（任意）</Text>
      <TextInput
        value={emoji ?? ""}
        onChangeText={(t) => setEmoji(t || null)}
        placeholder="例：🚶（絵文字キーボードから入力）"
        maxLength={8}
        style={[styles.input, styles.emojiInput]}
      />
      <View style={styles.chipRow}>
        {SUPPORTER_CHORE_EMOJI_SUGGESTIONS.map((e) => (
          <Pressable
            key={e}
            onPress={() => setEmoji(e)}
            style={[styles.chip, emoji === e && styles.chipSelected]}
          >
            <Text style={{ fontSize: 18 }}>{e}</Text>
          </Pressable>
        ))}
      </View>

      {/* [2026-09-19改訂・要件定義書07-28章決定25・26] 「たまり方」選択欄は
          撤去され、元のポイントのみの1択フォームに戻った。0ポイントも許すが
          既定値は0にせず・0を推奨する文言も出さない。 */}
      <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>ポイント（0以上の整数）</Text>
      <TextInput
        value={pointsText}
        onChangeText={(t) => setPointsText(t.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        placeholder="例：10"
        style={styles.input}
      />

      <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>繰り返し設定</Text>
      <View style={styles.chipRow}>
        <Pressable onPress={() => setIsRepeatable(false)} style={[styles.chip, !isRepeatable && styles.chipSelected]}>
          <Text>1回だけ</Text>
        </Pressable>
        <Pressable onPress={() => setIsRepeatable(true)} style={[styles.chip, isRepeatable && styles.chipSelected]}>
          <Text>くり返す</Text>
        </Pressable>
      </View>

      {/* [2026-09-06追加・要件定義書07-18章決定7・UIUXデザイン部30.3節決定9]
          「1回だけ」選択時のみ、早い者勝ちの挙動を前向きな言葉で事前に伝える。 */}
      {!isRepeatable && (
        <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
          1回だけのクエストは、だれか1人が完了報告すると一覧から消えます（みまもりメンバー全員が対象です）
        </Text>
      )}

      {isRepeatable && (
        <>
          <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>1日の上限回数（空欄で無制限）</Text>
          <TextInput
            value={dailyLimitText}
            onChangeText={(t) => setDailyLimitText(t.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            placeholder="空欄=無制限"
            style={styles.input}
          />
        </>
      )}

      {/* [2026-09-06改訂・要件定義書07-18章決定8・UIUXデザイン部30.3節決定8]
          対象chore（既存か新規か）で文言を出し分ける。既存のscope='personal'行に
          限り、決定4'・決定22の案内（削除して登録し直す）も兼ねる。 */}
      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s4, color: theme.colors.neutralTextSecondary }]}>
        {chore?.scope === "personal"
          ? "※ このクエストは家族みんなに見えますが、完了報告できるのはあなただけです。今後あたらしく登録するクエストは、みまもりメンバーなら誰でも完了報告できるようになります。共通にしたい場合は、いちど削除して登録し直してください（これまでの記録は残ります）。"
          : "※ このクエストは家族みんなに見え、みまもりメンバーなら誰でも完了報告できます。編集・削除ができるのはあなただけです。"}
      </Text>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <AppButton
        tone="supporter"
        label={saving ? "保存中…" : "保存する"}
        loading={saving}
        disabled={saving || deleting}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={save}
      />

      {/* NFCタグ管理（要件定義書07-2章判断事項7、主要画面ワイヤーフレーム.md 7.6.2章）
          新規作成モード（choreがまだ存在しない）では対象のchore_idが無いため表示しない。
          [2026-09-06追加・スキーマ設計45.17章(2)・UIUXデザイン部30.3節決定10]
          chore_nfc_tagsのRLSがsupporter_sharedを考慮していないため（39章未対応）、
          scope='personal'（既存分）に限定して表示する。supporter_shared（新規分）
          では、押しても0件書き込み失敗になる「動かない機能」を見せないためブロック
          ごと非表示にする。将来39章がsupporter_sharedに対応した時点でこの条件を
          外す（やること.mdに別途追記）。 */}
      {chore && chore.scope === "personal" && (
        <Card style={{ marginTop: theme.spacing.s4 }} tone="supporter">
          <Text style={theme.typography.supporterBodyMedium}>NFCタグ</Text>
          <Text style={[theme.typography.supporterCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
            このクエストに対応するタグにスマホをかざすと、完了報告が起動します。
          </Text>
          <AppButton
            tone="supporter"
            label={
              tagsLoading
                ? "読み込み中…"
                : tags.length === 0
                ? "NFCタグを登録する"
                : `NFCタグを管理する（${tags.length}まい発行ずみ）`
            }
            style={{ marginTop: theme.spacing.s3 }}
            disabled={tagsLoading}
            onPress={() => {
              setNfcStep("list");
              setModalVisible(true);
            }}
          />
        </Card>
      )}

      {/* [2026-09-25追加・やること.md 4-84] 押すと確認なしで削除されていた。保護者の画面
          （app/parent/chore-edit.tsx）と同じ2段階確認に揃える。 */}
      {chore &&
        (confirmingDelete ? (
          <View style={{ gap: theme.spacing.s2, marginTop: theme.spacing.s3 }}>
            <Text style={[theme.typography.supporterBody, { color: theme.colors.statusBlocking }]}>
              「{chore.title}」を削除しますか？取り消せません。
            </Text>
            <Text style={theme.typography.supporterCaption}>これまでの記録・ポイント・家族の木はそのまま残ります。</Text>
            {tags.length > 0 && (
              <Text style={theme.typography.supporterCaption}>
                このクエストに発行した{tags.length}まいのNFCタグは使えなくなります（タグの貼り直しが必要です）。
              </Text>
            )}
            <AppButton tone="supporter" label={deleting ? "削除中…" : "本当に削除する"} variant="danger" onPress={remove} disabled={deleting} />
            <AppButton tone="supporter" label="やめる" variant="ghost" onPress={() => setConfirmingDelete(false)} disabled={deleting} />
          </View>
        ) : (
          <AppButton
            tone="supporter"
            label="このクエストを削除する"
            variant="danger"
            disabled={saving || deleting}
            style={{ marginTop: theme.spacing.s3 }}
            onPress={() => setConfirmingDelete(true)}
          />
        ))}

      <AppButton tone="supporter" label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.back()} />

      {/* NFCタグ管理モーダル。7.6.2節「メンバー選択ステップを完全に省略」のとおり、
          P11（app/parent/chore-edit.tsx）より1段少ない簡易版。 */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard} tone="supporter">
            {nfcStep === "list" && chore && (
              <>
                <Text style={theme.typography.supporterTitle}>NFCタグを管理</Text>
                <Text style={[theme.typography.supporterCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
                  「{chore.title}」のタグ（{myTagCount}/{MAX_NFC_TAGS_PER_CHORE_MEMBER}まい）
                </Text>

                {issuedSnackbar && (
                  <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s2, color: theme.colors.supporterAccent }]}>
                    {issuedSnackbar}
                  </Text>
                )}
                {tagsError && (
                  <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.statusBlocking }}>{tagsError}</Text>
                )}

                {tags.length === 0 ? (
                  <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s3 }]}>
                    まだNFCタグは発行されていません
                  </Text>
                ) : (
                  <View style={{ marginTop: theme.spacing.s3 }}>
                    {tags.map((t) =>
                      confirmingRevokeTagId === t.id ? (
                        <View key={t.id} style={styles.tagRowConfirm}>
                          <Text style={{ color: theme.colors.statusBlocking }}>
                            このタグはもう使えなくなります（元にはもどせません）。本当に解除しますか？
                          </Text>
                          {revokeErrorTagId === t.id && (
                            <Text style={{ color: theme.colors.statusBlocking, marginTop: theme.spacing.s1 }}>
                              {NFC_UNLINK_ERROR_MESSAGE}
                            </Text>
                          )}
                          <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s2 }}>
                            <AppButton
                              tone="supporter"
                              label="やめる"
                              variant="ghost"
                              disabled={revokingTagId === t.id}
                              onPress={() => {
                                setConfirmingRevokeTagId(null);
                                setRevokeErrorTagId(null);
                              }}
                            />
                            <AppButton
                              tone="supporter"
                              label={revokingTagId === t.id ? "解除中…" : "解除する"}
                              variant="danger"
                              disabled={revokingTagId === t.id}
                              onPress={() => startRevoke(t.id)}
                            />
                          </View>
                        </View>
                      ) : (
                        <View key={t.id} style={styles.tagRow}>
                          <Text style={theme.typography.supporterBody}>
                            ・{toJstDateString(t.created_at).replace(/-/g, "/")}発行
                          </Text>
                          <Pressable
                            onPress={() => {
                              setConfirmingRevokeTagId(t.id);
                              setRevokeErrorTagId(null);
                            }}
                          >
                            <Text style={{ color: theme.colors.statusBlocking }}>解除する</Text>
                          </Pressable>
                        </View>
                      )
                    )}
                  </View>
                )}

                {myTagCount >= MAX_NFC_TAGS_PER_CHORE_MEMBER ? (
                  <Text style={[theme.typography.supporterCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s4 }]}>
                    すでに{MAX_NFC_TAGS_PER_CHORE_MEMBER}まい発行しています。ちょうどいい枚数になったら、使わなくなったタグを解除するとまた発行できます
                  </Text>
                ) : (
                  <AppButton
                    tone="supporter"
                    label="＋ 新しいタグを発行する"
                    style={{ marginTop: theme.spacing.s4 }}
                    onPress={openIssueModal}
                  />
                )}
                <AppButton
                  tone="supporter"
                  label="とじる"
                  variant="secondary"
                  style={{ marginTop: theme.spacing.s3 }}
                  onPress={() => setModalVisible(false)}
                />
              </>
            )}

            {nfcStep === "writing" && chore && (
              <>
                <Text style={theme.typography.supporterTitle}>NFCタグを発行</Text>
                <Text style={{ marginTop: theme.spacing.s3 }}>
                  「{chore.title}」に対応するタグを{"\n"}新しいNFCタグに近づけてください
                </Text>
                <View style={{ alignItems: "center", marginTop: theme.spacing.s6 }}>
                  <ActivityIndicator size="large" />
                </View>
                <AppButton
                  tone="supporter"
                  label="キャンセル"
                  variant="secondary"
                  style={{ marginTop: theme.spacing.s6 }}
                  onPress={() => setNfcStep("list")}
                />
              </>
            )}

            {nfcStep === "writeFailed" && (
              <>
                <Text style={theme.typography.supporterTitle}>NFCタグを発行</Text>
                <Text style={{ marginTop: theme.spacing.s3 }}>
                  {nfcErrorMessage ?? NFC_WRITE_ERROR_MESSAGE}
                </Text>
                <AppButton tone="supporter" label={NFC_WRITE_RETRY_LABEL} style={{ marginTop: theme.spacing.s4 }} onPress={startWrite} />
                <AppButton
                  tone="supporter"
                  label="キャンセル"
                  variant="secondary"
                  style={{ marginTop: theme.spacing.s2 }}
                  onPress={() => setNfcStep("list")}
                />
              </>
            )}

            {nfcStep === "unsupported" && (
              <>
                <Text style={theme.typography.supporterTitle}>NFCタグを発行</Text>
                <Text style={{ marginTop: theme.spacing.s3 }}>
                  この端末・ブラウザではNFCタグへの書き込みに対応していません。{"\n"}
                  Android版Chromeでこのページを開いて（GitHub Pages版のURLが必要です）お試しください。
                </Text>
                <AppButton
                  tone="supporter"
                  label="閉じる"
                  variant="secondary"
                  style={{ marginTop: theme.spacing.s6 }}
                  onPress={() => setModalVisible(false)}
                />
              </>
            )}
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // [2026-09-20追加・主要画面ワイヤーフレーム.md 54章決定9] P11の
  // styles.metaCard（marginTop: s4のみ）と同じ値。
  metaCard: { marginTop: theme.spacing.s4 },
  fieldLabel: { marginTop: theme.spacing.s4 },
  input: {
    marginTop: theme.spacing.s2,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    padding: theme.spacing.s3,
    backgroundColor: theme.colors.neutralSurface,
  },
  emojiInput: { width: 96, fontSize: 20, textAlign: "center" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  chipSelected: { borderColor: theme.colors.supporterAccent, backgroundColor: theme.colors.supporterAccentSoft },
  // [2026-09-01追加・実装メモ.md 108章] NFCタグの人ごと化まわり。
  tagRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: theme.spacing.s1,
  },
  tagRowConfirm: {
    marginTop: theme.spacing.s1,
    paddingVertical: theme.spacing.s2,
    paddingHorizontal: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    backgroundColor: theme.colors.neutralBg,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  modalCard: { width: "100%", maxWidth: 420 },
});
