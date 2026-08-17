/**
 * service_role clientの初期化。
 *
 * 参照: 設計部/成果物/認証・データ管理設計書.md 6章「service_role キーを
 * 使う操作（一覧・まとめ）」— invite-lookup / child-login / set-child-pin /
 * remove-member の4関数すべてがこのクライアントを使う。
 *
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は _shared/env.ts 経由で環境変数
 * からのみ読み込み、コードにハードコードしない。
 *
 * [ライブラリ] @supabase/supabase-js を Deno の npm: specifier 経由で
 * importする。バージョンはExpoアプリ本体（oyakopoint-app/package.json）が
 * 使用している ^2.112.3 に固定し、クライアント側・Edge Function側で
 * 挙動差異が出ないようにした。
 *
 * auth.autoRefreshToken / persistSession は false にする。Edge Function は
 * リクエストの都度使い捨てで実行され、ブラウザ的なセッション永続化は
 * 不要かつ実行環境（Deno Deploy的サンドボックス）にlocalStorage相当が
 * 無いため無効化しないとエラーになりうる（supabase-jsのデフォルト挙動
 * 回避のための定石設定）。
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import { env } from "./env.ts";

export function createAdminClient(): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
