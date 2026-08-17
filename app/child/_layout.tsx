import React, { useEffect } from "react";
import { Slot, router } from "expo-router";
import { View } from "react-native";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import Screen from "@/components/Screen";
import theme from "@/theme/theme";

/**
 * [2026-08-16追加・本部長] `app/child/`配下の各画面（C5等）は
 * `state.members.find((m) => m.id === state.activeChildMemberId)!` という
 * 非nullアサーションで自分自身のメンバー情報を取得している。src/data/store.tsxの
 * ローディングゲート（`familyId && !loadedOnce`）は「データ未取得」は防ぐが、
 * 「データは取得できたが、activeChildMemberIdに該当するメンバーがその中に
 * 存在しない」ケース（例: 使い回された古い子どもセッションが指すメンバーが
 * 既に削除・再作成されている等）までは防げず、ユーザーが実機で
 * "Cannot read properties of undefined (reading 'display_name')" のクラッシュに
 * 複数回遭遇した。ここで`app/child/`配下全体（(tabs)グループ・report等の
 * 単独画面の両方）を横断する共通ガードとして、該当メンバーが見つからない場合は
 * 子どもセッションを破棄してトップ画面へ戻す（クラッシュさせず再ログインを促す）。
 */
export default function ChildLayout() {
  const { state } = useAppData();
  const { logoutChild } = useSession();
  const me = state.members.find((m) => m.id === state.activeChildMemberId);
  const invalidSession = Boolean(state.activeChildMemberId) && !me;

  useEffect(() => {
    if (!invalidSession) return;
    void logoutChild().then(() => router.replace("/"));
  }, [invalidSession, logoutChild]);

  if (invalidSession) {
    return (
      <Screen tone="child">
        <View style={{ flex: 1 }} />
      </Screen>
    );
  }

  return <Slot />;
}
