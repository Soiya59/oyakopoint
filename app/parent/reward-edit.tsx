import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { createReward, deleteReward, updateReward } from "@/data/api";
import { toJstDateString } from "@/lib/calendarDates";
import { findRewardSuggestionById } from "@/data/rewardSuggestions";
import { saveSequentially } from "@/lib/sequentialSave";

// [2026-09-04追加・統括判断] ごほうびの絵文字の候補チップ。
// 上のコメントのとおり2026-08-20に「自分で決めたい、選択ではなく」との要望で自由入力へ
// 戻した経緯があるが、2026-09-04に統括より「保護者ご褒美もお願いします」と指示があり
// 追加する。チップは自由入力を置き換えるものではなくあくまで補助である（P11
// app/parent/chore-edit.tsx が2026-08-23に同じ整理でチップを復活させた前例に従う）。
// 並びは S9（app/supporter/reward-edit.tsx）と同一。実装メモ129章。
const REWARD_EMOJI_SUGGESTIONS = ["🍰", "☕", "🛍️", "♨️", "🎬"];

/**
 * P13 ごほうび登録・編集
 * 参照: 画面一覧・遷移図.md P13、API仕様.md 7章
 *
 * [2026-08-18実装・本部長] StubScreenのまま放置されており、ユーザーが実機で
 * 「ご褒美の追加ができない」と発見した。P11（app/parent/chore-edit.tsx、
 * 実装メモ.md 21章）と同じ構成で、実際に保存できるフォームに差し替えた。
 * カテゴリー・担当・繰り返し設定・NFC等、choreに存在する項目はrewardsテーブルには
 * 無いため対象外。
 *
 * [2026-08-20追加] 当初emojiは入力項目に含めていなかったが、絵文字が一切表示されず
 * 見にくいとユーザーが実機で発見したため追加した。候補から選ぶチップ形式を一度試したが、
 * ユーザーから「自分で決めたい、選択ではなく」との要望があり、自由入力（TextInput、
 * OS標準の絵文字キーボードを使う想定）に変更した。
 *
 * [2026-09-03追加→2026-09-08削除・本部長] 保護者代理でのごほうび交換の入口を
 * 一時期ここに置いていたが、統括の実機確認により削除した。経緯は実装メモ.md 162章
 * （124章「廃止」の注記）を参照。保護者は設定の「👦 こどもモードにする」で子どもに
 * 切り替えれば同じ操作ができるため、代理の入口は二重導線になっていた。
 *
 * [2026-09-12追加] 担当者（要件定義書07-22章、スキーマ設計.sql 50章、API仕様.md
 * 7d節、開発部/成果物/実装メモ.md 163章）。P11（app/parent/chore-edit.tsx）の
 * 「担当（未指定=誰でも実行可）」チップと同型のUIを「誰でも交換可」の文言に
 * 置き換えて追加した。候補一覧はP11の最新版（2026-09-08改訂）を踏襲し、
 * みまもりメンバー（role='supporter'）を最初から除外している
 * （家族共有ごほうびはみまもりメンバーの一覧に一切表示されないため、担当者に
 * 指定しても実効性が無い。スキーマ設計.sql 50.14章(1)参照）。
 */
