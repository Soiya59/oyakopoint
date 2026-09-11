import { Platform } from "react-native";
import NfcManager, { Ndef, NfcError, NfcTech } from "react-native-nfc-manager";
import { WEB_APP_BASE_URL } from "./legalLinks";
import { NFC_SCAN_PATH, NFC_TAG_VALUE_PARAM, generateNfcTagToken } from "./nfc.shared";
import type { NfcReadResult, NfcWriteResult } from "./nfc.shared";

/**
 * NFCタグ書き込み・読み取りのネイティブ版実装（iOS/Android、react-native-nfc-manager）。
 *
 * [2026-09-11新設・実装メモ187章] やること.md 5-16「配布形態をどうするか」の統括決定
 * （Expoネイティブビルドで進める）を受けた「NFCの載せ替え」。`nfc.web.ts`
 * （ブラウザのWeb NFC API）と同じ4関数（`isNfcWriteSupported`・`writeNfcTag`・
 * `readNfcTag`・`generateNfcTagToken`）を、画面側（app/parent/chore-edit.tsx・
 * app/supporter/chore-edit.tsx）から見て同じ形で提供する。Metroバンドラは拡張子
 * なしのimport（`from "@/lib/nfc"`）に対し、ビルド対象プラットフォームに応じて
 * このファイルと`nfc.web.ts`を自動的に出し分ける（React Native標準の
 * プラットフォーム別拡張子の仕組み。`nfc.ts`という共通の受け皿ファイルは置いていない）。
 *
 * [ライブラリ選定理由]
 * `react-native-nfc-manager`（whitedogg13、2026-09-11時点でnpm最新3.17.2、
 * 3日前に更新＝活発にメンテナンスされている）を選んだ。理由は3点:
 * 1. Expo Config Plugin（`app.plugin.js`）を同梱しており、EAS Buildの
 *    prebuild時にAndroidの`android.permission.NFC`、iOSの
 *    `NFCReaderUsageDescription`・NFC entitlement（`com.apple.developer.nfc.
 *    readersession.formats`）を自動で設定してくれる。Expo Goでは動かない
 *    （NFCはネイティブモジュールのため）が、EAS Buildの開発ビルド／本番ビルド
 *    では動く設計であり、本プロジェクトの配布形態（TestFlight配布のEASビルド）
 *    と噛み合う。
 * 2. iOS・Android両対応。iOSはCore NFC経由でNDEFの読み取り・書き込みの両方に
 *    対応する（後述「iOSでの書き込みについて」参照）。
 * 3. NFC対応のReact Nativeライブラリとしては事実上の定番（他候補が実質存在せず、
 *    比較検討の余地がほぼ無かった）。
 *
 * [iOSでの書き込みについて・未検証]
 * iOSのCore NFCは、iOS 13以降であれば`NFCTagReaderSession`（本ライブラリが
 * 内部で使用）を通じてNDEFメッセージの書き込みに対応している（読み取り専用の
 * `NFCNDEFReaderSession`とは別の経路）。iPhone 7以降・iOS 13以降であれば
 * ハードウェア・OSとも対応しているはずだが、**実機・実ビルドでの動作確認は
 * 今回行っていない**（Apple Developer Programの登録が未完了で、実機に配信する
 * ビルドをまだ作れないため）。もし実際に書き込みができない・不安定である
 * ことが判明した場合、影響するのはタグの新規登録フロー（P11拡張モーダル・
 * `startWrite`）のみで、読み取り（`readNfcTag`）には影響しない。
 *
 * [Web版との整合性]
 * 書き込むNDEFレコードは、Web版とまったく同じ「chore報告画面へのURL
 * （URIレコード、`https://soiya59.github.io/oyakopoint/child/nfc-scan?
 * tagValue=...`）」にした。理由:
 * 1. 家族の端末がWeb版・ネイティブ版に一斉移行するとは限らない移行期間中も、
 *    どちらのアプリが書いたタグでも、ネイティブアプリを入れていない端末で
 *    タップすればブラウザが開いて読める（後方互換）。
 * 2. `nfc.shared.ts`のURLの組み立て規則を1箇所に保つ。
 * ネイティブには`window.location.origin`が無いため、`src/lib/legalLinks.ts`が
 * 既に持っている本番オリジン定数（`WEB_APP_BASE_URL`）を再利用した。
 *
 * [まだ解決していないこと・実装メモ187章に詳細]
 * OSのNFCタグディスパッチ（URLが書かれたタグをタップしてブラウザで自動的に
 * 開く仕組み）は、ネイティブアプリを自動的には起動しない（Universal Links /
 * Android App Linksの設定が別途必要で、今回のスコープ外）。そのため、
 * `readNfcTag()`をこのファイルで実装しても、`app/child/nfc-scan.tsx`が
 * 実際にこれを呼び出す改修をしない限り、ネイティブアプリで「タグをかざして
 * クイック完了」は動かない。画面側のコードを変えない方針のため、今回は
 * 呼び出し側の配線はしていない（このファイル単体の準備にとどまる）。
 */

