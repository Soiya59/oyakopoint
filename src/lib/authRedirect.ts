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

/**
 * マジックリンクの emailRedirectTo を組み立てる。ネイティブ版はLinking.createURL()に任せる。
 *
 * [2026-08-22拡張] みまもりメンバー招待（S0、要件定義書07-7章・API仕様.md 2d章）に
 * 対応するため、intent以外の任意の追加クエリパラメータ（招待トークン等）を
 * 渡せるようにした。マジックリンクは別タブ・別セッション（メールクライアント経由）で
 * 開かれるため、この関数でURLに埋め込んだ値だけが auth-callback.tsx 側に引き継がれる
 * （P2/email.tsxのintent引き継ぎと同じ設計、実装メモ.md参照）。
 */
export function buildAuthRedirectUrl(intent: string, extraParams: Record<string, string> = {}): string {
  const params = { intent, ...extraParams };
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return buildWebAppUrl("/auth-callback", params);
  }
  return Linking.createURL("auth-callback", { queryParams: params });
}

/**
 * [2026-08-22追加] みまもりメンバー招待リンク（S0、要件定義書07-7章・
 * 認証・データ管理設計書.md 8.2章）。保護者がP24でこのリンクをコピーし、
 * メール・メッセージアプリ等アプリ外の任意の手段で招待相手に共有する
 * （既存の招待コード共有と同じ設計、8.2章「招待リンクを送付」参照）。
 */
export function buildSupporterInviteUrl(token: string): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return buildWebAppUrl("/onboarding/join-supporter", { token });
  }
  return Linking.createURL("onboarding/join-supporter", { queryParams: { token } });
}
