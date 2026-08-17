/**
 * JSONレスポンス生成の共通ヘルパー。
 * すべてのEdge FunctionレスポンスにCORSヘッダー（_shared/cors.ts）を付与する。
 */
import { corsHeaders } from "./cors.ts";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
