const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

/**
 * NFCタグを直接タップ起動できるようにする Expo config plugin。
 *
 * [2026-09-12新設・実装メモ212章] やること.md 2-4「NFCタグの直接起動」。
 * `app.json` の `expo.android.intentFilters` は `action: "VIEW"` のような
 * 短い名前しか受け付けず、Expoの内部実装（
 * `node_modules/@expo/config-plugins/build/android/IntentFilters.js` 54行目、
 * `` `android.intent.action.${intentFilter.action}` ``）が必ず
 * `android.intent.action.` を頭に付けてしまう。そのため
 * `android.nfc.action.NDEF_DISCOVERED`（NFCタグそのものを受け取る宣言）は
 * `app.json` の設定だけでは書けず、この専用pluginで
 * AndroidManifest.xmlのMainActivityに直接intent-filterを追加する。
 *
 * [なぜNDEF_DISCOVEREDが要るか]
 * 既存の`android.intentFilters`（`action: "VIEW"`、`autoVerify: true`）は
 * Android App Links用で、LINE等からのURLタップやブラウザのアドレスバー入力を
 * このアプリに引き渡す宣言。一方、NFCタグをかざす操作はOSのNFCサービス
 * （Android 16で確認）が別経路で処理しており、URLが書かれたNDEFタグを
 * 「どのアプリに渡すか」を判断する際は、VIEWの宣言ではなくNDEF_DISCOVERED
 * の宣言を持つアプリを候補にする。この宣言がないと、OSはブラウザだけを
 * 候補にし、「NFC で見つかったリンクを開きますか？」の通知経由でブラウザが
 * 開いてしまう（2026-09-12実機確認、Android 16・versionCode 4）。
 *
 * [値の一元化] host・pathPrefixは`app.json`の
 * `expo.android.intentFilters[0].data[0]`（VIEW用に既に書いてあるもの）から
 * 読む。ここにハードコードすると、将来ドメインを変えるときに片方だけ直す
 * 事故につながるため。
 */

const NDEF_ACTION = "android.nfc.action.NDEF_DISCOVERED";

function getViewIntentFilterData(config) {
  const intentFilters = config.android?.intentFilters ?? [];
  const viewFilter = intentFilters.find((f) => f.action === "VIEW" && f.data);
  const data = Array.isArray(viewFilter?.data) ? viewFilter.data[0] : viewFilter?.data;
  if (!data?.scheme || !data?.host) {
    throw new Error(
      "withNfcNdefIntentFilter: app.json の android.intentFilters[0].data[0] に " +
        "scheme・host が見つかりません。NDEF_DISCOVERED用のintent-filterに使う値を" +
        "読み込めないため中断します。"
    );
  }
  return data;
}

function hasNdefIntentFilter(mainActivity) {
  const filters = mainActivity["intent-filter"] ?? [];
  return filters.some((filter) =>
    (filter.action ?? []).some((a) => a.$?.["android:name"] === NDEF_ACTION)
  );
}

function buildNdefIntentFilter(data) {
  const dataAttrs = { "android:scheme": data.scheme, "android:host": data.host };
  if (data.pathPrefix) {
    dataAttrs["android:pathPrefix"] = data.pathPrefix;
  }
  return {
    action: [{ $: { "android:name": NDEF_ACTION } }],
    category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
    data: [{ $: dataAttrs }],
  };
}

function withNfcNdefIntentFilter(config, props = {}) {
  return withAndroidManifest(config, (modConfig) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(modConfig.modResults);

    // 冪等性: prebuildを複数回走らせても、既にNDEF_DISCOVEREDのintent-filterが
    // あれば追加しない（重複させない）。
    if (hasNdefIntentFilter(mainActivity)) {
      return modConfig;
    }

    const data = props.scheme && props.host ? props : getViewIntentFilterData(modConfig);

    if (!Array.isArray(mainActivity["intent-filter"])) {
      mainActivity["intent-filter"] = [];
    }
    mainActivity["intent-filter"].push(buildNdefIntentFilter(data));

    return modConfig;
  });
}

module.exports = withNfcNdefIntentFilter;
