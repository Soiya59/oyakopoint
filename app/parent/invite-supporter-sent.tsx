import React from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { buildSupporterInviteUrl } from "@/lib/authRedirect";

/**
 * P24 招待送信完了（保護者、2026-08-22新規）
 * 参照: 画面一覧・遷移図.md P24・3.11節
 *
 * 送信結果を確認し、招待中のみまもりメンバーの状態をP14で追える状態にする。
 * 「まだ返信がありません」ではなく「招待を送りました」という前向きな確認文言、
 * 再送導線（同じ内容でP23をもう一度開く）、P14へ戻るボタンを表示する。
 *
 * [実装判断] API仕様.md 2d章・認証・データ管理設計書.md 8.2章「招待リンクを送付」の
 * とおり、招待リンクの実際の送付（メール送信）はアプリの範囲外（保護者がアプリ外の
 * 任意の手段で共有する）であるため、この画面ではリンクそのものをテキストとして表示し
 * （選択・コピーして共有できるよう`selectable`を指定）、宛先メールアドレスと併せて
 * 保護者が手動で送付できるようにした。設計書に明示のUIは無いため独自に追加した。
 */
export default function InviteSupporterSentScreen() {
  const { email, token } = useLocalSearchParams<{ email?: string; token?: string }>();
  const inviteUrl = token ? buildSupporterInviteUrl(token) : "";

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>招待を送りました</Text>

      <Card style={{ marginTop: theme.spacing.s4 }}>
        <Text style={theme.typography.parentCaption}>招待先</Text>
        <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s1 }]}>{email}</Text>
      </Card>

      <View style={{ marginTop: theme.spacing.s4 }}>
        <Text style={theme.typography.parentBody}>
          このリンクをコピーして、メールやメッセージアプリなどで招待先に送ってください。
        </Text>
        <Card style={{ marginTop: theme.spacing.s2 }}>
          <Text selectable style={[theme.typography.parentBody, { color: theme.colors.brandPrimaryStrong }]}>
            {inviteUrl}
          </Text>
        </Card>
      </View>

      <AppButton
        label="もう一度招待する"
        variant="secondary"
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => router.replace("/parent/invite-supporter")}
      />
      <AppButton label="家族管理へ戻る" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.replace("/parent/family")} />
    </Screen>
  );
}
