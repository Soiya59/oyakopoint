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
      router.replace("/parent");
    } else if (status === "supporter") {
      // [2026-08-22追加] みまもりメンバー（要件定義書07-7章）。ログイン済みの場合は
      // 保護者と同様に自動的に専用ホーム（かぞくタブ）へ遷移する。
      // [2026-09-09変更・実装メモ.md 182章] S1廃止（35章）に伴い遷移先を
      // `/supporter/family`（かぞくタブ、初期表示）へ変更。
      router.replace("/supporter/family");
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
          クエストをがんばって、ポイントをためよう
        </Text>
      </View>

      <View style={{ gap: theme.spacing.s3, marginTop: theme.spacing.s8 }}>
        {/* [2026-09-12・UIUXデザイン部44.2節決定7] status==="parentNoFamily"（メール認証済み・
            家族未所属）のときは、この3つの認証系ボタン（家族を新しくつくる／招待コードをもって
            きた／ログインする）を非表示にし、下のdemoBox（家族をつくる／招待コードで参加）に
            案内を一本化する。この3ボタンは未認証者向けの入口であり、認証済みの
            parentNoFamilyの人が押すと不要なメール認証をもう一度求めてしまうため。
            「こどもモードで使う」だけは対象外（別ロールの入口のため常時表示、決定7）。 */}
        {status !== "parentNoFamily" && (
          <AppButton
            label="家族を新しくつくる"
            onPress={() => router.push("/onboarding/email?intent=create")}
          />
        )}
        {status !== "parentNoFamily" && (
          <AppButton
            label="招待コードをもってきた（保護者）"
            variant="secondary"
            onPress={() => router.push("/onboarding/email?intent=join")}
          />
        )}
        <AppButton
          label="こどもモードで使う"
          variant="secondary"
          onPress={() => router.push("/child-auth/invite-code")}
        />
      </View>

      {/* [2026-09-12追加・UIUXデザイン部44.1節決定1〜4] 審査員がP1（この画面）を
          見た時点で「すでにアカウントを持っている人」の入口が無く、統括自身が
          「パスワードでログインがない？」と見つけられなかったことを受けた4つ目の
          入口。42章のP2最下部リンク（審査員向け・目立たない見た目）とは別物で、
          こちらは一般利用者も使う「ボタンらしいボタン」として`variant="secondary"`
          （既存ボタン2・3と同格）にする。区切り線で「これから始める3択」と
          「すでに始めている人向けの1つ」を視覚的に分ける（決定3）。 */}
      {status !== "parentNoFamily" && (
        <>
          <View style={styles.loginDivider} />
          <AppButton
            label="ログインする（保護者・みまもり）"
            variant="secondary"
            style={{ marginTop: theme.spacing.s3 }}
            onPress={() => router.push("/onboarding/email?intent=login")}
          />
        </>
      )}

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
              onPress={() => router.push("/parent")}
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
  // [2026-09-12追加・UIUXデザイン部44.1節決定3] `app/parent/family.tsx`の
  // `settingsDivider`と同じ値（42.2節決定5・25.1節等でも使われている）。
  loginDivider: {
    marginTop: theme.spacing.s6,
    borderTopWidth: 1,
    borderTopColor: theme.colors.neutralBorder,
  },
  demoBox: {
    marginTop: theme.spacing.s8,
    padding: theme.spacing.s3,
    borderRadius: theme.radius.parentMd,
    backgroundColor: theme.colors.neutralSurface,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
});
