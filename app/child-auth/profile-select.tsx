import React from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import MemberAvatar from "@/components/MemberAvatar";
import ChildBackLink from "@/components/ChildBackLink";
import theme from "@/theme/theme";
import type { InviteLookupChild } from "@/data/api";

/**
 * C2 プロフィール選択（きょうだい対応）
 * 参照: API仕様.md 2c章手順1のレスポンス（children）をC1から受け取って表示する。
 * 選んだプロフィール（member_id）と招待コードをC3（PIN入力）へそのまま渡す
 * （child-loginは invite_code + member_id + pin の3点が必要なため）。
 *
 * [2026-09-10追加・やること.md 4-13] 画面の先頭に「← もどる」を置いた（ChildBackLink）。
 * この画面へ来る道は4つ（トップからの子どもログイン＝invite-code.tsx、保護者ホームの
 * ヘッダ＝ParentTabHeader.tsx と parent/(tabs)/index.tsx、保護者の設定の
 * 「👦 こどもモードにする」＝parent/family.tsx）あり、いずれも router.push で来る。
 * 戻り先を固定で書かないこと（詳細は ChildBackLink.tsx のコメント）。
 */
export default function ProfileSelectScreen() {
  const { inviteCode, childrenJson } = useLocalSearchParams<{ inviteCode?: string; childrenJson?: string }>();
  const children: InviteLookupChild[] = childrenJson ? JSON.parse(childrenJson) : [];

  return (
    <Screen tone="child">
      <ChildBackLink />
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3 }]}>だれかな？</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s4, marginTop: theme.spacing.s6 }}>
        {children.map((c) => (
          <Pressable
            key={c.member_id}
            onPress={() =>
              router.push({
                pathname: "/child-auth/pin-input",
                params: { inviteCode, memberId: c.member_id, displayName: c.display_name },
              })
            }
            style={{
              width: 140,
              minHeight: theme.tapTarget.childPrimary,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.colors.neutralSurface,
              borderRadius: theme.radius.childXl,
              padding: theme.spacing.s4,
              gap: theme.spacing.s2,
            }}
          >
            <MemberAvatar name={c.display_name} color={c.avatar_color} size={64} />
            <Text style={theme.typography.childBody}>{c.display_name}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
