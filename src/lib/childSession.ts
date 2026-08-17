/**
 * 子どものカスタムJWTセッション管理。
 *
 * 参照:
 * - 設計部/成果物/認証・データ管理設計書.md 2章「子ども（Edge Function `child-login` が発行）」
 *   「クライアント（Expo）は access_token をExpo SecureStoreに保存し、Supabase JSクライアントの
 *    setSession相当（またはPostgREST呼び出し時の Authorization: Bearer ヘッダー）に使う」
 * - 設計部/成果物/API仕様.md 2c章手順3「トークンをSecureStoreへ保存し以後のリクエストに使用」
 *
 * [設計判断] 子どものカスタムJWTは auth.users に対応行を持たない特殊なトークンのため、
 * 標準の `supabase.auth.setSession()`（refresh_token等を要求する）には乗せられない。
 * そのため、子ども専用のSupabaseクライアントインスタンスを
 * `global.headers.Authorization: Bearer <token>` 付きで生成し、
 * PostgRESTへのリクエストにこのヘッダーを直接使わせる方式にした。
 * このクライアントは supabase.auth（Supabase Authセッション）を一切使わない
 * （persistSession/autoRefreshTokenをfalseにし、保護者の通常ログインと状態が混ざらないようにする）。
 *
 * [2026-08-15修正・本部長] expo-secure-storeはWeb（react-native-web）を公式にサポートしておらず、
 * `npx expo start --web`環境でSecureStore.getItemAsync()を呼ぶと
 * 「ExpoSecureStore.default.getValueWithKeyAsync is not a function」が発生し、
 * SessionProviderのマウント時処理が例外で中断していた（トップ画面のボタンをタップしても
 * 画面遷移しなくなる、実際にブラウザで操作して発見した不具合）。ネイティブ実機では
 * SecureStoreの暗号化ストレージを使い、Web検証環境ではAsyncStorage（他の箇所でも
 * 使用中）にフォールバックするよう分岐した。
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SECURE_STORE_KEY = "oyakopoint.child_session.v1";

const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    return Platform.OS === "web" ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      await AsyncStorage.setItem(key, value);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      await AsyncStorage.removeItem(key);
    } else {
      await SecureStore.deleteItemAsync(key);
    }
  },
};

export interface ChildSessionMember {
  member_id: string;
  display_name: string;
  family_id: string;
}

export interface ChildSessionInfo {
  accessToken: string;
  /** child-loginレスポンスの expires_at（UNIX秒） */
  expiresAt: number;
  member: ChildSessionMember;
  /** 認証・データ管理設計書.md 2c章の再ログイン・プロフィール切替(C12)で
   *  招待コード再入力を省くために保持する（招待コード自体は秘密情報ではない）。 */
  inviteCode: string;
}

/** SecureStore（Webの場合はAsyncStorage）に子どもセッションを保存する。 */
export async function saveChildSession(info: ChildSessionInfo): Promise<void> {
  await secureStorage.setItem(SECURE_STORE_KEY, JSON.stringify(info));
}

/**
 * SecureStoreから子どもセッションを読み込む。
 * 期限切れ（expires_at <= 現在時刻）の場合は自動的に破棄しnullを返す
 * （認証・データ管理設計書.md 2章「期限切れ時はSecureStoreのトークンでの自動ログインが失敗し、
 *  PIN再入力を促す」）。
 */
export async function loadChildSession(): Promise<ChildSessionInfo | null> {
  const raw = await secureStorage.getItem(SECURE_STORE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ChildSessionInfo;
    if (!parsed.accessToken || !parsed.expiresAt || !parsed.member) {
      await clearChildSession();
      return null;
    }
    if (parsed.expiresAt * 1000 <= Date.now()) {
      await clearChildSession();
      return null;
    }
    return parsed;
  } catch {
    await clearChildSession();
    return null;
  }
}

export async function clearChildSession(): Promise<void> {
  await secureStorage.removeItem(SECURE_STORE_KEY);
}

/**
 * 子どものカスタムJWTをAuthorizationヘッダーに固定したSupabaseクライアントを作る。
 * anon key はPostgRESTの `apikey` ヘッダーとして必要なため引き続き使用する
 * （service_role等の秘密情報は一切扱わない）。
 */
export function createChildDataClient(supabaseUrl: string, supabaseAnonKey: string, accessToken: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
