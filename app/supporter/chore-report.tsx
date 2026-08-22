import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { PG_ERRCODE } from "@/data/api";

/**
 * S7 自分専用のお手伝いの完了報告（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S7、API仕様.md 4c章
 *
 * 通常どおりポイントが表示・付与される点でS4（家族共有への参加）と対象範囲が異なるだけで
 * APIロジックは同一（呼び出し方自体は保護者・子どもと全く同一。4c章参照）。
 */
type ScreenState = "form" | "uploadingPhoto" | "sending" | "networkError" | "limitReached";

export default function SupporterChoreReportScreen() {
  const { choreId } = useLocalSearchParams<{ choreId: string }>();
  const { state, dispatch, isChoreLimitReached } = useAppData();
  const { client } = useSession();
  const chore = state.chores.find((c) => c.id === choreId);
  const me = state.members.find((m) => m.id === state.activeParentMemberId);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [screenState, setScreenState] = useState<ScreenState>(
    chore && me && isChoreLimitReached(chore, me.id) ? "limitReached" : "form"
  );

  if (!chore || !me) {
    return (
      <Screen tone="supporter">
        <Text style={theme.typography.supporterBody}>お手伝いが見つかりませんでした</Text>
        <AppButton tone="supporter" label="じぶんのお手伝いへもどる" onPress={() => router.replace("/supporter/my-chores")} />
      </Screen>
    );
  }

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.5 });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const send = async () => {
    if (isChoreLimitReached(chore, me.id)) {
      setScreenState("limitReached");
      return;
    }

    let photoUrl: string | null = null;
    if (photoUri) {
      setScreenState("uploadingPhoto");
      try {
        const response = await fetch(photoUri);
        const blob = await response.blob();
        const path = `${chore.family_id}/${me.id}-${Date.now()}.jpg`;
        const { error: uploadError } = await client.storage.from("chore-photos").upload(path, blob, {
          contentType: "image/jpeg",
        });
        if (!uploadError) {
          photoUrl = path;
        } else {
          console.warn("chore-photos upload failed, continuing without photo", uploadError);
        }
      } catch (e) {
        console.warn("chore-photos upload threw, continuing without photo", e);
      }
    }

    setScreenState("sending");
    const result = await dispatch({
      type: "REPORT_COMPLETION",
      choreId: chore.id,
      reportedBy: me.id,
      note: note.trim() || null,
      photoUrl,
    });

    if (!result.ok) {
      if (result.error.code === PG_ERRCODE.checkViolation) {
        setScreenState("limitReached");
      } else {
        setScreenState("networkError");
      }
      return;
    }

    router.replace({
      pathname: "/supporter/my-chores",
      params: { justChoreId: chore.id, justTitle: chore.title, justPoints: String(chore.points) },
    });
  };

  if (screenState === "limitReached") {
    return (
      <Screen tone="supporter">
        <View style={styles.backRow}>
          <Pressable onPress={() => router.back()}>
            <Text style={theme.typography.supporterBody}>← もどる</Text>
          </Pressable>
          <Text style={theme.typography.supporterBody}>
            {chore.emoji} {chore.title}
          </Text>
        </View>
        <View style={styles.centerBlock}>
          <Text style={theme.typography.supporterBodyMedium}>本日はすでに記録済みです</Text>
        </View>
        <AppButton tone="supporter" label="じぶんのお手伝いへもどる" fullWidth onPress={() => router.replace("/supporter/my-chores")} />
      </Screen>
    );
  }

  if (screenState === "networkError") {
    return (
      <Screen tone="supporter">
        <View style={styles.backRow}>
          <Pressable onPress={() => router.back()}>
            <Text style={theme.typography.supporterBody}>← もどる</Text>
          </Pressable>
          <Text style={theme.typography.supporterBody}>
            {chore.emoji} {chore.title}
          </Text>
        </View>
        <View style={styles.centerBlock}>
          <Text style={theme.typography.supporterBody}>通信エラーが発生しました</Text>
        </View>
        <AppButton tone="supporter" label="もう一度送信する" fullWidth onPress={() => setScreenState("form")} />
      </Screen>
    );
  }

  return (
    <Screen tone="supporter">
      <View style={styles.backRow}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.supporterBody}>← もどる</Text>
        </Pressable>
        <Text style={theme.typography.supporterBody}>
          {chore.title} {chore.emoji}
        </Text>
      </View>

      <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s6 }]}>
        きろくすると +{chore.points}pt
      </Text>
      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        🔒 このお手伝いは非公開です。家族には表示されません。
      </Text>

      <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s6 }]}>写真（任意）</Text>
      <Pressable onPress={pickPhoto} style={styles.photoBox}>
        <Text style={theme.typography.supporterBody}>{photoUri ? "写真を追加しました" : "写真を追加"}</Text>
      </Pressable>

      <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s6 }]}>メモ（任意）</Text>
      <TextInput value={note} onChangeText={setNote} multiline style={styles.noteInput} />

      <AppButton
        tone="supporter"
        label={
          screenState === "uploadingPhoto"
            ? "写真をおくっています…"
            : screenState === "sending"
            ? "きろくしています…"
            : "きろくする"
        }
        fullWidth
        loading={screenState === "sending" || screenState === "uploadingPhoto"}
        disabled={screenState === "sending" || screenState === "uploadingPhoto"}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={send}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  centerBlock: { alignItems: "center", marginTop: theme.spacing.s8, marginBottom: theme.spacing.s6 },
  photoBox: {
    marginTop: theme.spacing.s2,
    minHeight: theme.tapTarget.supporterPrimary,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s3,
  },
  noteInput: {
    marginTop: theme.spacing.s2,
    minHeight: 72,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    padding: theme.spacing.s3,
    textAlignVertical: "top",
  },
});
