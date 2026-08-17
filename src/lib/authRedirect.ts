import { Platform } from "react-native";
import * as Linking from "expo-linking";

/**
 * マジックリンクの emailRedirectTo を組み立てる。
 *
 * [2026-08-18修正・本部長] GitHub Pages（`https://soiya59.github.io/oyakopoint/`、
 * app.json の experiments.baseUrl: "/oyakopoint" 参照）へのデプロイ後、実際に
 * マジックリンクを踏むと `https://soiya59.github.io/auth-callback...`
 * （サブパス`/oyakopoint`が欠落）へ着地しGitHub自体の404になる不具合が発生した。
 * `Linking.createURL()`のWeb版実装は`window.location.origin`は考慮するが、
 * Expo Routerに設定したbaseUrl（サブパス配信時の接頭辞）までは考慮しないため。
 * Web版はexpo-routerが内部的に使っているのと同じ`process.env.EXPO_BASE_URL`
 * （ビルド時にapp.jsonのexperiments.baseUrlから注入される）を使い、自前でURLを
 * 組み立てる。ネイティブ版は従来通りLinking.createURL()に任せる（baseUrlの概念が無いため）。
 */
export function buildAuthRedirectUrl(intent: string): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const basePath = process.env.EXPO_BASE_URL ?? "";
    const query = new URLSearchParams({ intent }).toString();
    return `${window.location.origin}${basePath}/auth-callback?${query}`;
  }
  return Linking.createURL("auth-callback", { queryParams: { intent } });
}
