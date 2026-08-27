import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { fetchMyGratitudeGiveableBalance, sendGratitudePoints, PG_ERRCODE } from "@/data/api";

/**
 * C17 感謝ポイントを贈る（子どもビュー）
 * 参照: 主要画面ワイヤーフレーム.md 10.4章、画面一覧・遷移図.md C17・3.10章
 *
 * 自由記述の入力自体は必須（要件定義書05章「定型リストからの選択ではなく自由入力を
 * 必須とする」）だが、タップすると入力欄にそのまま挿入され自由に編集できる例文チップを
 * 添える（10.4章「編集可能な下書きの提供であり…定型リスト選択UIとは異なる」）。
 * 送信成功時はC7より控えめ・C11より弱い肯定演出を、この画面内で表示してから
 * C16へ戻る（10.4章「送信成功時のワイヤーフレーム」、新しいC18等の画面は作らない）。
 */
const EXAMPLE_CHIPS = ["にもつをもってくれた", "てつだってくれた", "やさしくしてくれた", "びょうきのときにたすけてくれた"];

type ScreenState = "form" | "sending" | "success" | "networkError";

export default function ChildGratitudeSendScreen() {
  const { state } = useAppData();
  const { client } = useSession();
  const myId = state.activeChildMemberId;

  const [balance, setBalance] = useState<number | null>(null);
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [points, setPoints] = useState(1);
  const [screenState, setScreenState] = useState<ScreenState>("form");
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const [sentInfo, setSentInfo] = useState<{ name: string; points: number } | null>(null);

  useEffect(() => {
    void fetchMyGratitudeGiveableBalance(client).then((res) => {
      if (res.ok) setBalance(res.data);
    });
  }, [client]);

  const candidates = state.members.filter((m) => m.is_active && m.id !== myId);
  const maxPoints = balance ?? 0;

  const send = async () => {
    if (!myId || !recipientId || !note.trim() || points < 1) return;
    setScreenState("sending");
    const res = await sendGratitudePoints(client, {
      sender_id: myId,
      recipient_id: recipientId,
      points,
      note: note.trim(),
    });
    if (!res.ok) {
      if (res.error.code === PG_ERRCODE.checkViolation) {
        setLimitMessage("きょうは もう いっぱい おくったよ。また あした！");
        setScreenState("form");
      } else {
        setScreenState("networkError");
      }
      return;
    }
    setSentInfo({ name: state.members.find((m) => m.id === recipientId)?.display_name ?? "", points });
    setScreenState("success");
  };

  if (screenState === "success" && sentInfo) {
    return (
      <Screen tone="child">
        <View style={styles.centerBlock}>
          <Text style={{ fontSize: 48 }}>💌🌸</Text>
          <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s4, textAlign: "center" }]}>
            {sentInfo.name}に とどいたよ！
          </Text>
          <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s2 }]}>{sentInfo.points}こ</Text>
        </View>
        <AppButton
          label="ありがとうポイントへ"
          tone="child"
          fullWidth
          style={{ marginTop: theme.spacing.s8 }}
          onPress={() => router.replace("/child/gratitude")}
        />
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
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.childBody}>← もどる</Text>
        </Pressable>
        <Text style={theme.typography.childBody}>あと{balance ?? "…"}こ おくれるよ</Text>
      </View>

      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s6 }]}>だれに？</Text>
      <View style={styles.chipRow}>
        {candidates.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => setRecipientId(m.id)}
            style={[styles.memberChip, recipientId === m.id && styles.memberChipSelected]}
          >
            <MemberAvatar name={m.display_name} color={m.avatar_color} size={40} />
            <Text style={{ marginTop: theme.spacing.s1 }}>{m.display_name}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s6 }]}>なにをしてくれた？</Text>
      <TextInput value={note} onChangeText={setNote} multiline maxLength={200} style={styles.noteInput} />
      <View style={styles.exampleRow}>
        {EXAMPLE_CHIPS.map((c) => (
          <Pressable key={c} onPress={() => setNote(c)} style={styles.exampleChip}>
            <Text style={theme.typography.parentCaption}>{c}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s6 }]}>なんpt？</Text>
      <View style={styles.stepperRow}>
        <Pressable
          onPress={() => setPoints((p) => Math.max(1, p - 1))}
          disabled={points <= 1}
          style={styles.stepperBtn}
        >
          <Text style={styles.stepperBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{points}こ</Text>
        <Pressable
          onPress={() => setPoints((p) => Math.min(maxPoints, p + 1))}
          disabled={points >= maxPoints}
          style={styles.stepperBtn}
        >
          <Text style={styles.stepperBtnText}>＋</Text>
        </Pressable>
      </View>

      {limitMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.brandPrimaryStrong }}>{limitMessage}</Text>
      )}

      <AppButton
        label={screenState === "sending" ? "おくっています…" : "おくる"}
        tone="child"
        fullWidth
        loading={screenState === "sending"}
        disabled={screenState === "sending" || !recipientId || !note.trim() || maxPoints < 1}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={send}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  centerBlock: { alignItems: "center", marginTop: theme.spacing.s8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s3, marginTop: theme.spacing.s2 },
  memberChip: {
    alignItems: "center",
    padding: theme.spacing.s2,
    borderRadius: theme.radius.childXl,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  memberChipSelected: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
  noteInput: {
    marginTop: theme.spacing.s2,
    minHeight: 64,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.childXl,
    padding: theme.spacing.s3,
    textAlignVertical: "top",
  },
  exampleRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s2 },
  exampleChip: {
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.childXl,
    backgroundColor: theme.colors.brandPrimarySoft,
  },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s4, marginTop: theme.spacing.s2 },
  stepperBtn: {
    width: theme.tapTarget.child,
    height: theme.tapTarget.child,
    borderRadius: theme.radius.childXl,
    backgroundColor: theme.colors.neutralSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperBtnText: { fontSize: 24, fontWeight: "700" },
  stepperValue: { fontSize: 22, fontWeight: "700", minWidth: 60, textAlign: "center" },
});
