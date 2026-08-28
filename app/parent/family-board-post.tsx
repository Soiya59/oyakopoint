import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { createFamilyBoardPost, PG_ERRCODE } from "@/data/api";

/**
 * P33 投稿する（保護者）
 * 参照: 主要画面ワイヤーフレーム.md 22.3節、要件定義書07-14章
 *
 * 決定3: 投稿フォーム自体は3ロール共通の構造（本文1つ・200字上限・文字数カウンター）
 * だが、演出強度・文言はロールごとに書き分けるため、共通コンポーネント化はせず
 * P33/C28/S21をそれぞれ薄い個別画面にした（gratitude-send.tsx群と同じ構成判断）。
 * 送信成功時は演出なしでP32へ`router.replace`し、控えめなスナックバー
 * 「書き込みました」をP32側で表示する（22.3.1節）。
 */
const MAX_LENGTH = 200;
const WARNING_THRESHOLD = 20;

type ScreenState = "form" | "sending";

export default function ParentFamilyBoardPostScreen() {
  const { client } = useSession();
  const { state } = useAppData();
  const myMemberId = state.activeParentMemberId;
  const [body, setBody] = useState("");
  const [screenState, setScreenState] = useState<ScreenState>("form");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const remainingChars = MAX_LENGTH - body.length;
  const isNearLimit = remainingChars <= WARNING_THRESHOLD;

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || screenState === "sending" || !myMemberId) return;
    setScreenState("sending");
    setErrorMessage(null);
    const res = await createFamilyBoardPost(client, trimmed, myMemberId);
    setScreenState("form");
    if (!res.ok) {
      // 22.3節「送信エラー：投稿数上限超過」。通常は一覧側（P32）でボタンを無効化
      // しているため保険的な状態（決定6・22.3.3節）。
      if (res.error.code === PG_ERRCODE.checkViolation) {
        setErrorMessage("本日の投稿数の上限（5件）に達しています");
      } else {
        setErrorMessage("送信できませんでした。もう一度お試しください");
      }
      return;
    }
    router.replace({ pathname: "/parent/family-board", params: { posted: "1" } });
  };

  return (
    <Screen tone="parent">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.parentBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3 }]}>書き込む</Text>

      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder="例：今日は公園に行きました"
        multiline
        maxLength={MAX_LENGTH}
        style={styles.input}
      />
      <Text
        style={[
          theme.typography.parentCaption,
          styles.counter,
          {
            color: isNearLimit ? theme.colors.statusPending : theme.colors.neutralTextSecondary,
            fontWeight: remainingChars === 0 ? "700" : "400",
          },
        ]}
      >
        {body.length}/{MAX_LENGTH}字
      </Text>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <AppButton
        label={screenState === "sending" ? "書き込んでいます…" : "書き込む"}
        fullWidth
        loading={screenState === "sending"}
        disabled={screenState === "sending" || !body.trim() || !myMemberId}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={submit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    marginTop: theme.spacing.s4,
    minHeight: 120,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    padding: theme.spacing.s3,
    textAlignVertical: "top",
  },
  counter: { marginTop: theme.spacing.s1, textAlign: "right" },
});
