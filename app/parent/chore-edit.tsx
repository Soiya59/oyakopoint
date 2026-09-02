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
  createChore,
  createChoreNfcTag,
  deleteChore,
  fetchActiveChoreNfcTags,
  revokeChoreNfcTag,
  updateChore,
} from "@/data/api";
import { generateNfcTagToken, isWebNfcSupported, writeNfcTag } from "@/lib/nfc";
import { toJstDateString } from "@/lib/calendarDates";
import type { ChoreNfcTagWithMember } from "@/types/domain";
import { MAX_NFC_TAGS_PER_CHORE_MEMBER } from "@/lib/nfcTags";
import { findChoreSuggestionById } from "@/data/choreSuggestions";

// [2026-08-23追加] 絵文字自由入力欄の候補チップ。よくあるお手伝いの例
// （勉強・掃除・お風呂・洗濯・食器洗い）を想定した5個。
const CHORE_EMOJI_SUGGESTIONS = ["📚", "🧹", "🛁", "🧺", "🍽️"];

/**
 * P11 お手伝い登録・編集
 * 参照: 画面一覧・遷移図.md P11、API仕様.md 3章
 *
 * [2026-08-16実装] 従来はタイトル・ポイント等の基本項目がスタブ表示のみで、
 * `id`パラメータ無し（新規作成導線）に対応していなかったため、P19「じぶんのお手伝い一覧」
 * が空の状態で「お手伝い管理で追加する」を押すと「お手伝いが見つかりませんでした」の
 * 行き止まりになる不具合があった。基本項目を実際に入力・保存できるフォームへ差し替え、
 * 新規作成モード（idパラメータ無し）を新設した。
 * NFCタグ登録モーダル部分（旧実装からそのまま）は変更していない。
 *
 * [レイアウトに関する実装判断・開発部/成果物/実装メモ.md参照] 設計書（画面一覧・遷移図.md
 * P11、主要画面ワイヤーフレーム.md）はNFCタグ登録モーダル（7.1章）以外の基本項目フォームの
 * レイアウト詳細（入力欄の並び順・カテゴリー/担当の選択UI形式等）を明記していないため、
 * 既存の他フォーム画面（P22 app/parent/gratitude-send.tsx のチップ選択・ステッパー、
 * P15 app/parent/child-profile.tsx のTextInput+バリデーション表示）と統一感のあるUIを
 * 独自に採用した。
 */
// [2026-09-01改訂・実装メモ.md 108章] 「1chore=1タグ」から「クエスト×メンバー」単位の
// 発行に作り直したことに伴い、単一のON/OFF状態ではなく多段のモーダルステップに
// 拡張した（UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 7.6.1節決定7）。
type NfcModalStep = "list" | "selectMember" | "writing" | "writeFailed" | "unsupported";

// [変更] 2026-08-15改訂: 「承認要否（requires_approval）」項目を削除した。
// 要件定義書.md v0.5で承認フローが全面廃止され、chores.requires_approval列自体が
// スキーマ設計.sql v2.0で削除されたため（画面一覧・遷移図.md P11「承認要否の設定項目は
// 廃止」参照）。

