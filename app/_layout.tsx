import React, { useEffect } from "react";
import { Stack } from "expo-router";
import type { ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { AppDataProvider } from "@/data/store";
import { SessionProvider } from "@/lib/session";
import { PendingNfcLinkProvider } from "@/lib/pendingNfcLink";
import { PushSoftAskProvider } from "@/components/NotificationSoftAsk";
import { completeEmailSignIn } from "@/data/api";
import { isSupabaseConfigured } from "@/lib/supabase";
import theme from "@/theme/theme";
import AppErrorFallback from "@/components/AppErrorFallback";

/**
 * アプリ全体のエラー境界（やること.md 4-37、開発部/成果物/実装メモ.md 242章）。
 * expo-routerは、ルートファイルが`ErrorBoundary`という名前でexportしたコンポーネント
 * を見つけると、そのファイルの既定export（＝このRootLayout。SafeAreaProviderから
 * Stackまでアプリ全体のツリーそのもの）を丸ごとReactのエラー境界（内部的には
 * `getDerivedStateFromError`を持つクラスコンポーネント）で包む。この1ファイルにだけ
 * 置くことで、新しく増える画面（app/配下にファイルを1つ追加するだけの画面）を含めて
 * 漏れなくカバーする（各画面に個別にexportして回る方式は書き忘れに弱いため採らず、
 * 手書きのクラスコンポーネントで<Stack>を包む方式もexpo-router内部と同じ仕組みの
 * 車輪の再発明になるだけのため採らなかった。選定理由の詳細は
 * src/components/AppErrorFallback.tsxの先頭コメント参照）。
 */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <AppErrorFallback {...props} />;
}

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
      {/* [2026-09-13追加・実装メモ.md 213章] PendingNfcLinkProviderは
          SessionProvider（延いてはsrc/data/store.tsxのAppDataProviderが持つ
          `session.status === "loading"`中は{children}を描画しないゲート）より
          外側に置く。ゲートより内側だと、Stack（延いてはNavigationContainer配下の
          ルーティング）が遅れて構築される間に`Linking.getInitialURL()`を呼ぶことに
          なり、修正の意味が薄れるため。詳細はsrc/lib/pendingNfcLink.tsxのコメント。 */}
      <PendingNfcLinkProvider>
        <SessionProvider>
          <AppDataProvider>
            {/* [2026-09-22追加・要件定義書07-37章6章、UIUXデザイン部/成果物/
                主要画面ワイヤーフレーム.md 63.9節3] ソフトアスクの表示条件は
                特定の画面に紐づけず、ルートの共通レイヤーで判定する。
                useSession()・useAppData()の両方を使うため、この2つの
                Providerの内側に置く。 */}
            <PushSoftAskProvider>
              <StatusBar style="dark" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: theme.colors.neutralBg },
                }}
              />
            </PushSoftAskProvider>
          </AppDataProvider>
        </SessionProvider>
      </PendingNfcLinkProvider>
    </SafeAreaProvider>
  );
}