export type { NfcWriteResult, NfcReadResult };
export { generateNfcTagToken };

/**
 * この端末でNFCタグへの書き込みが使えるか。
 *
 * [同期関数である理由・重要な制約] 呼び出し元（chore-edit.tsxの`openIssueModal`）が
 * 同期関数であり、インターフェースを変えない方針のためこの関数もPromiseを
 * 返せない。一方、react-native-nfc-manager の`NfcManager.isSupported()`は
 * ネイティブモジュールへの問い合わせが必要なため非同期（Promise）でしか
 * 取得できない。そのため、モジュール読み込み時に一度だけ非同期チェックを
 * 開始してキャッシュし、この関数は最新のキャッシュ値を同期的に返す設計に
 * した。**アプリ起動直後、まだ非同期チェックが終わる前にこの画面へ遷移した
 * 場合は、実機にNFCが無くても楽観的にtrueを返すことがある**が、その場合も
 * `writeNfcTag()`が`write_failed`で失敗を返し、既存のUI（P11拡張モーダルの
 * 「writeFailed」ステップ）がエラー表示するため、機能が壊れたまま気づかれない
 * ことはない。iOS・Android向けの実機を持つほぼすべての機種がNFC対応である
 * （2026年時点で無いのは一部の廉価端末のみ）ことも踏まえた割り切り。
 */
let nativeNfcSupportedCache = Platform.OS === "ios" || Platform.OS === "android";

if (nativeNfcSupportedCache) {
  void NfcManager.isSupported()
    .then((supported) => {
      nativeNfcSupportedCache = supported;
    })
    .catch(() => {
      nativeNfcSupportedCache = false;
    });
}

export function isNfcWriteSupported(): boolean {
  return nativeNfcSupportedCache;
}

/** 物理タグに書き込むURL。Web版のbuildWebAppUrl()と同じ形になるよう組み立てる。 */
function buildNativeTagUrl(tagValue: string): string {
  return `${WEB_APP_BASE_URL}${NFC_SCAN_PATH}?${NFC_TAG_VALUE_PARAM}=${encodeURIComponent(tagValue)}`;
}

/** 書き込んだURLから、`tagValue`クエリパラメータの値だけを取り出す。 */
function extractTagValueFromUrl(url: string): string | null {
  const pattern = new RegExp(`[?&]${NFC_TAG_VALUE_PARAM}=([^&]+)`);
  const match = url.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * 物理NFCタグへ、このchoreの報告画面を開くURLを書き込む（保護者操作、P11拡張モーダル）。
 * 呼び出し前に`isNfcWriteSupported()`で確認すること（Web版と同じ呼び出し方）。
 */
export async function writeNfcTag(tagValue: string): Promise<NfcWriteResult> {
  const url = buildNativeTagUrl(tagValue);
  try {
    await NfcManager.start();
    await NfcManager.requestTechnology(NfcTech.Ndef);
    const bytes = Ndef.encodeMessage([Ndef.uriRecord(url)]);
    if (!bytes) {
      return { ok: false, errorReason: "write_failed" };
    }
    await NfcManager.ndefHandler.writeNdefMessage(bytes);
    return { ok: true, tagValue };
  } catch (e) {
    if (e instanceof NfcError.UserCancel) {
      return { ok: false, errorReason: "cancelled" };
    }
    return { ok: false, errorReason: "write_failed" };
  } finally {
    // タグ待機セッションを必ず閉じる。失敗しても書き込み結果には影響しないため
    // ここでの例外は握りつぶす（README記載の定型パターン）。
    await NfcManager.cancelTechnologyRequest().catch(() => undefined);
  }
}

/**
 * 物理NFCタグを読み取り、書き込まれているURLから`tagValue`を取り出す。
 *
 * [未使用・実装メモ187章] Web版の同名関数と異なり例外を投げない実装にした
 * （ネイティブでは将来これが実際に呼ばれる想定のため）。ただし現時点では
 * `app/child/nfc-scan.tsx`からは呼ばれていない（ファイル冒頭の「まだ解決して
 * いないこと」参照）。**実機での読み取り動作は未検証。**
 */
export async function readNfcTag(): Promise<NfcReadResult> {
  try {
    await NfcManager.start();
    await NfcManager.requestTechnology(NfcTech.Ndef);
    const tag = await NfcManager.getTag();
    const record = tag?.ndefMessage?.[0];
    if (!record || !Ndef.isType(record, Ndef.TNF_WELL_KNOWN, Ndef.RTD_URI)) {
      return { ok: false, errorReason: "read_failed" };
    }
    const url = Ndef.uri.decodePayload(new Uint8Array(record.payload));
    const tagValue = extractTagValueFromUrl(url);
    if (!tagValue) {
      return { ok: false, errorReason: "read_failed" };
    }
    return { ok: true, tagValue };
  } catch {
    return { ok: false, errorReason: "read_failed" };
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => undefined);
  }
}
