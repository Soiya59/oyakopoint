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
 * C6 完了報告（主要5画面のひとつ）
 * 参照: 主要画面ワイヤーフレーム.md 2章
 * 状態: 入力中 / 写真アップロード中 / 送信中 / 送信成功 / 送信エラー：上限到達 / 送信エラー：通信
 *
 * [2026-08-15改訂] 旧「追記モード」（appendMode、主要画面ワイヤーフレーム.md旧7.4節
 * 「あとで写真・メモをつける」対応）は撤回された（同ドキュメント7.0決定5・7.4節【撤回】
 * 参照）。C14からの導線を含め撤回済みのため、この画面は通常の完了報告フォームのみを持つ。
 * 実装メモ.md 11章参照。
 */
type ScreenState = "form" | "uploadingPhoto" | "sending" | "networkError" | "limitReached";

export default function ChildReportScreen() {
  const { choreId } = useLocalSearchParams<{ choreId: string }>();
  const { state, dispatch, isChoreLimitReached } = useAppData();
  const { client } = useSession();
  const chore = state.chores.find((c) => c.id === choreId);
  const me = state.members.find((m) => m.id === state.activeChildMemberId)!;

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [screenState, setScreenState] = useState<ScreenState>(
    chore && isChoreLimitReached(chore, me.id) ? "limitReached" : "form"
  );

  if (!chore) {
    return (
      <Screen tone="child">
        <Text style={theme.typography.childBody}>おてつだいが見つかりませんでした</Text>
        <AppButton label="やることリストへもどる" tone="child" onPress={() => router.replace("/child/home")} />
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
   * API仕様.md 4章「完了報告」相当。
   * 手順2（写真添付・任意）: supabase.storage.from('chore-photos').upload(...)
   * 手順3: supabase.from('chore_completions').insert({ chore_id, reported_by, photo_url, note })
   *
   * [設計判断の補完] 認証・データ管理設計書.md 5章のフォルダ構成
   * （{family_id}/{completion_id}.jpg）は completion_id の発行（INSERT成功）後に
   * しか決まらない一方、API仕様.md 4章の手順は「2. 写真添付→3. 完了報告作成」の順で
   * 書かれている。またchore_completionsは子ども自身によるUPDATEを許すRLSポリシーが
   * 無い追記専用ログ（9.6.1節参照）のため、INSERT後にphoto_urlだけ書き足すことはできない。
   * そのため実装では、アップロード時のパスに completion_id の代わりに
   * `{family_id}/{member_id}-{timestamp}.jpg` を使い、先にStorageへアップロードしてから
   * そのパスをphoto_urlとしてINSERTペイロードに含める順序にした。
   * Storageバケット `chore-photos` が未作成、またはアップロードに失敗した場合でも、
   * 写真無しで完了報告そのものは継続できるようにしている（実装メモ.md参照・未検証事項）。
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

    router.replace({
      pathname: "/child/report-sent",
      params: { choreTitle: chore.title, points: String(chore.points) },
    });
  };

  if (screenState === "limitReached") {
    return (
      <Screen tone="child">
        <View style={styles.backRow}>
          <Pressable onPress={() => router.back()}>
            <Text style={theme.typography.childBody}>← もどる</Text>
          </Pressable>
          <Text style={theme.typography.childBody}>
            {chore.title} {chore.emoji}
          </Text>
        </View>
        <View style={styles.centerBlock}>
          <Text style={{ fontSize: 40 }}>🌟✅🌟</Text>
          <Text style={[theme.typography.childHeadline, { textAlign: "center", marginTop: theme.spacing.s4 }]}>
            きょうの「{chore.title}」は{"\n"}もう たっぷりやったよ！
          </Text>
          <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
            またあした ためしてね
          </Text>
        </View>
        <AppButton label="やることリストへもどる" tone="child" fullWidth onPress={() => router.replace("/child/home")} />
      </Screen>
    );
  }

  if (screenState === "networkError") {
    return (
      <Screen tone="child">
        <View style={styles.backRow}>
          <Pressable onPress={() => router.back()}>
            <Text style={theme.typography.childBody}>← もどる</Text>
          </Pressable>
          <Text style={theme.typography.childBody}>
            {chore.title} {chore.emoji}
          </Text>
        </View>
        <View style={styles.centerBlock}>
          <Text style={theme.typography.childBody}>⚠ とどきませんでした…</Text>
          <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s2 }]}>もういちど おしてみてね</Text>
        </View>
        <AppButton label="もういちど とどける" tone="child" fullWidth onPress={() => setScreenState("form")} />
      </Screen>
    );
  }

  return (
    <Screen tone="child">
      <View style={styles.backRow}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.childBody}>← もどる</Text>
        </Pressable>
        <Text style={theme.typography.childBody}>
          {chore.title} {chore.emoji}
        </Text>
      </View>

      <Text style={[theme.typography.childHeadline, { textAlign: "center", marginTop: theme.spacing.s6 }]}>
        できたら +{chore.points}pt
      </Text>

      <Pressable onPress={pickPhoto} style={styles.photoBox}>
        {photoUri ? (
          <Text style={theme.typography.childBody}>📷 しゃしんをつけました</Text>
        ) : (
          <>
            <Text style={theme.typography.childBody}>📷 しゃしんをつける</Text>
            <Text style={theme.typography.parentCaption}>（なくてもOK）</Text>
          </>
        )}
      </Pressable>

      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s6 }]}>ひとことメモ（にんい）</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        multiline
        style={styles.noteInput}
        placeholder=""
      />

      <AppButton
        label={
          screenState === "uploadingPhoto"
            ? "しゃしんをおくっています…"
            : screenState === "sending"
            ? "とどけています…"
            : "とどける ✋📮"
        }
        tone="child"
        fullWidth
        loading={screenState === "sending" || screenState === "uploadingPhoto"}
        disabled={screenState === "sending" || screenState === "uploadingPhoto"}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={send}
      />

      {/* 検証用: 通信エラー状態を試すためのリンク */}
      <Pressable onPress={() => setScreenState("networkError")}>
        <Text style={styles.debugToggle}>（検証用）通信エラー状態を見る</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  centerBlock: { alignItems: "center", marginTop: theme.spacing.s8 },
  photoBox: {
    marginTop: theme.spacing.s6,
    minHeight: theme.tapTarget.childPrimary,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  noteInput: {
    marginTop: theme.spacing.s2,
    minHeight: 72,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    padding: theme.spacing.s3,
    textAlignVertical: "top",
  },
  debugToggle: { textAlign: "center", fontSize: 11, color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s3 },
});
