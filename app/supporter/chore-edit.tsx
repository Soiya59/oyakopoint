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
  createPersonalChore,
  deleteChore,
  fetchActiveChoreNfcTags,
  revokeChoreNfcTag,
  updatePersonalChore,
} from "@/data/api";
import { generateNfcTagToken, isWebNfcSupported, writeNfcTag } from "@/lib/nfc";
import { toJstDateString } from "@/lib/calendarDates";
import type { ChoreNfcTagWithMember } from "@/types/domain";
import { MAX_NFC_TAGS_PER_CHORE_MEMBER } from "@/lib/nfcTags";

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
 * S6 自分専用のお手伝い登録・編集（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S6、API仕様.md 3b章
 *
 * app/parent/chore-edit.tsx（P11）と同じ構成の基本項目フォームだが、以下が異なる。
 * - カテゴリー・担当（assigned_to）・NFCタグ登録は対象外（自分専用choreには存在しない
 *   概念、19章「自分専用choreにおけるassigned_toは自己指定」のためUIで選ばせる必要が無い）
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
 * 設けない）。編集・完了報告は引き続き作成者本人のみが行える（要件定義書07-7章
 * 「自分専用choreの公開方針」参照）。
 */
export default function SupporterChoreEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state, refresh } = useAppData();
  const { client } = useSession();
  const isEditMode = !!id;
  const chore = isEditMode ? state.chores.find((c) => c.id === id) : undefined;

  const [title, setTitle] = useState(chore?.title ?? "");
  const [emoji, setEmoji] = useState<string | null>(chore?.emoji ?? null);
  const [pointsText, setPointsText] = useState(chore ? String(chore.points) : "");
  const [isRepeatable, setIsRepeatable] = useState(chore?.is_repeatable ?? false);
  const [dailyLimitText, setDailyLimitText] = useState(chore?.daily_limit != null ? String(chore.daily_limit) : "");

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // [2026-09-01追加・実装メモ.md 108章] NFCタグ管理（要件定義書07-2章判断事項7）。
  // 自分専用クエストのタグの持ち主は常に作成者本人（＝いまログイン中のみまもり
  // メンバー自身、state.activeParentMemberId）固定のため、P11のようなメンバー選択
  // ステップは無い（主要画面ワイヤーフレーム.md 7.6.2節）。
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
    if (!isWebNfcSupported()) {
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
    const pointsNum = Number(pointsText);
    if (!Number.isInteger(pointsNum) || pointsNum < 1) return "ポイントは1以上の整数で入力してください";
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
      setErrorMessage("家族データの読み込みが完了していません。もう一度お試しください");
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

    const res = chore
      ? await updatePersonalChore(client, chore.id, input)
      : await createPersonalChore(client, state.family.id, input);

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

      <Text style={[theme.typography.supporterBodyMedium, styles.fieldLabel]}>ポイント（1以上の整数）</Text>
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

      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s4, color: theme.colors.neutralTextSecondary }]}>
        ※ このクエストは家族みんなに見えます。完了報告や編集ができるのは自分だけです。
      </Text>

      {errorMessage && <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>}

      <AppButton
        tone="supporter"
        label={saving ? "保存中…" : "保存する"}
        loading={saving}
        disabled={saving || deleting}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={save}
      />

      {/* NFCタグ管理（要件定義書07-2章判断事項7、主要画面ワイヤーフレーム.md 7.6.2章）
          新規作成モード（choreがまだ存在しない）では対象のchore_idが無いため表示しない。 */}
      {chore && (
        <Card style={{ marginTop: theme.spacing.s4 }} tone="supporter">
          <Text style={theme.typography.supporterBodyMedium}>NFCタグ</Text>
          <Text style={[theme.typography.supporterCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
            このクエストに対応するタグにスマホをかざすと、完了報告（C13→C14）が起動します。
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

      {chore && (
        <AppButton
          tone="supporter"
          label={deleting ? "削除中…" : "このクエストを削除する"}
          variant="danger"
          disabled={saving || deleting}
          style={{ marginTop: theme.spacing.s3 }}
          onPress={remove}
        />
      )}
      {chore && tags.length > 0 && (
        <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
          ※ 削除すると、発行した{tags.length}まいのNFCタグも使えなくなります。
        </Text>
      )}

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
                              解除できませんでした。もう一度お試しください
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
                  {nfcErrorMessage ?? "うまく書き込めませんでした。もう一度近づけてください"}
                </Text>
                <AppButton tone="supporter" label="もう一度試す" style={{ marginTop: theme.spacing.s4 }} onPress={startWrite} />
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
