import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AvatarDrawingPanel from "@/components/AvatarDrawingPanel";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { deleteMemberAvatar, saveMemberAvatar } from "@/data/api";
import type { FamilyDrawingLineData } from "@/types/domain";

/**
 * C31 アバターを かく（子ども、本人のみ）
 * 参照: 要件定義書07-27章 決定1〜22、主要画面ワイヤーフレーム.md 43章
 * （43.2節 決定7・43.7節ワイヤーフレーム）。
 *
 * 決定13・14: 子ども・みまもりメンバーは自分の分のみ操作できるため、対象を選ぶUIは
 * 無く`memberId`パラメータも持たない（保護者用のP38〈`app/parent/member-avatar.tsx`〉との違い）。
 */
export default function ChildMyAvatarScreen() {
  const { state, memberAvatars, memberAvatarsLoaded, memberAvatarsError, refreshMemberAvatars, setMemberAvatarLocal, clearMemberAvatarLocal } =
    useAppData();
  const { client } = useSession();
  const myId = state.activeChildMemberId;
  const me = state.members.find((m) => m.id === myId);

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetErrorMessage, setResetErrorMessage] = useState<string | null>(null);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);

  const handleSave = async (lineData: FamilyDrawingLineData): Promise<boolean> => {
    setSaving(true);
    setErrorMessage(null);
    setSavedMessage(null);
    const res = await saveMemberAvatar(client, myId, lineData);
    setSaving(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return false;
    }
    // [スキーマ設計.sql 54.7章(b)] 保存成功後はローカルキャッシュだけ更新し、
    // サーバーへの再取得は発生させない。
    setMemberAvatarLocal(myId, lineData);
    setSavedMessage("あたらしい すがたに なったよ！");
    setTimeout(() => setSavedMessage((prev) => (prev ? null : prev)), 4000);
    return true;
  };

  const handleReset = async (): Promise<boolean> => {
    setResetting(true);
    setResetErrorMessage(null);
    setResetSuccessMessage(null);
    const res = await deleteMemberAvatar(client, myId);
    setResetting(false);
    if (!res.ok) {
      setResetErrorMessage(res.error.message);
      return false;
    }
    clearMemberAvatarLocal(myId);
    setResetSuccessMessage("いろに もどしたよ");
    setTimeout(() => setResetSuccessMessage((prev) => (prev ? null : prev)), 4000);
    return true;
  };

  return (
    <Screen tone="child">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.childBody}>← もどる</Text>
        </Pressable>
      </View>
      <Text style={[theme.typography.childHeadline, styles.title]}>アバターを かく</Text>

      {/* 依頼3（企画部決定17）: ガチャの絵と取り違えないための常時表示の説明文言。 */}
      <Text style={[theme.typography.childBody, styles.explain]}>
        ここで かいた えが、あなたの アバターに なるよ。ガチャの ひみつの えとは べつの えだよ（ガチャには でないよ）
      </Text>

      {/* [2026-09-11追加・本部長／軽微変更ルート] 描き方のヒント。**統括が実機で描いて
          分かったこと**を、次に使う人が試行錯誤せずに済むよう文言にした。
          (1) 顔の輪郭を描くと、背景のメンバーカラーの丸と線が二重になり、小さいサイズ
              （27箇所中13箇所が20〜28px）で潰れる。輪郭を描かなければ目と口に使える
              面積も広がる。統括の言葉「顔の輪郭を記載したら潰れたけど、輪郭を記載
              しなかったらいい感じになった」。
          (2) ほっぺの赤い点は統括の提案。実際のアバターで効果が出ている。
          **書き出しを「すきなものをかいてね」にしているのは意図的**。企画部07-27章の
          確定仕様は「顔に限定しない（好きなもの）」であり、本部長の初稿は1行目で
          顔に限定してしまっていた。統括の指摘で直した。 */}
      <Text style={[theme.typography.childBody, styles.explain]}>
        すきな ものを かいてね。かおを かくなら、まるは もう あるから め と くち だけで いいよ。ほっぺに あかい チョンチョン を つけると かわいいよ。
      </Text>

      {!me || !memberAvatarsLoaded ? (
        <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4 }]}>よみこみちゅう…</Text>
      ) : memberAvatarsError ? (
        <View style={{ marginTop: theme.spacing.s4, alignItems: "center" }}>
          <Text style={theme.typography.childBody}>つうしんが おやすみ中みたい</Text>
          <Pressable onPress={() => void refreshMemberAvatars()} style={{ marginTop: theme.spacing.s2 }}>
            <Text style={[theme.typography.childBody, styles.retryLink]}>もういちど</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <AvatarDrawingPanel
            tone="child"
            isProxy={false}
            displayName={me.display_name}
            backgroundColor={me.avatar_color ?? theme.colors.neutralBorder}
            savedLineData={memberAvatars[myId] ?? null}
            saving={saving}
            errorMessage={errorMessage}
            savedMessage={savedMessage}
            onSave={handleSave}
            resetting={resetting}
            resetErrorMessage={resetErrorMessage}
            resetSuccessMessage={resetSuccessMessage}
            onReset={handleReset}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center" },
  title: { marginTop: theme.spacing.s3, textAlign: "center" },
  explain: { marginTop: theme.spacing.s3 },
  retryLink: { textDecorationLine: "underline" },
});
