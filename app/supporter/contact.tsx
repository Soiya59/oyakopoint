import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useSession } from "@/lib/session";
import { submitContentReport } from "@/data/api";
import { CONTACT_EMAIL } from "@/lib/legalLinks";

/**
 * S27 お問い合わせ（みまもりメンバー）
 * 参照: 主要画面ワイヤーフレーム.md 56.2節、要件定義書07-32章 決定4・6・8〜12・30〜32
 *
 * app/parent/contact.tsx（P39）と同一構成・同一文言（トーンのトークンのみ
 * supporter系）。**片方だけ直さないこと。** 子どものセッションからはそもそも
 * 到達できない（app/supporter/_layout.tsxが status==="child" を/child/homeへ
 * 戻すため）。
 */
const NOTE_MAX_LENGTH = 200;
const SHORT_FIELD_MAX_LENGTH = 50;
const SUCCESS_DISPLAY_MS = 1500;

type ScreenState = "form" | "sending" | "success" | "networkError";

export default function SupporterContactScreen() {
  const { client } = useSession();
  const [aboutText, setAboutText] = useState("");
  const [seenWhereText, setSeenWhereText] = useState("");
  const [note, setNote] = useState("");
  const [screenState, setScreenState] = useState<ScreenState>("form");

  const submit = async () => {
    if (screenState === "sending") return;
    setScreenState("sending");
    const res = await submitContentReport(client, {
      aboutText: aboutText.trim() || null,
      seenWhereText: seenWhereText.trim() || null,
      note: note.trim() || null,
    });
    if (!res.ok) {
      setScreenState("networkError");
      return;
    }
    setScreenState("success");
    setTimeout(() => router.back(), SUCCESS_DISPLAY_MS);
  };

  return (
    <Screen tone="supporter">
      <Pressable onPress={() => router.back()}>
        <Text style={theme.typography.supporterBody}>← もどる</Text>
      </Pressable>
      <Text style={[theme.typography.supporterTitle, { marginTop: theme.spacing.s3 }]}>お問い合わせ</Text>

      <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s3 }]}>
        アプリの使い方や、気になったことがあれば、運営にお知らせください。
        {"\n"}いただいた内容は、運営だけが確認します。ご家族の他の方には表示されません。
        {"\n\n"}わかる範囲でかまいません。選ばなくても、書かなくても送れます。
      </Text>

      <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s6 }]}>だれについてですか（任意）</Text>
      <TextInput
        value={aboutText}
        onChangeText={setAboutText}
        maxLength={SHORT_FIELD_MAX_LENGTH}
        editable={screenState !== "sending"}
        style={styles.shortInput}
      />

      <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s4 }]}>どこで見ましたか（任意）</Text>
      <TextInput
        value={seenWhereText}
        onChangeText={setSeenWhereText}
        placeholder="例: かぞくのけいじばん、お絵かき、ありがとうのメッセージ"
        maxLength={SHORT_FIELD_MAX_LENGTH}
        editable={screenState !== "sending"}
        style={styles.shortInput}
      />

      <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s4 }]}>
        気になったことがあれば書いてください（任意・200文字まで）
      </Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={NOTE_MAX_LENGTH}
        editable={screenState !== "sending"}
        style={styles.noteInput}
      />
      <Text style={[theme.typography.supporterCaption, styles.counter, { color: theme.colors.neutralTextSecondary }]}>
        {note.length}/{NOTE_MAX_LENGTH}字
      </Text>

      {screenState === "networkError" && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.neutralTextPrimary }}>
          送れませんでした。通信の状態を確かめて、もう一度お試しください。
        </Text>
      )}

      {screenState === "success" ? (
        <View style={{ marginTop: theme.spacing.s6 }}>
          <Text style={theme.typography.supporterBodyMedium}>お知らせを受け取りました。ありがとうございます。</Text>
        </View>
      ) : (
        <AppButton
          tone="supporter"
          label={screenState === "sending" ? "送っています…" : "運営に送る"}
          fullWidth
          loading={screenState === "sending"}
          disabled={screenState === "sending"}
          style={{ marginTop: theme.spacing.s6 }}
          onPress={submit}
        />
      )}

      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s8, color: theme.colors.neutralTextSecondary }]}>
        直接メールで問い合わせる場合
      </Text>
      <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s1 }]}>お問い合わせ: {CONTACT_EMAIL}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  shortInput: {
    marginTop: theme.spacing.s2,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    padding: theme.spacing.s3,
  },
  noteInput: {
    marginTop: theme.spacing.s2,
    minHeight: 100,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    padding: theme.spacing.s3,
    textAlignVertical: "top",
  },
  counter: { marginTop: theme.spacing.s1, textAlign: "right" },
});
