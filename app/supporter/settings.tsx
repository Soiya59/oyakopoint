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
import ExternalLinkRow from "@/components/ExternalLinkRow";
import { HELP_SUPPORTER_URL, PRIVACY_POLICY_URL, TERMS_URL } from "@/lib/legalLinks";

/** やること.md 2-23（サマリー表#5、Apple 1.2 "Published contact information"）。
 *  2026-09-09に統括が決定。app/parent/family.tsxと同一アドレス。 */
const CONTACT_EMAIL = "soiyalab.contact@gmail.com";

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

      {/* [2026-09-09追加・やること.md 2-28・2-23] 使い方ガイド・プライバシーポリシー・
          利用規約への外部リンクと、運営者への連絡先。app/parent/family.tsxと同じ
          構成（みまもり向けガイドのみ1本）。実装メモ.md 181章参照。 */}
      <Text style={[theme.typography.supporterTitle, { fontSize: 16, marginTop: theme.spacing.s4 }]}>
        使い方・お問い合わせ
      </Text>
      <View style={{ marginTop: theme.spacing.s2 }}>
        <ExternalLinkRow tone="supporter" label="使い方ガイド（みまもり向け）" url={HELP_SUPPORTER_URL} />
        <ExternalLinkRow tone="supporter" label="プライバシーポリシー" url={PRIVACY_POLICY_URL} />
        <ExternalLinkRow tone="supporter" label="利用規約" url={TERMS_URL} />
      </View>
      <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s3 }]}>
        お問い合わせ: {CONTACT_EMAIL}
      </Text>

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