export default function RewardEditScreen() {
  const { id, recId, copyFrom } = useLocalSearchParams<{ id?: string; recId?: string; copyFrom?: string }>();
  const { state, refresh } = useAppData();
  const { client } = useSession();
  const isEditMode = !!id;
  const reward = isEditMode ? state.rewards.find((r) => r.id === id) : undefined;

  // [2026-09-11追加・要件定義書07-26章決定8〜9・決定12／主要画面ワイヤーフレーム.md
  // 39.2.2節] コピー機能（クエストと同じ理由でごほうびも対象、決定12）。P13編集モード
  // 内の「コピーして新規登録」から`copyFrom`（コピー元のreward.id）付きで新規作成
  // モードへ遷移してくる。app/parent/chore-edit.tsxの`copySource`と同型。
  const copySource = !isEditMode && copyFrom ? state.rewards.find((r) => r.id === copyFrom) : undefined;

  // [2026-09-06追加] ごほうびのおすすめ集（主要画面ワイヤーフレーム.md 31.0節決定7・
  // 31.3節）。P12のおすすめ集モーダルから遷移した場合のみ`recId`が付く。新規作成モード
  // （idパラメータ無し）のときだけ有効にする（編集モードでは無視する、app/parent/
  // chore-edit.tsxの`recommendation`と同型）。
  const recommendation = !isEditMode && !copySource && recId ? findRewardSuggestionById(recId) : undefined;

  const [name, setName] = useState(reward?.name ?? copySource?.name ?? recommendation?.title ?? "");
  const [emoji, setEmoji] = useState<string | null>(reward?.emoji ?? copySource?.emoji ?? recommendation?.emoji ?? null);
  const [costText, setCostText] = useState(
    reward ? String(reward.cost) : copySource ? String(copySource.cost) : recommendation ? String(recommendation.points) : ""
  );
  const [description, setDescription] = useState(reward?.description ?? copySource?.description ?? "");
  // 編集モード専用（単一選択、変更なし。要件定義書07-26章決定18）。
  const [assignedTo, setAssignedTo] = useState<string | null>(reward?.assigned_to ?? null);
  // [2026-09-11追加・要件定義書07-26章決定14〜21／主要画面ワイヤーフレーム.md 39.3節]
  // 新規登録モード専用の複数選択状態。app/parent/chore-edit.tsxの
  // `selectedAssignees`と同型。担当者はコピーでも引き継がない（決定9）ため、
  // copySourceの有無に関わらず常に空配列から始める。
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  // [2026-09-11追加・要件定義書07-26章決定20／主要画面ワイヤーフレーム.md 39.3.4節]
  // app/parent/chore-edit.tsxの`saveResult`/`failedAssigneeIds`と同型。
  const [saveResult, setSaveResult] = useState<{ succeeded: string[]; failed: string[]; errorMessage: string | null } | null>(
    null
  );
  const [failedAssigneeIds, setFailedAssigneeIds] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // [2026-09-12追加] app/parent/chore-edit.tsxの`members`と同じ絞り込み
  // （2026-09-08改訂・統括指示: 家族共有choreの担当者にみまもりメンバーは
  // 選べない。ごほうびも同じ理由〈家族共有ごほうびはみまもりメンバーの
  // 一覧に出ないため、担当者に指定しても意味が無い〉で最初から踏襲する）。
  const members = state.members.filter((m) => m.is_active && m.role !== "supporter");

  const validate = (): string | null => {
    if (!name.trim()) return "名前を入力してください";
    if (name.trim().length > 100) return "名前は100文字以内で入力してください";
    const costNum = Number(costText);
    if (!Number.isInteger(costNum) || costNum < 1) return "コストは1以上の整数で入力してください";
    return null;
  };

  const remove = async () => {
    if (!reward) return;
    setDeleting(true);
    setErrorMessage(null);
    const res = await deleteReward(client, reward.id);
    setDeleting(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    await refresh();
    router.replace("/parent/rewards");
  };

  // [2026-09-11追加・要件定義書07-26章決定9・決定17・決定20／主要画面ワイヤーフレーム.md
  // 39.2.2節・39.3.4節] app/parent/chore-edit.tsxの`buildChoreInput`と同型。
  const buildRewardInput = (assignee: string | null) => ({
    name: name.trim(),
    emoji,
    cost: Number(costText),
    description: description.trim() ? description.trim() : null,
    assigned_to: assignee,
  });

  const save = async () => {
    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    // app/parent/chore-edit.tsxと同じ理由の安全策（実装メモ.md参照）。
    if (!state.family.id) {
      setErrorMessage("家族データの読み込みが完了していません。もう一度お試しください");
      return;
    }
    setErrorMessage(null);

    // 編集モード: 単一選択（assignedTo）のまま、従来どおり1回だけ更新する。
    if (reward) {
      setSaving(true);
      const res = await updateReward(client, reward.id, buildRewardInput(assignedTo));
      setSaving(false);
      if (!res.ok) {
        setErrorMessage(res.error.message);
        return;
      }
      await refresh();
      router.replace("/parent/rewards");
      return;
    }

    // 新規作成モード: 0人・1人選択時は現行と完全に同じ（要件定義書07-26章決定17）。
    const assigneeIds: (string | null)[] = selectedAssignees.length > 0 ? selectedAssignees : [null];
    if (assigneeIds.length === 1) {
      setSaving(true);
      const res = await createReward(client, state.family.id, buildRewardInput(assigneeIds[0]));
      setSaving(false);
      if (!res.ok) {
        setErrorMessage(res.error.message);
        return;
      }
      await refresh();
      router.replace("/parent/rewards");
      return;
    }

    // 新規作成モード・2人以上: 逐次保存し、失敗した時点で止める。既に保存が成功した
    // 行は取り消さない（要件定義書07-26章決定20）。ロジック本体は画面に依存しない
    // src/lib/sequentialSave.ts に切り出してあり、検証はsequentialSave.verify.tsで
    // 行っている（開発部/成果物/実装メモ.md参照）。app/parent/chore-edit.tsxと同型。
    setSaving(true);
    const familyId = state.family.id;
    const outcome = await saveSequentially(
      assigneeIds as string[], // 2人以上のときは「誰でも」(null)を含まない
      (mid) => members.find((m) => m.id === mid)?.display_name ?? "",
      (mid) => createReward(client, familyId, buildRewardInput(mid))
    );
    setSaving(false);
    if (outcome.remainingIds.length > 0) {
      setSaveResult({ succeeded: outcome.succeeded, failed: outcome.failed, errorMessage: outcome.errorMessage });
      setFailedAssigneeIds(outcome.remainingIds);
      return;
    }
    await refresh();
    router.replace("/parent/rewards");
  };

  // [2026-09-11追加・要件定義書07-26章決定20／主要画面ワイヤーフレーム.md 39.3.4節]
  // 「未保存のメンバーだけ、もう一度保存する」。既に成功したメンバーは再作成しない。
  const retryFailedAssignees = async () => {
    if (!state.family.id || failedAssigneeIds.length === 0) return;
    setSaving(true);
    const familyId = state.family.id;
    const outcome = await saveSequentially(
      failedAssigneeIds,
      (mid) => members.find((m) => m.id === mid)?.display_name ?? "",
      (mid) => createReward(client, familyId, buildRewardInput(mid)),
      saveResult?.succeeded ?? []
    );
    setSaving(false);
    if (outcome.remainingIds.length > 0) {
      setSaveResult({ succeeded: outcome.succeeded, failed: outcome.failed, errorMessage: outcome.errorMessage });
      setFailedAssigneeIds(outcome.remainingIds);
      return;
    }
    setSaveResult(null);
    setFailedAssigneeIds([]);
    await refresh();
    router.replace("/parent/rewards");
  };

  // [2026-09-11追加・要件定義書07-26章決定20／主要画面ワイヤーフレーム.md 39.3.4節]
  // 「ここまでの分でよい（一覧へ戻る）」。未保存だったメンバーの行は作成しない。
  const finishWithSucceededOnly = async () => {
    setSaveResult(null);
    setFailedAssigneeIds([]);
    await refresh();
    router.replace("/parent/rewards");
  };

  if (isEditMode && !reward) {
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentBody}>ごほうびが見つかりませんでした</Text>
        <AppButton label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s4 }} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>
        {reward ? `${reward.emoji ?? "🎁"} ごほうびを編集` : "ごほうびを新規登録"}
      </Text>
      <Text style={[theme.typography.parentBody, styles.purpose]}>reward作成・編集</Text>

      {/* [2026-08-30追加] 登録者・最終編集者（要件定義書07-15章、主要画面ワイヤーフレーム.md
          24.2節決定4）。app/parent/chore-edit.tsxと全く同じ構成・分岐。 */}
      {reward && (
        <Card style={styles.metaCard} tone="parent">
          <Text style={[theme.typography.parentCaption, styles.metaLine, { color: theme.colors.neutralTextSecondary }]}>
            登録: {reward.creator?.display_name ?? "記録なし"}
          </Text>
          <Text style={[theme.typography.parentCaption, styles.metaLine, { color: theme.colors.neutralTextSecondary }]}>
            最終編集:{" "}
            {reward.editor
              ? `${reward.editor.display_name}・${toJstDateString(reward.updated_at).replace(/-/g, "/")}`
              : "記録なし"}
          </Text>
        </Card>
      )}

      {/* [2026-09-11追加・要件定義書07-26章決定9・決定11・決定12／主要画面ワイヤー
          フレーム.md 39.2.2節決定9] コピー元の表示バナー。app/parent/chore-edit.tsxの
          コピー元バナーと同型。24.2節の登録・最終編集Card、31.3節のおすすめ集
          プレフィル表示と表示条件が排他。 */}
      {!reward && copySource && (
        <Card style={styles.metaCard} tone="parent">
          <Text style={theme.typography.parentBody}>
            🧾 「{copySource.name}」の内容をコピーしました。保存するまで、元のごほうびは変わりません
          </Text>
        </Card>
      )}

      {/* [2026-09-06追加] ごほうびのおすすめ集からのプレフィル表示（主要画面ワイヤー
          フレーム.md 31.0節決定8・31.3節）。24.2節の登録・最終編集Cardと表示条件が
          排他（reward有無で分岐）のため、同じCardコンポーネント・同じ位置を流用する
          （app/parent/chore-edit.tsxの`recommendation`表示と同型）。編集モードでは
          表示しない。 */}
      {!reward && !copySource && recommendation && (
        <Card style={styles.metaCard} tone="parent">
          <Text style={theme.typography.parentBody}>
            🎁 おすすめの「{recommendation.title}」をもとに入力しました。内容は自由に変えられます
          </Text>
        </Card>
      )}

      {/* [2026-09-11追加・要件定義書07-26章決定20・決定16／主要画面ワイヤーフレーム.md
          39.3.4節決定16] 保存結果（saveResult）が出ている間は、フォーム全体を操作
          できないようにする（二重登録防止）。app/parent/chore-edit.tsxと同型。 */}
      <View pointerEvents={saveResult ? "none" : "auto"} style={saveResult ? styles.formDisabled : undefined}>

      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>名前（必須）</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="例：おかし1つ"
        maxLength={100}
        style={styles.input}
      />

      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>絵文字（任意）</Text>
      <TextInput
        value={emoji ?? ""}
        onChangeText={(t) => setEmoji(t || null)}
        placeholder="例：🎁（絵文字キーボードから入力）"
        maxLength={8}
        style={[styles.input, styles.emojiInput]}
      />
      <View style={styles.chipRow}>
        {REWARD_EMOJI_SUGGESTIONS.map((e) => (
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

      {/* [2026-09-06追加] 主要画面ワイヤーフレーム.md 31.0節決定6。プレフィル直後のみ、
          「ポイントは目安である」ことを軽い注記として重ねて伝える。 */}
      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>
        {recommendation ? "コスト（目安。自由に変更できます）" : "コスト（1以上の整数）"}
      </Text>
      <TextInput
        value={costText}
        onChangeText={(t) => setCostText(t.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        placeholder="例：10"
        style={styles.input}
      />

      <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>説明（任意）</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="例：好きなおかしを1つえらべる"
        multiline
        style={[styles.input, styles.textArea]}
      />

      {/* 担当（未指定=誰でも交換可）。app/parent/chore-edit.tsxの「担当」チップと
          同型のUI。API仕様.md 7d節「候補一覧はP11の最新版をそのまま踏襲」のとおり、
          みまもりメンバーを除外したmembersを使う。 */}
      {isEditMode ? (
        // 編集モード: 単一選択のまま変更しない（要件定義書07-26章決定18）。
        <>
          <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>担当（未指定=誰でも交換可）</Text>
          <View style={styles.chipRow}>
            <Pressable
              onPress={() => setAssignedTo(null)}
              style={[styles.chip, assignedTo === null && styles.chipSelected]}
            >
              <Text>誰でも交換可</Text>
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
        </>
      ) : (
        // [2026-09-11追加・要件定義書07-26章決定14〜21／主要画面ワイヤーフレーム.md
        // 39.3.1節・39.3.2節] 新規登録モードのみ、特定メンバーを複数選択できる
        // トグル式チップに変更する。app/parent/chore-edit.tsxと同型。
        <>
          <Text style={[theme.typography.parentBodyMedium, styles.fieldLabel]}>
            {selectedAssignees.length >= 2 ? "担当（複数選択可・未指定=誰でも交換可）" : "担当（未指定=誰でも交換可）"}
          </Text>
          <View style={styles.chipRow}>
            <Pressable
              onPress={() => setSelectedAssignees([])}
              style={[
                styles.chip,
                selectedAssignees.length === 0 && styles.chipSelected,
                selectedAssignees.length > 0 && styles.chipDeemphasized,
              ]}
            >
              <Text>誰でも交換可</Text>
            </Pressable>
            {members.map((m) => {
              const selected = selectedAssignees.includes(m.id);
              return (
                <Pressable
                  key={m.id}
                  onPress={() =>
                    setSelectedAssignees((prev) => (prev.includes(m.id) ? prev.filter((mid) => mid !== m.id) : [...prev, m.id]))
                  }
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text>{m.display_name}</Text>
                </Pressable>
              );
            })}
          </View>
          {copySource && (
            <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
              コピー元の担当をそのまま使わず、担当を選び直すことをおすすめします
            </Text>
          )}
          {selectedAssignees.length >= 2 && (
            <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
              {selectedAssignees.length}人ぶん登録します：
              {selectedAssignees.map((mid) => members.find((m) => m.id === mid)?.display_name ?? "").join("・")}
            </Text>
          )}
        </>
      )}

      </View>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      {/* [2026-09-11改訂・要件定義書07-26章決定17・決定20／主要画面ワイヤーフレーム.md
          39.3.3節決定14] 0人・1人選択時は「保存する」（変更なし）。2人以上選択時のみ
          「◯人ぶん保存する」に変える。保存結果（saveResult）が出ている間は隠す。 */}
      {!saveResult && (
        <AppButton
          label={
            !isEditMode && selectedAssignees.length >= 2
              ? saving
                ? `${selectedAssignees.length}人ぶん保存中…`
                : `${selectedAssignees.length}人ぶん保存する`
              : saving
              ? "保存中…"
              : "保存する"
          }
          loading={saving}
          disabled={saving}
          style={{ marginTop: theme.spacing.s6 }}
          onPress={save}
        />
      )}

      {/* [2026-09-11追加・要件定義書07-26章決定8・決定12／主要画面ワイヤーフレーム.md
          39.2.1節決定6・7] 「コピーして新規登録」。編集モードのみ表示し、保存する
          ボタンと削除セクションの間に独立したCardとして置く（P13にはNFCカードが
          無いため、決定8の直後に決定8を続ける形になる）。 */}
      {!saveResult && reward && (
        <Card style={styles.copyCard} tone="parent">
          <Text style={theme.typography.parentBody}>内容をコピーして、新しく登録できます</Text>
          <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s1 }]}>
            担当は引き継ぎません
          </Text>
          <AppButton
            label="📄 コピーして新規登録"
            variant="secondary"
            style={{ marginTop: theme.spacing.s3 }}
            onPress={() => router.push({ pathname: "/parent/reward-edit", params: { copyFrom: reward.id } })}
          />
        </Card>
      )}

      {/* [2026-08-29追加・本部長／軽微変更ルート] ごほうびの削除。ユーザー要望
          「ごほうびにおいても削除できるようにしてほしい」。クエストの削除と同じ扱いで、
          完全削除（DELETE）だが交換履歴とポイントは残る（src/data/api.ts deleteReward参照）。
          取り消せないため、家族削除・クエスト削除と同じ画面内2段階確認にする。 */}
      {!saveResult && isEditMode && reward && (
        <View style={{ marginTop: theme.spacing.s8 }}>
          {confirmingDelete ? (
            <View style={{ gap: theme.spacing.s2 }}>
              <Text style={{ color: theme.colors.statusBlocking }}>
                「{reward.name}」を削除しますか？取り消せません。
              </Text>
              <Text style={theme.typography.parentCaption}>
                これまでの交換の記録とポイントはそのまま残ります。
              </Text>
              <Text style={theme.typography.parentCaption}>
                ただし通帳に残る過去の交換の絵文字は、{reward.emoji ?? "🎁"} ではなく 🎁 に変わります。
              </Text>
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
              label="このごほうびを削除する"
              variant="danger"
              onPress={() => setConfirmingDelete(true)}
              disabled={saving || deleting}
            />
          )}
        </View>
      )}

      {!saveResult && (
        <AppButton label="戻る" variant="secondary" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.back()} />
      )}

      {/* [2026-09-11追加・要件定義書07-26章決定20／主要画面ワイヤーフレーム.md 39.3.4節
          決定15] 一部保存に失敗したときの結果表示。app/parent/chore-edit.tsxと同型。
          配色はstatusPendingSoft/statusPending（アンバー）を使い、statusBlocking
          （赤）は使わない（見守り・達成のトーンで表現する全社共通ルール）。 */}
      {saveResult && (
        <Card style={styles.partialFailCard} tone="parent">
          {saveResult.succeeded.length > 0 && (
            <Text style={theme.typography.parentBody}>✅ {saveResult.succeeded.join("・")} の分は保存できました</Text>
          )}
          <Text
            style={[
              theme.typography.parentBody,
              saveResult.succeeded.length > 0 ? { marginTop: theme.spacing.s2 } : undefined,
            ]}
          >
            ⏳ {saveResult.failed.join("・")} の分はまだ保存できていません
          </Text>
          {saveResult.errorMessage && (
            <Text style={[theme.typography.parentCaption, { color: theme.colors.statusBlocking, marginTop: theme.spacing.s1 }]}>
              （{saveResult.errorMessage}）
            </Text>
          )}
          <AppButton
            label={saving ? "保存中…" : `${saveResult.failed.join("・")} の分だけ、もう一度保存する`}
            loading={saving}
            disabled={saving}
            style={{ marginTop: theme.spacing.s4 }}
            onPress={retryFailedAssignees}
          />
          <AppButton
            label="ここまでの分でよい（一覧へ戻る）"
            variant="secondary"
            disabled={saving}
            style={{ marginTop: theme.spacing.s2 }}
            onPress={finishWithSucceededOnly}
          />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  // [2026-09-11追加・要件定義書07-26章決定16／主要画面ワイヤーフレーム.md 39.3.1節
  // 決定12] app/parent/chore-edit.tsxと同型。
  chipDeemphasized: { opacity: 0.5 },
  purpose: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  // [2026-08-30追加] app/parent/chore-edit.tsxと同じスタイル。
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
  textArea: { minHeight: 80, textAlignVertical: "top" },
  // [2026-09-11追加・要件定義書07-26章決定20／主要画面ワイヤーフレーム.md 39.3.4節
  // 決定16] app/parent/chore-edit.tsxと同型。
  formDisabled: { opacity: 0.5 },
  // [2026-09-11追加・要件定義書07-26章決定8・決定12／主要画面ワイヤーフレーム.md
  // 39.2.1節決定6] app/parent/chore-edit.tsxの`copyCard`と同型。
  copyCard: { marginTop: theme.spacing.s4 },
  // [2026-09-11追加・要件定義書07-26章決定20／主要画面ワイヤーフレーム.md 39.3.4節
  // 決定15] app/parent/chore-edit.tsxの`partialFailCard`と同型。
  partialFailCard: {
    marginTop: theme.spacing.s6,
    backgroundColor: theme.colors.statusPendingSoft,
    borderColor: theme.colors.statusPending,
  },
});
