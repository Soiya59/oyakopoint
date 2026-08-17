import React, { useState } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { Text } from "react-native";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { removeMember } from "@/data/api";

/**
 * P17 設定
 * 参照: 画面一覧・遷移図.md P17
 * ログアウト・家族から抜ける・家族を削除（オーナーのみ表示）
 * 参照: 認証・データ管理設計書.md 3.4章 remove-member Edge Function
 *
 * [破壊的操作についての事前記録] 「家族を削除する」は remove-member の
 * mode: "delete_family" を呼び出す。families行のDELETE（ON DELETE CASCADEで
 * 家族の全データが連動削除される）という不可逆な操作であり、実際に呼び出すと
 * 元に戻せない。開発部/成果物/実装メモ.md にも同じ内容を事前記録した
 * （開発部CLAUDE.md「破壊的なDB操作は、実行前に成果物に記録する」対応）。
 * 画面側は2段階の確認（AppButton押下→確認ダイアログ）を必須にする。
 */
export default function SettingsScreen() {
  const { state } = useAppData();
  const { parentMember, logoutParent } = useSession();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const me = parentMember;

  const doLogout = async () => {
    await logoutParent();
    router.replace("/");
  };

  const doLeaveFamily = async () => {
    if (!me) return;
    setProcessing(true);
    setErrorMessage(null);
    const res = await removeMember(me.id, "soft_remove");
    setProcessing(false);
    if (!res.ok) {
      setErrorMessage(
        res.error.code === "owner_cannot_soft_remove"
          ? "オーナーは先にオーナー権限を委譲するか、家族を削除してください"
          : res.error.message
      );
      return;
    }
    await logoutParent();
    router.replace("/");
  };

  const doDeleteFamily = async () => {
    if (!me) return;
    setProcessing(true);
    setErrorMessage(null);
    const res = await removeMember(me.id, "delete_family");
    setProcessing(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    await logoutParent();
    router.replace("/");
  };

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>設定</Text>

      <View style={{ marginTop: theme.spacing.s6, gap: theme.spacing.s3 }}>
        <AppButton label="ログアウト" variant="secondary" onPress={doLogout} disabled={processing} />
        <AppButton
          label={processing ? "処理中…" : "家族から抜ける"}
          variant="secondary"
          onPress={doLeaveFamily}
          disabled={processing}
        />
        {me?.is_owner ? (
          confirmingDelete ? (
            <View style={{ gap: theme.spacing.s2 }}>
              <Text style={{ color: theme.colors.statusBlocking }}>
                本当に「{state.family.name}」を削除しますか？この操作は取り消せません（すべてのお手伝い・完了報告・ごほうび履歴が削除されます）。
              </Text>
              <AppButton
                label={processing ? "削除中…" : "本当に削除する"}
                variant="danger"
                onPress={doDeleteFamily}
                disabled={processing}
              />
              <AppButton
                label="キャンセル"
                variant="ghost"
                onPress={() => setConfirmingDelete(false)}
                disabled={processing}
              />
            </View>
          ) : (
            <AppButton label="家族を削除する" variant="danger" onPress={() => setConfirmingDelete(true)} disabled={processing} />
          )
        ) : null}
      </View>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s4, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s6, color: theme.colors.neutralTextSecondary }]}>
        「家族を削除する」はオーナー（is_owner=true）にのみ表示されます（remove-member Edge Functionの
        delete_familyモードに対応）。
      </Text>

      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.back()} />
    </Screen>
  );
}
