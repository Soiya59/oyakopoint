import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useSession } from "@/lib/session";
import { isSupabaseConfigured } from "@/lib/supabase";

/**
 * P1 ようこそ / はじめかた選択
 * 画面一覧・遷移図.md 1章 P1 / 3.1章「起動〜認証（全体像）」に対応。
 *
 * [2026-08-15改訂] 実際のSupabase接続に対応。SessionProvider（src/lib/session.tsx）の
 * statusを見て、既にログイン済み（保護者＝家族所属済み／子ども）であれば
 * 自動的にホームへ遷移する。未ログイン・家族未所属の場合はこれまでどおり
 * オンボーディング導線（P2〜P6・C1）を案内する。
 */
export default function WelcomeScreen() {
  const { status } = useSession();

  useEffect(() => {
    if (status === "parent") {
      router.replace("/parent/home");
    } else if (status === "supporter") {
      // [2026-08-22追加] みまもりメンバー（要件定義書07-7章）。ログイン済みの場合は
      // 保護者と同様に自動的に専用ホーム（S1）へ遷移する。
      router.replace("/supporter/home");
    } else if (status === "child") {
      router.replace("/child/home");
    }
  }, [status]);

  return (
    <Screen tone="parent">
      <View style={styles.hero}>
        <Text style={styles.logo}>🌟</Text>
        <Text style={theme.typography.parentTitle}>おやこポイント</Text>
        <Text style={[theme.typography.parentBody, styles.subtitle]}>
          おてつだいをがんばって、ポイントをためよう
        </Text>
      </View>

      <View style={{ gap: theme.spacing.s3, marginTop: theme.spacing.s8 }}>
        <AppButton
          label="家族を新しくつくる"
          onPress={() => router.push("/onboarding/email?intent=create")}
        />
        <AppButton
          label="招待コードをもってきた（保護者）"
          variant="secondary"
          onPress={() => router.push("/onboarding/email?intent=join")}
        />
        <AppButton
          label="こどもモードで使う"
          variant="secondary"
          onPress={() => router.push("/child-auth/invite-code")}
        />
      </View>

      {status === "parentNoFamily" && (
        <View style={styles.demoBox}>
          <Text style={theme.typography.parentBody}>
            メール認証は完了しています。家族の作成・参加を続けてください。
          </Text>
          <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s2 }}>
            <AppButton
              label="家族をつくる"
              variant="secondary"
              onPress={() => router.push("/onboarding/create-family")}
            />
            <AppButton
              label="招待コードで参加"
              variant="secondary"
              onPress={() => router.push("/onboarding/join-family")}
            />
          </View>
        </View>
      )}

      {!isSupabaseConfigured() && (
        <View style={styles.demoBox}>
          <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
            開発検証用ショートカット（Supabase未接続のためモックデータで動作します）
          </Text>
          <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s2 }}>
            <AppButton
              label="保護者ホームを見る"
              variant="ghost"
              onPress={() => router.push("/parent/home")}
            />
            <AppButton
              label="子どもホームを見る"
              variant="ghost"
              onPress={() => router.push("/child/home")}
            />
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", marginTop: theme.spacing.s8 },
  logo: { fontSize: 48, marginBottom: theme.spacing.s2 },
  subtitle: { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary },
  demoBox: {
    marginTop: theme.spacing.s8,
    padding: theme.spacing.s3,
    borderRadius: theme.radius.parentMd,
    backgroundColor: theme.colors.neutralSurface,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
});