export default function ChoreEditScreen() {
  const { id, recId } = useLocalSearchParams<{ id?: string; recId?: string }>();
  const { state, refresh } = useAppData();
  const { client } = useSession();
  const isEditMode = !!id;
  const chore = isEditMode ? state.chores.find((c) => c.id === id) : undefined;

  // [2026-09-02追加] クエストのおすすめ集（要件定義書07-16章、主要画面ワイヤーフレーム.md
  // 27.0節決定5・27.3節）。P10のおすすめ集モーダルから遷移した場合のみ`recId`が付く。
  // 新規作成モード（idパラメータ無し）のときだけ有効にする（編集モードでは無視する）。
  const recommendation = !isEditMode && recId ? findChoreSuggestionById(recId) : undefined;

  // [重要] Reactのフック規則（同一コンポーネントインスタンスの全レンダーで同じ順番・同じ数の
  // フックを呼ぶ）を守るため、下記「編集モードなのにchoreが見つからない」場合の早期returnは
  // 必ずすべてのuseState呼び出しの後に置くこと（先頭付近に置くとレンダーによってフック呼び出し数が
  // 変わり、Reactが実行時エラーを投げる）。
  // ---- フォーム項目（スキーマ設計.sql 4章 chores参照） ----
  const [title, setTitle] = useState(chore?.title ?? recommendation?.title ?? "");
  const [emoji, setEmoji] = useState<string | null>(chore?.emoji ?? recommendation?.emoji ?? null);
  const [pointsText, setPointsText] = useState(chore ? String(chore.points) : recommendation ? String(recommendation.points) : "");
  const [categoryId, setCategoryId] = useState<string | null>(chore?.category_id ?? null);
  // [2026-09-02追加] 要件定義書07-16章4-1節「頻度→繰り返し設定の変換仕様」決定1〜3
  // （2026-09-02改訂・本部長差し戻し対応）: おすすめはすべてis_repeatable=trueに変換し、
  // daily_limitは未指定（空欄）のままにする（DBトリガーが保存時に1を補完する）。
  const [isRepeatable, setIsRepeatable] = useState(chore?.is_repeatable ?? (recommendation ? true : false));
  const [dailyLimitText, setDailyLimitText] = useState(chore?.daily_limit != null ? String(chore.daily_limit) : "");
  const [assignedTo, setAssignedTo] = useState<string | null>(chore?.assigned_to ?? null);

  const [saving, setSaving] = useState(false);
  // [2026-08-29追加・本部長／軽微変更ルート] クエストの削除。ユーザー要望
  // 「クエストの削除を可能とする」。完全削除（DELETE）だが完了履歴・ポイント・
  // 家族の木・通帳は残る（src/data/api.ts deleteChore のコメント参照）。
  // 取り消せないため、家族削除と同じ「1タップ目で確認表示→2タップ目で確定」の
  // 画面内2段階確認にする（Alert.alert等はWeb版で挙動が不安定なため使わない）。
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [nfcStep, setNfcStep] = useState<NfcModalStep>("list");
  const [nfcErrorMessage, setNfcErrorMessage] = useState<string | null>(null);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);

  // [2026-09-01追加] 発行済みタグ一覧（chore_nfc_tags、有効なもののみ）。P11の外側の
  // ボタン文言（「NFCタグを登録する」／「NFCタグを管理する（◯まい発行ずみ）」）にも
  // 使うため、モーダルを開く前・chore確定時点で取得しておく（主要画面ワイヤーフレーム.md
  // 7.6.1節「開いた瞬間に現状の枚数感がつかめるようにするため」）。
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

  const tagCountFor = (memberId: string) => tags.filter((t) => t.member_id === memberId).length;

  const openIssueModal = () => {
    if (!chore) return;
    setIssuedSnackbar(null);
    if (!isWebNfcSupported()) {
      setNfcStep("unsupported");
      setModalVisible(true);
      return;
    }
    // 主要画面ワイヤーフレーム.md 7.6.1節「メンバー選択」: assigned_toが特定の1人なら
    // デフォルト選択（選択の余地は無い）、nullなら未選択から始める。
    setSelectedOwnerId(chore.assigned_to ?? null);
    setNfcStep("selectMember");
    setModalVisible(true);
  };

  const startWrite = async () => {
    if (!chore || !selectedOwnerId) return;
    setNfcErrorMessage(null);
    setNfcStep("writing");
    // API仕様.md 3a-2章手順2「クライアント側で暗号論的に安全なランダムトークンを生成」
    const newToken = generateNfcTagToken();
    // [2026-08-18実装] Web NFC API（Android Chrome限定）で実際に物理タグへ書き込む。
    // src/lib/nfc.ts参照。ここでのawaitは実際にタグをタップするまで待機し続ける。
    const result = await writeNfcTag(newToken);
    if (result.ok && result.tagValue) {
      // API仕様.md 3a-2章手順4「chore×memberに紐づけ」相当。
      const res = await createChoreNfcTag(client, {
        chore_id: chore.id,
        member_id: selectedOwnerId,
        tag_value: result.tagValue,
      });
      if (res.ok) {
        await loadTags(chore.id);
        const ownerName = state.members.find((m) => m.id === selectedOwnerId)?.display_name ?? "";
        setIssuedSnackbar(`${ownerName}さんのタグを発行しました`);
        setNfcStep("list");
      } else {
        setNfcErrorMessage(res.error.message);
        setNfcStep("writeFailed");
      }
    } else if (result.errorReason === "cancelled") {
      setNfcStep("selectMember");
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

  const categories = state.categories;
  const members = state.members.filter((m) => m.is_active);

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

  const remove = async () => {
    if (!chore) return;
    setDeleting(true);
    setErrorMessage(null);
    const res = await deleteChore(client, chore.id);
    setDeleting(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    await refresh();
    router.replace("/parent/chores");
  };

  const save = async () => {
    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    // [2026-08-22追加・本部長] ユーザーが実機で「invalid input syntax for type
    // uuid: ''」という分かりにくいエラーに遭遇した。state.family.idが未確定の
    // まま保存しようとすると発生しうるため（通常はsrc/data/store.tsxの
    // ローディングゲートで防がれるはずだが、念のための二重の安全策として）、
    // ここでも明示的にチェックし、分かりやすい案内を表示する。
    if (!state.family.id) {
      setErrorMessage("家族データの読み込みが完了していません。もう一度お試しください");
      return;
    }
    setErrorMessage(null);
    setSaving(true);

    const pointsNum = Number(pointsText);
    const dailyLimitNum = isRepeatable && dailyLimitText.trim() ? Number(dailyLimitText) : null;

    const input = {
      category_id: categoryId,
      title: title.trim(),
      emoji,
      points: pointsNum,
      is_repeatable: isRepeatable,
      daily_limit: dailyLimitNum,
      assigned_to: assignedTo,
    };

    const res = chore
      ? await updateChore(client, chore.id, input)
      : await createChore(client, state.family.id, input);

    setSaving(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    await refresh();
    // 保存成功後はP10（お手伝い管理一覧）へ戻る（依頼内容5.）
    router.replace("/parent/chores");
  };

  // 編集モードなのに対象choreが見つからない場合（不正なid・削除済み等）のみ、
  // 従来どおり行き止まり表示にする。新規作成モード（idパラメータ無し）はこの分岐に
  // 入らず、上のフォームをそのまま描画する（今回のバグ修正の核心部分）。
  if (isEditMode && !chore) {
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentBody}>クエストが見つかりませんでした</Text>
        <AppButton label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s4 }} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <View style={styles.badge}>
        <Text style={styles.badgeText}>P11</Text>
      </View>
      <Text style={theme.typography.parentTitle}>
        {chore ? `${chore.emoji ?? "📝"} クエストを編集` : "クエストを新規登録"}
      </Text>
      <Text style={[theme.typography.parentBody, styles.purpose]}>chore作成・編集</Text>

      {/* [2026-08-30追加] 登録者・最終編集者（要件定義書07-15章、主要画面ワイヤーフレーム.md
          24.2節決定4）。既存のnfcCardと同種のCardで軽く囲み、フォームより手前・目的文の
          直後に置く。新規作成モード（chore未定義）ではまだcreated_by/updated_byが
          存在しないため表示しない。created_by/updated_byがNULL（または解決できない）場合は
          「不明」ではなく「記録なし」と表示する（07-15章4章）。 */}
      {chore && (
        <Card style={styles.metaCard} tone="parent">
          <Text style={[theme.typography.parentCaption, styles.metaLine, { color: theme.colors.neutralTextSecondary }]}>
            登録: {chore.creator?.display_name ?? "記録なし"}
          </Text>
          <Text style={[theme.typography.parentCaption, styles.metaLine, { color: theme.colors.neutralTextSecondary }]}>
            最終編集:{" "}
            {chore.editor
              ? `${chore.editor.display_name}・${toJstDateString(chore.updated_at).replace(/-/g, "/")}`
              : "記録なし"}
          </Text>
        </Card>
      )}

      {/* [2026-09-02追加] クエストのおすすめ集からのプレフィル表示（要件定義書07-16章
          UIUX申し送り、主要画面ワイヤーフレーム.md 27.0節決定6・27.3節）。24.2節の
          登録・最終編集Cardと表示条件が排他（chore有無で分岐）のため、同じCard
          コンポーネント・同じ位置を流用する。編集モードでは表示しない。 */}
      {!chore && recommendation && (
        <Card style={styles.metaCard} tone="parent">
          <Text style={theme.typography.parentBody}>
            🍀 おすすめの「{recommendation.title}」をもとに入力しました。内容は自由に変えられます
          </Text>
        </Card>
      )}

      {/* タイトル */}
      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>タイトル（必須）</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="例：お風呂そうじ"
        maxLength={100}
        style={styles.input}
      />

      {/* 絵文字（任意・自由入力＋候補）
          [2026-08-23追加] 自由入力のみだと何を入れればいいか迷うとのフィードバックがあり、
          よくあるクエスト（勉強・掃除・お風呂等）を想定した候補チップを追加した。
          チップは自由入力を補助するショートカットであり、選択肢を自由入力の代わりに
          するものではない（前回の「選択ではなく自分で決めたい」という要望とも矛盾しない）。 */}
      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>絵文字（任意）</Text>
      <TextInput
        value={emoji ?? ""}
        onChangeText={(t) => setEmoji(t || null)}
        placeholder="例：🧹（絵文字キーボードから入力）"
        maxLength={8}
        style={[styles.input, styles.emojiInput]}
      />
      <View style={styles.chipRow}>
        {CHORE_EMOJI_SUGGESTIONS.map((e) => (
          <Pressable
            key={e}
            onPress={() => setEmoji(e)}
            style={[styles.chip, emoji === e && styles.chipSelected]}
          >
            <Text style={{ fontSize: 18 }}>{e}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
        Windowsは「Windowsキー + .（ピリオド）」、スマホは絵文字キーボードから入力できます
      </Text>

      {/* ポイント */}
      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>ポイント（1以上の整数）</Text>
      <TextInput
        value={pointsText}
        onChangeText={(t) => setPointsText(t.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        placeholder="例：10"
        style={styles.input}
      />

      {/* カテゴリー */}
      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>カテゴリー</Text>
      <View style={styles.chipRow}>
        <Pressable
          onPress={() => setCategoryId(null)}
          style={[styles.chip, categoryId === null && styles.chipSelected]}
        >
          <Text>未選択</Text>
        </Pressable>
        {categories.map((cat) => (
          <Pressable
            key={cat.id}
            onPress={() => setCategoryId(cat.id)}
            style={[styles.chip, categoryId === cat.id && styles.chipSelected]}
          >
            {cat.color ? <View style={[styles.colorDot, { backgroundColor: cat.color }]} /> : null}
            <Text>{cat.name}</Text>
          </Pressable>
        ))}
      </View>

      {/* 繰り返し設定 */}
      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>繰り返し設定</Text>
      <View style={styles.chipRow}>
        <Pressable
          onPress={() => setIsRepeatable(false)}
          style={[styles.chip, !isRepeatable && styles.chipSelected]}
        >
          <Text>1回だけ</Text>
        </Pressable>
        <Pressable
          onPress={() => setIsRepeatable(true)}
          style={[styles.chip, isRepeatable && styles.chipSelected]}
        >
          <Text>くり返す</Text>
        </Pressable>
      </View>

      {/* 1日の上限回数（繰り返し設定がtrueのときのみ表示・入力可） */}
      {isRepeatable && (
        <>
          <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>1日の上限回数（空欄で無制限）</Text>
          <TextInput
            value={dailyLimitText}
            onChangeText={(t) => setDailyLimitText(t.replace(/[^0-9]/g, ""))}
            keyboardType="number-pad"
            placeholder="空欄=無制限"
            style={styles.input}
          />
          {!chore && (
            <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
              ※ 新規作成時に空欄のまま保存すると、1日1回までとして登録されます（無制限にしたい場合は、保存後にもう一度編集して空欄のまま保存してください）。
            </Text>
          )}
        </>
      )}

      {/* 担当 */}
      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>担当（未指定=誰でも実行可）</Text>
      <View style={styles.chipRow}>
        <Pressable
          onPress={() => setAssignedTo(null)}
          style={[styles.chip, assignedTo === null && styles.chipSelected]}
        >
          <Text>誰でも実行可</Text>
        </Pressable>
        {members.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => setAssignedTo(m.id)}
            style={[styles.chip, assignedTo === m.id && styles.chipSelected]}
          >
            <Text>{m.display_name}</Text>
          </Pressable>
        ))}
      </View>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <AppButton
        label={saving ? "保存中…" : "保存する"}
        loading={saving}
        disabled={saving}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={save}
      />

      {/* NFCタグ管理（人ごと化版・2026-09-01改訂。主要画面ワイヤーフレーム.md 7.6.1章）
          新規作成モード（choreがまだ存在しない）では対象のchore_idが無いため表示しない。 */}
      {chore && (
        <Card style={styles.nfcCard} tone="parent">
          <Text style={theme.typography.parentBodyMedium}>NFCタグ</Text>
          <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
            このクエストに対応するタグに家族の誰かがスマホをかざすと、完了報告（C13→C14）が起動します。
          </Text>
          <AppButton
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

      {isEditMode && chore && (
        <View style={{ marginTop: theme.spacing.s8 }}>
          {confirmingDelete ? (
            <View style={{ gap: theme.spacing.s2 }}>
              <Text style={{ color: theme.colors.statusBlocking }}>
                「{chore.title}」を削除しますか？取り消せません。
              </Text>
              <Text style={theme.typography.parentCaption}>
                これまでの記録・ポイント・家族の木はそのまま残ります。
              </Text>
              {tags.length > 0 ? (
                <Text style={theme.typography.parentCaption}>
                  このクエストに発行した{tags.length}まいのNFCタグは使えなくなります（タグの貼り直しが必要です）。
                </Text>
              ) : null}
              <AppButton
                label={deleting ? "削除中…" : "本当に削除する"}
                variant="danger"
                onPress={remove}
                disabled={deleting}
              />
              <AppButton label="やめる" variant="ghost" onPress={() => setConfirmingDelete(false)} disabled={deleting} />
            </View>
          ) : (
            <AppButton
              label="このクエストを削除する"
              variant="danger"
              onPress={() => setConfirmingDelete(true)}
              disabled={saving || deleting}
            />
          )}
        </View>
      )}

      <AppButton label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />

      {/* NFCタグ管理モーダル（人ごと化版・2026-09-01改訂）
          主要画面ワイヤーフレーム.md 7.6.1章「一覧→（＋新規発行）→メンバー選択→書き込み」 */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <Card style={styles.modalCard}>
            {nfcStep === "list" && chore && (
              <>
                <Text style={theme.typography.parentTitle}>NFCタグを管理</Text>
                <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
                  「{chore.title}」のタグ
                </Text>

                {issuedSnackbar && (
                  <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s2, color: theme.colors.brandPrimaryStrong }]}>
                    {issuedSnackbar}
                  </Text>
                )}
                {tagsError && (
                  <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.statusBlocking }}>{tagsError}</Text>
                )}

                {tags.length === 0 ? (
                  <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s3 }]}>
                    まだNFCタグは発行されていません
                  </Text>
                ) : (
                  <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s3 }}>
                    {members
                      .filter((m) => tagCountFor(m.id) > 0)
                      .map((m) => (
                        <View key={m.id}>
                          <Text style={theme.typography.parentBodyMedium}>
                            {m.display_name}（{tagCountFor(m.id)}まい）
                          </Text>
                          {tags
                            .filter((t) => t.member_id === m.id)
                            .map((t) =>
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
                                      label="やめる"
                                      variant="ghost"
                                      disabled={revokingTagId === t.id}
                                      onPress={() => {
                                        setConfirmingRevokeTagId(null);
                                        setRevokeErrorTagId(null);
                                      }}
                                    />
                                    <AppButton
                                      label={revokingTagId === t.id ? "解除中…" : "解除する"}
                                      variant="danger"
                                      disabled={revokingTagId === t.id}
                                      onPress={() => startRevoke(t.id)}
                                    />
                                  </View>
                                </View>
                              ) : (
                                <View key={t.id} style={styles.tagRow}>
                                  <Text style={theme.typography.parentBody}>
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
                      ))}
                  </View>
                )}

                <AppButton label="＋ 新しいタグを発行する" style={{ marginTop: theme.spacing.s4 }} onPress={openIssueModal} />
                <AppButton
                  label="とじる"
                  variant="secondary"
                  style={{ marginTop: theme.spacing.s3 }}
                  onPress={() => setModalVisible(false)}
                />
              </>
            )}

            {nfcStep === "selectMember" && chore && (
              <>
                <Text style={theme.typography.parentTitle}>誰の分のタグを発行しますか？</Text>
                <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
                  {(chore.assigned_to ? members.filter((m) => m.id === chore.assigned_to) : members).map((m) => {
                    const count = tagCountFor(m.id);
                    const atLimit = count >= MAX_NFC_TAGS_PER_CHORE_MEMBER;
                    const selected = selectedOwnerId === m.id;
                    return (
                      <View key={m.id}>
                        <Pressable
                          disabled={atLimit}
                          onPress={() => setSelectedOwnerId(m.id)}
                          style={[styles.memberRow, selected && styles.memberRowSelected, atLimit && styles.memberRowDisabled]}
                        >
                          <Text style={theme.typography.parentBody}>
                            {selected ? "●" : "○"} {m.display_name}（{count}/{MAX_NFC_TAGS_PER_CHORE_MEMBER}まい
                            {atLimit ? "・選べません" : ""}）
                          </Text>
                        </Pressable>
                        {atLimit && (
                          <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary, marginLeft: theme.spacing.s2 }]}>
                            ちょうどいい枚数になったら、使わなくなったタグを解除するとまた発行できます
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s6 }}>
                  <AppButton label="もどる" variant="secondary" onPress={() => setNfcStep("list")} />
                  <AppButton
                    label="つぎへ"
                    disabled={!selectedOwnerId || tagCountFor(selectedOwnerId) >= MAX_NFC_TAGS_PER_CHORE_MEMBER}
                    onPress={startWrite}
                  />
                </View>
              </>
            )}

            {nfcStep === "writing" && chore && (
              <>
                <Text style={theme.typography.parentTitle}>NFCタグを発行</Text>
                <Text style={{ marginTop: theme.spacing.s3 }}>
                  {state.members.find((m) => m.id === selectedOwnerId)?.display_name ?? ""}の「{chore.title}」に対応するタグを
                  {"\n"}新しいNFCタグに近づけてください
                </Text>
                <View style={{ alignItems: "center", marginTop: theme.spacing.s6 }}>
                  <ActivityIndicator size="large" />
                </View>
                <AppButton
                  label="キャンセル"
                  variant="secondary"
                  style={{ marginTop: theme.spacing.s6 }}
                  onPress={() => setNfcStep("selectMember")}
                />
              </>
            )}

            {nfcStep === "writeFailed" && (
              <>
                <Text style={theme.typography.parentTitle}>NFCタグを発行</Text>
                <Text style={{ marginTop: theme.spacing.s3 }}>
                  {nfcErrorMessage ?? "うまく書き込めませんでした。もう一度近づけてください"}
                </Text>
                <AppButton label="もう一度試す" style={{ marginTop: theme.spacing.s4 }} onPress={startWrite} />
                <AppButton
                  label="キャンセル"
                  variant="secondary"
                  style={{ marginTop: theme.spacing.s2 }}
                  onPress={() => setNfcStep("selectMember")}
                />
              </>
            )}

            {nfcStep === "unsupported" && (
              <>
                <Text style={theme.typography.parentTitle}>NFCタグを発行</Text>
                <Text style={{ marginTop: theme.spacing.s3 }}>
                  この端末・ブラウザではNFCタグへの書き込みに対応していません。{"\n"}
                  Android版Chromeでこのページを開いて（GitHub Pages版のURLが必要です）お試しください。
                </Text>
                <AppButton
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
  badge: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.brandPrimarySoft,
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s1,
    borderRadius: theme.radius.parentMd,
    marginBottom: theme.spacing.s3,
  },
  badgeText: { color: theme.colors.brandPrimaryStrong, fontWeight: "700", fontSize: 12 },
  purpose: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  // [2026-08-30追加] 主要画面ワイヤーフレーム.md 24.2節決定4。nfcCardと同種の
  // Card枠（色は既定のneutralBorderのまま、強調色は使わない）。
  metaCard: { marginTop: theme.spacing.s4 },
  metaLine: { marginTop: theme.spacing.s1 },
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
  chipSelected: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
  colorDot: { width: 10, height: 10, borderRadius: 5, marginRight: theme.spacing.s1 },
  nfcCard: { marginTop: theme.spacing.s4 },
  // [2026-09-01追加・実装メモ.md 108章] NFCタグの人ごと化に伴う発行済み一覧の行。
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
  memberRow: {
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  memberRowSelected: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
  memberRowDisabled: { opacity: 0.5 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  modalCard: { width: "100%", maxWidth: 420 },
});
