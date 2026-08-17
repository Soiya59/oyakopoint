/**
 * Supabaseクライアントのセットアップ。
 *
 * 設計参照:
 * - 設計部/成果物/認証・データ管理設計書.md 1章・6章
 *   「service_role keyはクライアントに一切埋め込まない」方針に従い、
 *   ここで扱うのは anon key のみ。
 * - 設計部/成果物/API仕様.md
 *   PostgREST（supabase.from）/ RPC（supabase.rpc）/ Edge Function
 *   （supabase.functions.invoke）の3種の呼び出しをこのクライアント経由で行う。
 *
 * URL/anon keyは環境変数（EXPO_PUBLIC_ プレフィックス = Expoがビルド時に
 * クライアントバンドルへ埋め込む公開変数）から読み込む。
 * 値は .env（gitignore対象）に置き、.env.example にダミー値のみを残す。
 *
 * [2026-08-15追記] 実際のSupabaseプロジェクト（oyakopoint, project ref:
 * pnznewjkaiwlqmddszpl）に接続済み。.env には実際のURL・anon（publishable）keyが
 * 設定されている（開発部/成果物/実装メモ.md 13章・15章参照）。
 * isSupabaseConfigured() が false の環境（.env未設定・レビュー環境等）向けに、
 * 画面は引き続き src/data/store.tsx のモックデータ層にフォールバックできる構成を
 * 維持している。
 */
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

const DUMMY_URL_MARKERS = ["your-project-ref", ""];

/**
 * .env がダミー値のまま（＝実プロジェクト未接続）かどうかを判定する。
 * 未接続の間はUI層がこのフラグを見てモックデータ経路にフォールバックする。
 */
export function isSupabaseConfigured(): boolean {
  if (!supabaseUrl || !supabaseAnonKey) return false;
  return !DUMMY_URL_MARKERS.some((marker) => marker && supabaseUrl.includes(marker));
}

// createClientはURLが空文字だと例外を投げるため、未設定時のみ最小限のダミーURLを渡す。
// isSupabaseConfigured() が false の間、このクライアントで実際にAPIを呼ぶコードは
// 実行しない（呼び出し側は必ずモックデータ層 src/data を使う）。
export const supabase = createClient(
  isSupabaseConfigured() ? supabaseUrl : "https://placeholder.supabase.co",
  isSupabaseConfigured() ? supabaseAnonKey : "placeholder-anon-key",
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
