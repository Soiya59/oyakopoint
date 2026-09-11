/**
 * NFCタグ書き込み・読み取りの型・共通定数（Web版・ネイティブ版の両方から参照）。
 *
 * [2026-09-11新設・実装メモ187章] それまで`src/lib/nfc.ts`1本にWeb NFC API
 * （`NDEFReader`）実装を直書きしていたが、Expoネイティブビルド対応のため
 * `nfc.web.ts`・`nfc.native.ts`にプラットフォームごと分割した（Metroのバンドラは
 * `<モジュール名>.web.ts`／`<モジュール名>.native.ts`の命名を、拡張子なしの
 * import（`from "@/lib/nfc"`）に対して自動的に出し分ける。tsc側は
 * tsconfig.jsonの`moduleSuffixes`で同じ規則を再現している）。
 * 型定義とトークン生成ロジックは両ファイルで完全に同一である必要があるため、
 * ここに集約してどちらからもimportする（コピーによる将来的なズレを防ぐ）。
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

/**
 * 物理タグに書き込むURLのうち、chore報告画面のパスとクエリパラメータ名。
 * Web版・ネイティブ版のどちらが書き込んでも同じURL形状になるようにするため
 * 定数化した（`app/child/nfc-scan.tsx`が読むクエリパラメータ名と一致させること）。
 */
export const NFC_SCAN_PATH = "/child/nfc-scan";
export const NFC_TAG_VALUE_PARAM = "tagValue";

/**
 * 新しいトークンを生成する。
 * API仕様.md 3a章手順1「クライアント側で暗号論的に安全なランダムトークンを生成」に対応。
 *
 * [注意] `Math.random()`は暗号論的に安全な乱数源ではない。この点は2026-08-18の
 * 元実装からの既存の制約であり、今回の分割で新たに持ち込んだものではない
 * （挙動を変えない方針のため、今回は踏み込んで直していない）。
 */
export function generateNfcTagToken(): string {
  const hex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-${hex().slice(0, 4)}-${hex()}${hex().slice(0, 4)}`;
}
