import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { fetchMyGratitudeGiveableBalance, sendGratitudePoints } from "@/data/api";

/**
 * P22 感謝ポイントを贈る（保護者）
 * 参照: 主要画面ワイヤーフレーム.md 10.2章、画面一覧・遷移図.md P22・3.10章
 *
 * 決定2（10.0章）: ポイント数はステッパー式（自由入力欄にしない）。上限は
 * my_gratitude_giveable_balance()の返り値に固定し、check_violationがほぼ発生しない
 * 設計にする。
 * 決定3: 贈り先選択UIから自分自身をあらかじめ除外する。
 * 決定4: 子ども・保護者を区別せず同一の並びで表示する（family_membersの登録順）。
 */
type ScreenState = "form" | "sending";

export default function ParentGratitudeSendScreen() {
  const { state } = useAppData();
  const { client } = useSession();
  const myId = state.activeParentMemberId;

  const [balance, setBalance] = useState<number | null>(null);
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [points, setPoints] = useState(1);
  const [screenState, setScreenState] = useState<ScreenState>("form");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    setErrorMessage(null);
    const res = await sendGratitudePoints(client, {
      sender_id: myId,
      recipient_id: recipientId,
      points,
      note: note.trim(),
    });
    setScreenState("form");
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    const recipientName = state.members.find((m) => m.id === recipientId)?.display_name ?? "";
    router.replace({
      pathname: "/parent/gratitude",
      params: { toastName: recipientName, toastPoints: String(points) },
    });
  };

  return (
    <Screen tone="parent">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.parentBody}>← もどる</Text>
        </Pressable>
        <Text style={theme.typography.parentBody}>今週あと{balance ?? "…"}pt贈れます</Text>
      </View>

      <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>だれに？</Text>
      <View style={styles.chipRow}>
        {candidates.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => setRecipientId(m.id)}
            style={[styles.memberChip, recipientId === m.id && styles.memberChipSelected]}
          >
            <MemberAvatar name={m.display_name} color={m.avatar_color} size={28} />
            <Text style={{ marginLeft: theme.spacing.s2 }}>{m.display_name}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>
        なにをしてくれた？（必須）
      </Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="例：帰り道に荷物を持ってくれた"
        multiline
        maxLength={200}
        style={styles.noteInput}
      />

      <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>なんpt贈る？</Text>
      <View style={styles.stepperRow}>
        <Pressable
          onPress={() => setPoints((p) => Math.max(1, p - 1))}
          disabled={points <= 1}
          style={styles.stepperBtn}
        >
          <Text style={styles.stepperBtnText}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{points}pt</Text>
        <Pressable
          onPress={() => setPoints((p) => Math.min(maxPoints, p + 1))}
          disabled={points >= maxPoints}
          style={styles.stepperBtn}
        >
          <Text style={styles.stepperBtnText}>＋</Text>
        </Pressable>
      </View>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <AppButton
        label={screenState === "sending" ? "贈っています…" : "贈る"}
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
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s2 },
  memberChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  memberChipSelected: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
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
  stepperRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s4, marginTop: theme.spacing.s2 },
  stepperBtn: {
    width: theme.tapTarget.parent,
    height: theme.tapTarget.parent,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperBtnText: { fontSize: 20, fontWeight: "700" },
  stepperValue: { fontSize: 20, fontWeight: "700", minWidth: 60, textAlign: "center" },
});
