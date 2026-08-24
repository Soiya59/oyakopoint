/**
 * カスタムJWTの署名・検証。
 *
 * 参照: 設計部/成果物/認証・データ管理設計書.md 2章「JWTクレーム設計」
 *
 * [ライブラリ選定] djwt（https://deno.land/x/djwt、最新版 v3.0.2を
 * `https://deno.land/x/djwt@$VERSION/mod.ts` の形で確認。2026-08-13時点。
 * Deno/CLI無しのため実際にインポートして動かす検証はできていない＝未検証）
 * を採用する。
 *   - Deno向けJWT実装の事実上の標準で、HS256を含むJOSE標準アルゴリズムを
 *     幅広くサポートする。
 *   - Web Crypto API（`crypto.subtle`）をそのまま利用する設計のため、
 *     bcryptライブラリ選定（_shared/pin.ts）で確認したWorker関連の制約と
 *     同様の理由で、追加APIに依存せずSupabase Edge Runtimeでも動作する
 *     見込みが高いと判断した。
 *   - 保護者側のSupabase Auth標準JWTも子ども用カスタムJWTも同じHS256+
 *     同一シークレット（環境変数名は`APP_JWT_SECRET`。2026-08-15改名、
 *     旧`SUPABASE_JWT_SECRET`。Supabaseダッシュボードの「SUPABASE_」始まりの
 *     Edge Function secrets名を予約する仕様により変更。_shared/env.ts参照）
 *     で署名されている（認証・データ管理設計書.md 2章）ため、
 *     発行(create)・検証(verify)の両方をdjwt 1本で賄える。
 */
import {
  create,
  verify,
  type Payload,
} from "https://deno.land/x/djwt@v3.0.2/mod.ts";

// HMACキーはリクエストの都度importKeyし直すとオーバーヘッドがあるため、
// 同一シークレット文字列である間はモジュールスコープでキャッシュする
// （Edge Functionのインスタンスはリクエスト間で再利用され得るため有効）。
let cachedKey: CryptoKey | null = null;
let cachedSecret: string | null = null;

async function getHmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedSecret === secret) return cachedKey;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  cachedKey = key;
  cachedSecret = secret;
  return key;
}

// [2026-08-24変更] 従来は12時間（共有タブレットを想定した短め設定）だったが、
// 「毎回ログインが面倒」との利用実態のフィードバックを受けて1週間に延長した。
// 延長にあたり、退会(remove-member soft_remove)後もトークンが生きている間は
// is_activeチェックを経由せずアクセスできてしまう問題（本部長の粗探しで発見）を
// 同時に修正済み（current_family_id()等がfamily_member_idクレームがあっても
// 都度is_activeを確認するようになった。スキーマ設計.sql 32章）。そのため
// TTLを延ばしても、退会は既発行トークンに即座に反映される。
const CHILD_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface ChildTokenClaims {
  familyId: string;
  familyMemberId: string;
  displayName: string;
}

export interface SignedChildToken {
  token: string;
  expiresAt: number; // UNIX秒（exp）
}

/**
 * 子ども用カスタムJWTを発行する（child-loginから呼ばれる）。
 * クレーム構造は認証・データ管理設計書.md 2章「子ども（Edge Function
 * child-loginが発行）」の例に厳密に従う。
 */
export async function signChildToken(
  secret: string,
  claims: ChildTokenClaims
): Promise<SignedChildToken> {
  const key = await getHmacKey(secret);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = nowSeconds + CHILD_TOKEN_TTL_SECONDS;

  const payload: Payload = {
    aud: "authenticated",
    role: "authenticated", // 予約クレーム。PostgRESTが実行するPostgresロールを決定する
    sub: claims.familyMemberId, // auth.usersに対応行が無いためfamily_members.idをそのまま使う（2章）
    family_id: claims.familyId,
    family_member_id: claims.familyMemberId,
    app_role: "child",
    display_name: claims.displayName,
    iss: "oyakopoint-edge",
    iat: nowSeconds,
    exp,
  };

  const token = await create({ alg: "HS256", typ: "JWT" }, payload, key);
  return { token, expiresAt: exp };
}

export interface VerifiedCallerClaims {
  sub: string;
  appRole?: string;
  raw: Payload;
}

/**
 * 呼び出し元が送ってきたJWT（set-child-pin/remove-memberでは保護者の
 * Supabase Auth標準JWTを想定）を検証し、subクレーム等を取り出す。
 * 標準のSupabase AuthトークンにはfamilyIdなどのカスタムクレームが無いため
 * （2章「保護者（Supabase Auth標準発行）」の例を参照）、ここではsub
 * （auth.users.id）の取り出しのみを行い、実際のfamily_id/role解決は
 * 呼び出し元がservice_role clientでfamily_membersを引いて行う
 * （_shared/parentAuth.ts参照）。
 */
export async function verifyToken(
  secret: string,
  token: string
): Promise<VerifiedCallerClaims> {
  const key = await getHmacKey(secret);
  const payload = await verify(token, key);

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("JWTにsubクレームがありません");
  }

  const appRole = (payload as Record<string, unknown>)["app_role"];

  return {
    sub: payload.sub,
    appRole: typeof appRole === "string" ? appRole : undefined,
    raw: payload,
  };
}
