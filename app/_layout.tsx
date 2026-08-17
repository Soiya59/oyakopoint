import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { AppDataProvider } from "@/data/store";
import { SessionProvider } from "@/lib/session";
import { completeEmailSignIn } from "@/data/api";
import { isSupabaseConfigured } from "@/lib/supabase";
import theme from "@/theme/theme";

/**
 * マジックリンクのリダイレクトを受け取り、Supabase Authセッションへ交換する。
 * 参照: 設計部/成果物/API仕様.md 1章手順2「リンク踏んでセッション確立
 * （Supabase Auth SDKが自動処理）」。React Native環境ではブラウザのURLバーが
 * 存在しないため、supabase-jsの自動検出（detectSessionInUrl）は使えず、
 * expo-linkingで届いたディープリンクURLを明示的に交換する必要がある
 * （app.json の scheme: "oyakopoint" 参照、app/onboarding/email.tsx から
 * `Linking.createURL('auth-callback')` をemailRedirectToに指定している）。
 */
function useMagicLinkListener() {
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const handleUrl = (url: string | null) => {
      if (!url) return;
      if (!url.includes("code=") && !url.includes("access_token=")) return;
      void completeEmailSignIn(url);
    };

    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener("url", (event) => handleUrl(event.url));
    return () => sub.remove();
  }, []);
}

export default function RootLayout() {
  useMagicLinkListener();

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <AppDataProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.neutralBg },
            }}
          />
        </AppDataProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
