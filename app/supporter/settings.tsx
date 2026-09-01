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
  // [2026-09-01追加・本部長] 主要画面ワイヤーフレーム.md 16章は「家族から抜ける」に
  // 確認モーダルを挟むと定めていたが、実装は**ボタン押下で即座に退会処理が走る**
  // 状態だった（2026-09-01の文書照合で発見）。退会は取り返しがつかない操作なので、
  // 家族削除・お絵かき削除と同じ「1タップ目で確認表示→2タップ目で確定」の
  // 画面内2段階確認に揃える（Alert.alert等のネイティブダイアログはWeb版で
  // 挙動が不安定なため使わない）。実装メモ107章。
  const [confirmingLeave, setConfirmingLeave] = useState(false);

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
        {confirmingLeave ? (
          <View style={{ gap: theme.spacing.s2 }}>
            <Text style={theme.typography.supporterBody}>
              家族から抜けますか？ 自分専用のクエスト・ごほうびの記録は見られなくなります。
            </Text>
            <AppButton
              tone="supporter"
              label={processing ? "処理中…" : "ほんとうに抜ける"}
              onPress={doLeaveFamily}
              disabled={processing}
            />
            <AppButton
              tone="supporter"
              label="やめる"
              variant="ghost"
              onPress={() => setConfirmingLeave(false)}
              disabled={processing}
            />
          </View>
        ) : (
          <AppButton
            tone="supporter"
            label="家族から抜ける"
            variant="secondary"
            onPress={() => setConfirmingLeave(true)}
            disabled={processing}
          />
        )}
      </View>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s4, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <AppButton tone="supporter" label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/supporter/home")} />
    </Screen>
  );
}
