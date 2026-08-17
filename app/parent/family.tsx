import React, { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { Text } from "react-native";
import { useAppData } from "@/data/store";
import { removeMember } from "@/data/api";

/**
 * P14 家族管理（メンバー一覧・招待・子ども追加の起点）
 * 参照: 画面一覧・遷移図.md P14、API仕様.md 2章
 *
 * [2026-08-15追加] 子どもプロフィールの退会（remove-member の soft_remove
 * モード）操作を追加した。認証・データ管理設計書.md 3.4章のとおり、保護者
 * （role='parent'）を退会させられるのは本人のみのため、ここでは子ども
 * （role='child'）にのみ「退会させる」ボタンを表示する。
 */
export default function FamilyScreen() {
  const { state, refresh } = useAppData();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeMembers = state.members.filter((m) => m.is_active);

  const removeChild = async (memberId: string) => {
    setProcessingId(memberId);
    setErrorMessage(null);
    const res = await removeMember(memberId, "soft_remove");
    setProcessingId(null);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    void refresh();
  };

  return (
    <Screen tone="parent">
      <Text style={theme.typography.parentTitle}>家族管理</Text>

      <Card style={{ marginTop: theme.spacing.s4 }}>
        <Text style={theme.typography.parentCaption}>招待コード</Text>
        <Text style={[theme.typography.parentTitle, { letterSpacing: 2, marginTop: theme.spacing.s1 }]}>
          {state.family.invite_code}
        </Text>
      </Card>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <View style={{ marginTop: theme.spacing.s4, gap: theme.spacing.s2 }}>
        {activeMembers.map((m) => (
          <Card key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.s3 }}>
            <MemberAvatar name={m.display_name} color={m.avatar_color} />
            <View style={{ flex: 1 }}>
              <Text style={theme.typography.parentBodyMedium}>{m.display_name}</Text>
              <Text style={theme.typography.parentCaption}>
                {m.role === "parent" ? (m.is_owner ? "保護者（オーナー）" : "保護者") : "子ども"}
              </Text>
            </View>
            {m.role === "child" && (
              <View style={{ gap: theme.spacing.s2 }}>
                {/* [2026-08-16追加・本部長] 既存の子どもにPINを設定・再発行する導線が
                    無かった（P15は新規作成専用のため）。要件定義書10章未決事項「子ども用
                    PINの再発行フロー」への対応。 */}
                <AppButton
                  label="PINを設定"
                  variant="secondary"
                  onPress={() =>
                    router.push({
                      pathname: "/parent/child-pin-reset",
                      params: { memberId: m.id, displayName: m.display_name },
                    })
                  }
                  disabled={processingId !== null}
                />
                <AppButton
                  label={processingId === m.id ? "処理中…" : "退会させる"}
                  variant="secondary"
                  onPress={() => removeChild(m.id)}
                  disabled={processingId !== null}
                />
              </View>
            )}
          </Card>
        ))}
      </View>

      <AppButton
        label="子どもプロフィールを追加"
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => router.push("/parent/child-profile")}
      />
      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.back()} />
    </Screen>
  );
}
