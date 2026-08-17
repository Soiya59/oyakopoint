import { Platform } from "react-native";
import { buildWebAppUrl } from "./authRedirect";

/**
 * NFCタグ書き込み・読み取りのインターフェース定義。
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
 * app/parent/chore-edit.tsxで`isWebNfcSupported()`を見て導線自体を出し分ける）。
 */

export interface NfcWriteResult {
  ok: boolean;
  tagValue?: string;
  errorReason?: "write_failed" | "unsupported_tag_type" | "cancelled";
}

export interface NfcReadResult {
  ok: boolean;
  tagValue?: string;
  errorReason?: "read_failed";
}

/** この端末・ブラウザでWeb NFC APIによる書き込みが使えるか。 */
export function isWebNfcSupported(): boolean {
  return Platform.OS === "web" && typeof window !== "undefined" && "NDEFReader" in window;
}

/**
 * 新しいトークンを生成する。
 * API仕様.md 3a章手順1「クライアント側で暗号論的に安全なランダムトークンを生成」に対応。
 */
export function generateNfcTagToken(): string {
  const hex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-${hex().slice(0, 4)}-${hex()}${hex().slice(0, 4)}`;
}

/**
 * 物理NFCタグへ、このchoreの報告画面を開くURLを書き込む（保護者操作、P11拡張モーダル）。
 * Web NFC API非対応の端末（iOS・PC・LAN内http配信）では書き込めないため、
 * 呼び出し前に`isWebNfcSupported()`で確認すること。
 */
export async function writeNfcTag(tagValue: string): Promise<NfcWriteResult> {
  if (!isWebNfcSupported()) {
    return { ok: false, errorReason: "unsupported_tag_type" };
  }
  try {
    const url = buildWebAppUrl("/child/nfc-scan", { tagValue });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ndef = new (window as any).NDEFReader();
    await ndef.write({ records: [{ recordType: "url", data: url }] });
    return { ok: true, tagValue };
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
