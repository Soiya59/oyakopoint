/**
 * get_app_update_policy RPC を呼ぶ処理の本体（fetchを差し込める形）。
 * 参照: 設計部/成果物/API仕様.md 41.4、開発部/成果物/実装メモ.md 362章。
 * src/data/api.ts の `fetchAppUpdatePolicy` が、環境変数のURL・anonキーと本物の`fetch`を渡して呼ぶ。
 *
 * RN/expo/supabase-jsに依存させない（Nodeで fake fetch と本物のローカルDBを相手に検査できるようにする。
 * src/lib/appUpdatePolicyFetch.verify.ts）。
 *
 * **戻り値は `AppUpdatePolicy | null`。失敗は全部 null（＝通す。閉じ込めない）。例外は投げない。**
 * 通信エラー・機内モード・タイムアウト・HTTPエラー（401/403/404/5xx）・JSONでない本文・想定外の形、
 * のどれも null。再試行しない。
 *
 * タイムアウトは `AbortController` と `Promise.race` の二重（fetchがabortに応えない場合でも
 * timeoutMs で必ず返す）。タイムアウト後に届いた結果は捨てる（3秒を過ぎて届いた「おすすめ」は出さない）。
 */
import { APP_UPDATE_TIMEOUT_MS, parseAppUpdatePolicyResponse } from "./appUpdatePolicy";
import type { AppUpdatePolicy, UpdatePlatform } from "./appUpdatePolicy";

export interface RequestAppUpdatePolicyOptions {
  /** SupabaseのプロジェクトURL（末尾のスラッシュは有っても無くてもよい）。 */
  baseUrl: string;
  /** anonキー（公開してよい鍵）。ログイン中のセッションのトークンは**使わない**。 */
  anonKey: string;
  platform: UpdatePlatform;
  timeoutMs?: number;
  /** テスト用。省略時はグローバルの fetch。 */
  fetchImpl?: typeof fetch;
}

export async function requestAppUpdatePolicy(opts: RequestAppUpdatePolicyOptions): Promise<AppUpdatePolicy | null> {
  try {
    const timeoutMs = opts.timeoutMs ?? APP_UPDATE_TIMEOUT_MS;
    const doFetch = opts.fetchImpl ?? (typeof fetch !== "undefined" ? fetch : null);
    if (!doFetch) return null;
    if (!opts.baseUrl || !opts.anonKey) return null;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        try {
          controller?.abort();
        } catch {
          // abortできなくても、Promise.raceが先にnullで返るので問題ない。
        }
        resolve(null);
      }, timeoutMs);
    });
    const request = (async (): Promise<AppUpdatePolicy | null> => {
      try {
        const res = await doFetch(`${opts.baseUrl.replace(/\/+$/, "")}/rest/v1/rpc/get_app_update_policy`, {
          method: "POST",
          headers: {
            apikey: opts.anonKey,
            Authorization: `Bearer ${opts.anonKey}`,
            "Content-Type": "application/json",
          },
          // 送るのはOSだけ。誰がどのビルドかは送らない（要件定義書07-47章 決定8）。
          body: JSON.stringify({ p_platform: opts.platform }),
          signal: controller?.signal,
        });
        if (!res.ok) return null;
        return parseAppUpdatePolicyResponse(await res.json());
      } catch {
        return null;
      }
    })();
    try {
      return await Promise.race([request, timeout]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
