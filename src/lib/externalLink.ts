import { Platform } from "react-native";
import * as Linking from "expo-linking";

/**
 * 外部URL（使い方ガイド・プライバシーポリシー・利用規約等）を開く共通処理。
 * やること.md 2-28（宣伝部/成果物/開発チャットへの申し送り（2026-09-09）.md 件3）。
 *
 * [Web版での挙動] expo-linkingのLinking.openURL()はWeb版では
 * `window.location = url`（同じタブでの遷移）になり、アプリの状態を失って
 * しまう（node_modules/expo-linking/build/RNLinking.web.js参照、実装メモ.md
 * 181章で確認）。ガイド・規約を読んで戻ってくる利用シーンでは新しいタブで
 * 開くほうが自然なため、Web版だけ `window.open(url, "_blank")` を使う。
 * ネイティブ版（iOS/Android）は従来どおりexpo-linkingのLinking.openURL()に
 * 任せる。
 *
 * @returns 開けたら true、開けなかったら false。呼び出し元は false のとき
 *   利用者に必ず何か伝えること（開発部CLAUDE.md「黙って失敗しない」要件）。
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  try {
    if (Platform.OS === "web") {
      if (typeof window === "undefined") return false;
      const win = window.open(url, "_blank", "noopener,noreferrer");
      // ポップアップブロック等でwinがnull/undefinedになる場合がある。
      return Boolean(win);
    }
    const supported = await Linking.canOpenURL(url);
    if (!supported) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
