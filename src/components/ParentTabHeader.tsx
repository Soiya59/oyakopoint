/**
 * 保護者の各タブの共通ヘッダー（アバター＋自分の名前／家族名／🔔）。
 *
 * [2026-09-10新設・本部長／軽微変更ルート] 統括の実機確認
 * 「じぶんとかんりの左上のアイコンから、子供モードに飛べない」。
 *
 * 187章のタブ化で、旧`app/parent/home.tsx`のヘッダーを各タブへ写した際、
 * **「かぞく」タブにだけ子どもモードへの導線（`goToChildSwitch`）が付いていて、
 * 「じぶん」「かんり」ではアバターが絵として置かれているだけだった。**
 * 同じ見た目なのに押せたり押せなかったりするのは、いちばん紛らわしい壊れ方なので、
 * ヘッダーごと1つの部品にまとめて、4つのタブすべてで同じものを使う。
 *
 * 飛び先は保護者の設定にある「👦 こどもモードにする」と同一（実装メモ167.3章）。
 * **新しい画面も通信も増やしていない。** 子どもが1人もいなければ押せないようにする
 * （押しても空の選択画面が出るだけで行き止まりになるため）。
 * PINは従来どおり必要で、92.2章「保護者→子どもは変更していない」は崩していない。
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

export function ParentTabHeader({ inboxCount }: { inboxCount: number }) {
  const { state } = useAppData();
  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  const childProfiles = state.members
    .filter((m) => m.is_active && m.role === "child")
    .map((m) => ({ member_id: m.id, display_name: m.display_name, avatar_color: m.avatar_color }));

  const goToChildSwitch = () =>
    router.push({
      pathname: "/child-auth/profile-select",
      params: {
        inviteCode: state.family.invite_code,
        childrenJson: JSON.stringify(childProfiles),
      },
    });

  const nameBlock = me ? (
    <>
      <MemberAvatar name={me.display_name} color={me.avatar_color} size={36} />
      <Text style={theme.typography.parentTitle}>{me.display_name}</Text>
    </>
  ) : null;

  return (
    <View style={styles.headerRow}>
      {me &&
        (childProfiles.length > 0 ? (
          <Pressable style={styles.headerMe} onPress={goToChildSwitch} hitSlop={8}>
            {nameBlock}
          </Pressable>
        ) : (
          <View style={styles.headerMe}>{nameBlock}</View>
        ))}
      <Text style={[theme.typography.parentTitle, styles.headerFamilyName]}>{state.family.name}</Text>
      <Pressable onPress={() => router.push("/parent/inbox")} hitSlop={8} style={styles.bellHit}>
        <Text style={styles.notifBadge}>🔔{inboxCount}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center" },
  headerMe: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  headerFamilyName: { flex: 1, marginLeft: theme.spacing.s3 },
  bellHit: { minHeight: theme.tapTarget.parent, justifyContent: "center", paddingLeft: theme.spacing.s2 },
  notifBadge: { fontSize: 16, fontWeight: "700" },
});

export default ParentTabHeader;
