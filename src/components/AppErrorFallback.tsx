import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import type { ErrorBoundaryProps } from "expo-router";
import AppButton from "./AppButton";
import AppVersionInfo from "./AppVersionInfo";
import theme from "@/theme/theme";

/**
 * アプリ全体が予期しないエラーで落ちたときに表示する画面。
 * やること.md 4-37「ErrorBoundaryが無い（何かが壊れると白い画面になる）」対応。
 * 参照: 開発部/成果物/実装メモ.md 242章。
 *
 * [なぜapp/_layout.tsxの`export function ErrorBoundary`から呼ばれるだけで
 *  全画面をカバーできるか]
 * expo-routerは各ルートファイルが`ErrorBoundary`という名前でexportした
 * コンポーネントを見つけると、そのファイルの既定exportを`Try`という本物の
 * Reactエラー境界（`getDerivedStateFromError`を持つクラスコンポーネント。
 * node_modules/expo-router/build/views/Try.js）で包む
 * （node_modules/expo-router/build/useScreens.js の`fromImport()`）。
 * `app/_layout.tsx`の既定exportは「SafeAreaProvider〜Stack」というアプリ全体の
 * ツリーそのものなので、この1ファイルにだけ`ErrorBoundary`をexportしておけば、
 * その中で新しく増える画面（app/配下にファイルを1つ追加するだけの画面）を含めて
 * 漏れなく1枚の境界で受け止められる。各画面ファイルに個別に`ErrorBoundary`を
 * exportして回る方式は、新しい画面を作るたびに書き忘れると即座に「その画面だけ
 * 白画面に戻る」ため、この案は採らなかった。
 * 手書きのクラスコンポーネントで`<Stack>`を包む方式も検討したが、
 * expo-routerの`Try`は上記のとおり同じ仕組み（getDerivedStateFromError）を
 * 内部で使っており、車輪の再発明になるだけで得るものが無いため採らなかった。
 *
 * [SafeAreaViewについて] `useSafeAreaInsets()`（他画面のScreen.tsxが使っている）は
 * 呼び出し時に`<SafeAreaProvider>`が祖先に無いと例外を投げる作りのため、ここでは
 * 使わない。RootLayoutがエラーで丸ごとアンマウントされた状態でこの画面が
 * 描画されるため、`app/_layout.tsx`自身が持つ`<SafeAreaProvider>`はこのとき
 * 存在しない前提で書く（expo-router本体がバージョン外の内部実装でExpoRoot側にも
 * 別のSafeAreaProviderを持つが、それに依存しない書き方にする）。
 * 代わりに、expo-router自身の既定のエラー画面
 * （node_modules/expo-router/build/views/ErrorBoundary.js）と同じく、
 * Context無しでも安全な`<SafeAreaView>`（同じreact-native-safe-area-contextの
 * コンポーネント）を使う。
 */
export default function AppErrorFallback({ error, retry }: ErrorBoundaryProps) {
  // 握りつぶさない: 開発時にスタックトレースが見えるようにコンソールへ出す。
  // 外部の監視サービスへは送らない（依存を増やさない・個人情報の方針）。
  useEffect(() => {
    console.error("[AppErrorFallback] アプリ全体のエラー境界で捕捉:", error);
  }, [error]);

  const summary = `${error.name}: ${error.message}`.slice(0, 80);

  const handleRetry = () => {
    void retry();
  };

  const handleGoHome = () => {
    // 先にパスを"/"へ更新してから retry() で RootLayout を再マウントする。
    // 逆順（retry→replace）だと、再マウント直後に元のクラッシュした画面を
    // 一瞬描画し直してしまう恐れがあるため。RootLayoutがアンマウントされている間、
    // アプリ内のルーティング（Stack）自体が存在しないため router.replace() 単独では
    // 画面は変わらない。retry() と組み合わせて初めて効く。
    router.replace("/");
    void retry();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <View style={styles.content}>
          <Text style={styles.emoji}>⚠️</Text>
          <Text style={[theme.typography.parentTitle, styles.title]}>エラーが おきました</Text>
          <Text style={[theme.typography.parentBody, styles.body]}>
            アプリの なかで もんだいが おきました。もういちど ためしてください。
          </Text>
          <AppButton label="もういちど" onPress={handleRetry} fullWidth style={styles.button} />
          <AppButton
            label="ホームへ もどる"
            variant="secondary"
            onPress={handleGoHome}
            fullWidth
            style={styles.button}
          />
          <AppVersionInfo />
          <Text style={[theme.typography.parentCaption, styles.errorLine]}>{summary}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.neutralBg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s6,
  },
  content: { width: "100%", maxWidth: 480, alignItems: "center" },
  emoji: { fontSize: 48, marginBottom: theme.spacing.s3 },
  title: { textAlign: "center" },
  body: {
    textAlign: "center",
    marginTop: theme.spacing.s2,
    marginBottom: theme.spacing.s6,
    color: theme.colors.neutralTextSecondary,
  },
  button: { marginTop: theme.spacing.s3, width: "100%" },
  errorLine: {
    marginTop: theme.spacing.s4,
    color: theme.colors.neutralTextSecondary,
    textAlign: "center",
  },
});
