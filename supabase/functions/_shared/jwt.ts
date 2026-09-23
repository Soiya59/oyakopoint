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
 *
 * [2026-09-23追加・やること4-73対応] `verifyToken()`はHS256（共有シークレット）
 * でしか検証できず、SupabaseがJWTの署名鍵を非対称鍵（ES256等）へ切り替えた
 * 瞬間に全滅する問題への対処。**HS256と非対称鍵の両方を受け付けるよう変更**。
 *
 * [方式の選定・理由] JWTヘッダーの`alg`を見て分岐する点は「候補(a)」だが、
 * 非対称鍵側の実装は自前でJWKS取得・JWKパース・crypto.subtle検証を書かず、
 * 既に依存している`@supabase/supabase-js@2.112.3`（`supabaseAdmin.ts`と
 * バージョンを揃えている）の`auth.getClaims()`に委譲する（「候補(b)」の
 * 実装を借りる）。理由は実際に`node_modules/@supabase/auth-js/dist/module/
 * GoTrueClient.js`のソースを読んで確認した下記の事実による:
 *   - `getClaims(jwt)`は`alg`が`HS`で始まる・`kid`が無い・WebCrypto利用不可の
 *     いずれかなら`getUser(jwt)`（Auth serverへの都度リクエスト）にフォール
 *     バックし、そうでなければ`/.well-known/jwks.json`から鍵を取得して
 *     （インスタンス内に10分＝`JWKS_TTL`でキャッシュ）`crypto.subtle`で
 *     ローカル検証する（同ファイル5221〜5387行）。
 *   - `getAlgorithm()`は`RS256`/`ES256`のみ対応し、それ以外（`none`含む）は
 *     例外を投げる（同ファイル`lib/helpers.js`427〜443行）ため、想定外の
 *     `alg`を鍵とみなして通すことはない。
 *   - `validateExp()`は`exp`欠落・期限切れをいずれも例外にする
 *     （同ファイル`lib/helpers.js`418〜426行）。
 * これを自前実装しない理由（却下した案）: 上記を手書きすると、JWK→
 * CryptoKey変換のアルゴリズム指定間違い等、暗号コードの車輪の再発明に
 * なりリスクが高い。一方、**非対称鍵の検証を丸ごと`getClaims()`任せに
 * せず、HS256は今までどおり`djwt`でローカル検証する**（＝alg分岐は自前で
 * 行う）理由: `getClaims()`は`alg`が`HS`始まりだと問答無用で`getUser()`の
 * ネットワーク呼び出しにフォールバックする（前述の分岐）。今の本番は
 * HS256のみのため、全部`getClaims()`に委ねると**今は不要な通信が全リクエスト
 * で毎回発生し**、レイテンシと可用性（Auth serverが落ちていると道連れで
 * 401になる）を今より悪化させる。alg分岐を自前で行い、HS256は現状の
 * ローカル検証のまま変更しないことで、本番の挙動を変えずに非対称鍵だけ
 * 新しい経路に乗せる。
 * [鍵のキャッシュについて] `getClaims()`のJWKSキャッシュはSupabaseClient
 * インスタンスのプロパティ（`this.jwks`）なので、リクエストの都度
 * `createClient()`し直すと毎回キャッシュが失われる。本ファイルはこの
 * ためだけの検証用クライアントを**モジュールスコープに1個だけ生成して
 * 使い回す**（HMACキーの`cachedKey`と同じ考え方。Edge Functionのインスタンス
 * はリクエスト間で再利用され得るため、ウォームなインスタンスではJWKSの
 * 再取得が省略される）。
 * [安全性] HS256側は変更なし。非対称鍵側は、Supabaseが公開する本物のJWKS
 * （kid一致）で検証できた場合のみローカルで信頼し、それ以外（kid不一致・
 * 想定外alg・WebCrypto不可など）は必ずSupabase Auth server本体への
 * `getUser()`照会に回るため、攻撃者が用意した鍵を信頼する経路は無い。
 * `verifyToken()`の外部シグネチャ（引数・戻り値）は変更しないため、
 * 呼び出し元（delete-account/index.ts、_shared/parentAuth.ts）は無改修。
 */
