import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
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
type ScreenState = "form" | "sending" | "networkError" | "limitReached";

export default function ChildReportScreen() {
  const { choreId } = useLocalSearchParams<{ choreId: string }>();
  const { state, dispatch, isChoreLimitReached } = useAppData();
  const { client } = useSession();
  const chore = state.chores.find((c) => c.id === choreId);
  const me = state.members.find((m) => m.id === state.activeChildMemberId)!;

  const [note, setNote] = useState("");
  const [screenState, setScreenState] = useState<ScreenState>(
    chore && isChoreLimitReached(chore, me.id) ? "limitReached" : "form"
  );

  if (!chore) {
    return (
      <Screen tone="child">
        <Text style={theme.typography.childBody}>クエストが見つかりませんでした</Text>
        <AppButton label="やることリストへもどる" tone="child" onPress={() => router.replace("/child/home")} />
      </Screen>
    );
  }


  /**
   * API仕様.md 4章「完了報告」相当。
   * 手順2（写真添付・任意）: supabase.storage.from('chore-photos').upload(...)
   * 手順3: supabase.from('chore_completions').insert({ chore_id, reported_by, note })
   *
   * [2026-08-29] 証拠写真機能の廃止（2026-08-24決定）により、写真アップロードの手順と
   * 「アップロード失敗時は静かに写真無しで続行する」という設計はまるごと削除した。
   * Storageバケット `chore-photos` が未作成、またはアップロードに失敗した場合でも、
   * 写真無しで完了報告そのものは継続できるようにしている。
   *
   * [2026-08-20判明・本部長] この「失敗時は静かに写真無しで続行する」設計により、
   * 実際にStorageアップロードが常に失敗していた不具合（子ども用JWTがPostgRESTの
   * 検証は通るがStorageは別の鍵でしか検証しない、Supabase側の既知の制約）が
   * 画面上に一切表れず、ユーザーが「写真を添付しても反映されない」と気づくまで
   * 発見が遅れた。原因はsupabase/functions/_shared/env.tsのchildJwtSigningSecret
   * コメント参照・対応済み。当時「未検証事項」としていたこの部分は今回の調査で解消した。
   */
  const send = async () => {
    if (isChoreLimitReached(chore, me.id)) {
      setScreenState("limitReached");
      return;
    }


    setScreenState("sending");
    const result = await dispatch({
      type: "REPORT_COMPLETION",
      choreId: chore.id,
      reportedBy: me.id,
      note: note.trim() || null,
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
      // [2026-09-03追加] 要件定義書07-17章「完了報告の直後の取消」・UIUXデザイン部/
      // 成果物/主要画面ワイヤーフレーム.md 28.2節。取消リンクの対象を特定するため
      // completionIdを渡す（dispatchがREPORT_COMPLETION成功時に返すid、store.tsx参照）。
      params: { choreTitle: chore.title, points: String(chore.points), completionId: result.completionId ?? "" },
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
          screenState === "sending"
            ? "とどけています…"
            : "とどける ✋📮"
        }
        tone="child"
        fullWidth
        loading={screenState === "sending"}
        disabled={screenState === "sending"}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={send}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  centerBlock: { alignItems: "center", marginTop: theme.spacing.s8 },
  noteInput: {
    marginTop: theme.spacing.s2,
    minHeight: 72,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    padding: theme.spacing.s3,
    textAlignVertical: "top",
  },
});
