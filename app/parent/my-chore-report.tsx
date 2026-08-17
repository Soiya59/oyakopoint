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
 * P20 じぶんの完了報告（保護者、要件定義書07-4章「親の完了報告」）
 * 参照: 主要画面ワイヤーフレーム.md 9.2章、画面一覧・遷移図.md P20・3.9章
 *
 * C6完了報告の保護者版。API呼び出し（chore_completions insert）自体はC6と全く同じ
 * （API仕様.md 4b章）。異なるのは演出のみ:
 * - ボタン文言「とどける」→「きろくする」
 * - 送信成功時は新しい画面（C7相当）へ遷移せず、P19へ戻り控えめな確認表示のみ
 *   （主要画面ワイヤーフレーム.md 9.0決定2）
 * - 上限到達時の文言も達成トーンではなく簡潔な事実提示にする（9.2章状態一覧）
 */
type ScreenState = "form" | "uploadingPhoto" | "sending" | "networkError" | "limitReached";

export default function ParentMyChoreReportScreen() {
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
      <Screen tone="parent">
        <Text style={theme.typography.parentBody}>お手伝いが見つかりませんでした</Text>
        <AppButton label="じぶんのお手伝いへもどる" onPress={() => router.replace("/parent/my-chores")} />
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

  /**
   * app/child/report.tsx（C6）と同一のアップロード順序・エラー処理方針を踏襲する
   * （chore_completionsは追記専用ログでUPDATE経路が無いため、Storageアップロードを
   * 先に行いphoto_urlをINSERTペイロードに含める。実装メモ.md 15.7章参照）。
   */
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

    // 主要画面ワイヤーフレーム.md 9.0決定2: 新しい画面へは遷移せず、P19へ戻り
    // 控えめな確認表示のみ行う。P19側はjustChoreId/justTitle/justPointsパラメータを
    // 「一度きりの合図」として受け取り、該当行のハイライト＋スナックバーを出す。
    router.replace({
      pathname: "/parent/my-chores",
      params: { justChoreId: chore.id, justTitle: chore.title, justPoints: String(chore.points) },
    });
  };

  if (screenState === "limitReached") {
    return (
      <Screen tone="parent">
        <View style={styles.backRow}>
          <Pressable onPress={() => router.back()}>
            <Text style={theme.typography.parentBody}>← もどる</Text>
          </Pressable>
          <Text style={theme.typography.parentBody}>
            {chore.emoji} {chore.title}
          </Text>
        </View>
        <View style={styles.centerBlock}>
          <Text style={theme.typography.parentBodyMedium}>本日はすでに記録済みです</Text>
        </View>
        <AppButton label="じぶんのお手伝いへもどる" fullWidth onPress={() => router.replace("/parent/my-chores")} />
      </Screen>
    );
  }

  if (screenState === "networkError") {
    return (
      <Screen tone="parent">
        <View style={styles.backRow}>
          <Pressable onPress={() => router.back()}>
            <Text style={theme.typography.parentBody}>← もどる</Text>
          </Pressable>
          <Text style={theme.typography.parentBody}>
            {chore.emoji} {chore.title}
          </Text>
        </View>
        <View style={styles.centerBlock}>
          <Text style={theme.typography.parentBody}>通信エラーが発生しました</Text>
        </View>
        <AppButton label="もう一度送信する" fullWidth onPress={() => setScreenState("form")} />
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <View style={styles.backRow}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.parentBody}>← もどる</Text>
        </Pressable>
        <Text style={theme.typography.parentBody}>
          {chore.title} {chore.emoji}
        </Text>
      </View>

      <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>
        記録すると +{chore.points}pt
      </Text>

      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s6 }]}>写真（任意）</Text>
      <Pressable onPress={pickPhoto} style={styles.photoBox}>
        <Text style={theme.typography.parentBody}>{photoUri ? "写真を追加しました" : "写真を追加"}</Text>
      </Pressable>

      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s6 }]}>メモ（任意）</Text>
      <TextInput value={note} onChangeText={setNote} multiline style={styles.noteInput} />

      <AppButton
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
    minHeight: theme.tapTarget.parent,
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
