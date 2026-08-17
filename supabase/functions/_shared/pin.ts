/**
 * 子どもPINのハッシュ化・照合・バリデーション。
 *
 * 参照: 設計部/成果物/認証・データ管理設計書.md 3.2章（child-login）・
 * 3.3章（set-child-pin）、スキーマ設計.sql 2b章（family_member_pins）。
 *
 * [ライブラリ選定] npm:bcryptjs（Denoのnpm: specifier経由）を採用する。
 *
 * 検討した選択肢:
 *   1. https://deno.land/x/bcrypt
 *      - README（`https://deno.land/x/bcrypt`、WebFetchで実際に内容を確認）
 *        によれば、非同期版は内部でWeb Workerを使い、かつそのWorkerが
 *        Deno標準モジュールをimportするために`--allow-net`権限を要求する。
 *        Supabase Edge RuntimeはDeno実行フラグを利用者が制御できない
 *        サンドボックスのため、この権限要求が満たせず動作しないリスクが
 *        ある。
 *      - 同期版（hashSync/compareSync）はブロッキングであり、README上も
 *        「BCryptアルゴリズムは計算コストが高いため、サーバーで複数リクエスト
 *        を処理する用途には推奨しない（他のリクエストがブロックされる）」
 *        と明記されている。
 *      - さらにdeno.land/xはDeno公式が新規パッケージの登録を停止し
 *        jsr.io等への移行を案内している状態のレジストリであり、新規実装
 *        での採用を避けた。
 *   2. npm:bcryptjs（採用）
 *      - Native bindingにもWASM Workerにも依存しない純粋なJS実装のため、
 *        Supabase Edge Runtimeの制約（Worker/ファイルシステムアクセス等が
 *        制限された環境）の影響を受けにくい。
 *      - Denoのnpm互換レイヤー（`npm:`specifier）は公式にサポートされて
 *        おり、Supabase Edge Functionsのドキュメントでもnpmパッケージの
 *        利用例として案内されている。
 *      - npm registryで確認した最新バージョンは3.0.3（2026-08-13時点、
 *        `https://registry.npmjs.org/bcryptjs/latest` で確認。Deno/CLI無しの
 *        ため実際にインポートして動かす検証はできていない＝未検証）。
 *      - トレードオフ: 純JS実装のためRustのWASM実装より低速。ただしPIN
 *        照合は「子どもがプロフィールを選んでPINを入力する」都度の低頻度
 *        操作であり、体感速度への影響は許容範囲と判断した。
 */
import bcrypt from "npm:bcryptjs@3.0.3";

// bcryptjsのデフォルトと同程度のコスト値。PIN自体は4桁(1万通り)しかなく
// 総当たり耐性が低いため、防御の主眼はコスト値ではなく
// failed_attempts/locked_untilによるレート制限側に置く設計
// （スキーマ設計.sql 2b章のコメント参照）。
const BCRYPT_COST_FACTOR = 10;

export async function hashPin(pin: string): Promise<string> {
  return await bcrypt.hash(pin, BCRYPT_COST_FACTOR);
}

export async function comparePin(pin: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(pin, hash);
}

/** 認証・データ管理設計書.md 3.3章「new_pinが4桁数字であることをバリデーション」 */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}
