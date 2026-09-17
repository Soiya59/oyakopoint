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
 * [値の一元化] host・pathPrefixは`app.json`の`expo.android.intentFilters`
 * （VIEW用に既に書いてあるもの）から読む。ここにハードコードすると、将来ドメインを
 * 変えるときに片方だけ直す事故につながるため。
 *
 * [2026-09-17改訂・やること.md 4-35・実装メモ232章]
 * `app.json`のVIEW用`intentFilters`が新旧2ホスト（`soiya59.github.io`・
 * `soiyalab.com`）に増えたため、**該当するVIEWフィルタすべて**を読んで
 * NDEF_DISCOVEREDのintent-filterもホストの数ぶん追加するよう改めた（旧実装は
 * `.find()`で最初の1件しか見ておらず、そのままだと新ドメインのタグをタップ
 * したときだけNDEF_DISCOVEREDが効かず、ファイル冒頭の「なぜNDEF_DISCOVEREDが
 * 要るか」で説明した「ブラウザ確認ダイアログを飛ばして直接アプリを起動する」
 * 効果が新ドメインのタグに対してだけ働かなくなるところだった）。
 */

const NDEF_ACTION = "android.nfc.action.NDEF_DISCOVERED";

/**
 * `app.json`の`android.intentFilters`のうち、`action: "VIEW"`かつ`data`を
 * 持つものすべてから、それぞれの1件目のdataを取り出す（新旧ドメインぶん
 * 複数件になりうる）。
 */
function getViewIntentFilterDataList(config) {
  const intentFilters = config.android?.intentFilters ?? [];
  const viewFilters = intentFilters.filter((f) => f.action === "VIEW" && f.data);
  const dataList = viewFilters.map((f) => (Array.isArray(f.data) ? f.data[0] : f.data));
  const invalid = dataList.find((data) => !data?.scheme || !data?.host);
  if (dataList.length === 0 || invalid) {
    throw new Error(
      "withNfcNdefIntentFilter: app.json の android.intentFilters（action: VIEW）の " +
        "data に scheme・host が見つかりません。NDEF_DISCOVERED用のintent-filterに" +
        "使う値を読み込めないため中断します。"
    );
  }
  return dataList;
}

function hasNdefIntentFilterForHost(mainActivity, host) {
  const filters = mainActivity["intent-filter"] ?? [];
  return filters.some(
    (filter) =>
      (filter.action ?? []).some((a) => a.$?.["android:name"] === NDEF_ACTION) &&
      (filter.data ?? []).some((d) => d.$?.["android:host"] === host)
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

    const dataList = props.scheme && props.host ? [props] : getViewIntentFilterDataList(modConfig);

    if (!Array.isArray(mainActivity["intent-filter"])) {
      mainActivity["intent-filter"] = [];
    }

    for (const data of dataList) {
      // 冪等性: prebuildを複数回走らせても、同じホストのNDEF_DISCOVERED
      // intent-filterが既にあれば追加しない（重複させない）。ホストごとに
      // 判定するため、新しいホストを追加したときはそのホストの分だけ足される。
      if (hasNdefIntentFilterForHost(mainActivity, data.host)) {
        continue;
      }
      mainActivity["intent-filter"].push(buildNdefIntentFilter(data));
    }

    return modConfig;
  });
}

module.exports = withNfcNdefIntentFilter;
