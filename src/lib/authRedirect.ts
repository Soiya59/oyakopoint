import { Platform } from "react-native";
import * as Linking from "expo-linking";

/**
 * Web版（GitHub Pagesのサブパス配信を含む）で、このアプリ自身の画面を指す絶対URLを
 * 組み立てる共通ヘルパー。
 *
 * [2026-08-18追加・本部長] `Linking.createURL()`のWeb版実装は`window.location.origin`は
 * 考慮するが、Expo Routerに設定したbaseUrl（GitHub Pagesのサブパス配信用接頭辞、
 * app.jsonのexperiments.baseUrl参照）までは考慮しない。expo-router自身が内部的に
 * 使っているのと同じ`process.env.EXPO_BASE_URL`（ビルド時にexperiments.baseUrlから
 * 注入される）を使い、自前でURLを組み立てることでこれを回避する。
 * マジックリンクのリダイレクト先（buildAuthRedirectUrl）・NFCタグに書き込むURL
 * （src/lib/nfc.ts）の両方で使う。
 */
export function buildWebAppUrl(path: string, params: Record<string, string>): string {
  const basePath = process.env.EXPO_BASE_URL ?? "";
  const query = new URLSearchParams(params).toString();
  return `${window.location.origin}${basePath}${path}${query ? `?${query}` : ""}`;
}

/** マジックリンクの emailRedirectTo を組み立てる。ネイティブ版はLinking.createURL()に任せる。 */
export function buildAuthRedirectUrl(intent: string): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return buildWebAppUrl("/auth-callback", { intent });
  }
  return Linking.createURL("auth-callback", { queryParams: { intent } });
}
