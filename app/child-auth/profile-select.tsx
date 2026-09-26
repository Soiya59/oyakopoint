import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import MemberAvatar from "@/components/MemberAvatar";
import ChildBackLink from "@/components/ChildBackLink";
import theme from "@/theme/theme";
import { inviteLookup, childSwitch } from "@/data/api";
import type { InviteLookupChild } from "@/data/api";
import type { FamilyDrawingLineData } from "@/types/domain";
import { useSession } from "@/lib/session";

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
 *
 * [2026-09-27追加・要件定義書07-41章、スキーマ設計.sql 79.6章、API仕様.md
 * 35.4章] `mode === "parent_switch"`（`ParentTabHeader.tsx`のヘッダーから
 * 来た場合のみ）のときは、カード押下で`childSwitch()`（新設Edge Function）
 * を呼び、成功したら`pin-input.tsx`の成功時と同じ2行（`loginChild()`→
 * `router.replace("/child/home")`）を行う。PIN入力画面へは遷移しない。
 * `mode`が無い場合（子ども自身の入口・きょうだい切替）は現状どおり
 * `pin-input.tsx`へ遷移する（決定3、変更しない）。
 * 失敗時は画面を行き止まりにしないよう、押したカードの下に
 * 「あんしょうばんごうで入る」というPIN経路への遷移リンクを出す
 * （設計部の推奨。79.6章）。PIN側は従来どおりchild-loginが検証するため、
 * このフォールバックはセキュリティを緩めない。
 */
export default function ProfileSelectScreen() {
  const { inviteCode, childrenJson, mode } = useLocalSearchParams<{
    inviteCode?: string;
    childrenJson?: string;
    mode?: string;
  }>();
  const children: InviteLookupChild[] = childrenJson ? JSON.parse(childrenJson) : [];
  const [avatars, setAvatars] = useState<Record<string, FamilyDrawingLineData>>({});
  const { loginChild } = useSession();
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchErrorId, setSwitchErrorId] = useState<string | null>(null);

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

  const goToPinInput = (c: InviteLookupChild) => {
    router.push({
      pathname: "/child-auth/pin-input",
      params: { inviteCode, memberId: c.member_id, displayName: c.display_name },
    });
  };

  const onPressChild = async (c: InviteLookupChild) => {
    if (mode !== "parent_switch") {
      goToPinInput(c);
      return;
    }
    setSwitchErrorId(null);
    setSwitchingId(c.member_id);
    const res = await childSwitch(c.member_id);
    setSwitchingId(null);
    if (res.ok) {
      await loginChild({
        accessToken: res.data.access_token,
        expiresAt: res.data.expires_at,
        member: res.data.member,
        inviteCode: inviteCode ?? "",
      });
      router.replace("/child/home");
      return;
    }
    setSwitchErrorId(c.member_id);
  };

  return (
    <Screen tone="child">
      <ChildBackLink />
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3 }]}>だれかな？</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s4, marginTop: theme.spacing.s6 }}>
        {children.map((c) => (
          <View key={c.member_id} style={{ width: 140, alignItems: "center", gap: theme.spacing.s2 }}>
            <Pressable
              onPress={() => onPressChild(c)}
              disabled={switchingId === c.member_id}
              style={{
                width: 140,
                minHeight: theme.tapTarget.childPrimary,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.neutralSurface,
                borderRadius: theme.radius.childXl,
                padding: theme.spacing.s4,
                gap: theme.spacing.s2,
                opacity: switchingId === c.member_id ? 0.6 : 1,
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
            {switchErrorId === c.member_id && (
              <View style={{ alignItems: "center", gap: theme.spacing.s1 }}>
                <Text
                  style={[
                    theme.typography.childBody,
                    { fontSize: 13, color: theme.colors.statusBlocking, textAlign: "center" },
                  ]}
                >
                  うまく切り替えられませんでした
                </Text>
                <Pressable onPress={() => goToPinInput(c)} hitSlop={8}>
                  <Text style={[theme.typography.childBody, { fontSize: 13, textDecorationLine: "underline" }]}>
                    あんしょうばんごうで入る
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}
      </View>
    </Screen>
  );
}
