import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { createFamilyBoardPost, PG_ERRCODE } from "@/data/api";

/**
 * C28 かきこむ（子ども）
 * 参照: 主要画面ワイヤーフレーム.md 22.3節・22.3.2節、要件定義書07-14章
 *
 * 送信成功演出はC17「感謝ポイントを贈る」の演出（「とどいたよ！」、C7より控えめ）と
 * 同じ強度を踏襲し（22.3.2節）、画面内に一言表示した後、自動的にC27へ戻る
 * （新しい画面遷移は発生させない＝ボタンを押させず自動でtimeoutして戻す）。
 * C11「やったね！」ほど強い演出にはしない（ポイント獲得を伴わない行為のため）。
 */
const MAX_LENGTH = 200;
const WARNING_THRESHOLD = 20;
const SUCCESS_DISPLAY_MS = 1500;

type ScreenState = "form" | "sending" | "success" | "networkError";

export default function ChildFamilyBoardPostScreen() {
  const { client } = useSession();
  const { state } = useAppData();
  const myMemberId = state.activeChildMemberId;
  const [body, setBody] = useState("");
  const [screenState, setScreenState] = useState<ScreenState>("form");
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

  const remainingChars = MAX_LENGTH - body.length;
  const isNearLimit = remainingChars <= WARNING_THRESHOLD;

  useEffect(() => {
    if (screenState !== "success") return;
    const t = setTimeout(() => {
      router.replace("/child/family-board");
    }, SUCCESS_DISPLAY_MS);
    return () => clearTimeout(t);
  }, [screenState]);

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed || screenState === "sending" || !myMemberId) return;
    setScreenState("sending");
    setLimitMessage(null);
    const res = await createFamilyBoardPost(client, trimmed, myMemberId);
    if (!res.ok) {
      if (res.error.code === PG_ERRCODE.checkViolation) {
        setLimitMessage("きょうは もう いっぱい とどけたよ。また あした！");
        setScreenState("form");
      } else {
        setScreenState("networkError");
      }
      return;
    }
    setScreenState("success");
  };

  if (screenState === "success") {
    return (
      <Screen tone="child">
        <View style={styles.centerBlock}>
          <Text style={{ fontSize: 48 }}>💬🌸</Text>
          <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s4, textAlign: "center" }]}>
            かぞくに とどいたよ！
          </Text>
        </View>
      </Screen>
    );
  }

  if (screenState === "networkError") {
    return (
      <Screen tone="child">
        <View style={styles.centerBlock}>
          <Text style={theme.typography.childBody}>⚠ とどきませんでした…</Text>
        </View>
        <AppButton label="もういちど" tone="child" fullWidth onPress={() => setScreenState("form")} />
      </Screen>
    );
  }

  return (
    <Screen tone="child">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.childBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
        かきこむ
      </Text>

      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder="れい：きょう こうえんに いったよ"
        multiline
        maxLength={MAX_LENGTH}
        style={styles.input}
      />
      <Text
        style={[
          theme.typography.childBody,
          styles.counter,
          {
            color: isNearLimit ? theme.colors.statusPending : theme.colors.neutralTextSecondary,
            fontWeight: remainingChars === 0 ? "700" : "400",
          },
        ]}
      >
        {body.length}/{MAX_LENGTH}もじ
      </Text>

      {limitMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.brandPrimaryStrong }}>{limitMessage}</Text>
      )}

      <AppButton
        label={screenState === "sending" ? "とどけています…" : "かぞくに とどける"}
        tone="child"
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
  centerBlock: { alignItems: "center", marginTop: theme.spacing.s8 },
  input: {
    marginTop: theme.spacing.s4,
    minHeight: 120,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    padding: theme.spacing.s3,
    textAlignVertical: "top",
  },
  counter: { marginTop: theme.spacing.s1, textAlign: "right" },
});
