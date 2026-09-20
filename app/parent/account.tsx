import React, { useMemo, useState } from "react";
import { router } from "expo-router";
import { TextInput, View } from "react-native";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { Text } from "react-native";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { removeMember } from "@/data/api";

/**
 * P41 アカウントについて（保護者、2026-09-21新設）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 59.3節
 *       要件定義書.md 07-33章 決定1〜6・17
 *       設計部/成果物/API仕様.md 24.3・24.5章
 *
 * `app/parent/family.tsx`（P14）にあった「ログアウト・家族から抜ける・
 * 家族を削除する」を移設し、「アカウントを削除する」（新設・P42へ遷移）を
 * 追加した4行の画面（59.3節）。
 *
 * ---- 破壊的操作についての事前記録（開発部CLAUDE.md） ----
 * この画面が呼ぶ `removeMember(me.id, "soft_remove" | "delete_family")` は、
 * いずれも不可逆な破壊的操作である。
 * - soft_remove（家族から抜ける）: 自分がオーナーで、かつ他に在籍保護者が
 *   いる場合、サーバ側（remove-member Edge Function）が
 *   transfer_family_ownership() でオーナー権限を自動的に移してから抜ける
 *   （要件定義書07-33章 決定5）。ログイン用アカウントは消えない。
 * - delete_family（家族を削除する）: families行のDELETE（CASCADEで家族の
 *   全データが連動削除される）に加え、実行したオーナー本人の
 *   ログイン用アカウント（auth.users）もハード削除される（決定9）。
 *   「家族から抜ける」を押したときでも、自分が唯一の在籍保護者であれば
 *   このモードに合流する（決定4。59.3.1節ケースB）。
 */
export default function ParentAccountScreen() {
  const { state } = useAppData();
  const { parentMember, logoutParent } = useSession();
  const me = parentMember;

  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 59.3.1節「判定（クライアント側、state.membersから計算）」のとおり。
  const otherActiveParents = useMemo(
    () => state.members.filter((m) => m.role === "parent" && m.is_active && m.id !== me?.id),
    [state.members, me]
  );
  const oldestOtherParentName = useMemo(() => {
    if (otherActiveParents.length === 0) return null;
    const sorted = [...otherActiveParents].sort((a, b) => a.created_at.localeCompare(b.created_at));
    return sorted[0].display_name;
  }, [otherActiveParents]);
  // 決定4: オーナーで、他に在籍保護者が1人もいない → 家族ごと削除に合流。
  const willMergeIntoDelete = !!me?.is_owner && otherActiveParents.length === 0;

  // "leaveA" | "deleteFamily" | null。一度に1つの確認パネルしか開かない。
  const [confirmMode, setConfirmMode] = useState<"leaveA" | "deleteFamily" | null>(null);
  // deleteFamilyパネルが「家族から抜ける」経由（59.3.1bケースB）で開いたか。
  // 冒頭の1文の有無だけが変わる（59.3.2節と完全に共通のパネル）。
  const [deleteFamilyViaLeave, setDeleteFamilyViaLeave] = useState(false);
  const [deleteFamilyNameDraft, setDeleteFamilyNameDraft] = useState("");

  const doLogout = async () => {
    await logoutParent();
    router.replace("/");
  };

  const startLeave = () => {
    setErrorMessage(null);
    if (willMergeIntoDelete) {
      // 59.3.1bケースB: 「抜けるだけ」という軽い選択肢は出さない（決定4）。
      // 59.3.2節の確認パネルへそのまま合流する。
      setDeleteFamilyViaLeave(true);
      setDeleteFamilyNameDraft("");
      setConfirmMode("deleteFamily");
      return;
    }
    setConfirmMode("leaveA");
  };

  const cancelConfirm = () => {
    setConfirmMode(null);
    setDeleteFamilyViaLeave(false);
    setDeleteFamilyNameDraft("");
  };

  const confirmLeave = async () => {
    if (!me) return;
    setProcessing(true);
    setErrorMessage(null);
    const res = await removeMember(me.id, "soft_remove");
    setProcessing(false);
    if (!res.ok) {
      setErrorMessage(
        res.error.code === "owner_must_delete_family"
          ? "他に在籍している保護者がいないため、抜けるには家族を削除してください。"
          : res.error.message
      );
      return;
    }
    await logoutParent();
    router.replace("/");
  };

  const startDeleteFamily = () => {
    setErrorMessage(null);
    setDeleteFamilyViaLeave(false);
    setDeleteFamilyNameDraft("");
    setConfirmMode("deleteFamily");
  };

  const confirmDeleteFamily = async () => {
    if (!me) return;
    setProcessing(true);
    setErrorMessage(null);
    const res = await removeMember(me.id, "delete_family", deleteFamilyNameDraft);
    setProcessing(false);
    if (!res.ok) {
      setErrorMessage(
        res.error.code === "family_name_mismatch"
          ? "家族の名前が一致しません。もう一度ご確認ください"
          : res.error.message
      );
      return;
    }
    await logoutParent();
    router.replace("/");
  };

  const deleteFamilyNameMatches =
    deleteFamilyNameDraft.trim().length > 0 && deleteFamilyNameDraft.trim() === state.family.name.trim();

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/family")} />
      <Text style={theme.typography.parentTitle}>アカウントについて</Text>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <View style={{ marginTop: theme.spacing.s4, gap: theme.spacing.s3 }}>
        <AppButton label="ログアウト" variant="secondary" onPress={doLogout} disabled={processing || confirmMode !== null} />

        {/* 59.3.1節 決定4。家族から抜ける（ケースA=軽い確認／ケースB=家族の削除に合流）。 */}
        {confirmMode === "leaveA" ? (
          <View style={{ gap: theme.spacing.s2 }}>
            <Text style={theme.typography.parentBody}>
              家族から抜けますか？ これまでの完了報告やポイントの記録は、家族のほうに残ります。もう一度入るには、招待コードが必要です。
              {me?.is_owner && oldestOtherParentName
                ? `\n抜けたあと、${oldestOtherParentName}さんがこの家族の管理者になります。`
                : ""}
            </Text>
            <AppButton
              label={processing ? "処理しています…" : "ほんとうに抜ける"}
              variant="danger"
              onPress={confirmLeave}
              disabled={processing}
            />
            <AppButton label="やめる" variant="ghost" onPress={cancelConfirm} disabled={processing} />
          </View>
        ) : confirmMode === "deleteFamily" && deleteFamilyViaLeave ? (
          <View style={{ gap: theme.spacing.s2 }}>
            <Text style={theme.typography.parentBody}>
              「家族から抜ける」を選びましたが、いま家族の保護者はあなただけです。抜けると、この家族を管理できる人がいなくなります。
            </Text>
            {renderDeleteFamilyBody({
              familyName: state.family.name,
              draft: deleteFamilyNameDraft,
              onChangeDraft: setDeleteFamilyNameDraft,
              matches: deleteFamilyNameMatches,
              processing,
              onConfirm: confirmDeleteFamily,
              onCancel: cancelConfirm,
            })}
          </View>
        ) : (
          <AppButton
            label="家族から抜ける"
            variant="secondary"
            onPress={startLeave}
            disabled={processing || confirmMode !== null}
          />
        )}

        {/* 59.3.3節 決定8。P42（新設）へ遷移する。インライン展開はしない。 */}
        <AppButton
          label="アカウントを削除する"
          variant="danger"
          onPress={() => router.push("/account-delete")}
          disabled={processing || confirmMode !== null}
        />

        {/* 59.3.2節 決定6・7。オーナーにのみ表示（現状維持）。 */}
        {me?.is_owner ? (
          confirmMode === "deleteFamily" && !deleteFamilyViaLeave ? (
            renderDeleteFamilyBody({
              familyName: state.family.name,
              draft: deleteFamilyNameDraft,
              onChangeDraft: setDeleteFamilyNameDraft,
              matches: deleteFamilyNameMatches,
              processing,
              onConfirm: confirmDeleteFamily,
              onCancel: cancelConfirm,
            })
          ) : (
            <AppButton
              label="家族を削除する"
              variant="danger"
              onPress={startDeleteFamily}
              disabled={processing || confirmMode !== null}
            />
          )
        ) : null}
      </View>

      <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s4, color: theme.colors.neutralTextSecondary }]}>
        「家族を削除する」はオーナーにのみ表示されます。
      </Text>
    </Screen>
  );
}

