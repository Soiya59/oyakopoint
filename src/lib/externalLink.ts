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
      // [2026-09-11修正・本部長／軽微変更ルート] **`noopener`を外した。**
      //
      // 直前の実装は `window.open(url, "_blank", "noopener,noreferrer")` の
      // 戻り値で成否を判定していたが、**HTMLの仕様上、`noopener`（および
      // それを含意する`noreferrer`）を指定した`window.open()`は、タブが
      // 正常に開いても必ず`null`を返す。** そのため`Boolean(win)`は常にfalseになり、
      // **規約・プライバシーポリシー・使い方ガイドのリンクを押すと、実際には
      // 新しいタブが開いているのに「開けませんでした。もう一度お試しください。」
      // が必ず表示されていた**（統括が初回同意モーダルで発見・実機で
      // 「タブは開いた」ことを確認済み。本部長が本物のクリック操作で
      // `null`が返ることを実測して原因を特定した）。
      //
      // 戻り値で成否を判定する（＝「黙って失敗しない」を満たす）ためには
      // 窓オブジェクトを受け取る必要があるため、`noopener`は付けずに開き、
      // 直後に`opener`を切る。安全性は`noopener`と同等で、判定だけが可能になる。
      // 開く先は使い方ガイド・規約・PPのいずれも本アプリと同一オリジン
      // （`https://soiya59.github.io`。`src/lib/legalLinks.ts`参照）なので
      // `win.opener`への代入は通るが、将来ドメインが分かれた場合に
      // SecurityErrorになりうるため念のためtry/catchで囲う。
      const win = window.open(url, "_blank");
      // ポップアップブロック等で開けなかった場合はnull/undefinedになる。
      // 上記のとおり`noopener`を外したので、**この判定は今度こそ「本当に
      // 開けなかったか」だけを表す。**
      if (!win) return false;
      try {
        win.opener = null;
      } catch {
        // 別オリジンだった場合は代入できない。開けたこと自体は変わらないので
        // 成功として扱う。
      }
      return true;
    }
    const supported = await Linking.canOpenURL(url);
    if (!supported) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