import {
  create,
  decode,
  verify,
  type Header,
  type Payload,
} from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.112.3";
import { env } from "./env.ts";

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
// [2026-09-05変更・統括指示] 1週間から1か月へ延長する。統括「1週間から1カ月に
// 延ばしたい」。上の2026-08-24の判断（退会が既発行トークンに即座に反映される
// ようになっているため延長しても安全）はそのまま当てはまる。
// なお保護者・みまもりメンバーは Supabase Auth 側の管理で、refresh token に
// 期限が無く（config.toml の [auth.sessions] は無効のまま）実質無期限のため、
// 今回は変更していない。統括の確認を経て「そのまま」で決着（本部長が確認）。
const CHILD_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

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

// [2026-09-23追加] 非対称鍵（ES256/RS256）のJWT検証専用。HMACキーと違い
// シークレット文字列ではなく`SUPABASE_URL`しか要らないため、モジュール
// スコープに1個だけ生成して使い回す（ファイル冒頭コメント「鍵のキャッシュ
// について」を参照。supabase-js内部のJWKSキャッシュを効かせるため）。
let cachedClaimsClient: SupabaseClient | null = null;

function getClaimsClient(): SupabaseClient {
  if (!cachedClaimsClient) {
    // service_role キーを使うが、ここでの用途はJWKS取得と`getUser()`
    // フォールバックのみ（DBへの特権アクセスはしない）。他のservice_role
    // client（_shared/supabaseAdmin.ts）とは別インスタンスとして持つ
    // （呼び出し元の関数シグネチャを変えずに済ませるため、admin clientを
    // 引数で受け取らず本ファイル内で完結させている）。
    cachedClaimsClient = createClient(env.supabaseUrl, env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedClaimsClient;
}

/**
 * 呼び出し元が送ってきたJWT（set-child-pin/remove-memberでは保護者の
 * Supabase Auth標準JWTを想定）を検証し、subクレーム等を取り出す。
 * 標準のSupabase AuthトークンにはfamilyIdなどのカスタムクレームが無いため
 * （2章「保護者（Supabase Auth標準発行）」の例を参照）、ここではsub
 * （auth.users.id）の取り出しのみを行い、実際のfamily_id/role解決は
 * 呼び出し元がservice_role clientでfamily_membersを引いて行う
 * （_shared/parentAuth.ts参照）。
 *
 * [2026-09-23変更・やること4-73対応] HS256はこれまでどおりdjwtでローカル
 * 検証する（本番の現状の署名方式・挙動を変えない）。それ以外（ES256/RS256
 * 等の非対称鍵）は、ファイル冒頭コメントの理由によりsupabase-jsの
 * `auth.getClaims()`に委譲する。alg判定は署名検証前のヘッダー読み取り
 * （djwtの`decode()`。シグネチャ未検証の値なので分岐にしか使わない）で行う。
 */
export async function verifyToken(
  secret: string,
  token: string
): Promise<VerifiedCallerClaims> {
  let header: Header;
  try {
    [header] = decode(token) as [Header, Payload, Uint8Array];
  } catch {
    throw new Error("JWTの形式が不正です");
  }

  let payload: Payload;

  if (header.alg === "HS256") {
    // 現状の本番（HS256・共有シークレット）はここを通る。ネットワーク
    // 通信を発生させない、従来どおりのローカル検証。
    const key = await getHmacKey(secret);
    payload = await verify(token, key);
  } else {
    // ES256/RS256等の非対称鍵、または想定外のalg。すべてsupabase-jsに
    // 委ね、真正なJWKS一致 or Auth server本体での検証のいずれかでしか
    // 通らないようにする（ファイル冒頭コメント「安全性」を参照）。
    const client = getClaimsClient();
    const { data, error } = await client.auth.getClaims(token);
    if (error || !data || !data.claims) {
      throw new Error("JWTの検証に失敗しました（Supabase Auth）");
    }
    payload = data.claims as Payload;
  }

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
