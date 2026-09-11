import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import MemberAvatar from "@/components/MemberAvatar";
import ChildBackLink from "@/components/ChildBackLink";
import theme from "@/theme/theme";
import { inviteLookup } from "@/data/api";
import type { InviteLookupChild } from "@/data/api";
import type { FamilyDrawingLineData } from "@/types/domain";

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
 *
 * [2026-09-11追加・実装メモ205.8章] `childrenJson`（名前・色のみ）は従来どおり
 * invite-code.tsxからURLパラメータで受け取る（`invite-code.tsx`が渡す内容は
 * 増やさない＝1件あたり最大20KBの絵をURLに乗せないため）。絵だけは、この
 * 画面のマウント時に`inviteCode`で`invite-lookup`を呼び直して別途取得する。
 * 名前・色はパラメータから即座に描けるためちらつきは出ない。
 */
export default function ProfileSelectScreen() {
  const { inviteCode, childrenJson } = useLocalSearchParams<{ inviteCode?: string; childrenJson?: string }>();
  const children: InviteLookupChild[] = childrenJson ? JSON.parse(childrenJson) : [];
  const [avatars, setAvatars] = useState<Record<string, FamilyDrawingLineData>>({});

  useEffect(() => {
    if (!inviteCode) return;
    let cancelled = false;
    void (async () => {
      const res = await inviteLookup(inviteCode);
      if (!cancelled && res.ok && res.data.child_avatars) {
        setAvatars(res.data.child_avatars);
      }
      // 失敗時は何もしない（色丸＋頭文字のまま。この画面には元々
      // エラー表示用のUI状態が無く、名前・色の表示自体はchildrenJson側で
      // 完結しているため、絵の追加取得だけが失敗しても画面は成立する）。
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteCode]);

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
            <MemberAvatar
              name={c.display_name}
              color={c.avatar_color}
              size={64}
              lineData={avatars[c.member_id] ?? null}
            />
            <Text style={theme.typography.childBody}>{c.display_name}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
