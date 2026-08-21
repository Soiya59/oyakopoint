/**
 * Edge Function実行環境の環境変数アクセサ。
 *
 * 遵守事項（開発部/CLAUDE.md・本タスク指示）: service_role キー・
 * JWTシークレットをコードにハードコードしない。値は必ず
 * `Deno.env.get()` 経由で実行時に読み込む。
 *
 * [運用メモ] Supabase公式ドキュメント（Edge Functions > Secrets）によれば、
 * 以下の環境変数はEdge Functionの実行環境にプラットフォームが自動的に
 * デフォルトのsecretsとして注入する（ユーザーが`supabase secrets set`で
 * 明示的に設定しなくても既定で利用できる）:
 *   - SUPABASE_URL
 *   - SUPABASE_ANON_KEY
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - SUPABASE_DB_URL
 * 一方、JWT署名用シークレット（Supabaseダッシュボード JWT Keys >
 * Legacy JWT Secret の値）は自動注入の対象ではなく、明示的な登録が必要
 * （認証・データ管理設計書.md 2章「署名鍵の扱い」・3章冒頭）。
 *
 * [2026-08-15訂正] 当初は環境変数名を`SUPABASE_JWT_SECRET`とする想定だったが、
 * Supabaseダッシュボードの「Edge Function Secrets」画面で実際に登録しようと
 * したところ「Name must not start with the SUPABASE_ prefix」という制約に
 * より拒否されることが判明した（`SUPABASE_`始まりの名前はプラットフォーム
 * 予約のため、カスタムsecretsとして使えない）。そのため環境変数名を
 * `APP_JWT_SECRET`に変更した。値の中身・扱い（機密情報・Edge Function
 * 環境変数としてのみ保持・クライアントに一切含めない）は設計書の記載から
 * 変わらない。`supabase secrets set APP_JWT_SECRET=...`、またはダッシュボード
 * のEdge Function Secrets画面でName欄に`APP_JWT_SECRET`と入力して登録する。
 */
function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません`);
  }
  return value;
}

export const env = {
  get supabaseUrl(): string {
    return requireEnv("SUPABASE_URL");
  },
  get serviceRoleKey(): string {
    return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  },
  /** 保護者のSupabase Auth標準JWT（現在のJWT署名鍵で署名）を検証する用途専用。 */
  get jwtSecret(): string {
    return requireEnv("APP_JWT_SECRET");
  },
  /**
   * [2026-08-20追加・本部長] 子ども用カスタムJWTの署名専用シークレット。
   *
   * 実機で「写真を添付しても完了報告に反映されない」不具合を調査したところ、
   * Supabase Storageへのアップロードが（画面上はエラー表示無しで）静かに失敗して
   * いることが判明した。直接APIを叩いて検証した結果、child-loginが発行する
   * JWT（APP_JWT_SECRET、＝26章で作成した現在のJWT署名鍵と同じ値で署名）は
   * PostgRESTの検証は通るが、**Storageは別の鍵（Legacy JWT Secret）でしか
   * 検証しない**ことが分かった（PostgRESTとStorageで検証に使う鍵が食い違っている、
   * Supabase側の既知の制約と考えられる）。
   *
   * JWT Signing Keysのダッシュボード操作は26章で大きなトラブルの原因になった
   * 経緯があり（「今後不用意に行わないこと」と申し送り済み）、再度キーローテー
   * ションを行う対応は避けた。代わりに、子ども用JWTの**署名にのみ**Legacy JWT
   * Secretの値を使う専用シークレットを新設し、影響範囲を子どもの認証経路だけに
   * 限定した。APP_JWT_SECRET（保護者トークンの検証用）は変更していない。
   */
  get childJwtSigningSecret(): string {
    return requireEnv("CHILD_JWT_SIGNING_SECRET");
  },
};
