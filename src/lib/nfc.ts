/**
 * NFCタグ書き込み・読み取りのインターフェース定義。
 *
 * 参照:
 * - 設計部/成果物/API仕様.md 3a章「NFCタグ登録（保護者操作、P11拡張モーダル）」
 * - 設計部/成果物/API仕様.md 4a章「NFCタグでのクイック完了（子どもがタグを読み取って実行報告、C13→C14）」
 * - 企画部/成果物/要件定義書.md 07-2章「技術的な制約（開発部への申し送り事項）」
 *
 * [重要・環境制約] この開発環境には実機のNFCハードウェアが無く、NFC読み取り自体を
 * 動作確認することはできない（実装メモ.md 9章参照）。またNFC読み取り/書き込みには
 * `react-native-nfc-manager` 等の追加ネイティブモジュールとEAS Buildによる
 * カスタムビルド（Expo Goでは動作しない）が必要になる見込みであることが
 * 要件定義書07-2章で申し送りされている。
 *
 * そのため本ファイルは、
 *   (a) 実際にNFCライブラリを使う場合と同じ関数シグネチャ・返り値の形（API仕様.md
 *       3a章・4a章の手順に対応）だけを定義し、
 *   (b) 中身は実機なしで検証できる「常に成功を返すモック実装」にとどめる。
 * 呼び出し側（P11拡張モーダル、C13画面）はこのインターフェースだけに依存させ、
 * 将来react-native-nfc-manager等の実装に差し替える際にUI側のコード変更を
 * 最小限にする狙い。
 *
 * 実機実装イメージ（未実装・コメントのみ）:
 *   import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager';
 *   await NfcManager.requestTechnology(NfcTech.Ndef);
 *   const bytes = Ndef.encodeMessage([Ndef.textRecord(tagValue)]);
 *   await NfcManager.ndefHandler.writeNdefMessage(bytes);
 *   await NfcManager.cancelTechnologyRequest();
 */

export interface NfcWriteResult {
  ok: boolean;
  tagValue?: string;
  errorReason?: "write_failed" | "unsupported_tag_type";
}

export interface NfcReadResult {
  ok: boolean;
  tagValue?: string;
  errorReason?: "read_failed";
}

/**
 * 新しいトークンを生成する。
 * API仕様.md 3a章手順1「クライアント側で暗号論的に安全なランダムトークンを生成
 * （例: Expoなら expo-crypto の Crypto.randomUUID()）」に対応。
 * 実機のCrypto.randomUUID()相当のインターフェースを保ちつつ、
 * 本アプリはexpo-cryptoに依存しない環境でも動く簡易UUID風文字列を返す。
 */
export function generateNfcTagToken(): string {
  const hex = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-${hex().slice(0, 4)}-${hex()}${hex().slice(0, 4)}`;
}

/**
 * 物理NFCタグへトークンを書き込む（保護者操作、P11拡張モーダル）。
 * API仕様.md 3a章手順2「react-native-nfc-manager等でトークンをNDEFレコードとして
 * 物理タグへ書き込む」に対応するインターフェース。
 *
 * [モック実装] 実機NFCハードウェアが無いため、実際の書き込みは行わず、
 * 短い遅延の後に常に成功を返す。書き込み失敗状態（ワイヤーフレーム7.1「書き込み失敗」）
 * はP11側のUIで別途、検証用に強制トグルできるようにしている。
 */
export async function writeNfcTag(tagValue: string): Promise<NfcWriteResult> {
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { ok: true, tagValue };
}

/**
 * 物理NFCタグを読み取り、書き込まれているトークンを取得する（子ども操作、C13）。
 * API仕様.md 4a章手順1「react-native-nfc-manager等でNDEFレコードを読み取り、
 * 3aで書き込んだトークン文字列（tagValue）を得る」に対応するインターフェース。
 *
 * [未実装・実機ハードウェア無し] この関数は呼び出し側（C13画面）からは使用しない。
 * 実機のNFCタップを再現できないため、検証用の「NFCタグを読み取る（シミュレート）」
 * 導線ではtagValueをnavigationパラメータとして直接渡す方式にしている
 * （src/data/store.tsx の findChoreByTag、app/child/nfc-scan.tsx 参照）。
 * 実機対応時はこの関数の中身をreact-native-nfc-manager呼び出しに置き換え、
 * C13画面からこの関数を呼ぶ形に変更する想定。
 */
export async function readNfcTag(): Promise<NfcReadResult> {
  throw new Error(
    "readNfcTag は実機NFCハードウェアが無い検証環境のため未実装です。C13画面の検証用シミュレーション導線（tagValueパラメータ）を使用してください。"
  );
}
