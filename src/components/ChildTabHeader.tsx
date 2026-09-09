/**
 * 子どもの各タブの共通ヘッダー（アバター＋名前／🔔）。
 *
 * [2026-09-10新設・開発部/成果物/実装メモ.md 188章] 子ども下部タブ4区画化
 * （UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 36章、36.4節）。
 *
 * 保護者向け`src/components/ParentTabHeader.tsx`と同じ理由・同じ形にした。
 * 187章のタブ化で保護者は「かぞく」タブにだけアバターの押し先（子どもモード切替）が
 * 付いていて、他タブでは絵が置いてあるだけという壊れ方をした（`645a203`で修正）。
 * **同じ見た目なのに押せたり押せなかったりするのが、いちばん紛らわしい壊れ方**
 * という教訓を踏まえ、子どもは最初からこの共通部品を4タブすべてで使う。
 *
 * 元は`app/child/(tabs)/home.tsx`が単独で持っていたヘッダー（157行目付近）を
 * そのまま抜き出した。アバター＋名前はタップで`/child/profile-switch`
 * （プロフィール切替）、🔔はタップで`/child/inbox`（とどいたよ）へ。
 * 新しい画面・新しい通知種別は追加していない。
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

export function ChildTabHeader({ inboxCount }: { inboxCount: number }) {
  const { state } = useAppData();
  const me = state.members.find((m) => m.id === state.activeChildMemberId);

  return (
    <View style={styles.headerRow}>
      <Pressable style={styles.headerLeft} onPress={() => router.push("/child/profile-switch")} hitSlop={8}>
        {me && (
          <>
            <MemberAvatar name={me.display_name} color={me.avatar_color} size={36} />
            <Text style={theme.typography.childBody}>{me.display_name}</Text>
          </>
        )}
      </Pressable>
      <Pressable onPress={() => router.push("/child/inbox")} hitSlop={8} style={styles.bellHit}>
        <Text style={styles.notifBadge}>🔔{inboxCount}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  bellHit: { minHeight: theme.tapTarget.child, justifyContent: "center", paddingLeft: theme.spacing.s2 },
  notifBadge: { fontSize: 16, fontWeight: "700" },
});

export default ChildTabHeader;
