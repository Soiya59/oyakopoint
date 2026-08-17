/**
 * CORS共通処理。
 *
 * 参照: 設計部/成果物/認証・データ管理設計書.md 3章（Edge Function設計）
 *
 * [設計判断] 4関数（invite-lookup / child-login / set-child-pin /
 * remove-member）はいずれもExpoアプリ（モバイルネイティブ）からの呼び出しが
 * メインだが、`supabase.functions.invoke()` はWeb版プレビューや開発者の
 * ブラウザからの動作確認でも使われ得るため、ブラウザ実行時のCORSプリフライト
 * (OPTIONS) に共通で対応しておく。
 *
 * Access-Control-Allow-Origin は "*" とした。理由:
 *   - これらの関数はservice_role権限で動くが、実際に返す情報・受け付ける
 *     操作は「公開されている招待コードの検索」「PINやJWTによる本人確認」
 *     「呼び出し元JWTの検証」でガードされており、CORSのOrigin制限を
 *     認可の手段として使っていない（認可はEdge Function内部のロジックで
 *     完結させる設計。認証・データ管理設計書.md 3章）。
 *   - Expoアプリ（ネイティブ）からの呼び出しはそもそもOriginヘッダーを
 *     送らないためCORSの影響を受けない。ここでのCORS設定はあくまで
 *     ブラウザ経由の開発時動作確認の補助。
 */
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** OPTIONSプリフライトリクエストであればレスポンスを返し、そうでなければnull。 */
export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
