import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useSession } from "@/lib/session";

/**
 * マジックリンクのリダイレクト先画面。
 *
 * [2026-08-15追加・本部長] app/_layout.tsx の useMagicLinkListener() が
 * ディープリンクを検知して exchangeCodeForSession() を呼ぶ処理自体は実装済み
 * だったが、その処理を待つ間に expo-router が表示すべき「/auth-callback」用の
 * 画面ファイルが存在しなかったため、実際にブラウザでマジックリンクを踏むと
 * 「Unmatched Route」（404相当）が表示されてしまう不具合を、本部長が実際に
 * ブラウザで検証して発見した。
 *
 * Supabaseはリンクが無効・期限切れの場合、code= を含めず、URLフラグメントに
 * error=access_denied&error_code=otp_expired 等を付けてこのURLへリダイレクトする。
 * useMagicLinkListener は code=/access_token= を含まないURLを無視する設計のため
 * （エラー時に誤ってexchangeCodeForSessionを呼ばないための意図的な仕様）、
 * エラー時の表示はこの画面が独自に担う。
 *
 * [2026-08-16修正・本部長] 当初はparentNoFamily時に常に/onboarding/create-family
 * （家族を新しくつくる）へ遷移していたため、ユーザーが実際に「招待コードをもってきた
 * （保護者）」からマジックリンクを踏んでも家族新規作成画面に固定されてしまう不具合が
 * あった。マジックリンクは別タブ・別セッション（メールクライアント経由）で開かれ、
 * P2（app/onboarding/email.tsx）のURLパラメータのintentはこの画面には引き継がれない
 * ため、P2側でredirectToのクエリパラメータとしてintentを明示的に埋め込み、
 * この画面でuseLocalSearchParams経由で読み取れるようにした（P2/P3参照）。
 */
export default function AuthCallbackScreen() {
  const { status } = useSession();
  // [2026-08-22追加] みまもりメンバー招待（S0、要件定義書07-7章）対応。
  // intent="join-supporter" のときはtokenパラメータも一緒に受け取り、
  // /onboarding/join-supporter（S0）へ引き継ぐ（src/lib/authRedirect.tsの
  // extraParams経由でここまで届く）。
  const { intent, token } = useLocalSearchParams<{ intent?: string; token?: string }>();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.location?.hash) return;
    const hash = window.location.hash;
    if (!hash.includes("error=")) return;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const code = params.get("error_code");
    setErrorMessage(
      code === "otp_expired"
        ? "リンクの有効期限が切れているか、すでに使用されています。"
        : "リンクを確認できませんでした。"
    );
  }, []);

  useEffect(() => {
    if (status === "parent") {
      router.replace("/parent/home");
    } else if (status === "supporter") {
      // [2026-08-22追加] みまもりメンバーが既存アカウントで再ログインした場合
      // （例: ログアウト後に再度マジックリンクを踏んだ等）。
      router.replace("/supporter/home");
    } else if (status === "parentNoFamily") {
      if (intent === "join-supporter" && token) {
        // [2026-08-22追加] S0「招待プレビュー・参加確認」へ。認証は完了済みだが
        // まだfamily_membersに行が無い状態（accept_family_invite未実行）。
        router.replace({ pathname: "/onboarding/join-supporter", params: { token } });
      } else {
        router.replace(intent === "join" ? "/onboarding/join-family" : "/onboarding/create-family");
      }
    }
  }, [status, intent, token]);

  if (errorMessage) {
    return (
      <Screen tone="parent">
        <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
          <Text style={{ fontSize: 48 }}>📩</Text>
          <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
            {errorMessage}
          </Text>
          <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary, textAlign: "center" }}>
            もう一度メールアドレスを入力して、新しいリンクを送りましょう。
          </Text>
        </View>
        <AppButton
          label="さいしょから やりなおす"
          style={{ marginTop: theme.spacing.s8 }}
          onPress={() => router.replace("/")}
        />
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
        <Text style={{ fontSize: 48 }}>⏳</Text>
        <Text style={[theme.typography.parentTitle, { marginTop: theme.spacing.s3 }]}>
          ログイン処理中…
        </Text>
      </View>
    </Screen>
  );
}
