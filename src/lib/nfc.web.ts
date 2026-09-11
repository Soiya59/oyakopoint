import { Platform } from "react-native";
import { buildWebAppUrl } from "./authRedirect";
import { NFC_SCAN_PATH, NFC_TAG_VALUE_PARAM, generateNfcTagToken } from "./nfc.shared";
import type { NfcReadResult, NfcWriteResult } from "./nfc.shared";

/**
 * NFCタグ書き込み・読み取りのWeb版実装（ブラウザのWeb NFC API、`NDEFReader`）。
 *
 * 参照:
 * - 設計部/成果物/API仕様.md 3a章「NFCタグ登録（保護者操作、P11拡張モーダル）」
 * - 設計部/成果物/API仕様.md 4a章「NFCタグでのクイック完了（子どもがタグを読み取って実行報告、C13→C14）」
 * - 企画部/成果物/要件定義書.md 07-2章「技術的な制約（開発部への申し送り事項）」
 *
 * [2026-08-18実装・本部長] 当初はネイティブアプリ化（react-native-nfc-manager +
 * EAS Build）を前提にモック実装のみとしていたが（実装メモ.md 9章）、その後の方針転換で
 * 本アプリはWeb版（GitHub Pages / LAN内配信）での運用に切り替わった（実装メモ.md 29〜33章）。
 * ネイティブアプリ化を前提にせず、ブラウザの **Web NFC API**（`NDEFReader`、Android Chrome限定・
 * HTTPS必須）で物理タグに書き込めるようにした。
 *
 * 書き込む内容も方針転換した。当初は「トークン文字列（テキストレコード）」を書き込み、
 * 読み取り側もネイティブNFCライブラリでの読み取りを前提にしていたが、Web版では
 * 「chore報告画面へのURL（URIレコード）」を書き込む方式に変更した。この方式だと、
 * **子ども側の読み取りにはWeb NFC API自体が不要**になる（Android OS標準のNFCタグ
 * ディスパッチ機能が、URLが書き込まれたタグをタップした際に自動的にそのURLを
 * ブラウザで開いてくれるため）。書き込み（NDEFReader.write）はAndroid Chromeが必要だが、
 * 読み取り（子どもがタグにスマホをかざす）はどの機種でも動く。
 *
 * [対応不可な環境] Web NFC APIはiOS Safari・PC・LAN内配信（httpの非セキュアコンテキスト）
 * では使えない。この場合は`writeNfcTag()`が`errorReason: "unsupported_tag_type"`相当の
 * 失敗を返す代わりに、P11拡張モーダル側で非対応である旨を案内する（呼び出し元
 * app/parent/chore-edit.tsxで`isNfcWriteSupported()`を見て導線自体を出し分ける）。
 *
 * [2026-09-11改訂・実装メモ187章] Expoネイティブビルド対応のため、このファイルを
 * `src/lib/nfc.ts`から`nfc.web.ts`へ改名し、ネイティブ実装（`nfc.native.ts`、
 * react-native-nfc-manager使用）を追加した。**このファイルの中身・挙動は
 * 「関数名`isWebNfcSupported`→`isNfcWriteSupported`への改名」「型定義と
 * `generateNfcTagToken()`を`nfc.shared.ts`へ切り出し」以外は一切変更していない**
 * （Web版が本番稼働中で触ってはいけないため）。
 */

export type { NfcWriteResult, NfcReadResult };
export { generateNfcTagToken };

/**
 * この端末・ブラウザでNFCタグへの書き込みが使えるか。
 *
 * [2026-09-11改名・実装メモ187章] 旧名`isWebNfcSupported`。ネイティブ版
 * （`nfc.native.ts`）にも同名の関数ができ、`isWebNfcSupported`という名前が
 * 「Web限定」を想起させ実態と合わなくなるため、呼び出し元
 * （app/parent/chore-edit.tsx・app/supporter/chore-edit.tsx）とあわせて改名した。
 * この関数自体の判定ロジック（`Platform.OS === "web"`かつ`NDEFReader`の有無）は
 * 変更していない。
 */
export function isNfcWriteSupported(): boolean {
  return Platform.OS === "web" && typeof window !== "undefined" && "NDEFReader" in window;
}

/**
 * 物理NFCタグへ、このchoreの報告画面を開くURLを書き込む（保護者操作、P11拡張モーダル）。
 * Web NFC API非対応の端末（iOS・PC・LAN内http配信）では書き込めないため、
 * 呼び出し前に`isNfcWriteSupported()`で確認すること。
 */
export async function writeNfcTag(tagValue: string): Promise<NfcWriteResult> {
  if (!isNfcWriteSupported()) {
    return { ok: false, errorReason: "unsupported_tag_type" };
  }
  try {
    const url = buildWebAppUrl(NFC_SCAN_PATH, { [NFC_TAG_VALUE_PARAM]: tagValue });
    // NDEFReaderはWeb NFC APIの型定義が標準のlibに無いためanyで受ける。
    // [2026-09-09] 元は@typescript-eslint/no-explicit-anyのdisableコメントだったが、
    // 本プロジェクトのESLintはフックの規則2つに絞っており同ルールを読み込まないため、
    // 「定義の無いルールへのdisable」としてエラーになる。理由を残す普通のコメントにした。
    const ndef = new (window as any).NDEFReader();
    await ndef.write({ records: [{ recordType: "url", data: url }] });
    return { ok: true, tagValue };
  } catch (e) {
    // catchのeはunknownのためanyで受けてnameを読む（上と同じ理由でdisableコメントは外した）。
    const name = (e as any)?.name;
    if (name === "NotAllowedError" || name === "AbortError") {
      return { ok: false, errorReason: "cancelled" };
    }
    return { ok: false, errorReason: "write_failed" };
  }
}

/**
 * 物理NFCタグを読み取る。
 *
 * [未使用] 子ども側の読み取りはAndroid OS標準のNFCタグディスパッチ（URIレコードを
 * タップした際にブラウザでそのURLを自動的に開く機能）に任せているため、アプリ側で
 * 明示的にこの関数を呼ぶ必要が無い（app/child/nfc-scan.tsx はURLの`tagValue`
 * クエリパラメータをそのまま使う）。検証用（本物のタグが無い場合）の
 * 「NFCタグを読み取る（シミュレート）」導線も同様にnavigationパラメータで代用する
 * （src/data/store.tsx の findChoreByTag 参照）。
 */
export async function readNfcTag(): Promise<NfcReadResult> {
  throw new Error(
    "readNfcTag は使用しません。子ども側の読み取りはAndroid OS標準のNFCタグディスパッチ（URL自動起動）に委ねています。"
  );
}
