import React, { useState } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { Text } from "react-native";
import { useSession } from "@/lib/session";
import { removeMember } from "@/data/api";

/**
 * S13 設定（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S13
 *
 * ログアウト・家族から抜けるのみ。家族の削除・招待発行のボタンは表示しない
 * （オーナー限定操作のため。みまもりメンバーはchk_owner_is_parent制約により
 * 構造的にオーナーになり得ない）。「家族から抜ける」は
 * supabase/functions/remove-member（soft_removeモード）を呼ぶ。実装メモ.md 59.3.2章の
 * とおり、みまもりメンバー自身の退会はresolveFamilyMemberCallerにより許可される。
 */
export default function SupporterSettingsScreen() {
  const { parentMember, logoutParent } = useSession();
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
      setErrorMessage(res.error.message);
      return;
    }
    await logoutParent();
    router.replace("/");
  };

  return (
    <Screen tone="supporter">
      <ScreenBackLink tone="supporter" onPress={() => router.replace("/supporter/home")} />
      <Text style={theme.typography.supporterTitle}>設定</Text>

      <View style={{ marginTop: theme.spacing.s6, gap: theme.spacing.s3 }}>
        <AppButton tone="supporter" label="ログアウト" variant="secondary" onPress={doLogout} disabled={processing} />
        <AppButton
          tone="supporter"
          label={processing ? "処理中…" : "家族から抜ける"}
          variant="secondary"
          onPress={doLeaveFamily}
          disabled={processing}
        />
      </View>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s4, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <AppButton tone="supporter" label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/supporter/home")} />
    </Screen>
  );
}