/**
 * 59.3.2節（決定6・7）・07-33章決定17の確認パネル本体。「家族から抜ける」
 * （ケースB・59.3.1b）と「家族を削除する」（59.3.2）の2箇所で完全に共通の
 * ため、ここに1つだけ用意する（冒頭の1文の有無は呼び出し側で出し分ける）。
 */
function renderDeleteFamilyBody(props: {
  familyName: string;
  draft: string;
  onChangeDraft: (v: string) => void;
  matches: boolean;
  processing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { familyName, draft, onChangeDraft, matches, processing, onConfirm, onCancel } = props;
  return (
    <View style={{ gap: theme.spacing.s2 }}>
      <Text style={theme.typography.parentBody}>
        この家族の記録がすべて消えます。クエスト、完了報告、ポイント、ごほうび、掲示板の書き込み、お絵かき、シール帳、家族の木——すべて元に戻せません。{"\n"}
        あわせて、あなたのログイン用アカウントも削除されます。{"\n"}
        ほかのメンバーのログイン用アカウントは削除されません（各自で削除できます）。
      </Text>
      <Text style={theme.typography.parentBody}>続けるには、家族の名前「{familyName}」を入力してください。</Text>
      <TextInput
        value={draft}
        onChangeText={onChangeDraft}
        editable={!processing}
        placeholder="家族の名前"
        style={{
          borderWidth: 1,
          borderColor: theme.colors.neutralBorder,
          borderRadius: theme.radius.parentMd,
          paddingHorizontal: theme.spacing.s3,
          paddingVertical: theme.spacing.s2,
          backgroundColor: theme.colors.neutralSurface,
        }}
      />
      {/* 決定7: 不一致を赤字・エラー扱いにしない。常時表示のヒントのみ。 */}
      <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
        上の名前とすべて同じ文字で入力してください。
      </Text>
      <AppButton
        label={processing ? "削除しています…" : "本当に削除する"}
        variant="danger"
        onPress={onConfirm}
        disabled={processing || !matches}
      />
      <AppButton label="やめる" variant="ghost" onPress={onCancel} disabled={processing} />
    </View>
  );
}
