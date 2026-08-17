import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import theme from "@/theme/theme";
import { childLogin } from "@/data/api";
import { useSession } from "@/lib/session";

/**
 * C3 PIN入力（本人確認）
 * 参照: API仕様.md 2c章手順2 Edge Function `child-login`
 * 認証・データ管理設計書.md 3.2章のレスポンス（成功/423ロック/401失敗/404/409）に対応する。
 */
export default function PinInputScreen() {
  const { inviteCode, memberId, displayName } = useLocalSearchParams<{
    inviteCode?: string;
    memberId?: string;
    displayName?: string;
  }>();
  const { loginChild } = useSession();
  const [pin, setPin] = useState("");
  const [checking, setChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onDigit = (d: string) => {
    if (checking || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      void submit(next);
    }
  };

  const submit = async (value: string) => {
    if (!inviteCode || !memberId) return;
    setChecking(true);
    setErrorMessage(null);
    const res = await childLogin(inviteCode, memberId, value);
    setChecking(false);

    if (res.ok) {
      await loginChild({
        accessToken: res.data.access_token,
        expiresAt: res.data.expires_at,
        member: res.data.member,
        inviteCode,
      });
      // [2026-08-16修正・本部長] 一時的にwindow.location.hrefによるハード遷移へ
      // 変更していたが、真因はsrc/data/store.tsxのローディングゲートが
      // session.status==="loading"の一瞬を考慮していなかったことだった
      // （実装メモ.md 31章「続報」参照）。ゲート側を修正したため、通常の
      // クライアント側遷移に戻す。
      router.replace("/child/home");
      return;
    }

    if (res.error.status === 423) {
      router.push("/child-auth/pin-locked");
      return;
    }

    setPin("");
    if (res.error.code === "invalid_pin") {
      setErrorMessage("あんしょうばんごうが ちがうみたい。もういちど");
    } else if (res.error.code === "pin_not_set") {
      setErrorMessage("まだあんしょうばんごうが せっていされていないよ。おうちのひとにきいてね");
    } else {
      setErrorMessage("つうしんがおやすみ中みたい。もういちどためしてね");
    }
  };

  return (
    <Screen tone="child">
      <Text style={theme.typography.childHeadline}>あんしょうばんごう</Text>
      {displayName ? (
        <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s1, textAlign: "center" }]}>
          {displayName}
        </Text>
      ) : null}
      <View style={styles.dots}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i < pin.length ? theme.colors.brandPrimary : theme.colors.neutralBorder },
            ]}
          />
        ))}
      </View>

      {checking && (
        <View style={{ alignItems: "center", marginTop: theme.spacing.s3 }}>
          <ActivityIndicator />
        </View>
      )}

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, textAlign: "center", color: theme.colors.statusBlocking }}>
          {errorMessage}
        </Text>
      )}

      <View style={styles.pad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((key, idx) => (
          <Pressable
            key={idx}
            disabled={key === "" || checking}
            onPress={() => (key === "⌫" ? setPin((p) => p.slice(0, -1)) : key ? onDigit(key) : undefined)}
            style={({ pressed }) => [
              styles.key,
              { opacity: key === "" ? 0 : pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={{ fontSize: 24, fontWeight: "700" }}>{key}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: "row", gap: theme.spacing.s3, marginTop: theme.spacing.s6, justifyContent: "center" },
  dot: { width: 20, height: 20, borderRadius: 10 },
  pad: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: theme.spacing.s8,
    justifyContent: "center",
    gap: theme.spacing.s3,
  },
  key: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.neutralSurface,
    alignItems: "center",
    justifyContent: "center",
  },
});
