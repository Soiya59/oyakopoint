/**
 * appUpdatePolicyFetch.ts の検証スクリプト。
 * 参照: 開発部/成果物/実装メモ.md 362章、企画部/成果物/要件定義書.md 07-47章 4節（受け入れ条件4・5）。
 *
 * 実行:
 *   npx tsx src/lib/appUpdatePolicyFetch.verify.ts
 *
 * 本物のローカルDBに対する検査も行うには、環境変数でローカルのURLとanonキーを渡す
 * （本番のURLは渡さないこと。渡さなければこの検査はSKIPになる）:
 *   VERIFY_SUPABASE_URL=http://127.0.0.1:54321 VERIFY_SUPABASE_ANON_KEY=<ローカルの鍵> \
 *     npx tsx src/lib/appUpdatePolicyFetch.verify.ts
 */
import { requestAppUpdatePolicy } from "./appUpdatePolicyFetch.ts";

let failed = 0;
let passed = 0;

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    passed += 1;
    console.log(`OK   ${label}`);
  } else {
    failed += 1;
    console.log(`NG   ${label}`);
    console.log(`     期待値: ${JSON.stringify(expected)}`);
    console.log(`     実際値: ${JSON.stringify(actual)}`);
  }
}

const BASE = "http://example.invalid";
const KEY = "dummy-anon-key";
const GOOD_BODY = [{ required_min_build: 30, recommended_min_build: 25, store_url: "https://play.google.com/store/apps/details?id=x" }];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function main(): Promise<void> {
  // ---- 1. 正常: 呼び方（URL・ヘッダー・本文）と戻り値 ----
  {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return jsonResponse(GOOD_BODY);
    }) as unknown as typeof fetch;
    const r = await requestAppUpdatePolicy({ baseUrl: BASE + "/", anonKey: KEY, platform: "ios", fetchImpl: fakeFetch });
    assertEqual("正常: requiredMinBuild", r?.requiredMinBuild, 30);
    assertEqual("正常: recommendedMinBuild", r?.recommendedMinBuild, 25);
    assertEqual("正常: URL（末尾スラッシュの二重にならない）", seenUrl, `${BASE}/rest/v1/rpc/get_app_update_policy`);
    const h = (seenInit?.headers ?? {}) as Record<string, string>;
    assertEqual("ヘッダー: apikey はanonキー", h.apikey, KEY);
    assertEqual("ヘッダー: Authorization はanonキーのBearerだけ（セッションのトークンを使わない）", h.Authorization, `Bearer ${KEY}`);
    assertEqual("メソッドはPOST", seenInit?.method, "POST");
    assertEqual("本文はOSだけ（誰がどのビルドかを送らない）", seenInit?.body, '{"p_platform":"ios"}');
  }
  {
    let body = "";
    const fakeFetch = (async (_u: string, init?: RequestInit) => {
      body = String(init?.body);
      return jsonResponse(GOOD_BODY);
    }) as unknown as typeof fetch;
    await requestAppUpdatePolicy({ baseUrl: BASE, anonKey: KEY, platform: "android", fetchImpl: fakeFetch });
    assertEqual("androidのときの本文", body, '{"p_platform":"android"}');
  }

  // ---- 2. 失敗は全部 null（通す） ----
  const nullCase = async (label: string, fakeFetch: typeof fetch, timeoutMs?: number) => {
    const t0 = Date.now();
    const r = await requestAppUpdatePolicy({ baseUrl: BASE, anonKey: KEY, platform: "ios", fetchImpl: fakeFetch, timeoutMs });
    assertEqual(label, r, null);
    return Date.now() - t0;
  };
  await nullCase("401（期限切れJWTなどのPostgRESTエラー）-> null", (async () => jsonResponse({ code: "PGRST301", message: "x" }, 401)) as unknown as typeof fetch);
  await nullCase("403 -> null", (async () => jsonResponse({}, 403)) as unknown as typeof fetch);
  await nullCase("404（関数が無い: DB未適用）-> null", (async () => jsonResponse({ code: "PGRST202" }, 404)) as unknown as typeof fetch);
  await nullCase("500 -> null", (async () => jsonResponse({}, 500)) as unknown as typeof fetch);
  await nullCase("503 -> null", (async () => new Response("bad gateway", { status: 503 })) as unknown as typeof fetch);
  await nullCase("通信エラー（fetchがthrow。機内モード）-> null", (async () => {
    throw new TypeError("Network request failed");
  }) as unknown as typeof fetch);
  await nullCase("本文がJSONでない（HTML）-> null", (async () => new Response("<html>captive portal</html>", { status: 200 })) as unknown as typeof fetch);
  await nullCase("空の本文 -> null", (async () => new Response("", { status: 200 })) as unknown as typeof fetch);
  await nullCase("空配列 -> null", (async () => jsonResponse([])) as unknown as typeof fetch);
  await nullCase("2要素 -> null", (async () => jsonResponse([GOOD_BODY[0], GOOD_BODY[0]])) as unknown as typeof fetch);
  await nullCase("列が足りない -> null", (async () => jsonResponse([{ required_min_build: 1 }])) as unknown as typeof fetch);
  await nullCase("数字が文字列 -> null", (async () => jsonResponse([{ required_min_build: "30", recommended_min_build: 0, store_url: "" }])) as unknown as typeof fetch);
  await nullCase("オブジェクト（配列でない）-> null", (async () => jsonResponse(GOOD_BODY[0])) as unknown as typeof fetch);

  // ---- 3. タイムアウト（受け入れ条件4・5。3秒の代わりに短い値で確かめる） ----
  {
    // abortに応えない（永遠に返らない）fetch でも、timeoutMsで必ず返る
    const ms = await nullCase("返らないfetch（abortに応えない）-> timeoutで null", (() => new Promise(() => {})) as unknown as typeof fetch, 150);
    assertEqual("  タイムアウトは150ms前後で返る（100〜600ms）", ms >= 100 && ms <= 600, true);
  }
  {
    // abortに応える fetch
    let aborted = false;
    const fakeFetch = ((_u: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      })) as unknown as typeof fetch;
    await nullCase("abortに応えるfetch -> null", fakeFetch, 100);
    assertEqual("  タイムアウト時に中断(abort)が呼ばれた", aborted, true);
  }
  {
    // 遅れて届いた結果は捨てる（3秒を過ぎて届いた「おすすめ」は出さない）
    const lateFetch = (() =>
      new Promise((resolve) => setTimeout(() => resolve(jsonResponse(GOOD_BODY)), 300))) as unknown as typeof fetch;
    await nullCase("タイムアウト後に届いた結果は捨てる -> null", lateFetch, 100);
  }
  {
    // 時間内に届けば使う
    const fastFetch = (() =>
      new Promise((resolve) => setTimeout(() => resolve(jsonResponse(GOOD_BODY)), 50))) as unknown as typeof fetch;
    const r = await requestAppUpdatePolicy({ baseUrl: BASE, anonKey: KEY, platform: "ios", fetchImpl: fastFetch, timeoutMs: 500 });
    assertEqual("時間内に届いた結果は使う", r?.requiredMinBuild, 30);
  }
  {
    // 既定のタイムアウトは3秒（AbortControllerを待たずに確認するため、短縮はしない: 設定値だけ確認）
    const { APP_UPDATE_TIMEOUT_MS } = await import("./appUpdatePolicy.ts");
    assertEqual("既定のタイムアウトは3000ms", APP_UPDATE_TIMEOUT_MS, 3000);
  }

  // ---- 4. 入力の不備 ----
  assertEqual("baseUrlが空 -> null", await requestAppUpdatePolicy({ baseUrl: "", anonKey: KEY, platform: "ios", fetchImpl: (async () => jsonResponse(GOOD_BODY)) as unknown as typeof fetch }), null);
  assertEqual("anonKeyが空 -> null", await requestAppUpdatePolicy({ baseUrl: BASE, anonKey: "", platform: "ios", fetchImpl: (async () => jsonResponse(GOOD_BODY)) as unknown as typeof fetch }), null);

  // ---- 5. 本物のローカルDB（環境変数があるときだけ）----
  const url = process.env.VERIFY_SUPABASE_URL;
  const key = process.env.VERIFY_SUPABASE_ANON_KEY;
  if (url && key) {
    if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
      failed += 1;
      console.log(`NG   ローカル以外のURLが渡された（本番に触れない約束）: ${url}`);
    } else {
      const ios = await requestAppUpdatePolicy({ baseUrl: url, anonKey: key, platform: "ios" });
      const android = await requestAppUpdatePolicy({ baseUrl: url, anonKey: key, platform: "android" });
      console.log(`INFO ローカルiOS行:     ${JSON.stringify(ios)}`);
      console.log(`INFO ローカルAndroid行: ${JSON.stringify(android)}`);
      assertEqual("ローカルDB: iOS行が読めた（形が正しい）", ios !== null, true);
      assertEqual("ローカルDB: Android行が読めた", android !== null, true);
      assertEqual("ローカルDB: AndroidのURLはPlayのもの", android?.storeUrl.startsWith("https://play.google.com/") ?? false, true);
      // 壊れたキーでは読めない（null）。通すだけで落ちない
      const bad = await requestAppUpdatePolicy({ baseUrl: url, anonKey: "broken", platform: "ios" });
      assertEqual("ローカルDB: 壊れたキーでも例外にならず null", bad, null);
      // 止まっているサーバ（ポートが違う）: 通信エラー -> null
      const down = await requestAppUpdatePolicy({ baseUrl: "http://127.0.0.1:1", anonKey: key, platform: "ios" });
      assertEqual("ローカルDB: 接続できないとき null", down, null);
    }
  } else {
    console.log("SKIP 本物のローカルDBへの検査（VERIFY_SUPABASE_URL / VERIFY_SUPABASE_ANON_KEY が未指定）");
  }

  console.log(`\n${passed} 件OK / ${failed} 件NG`);
  if (failed > 0) process.exitCode = 1;
}

void main();
