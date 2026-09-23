/**
 * notify-family-scheduled-announcement
 *
 * 参照:
 *   - 開発部/成果物/実装メモ.md 292章（本タスクの実装記録・決定ログ）
 *   - 設計部/成果物/スキーマ設計.sql 75章（骨格）
 *   - 設計部/成果物/API仕様.md 32章
 *   - supabase/functions/notify-family-board-post/index.ts（骨格の転用元。
 *     271章・74章と同型のservice_role JWT検証・Vault・PUSH_DRY_RUNを
 *     そのまま踏襲する）
 *
 * 役割: pg_cronのジョブ（family-scheduled-announcements-dispatch、毎分）が
 * `dispatch_due_family_scheduled_announcements()`経由でnet.http_postを
 * 呼び、その分に該当する家族×枠のメッセージをExpo Push APIでまとめて送る。
 *
 * [notify-family-board-postと別関数にした理由・実装メモ292章]
 * 払い出す情報の形（family_id/slot/messageであり post_id/author_display_
 * name ではない）・呼び出しの粒度（1投稿につき1回ではなく、1分ごとの
 * cronがその分に該当する数だけ）が異なるため、別関数にした
 * （設計部/成果物/スキーマ設計.sql 75.10章の判断をそのまま踏襲）。
 *
 * [受け取るbody]
 * family_scheduled_announcement_notification_payload()が返すjsonbそのもの。
 * family_id・slot・message・recipient_tokensの4つ。
 *
 * [文言] タイトルは「メッセージ」（画面上の名称、実装メモ292.1章）。本文は
 * 保護者が書いたmessageをそのまま出す（要件定義書07-37-4-6節「保護者は、
 * 通知として出ることを知ったうえで書く」。掲示板の投稿通知〈本文を隠す〉
 * とは異なり、ここは本文をそのまま見せる設計）。
 *
 * [ドライラン・無効トークンの掃除]
 * notify-family-board-postと全く同じ設計（PUSH_DRY_RUN・EXPO_ACCESS_TOKEN・
 * DeviceNotRegisteredの掃除）。
 */
import { jsonResponse } from "../_shared/http.ts";
import { env } from "../_shared/env.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** notify-family-board-post/index.tsと同じ実装（署名検証はKongが済ませて
 * いる前提でroleクレームだけを読む）。 */
function getJwtRole(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64url = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64url.padEnd(
      base64url.length + ((4 - (base64url.length % 4)) % 4),
      "="
    );
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

interface ExpoTicket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

/** [実装メモ292.1章] 画面に出す名前は「メッセージ」。名前を1か所にまとめる
 * （クライアント側の定数はsrc/constants/scheduledAnnouncement.tsに置き、
 * こちらはEdge Function側の同じ定数。DenoランタイムはNode側のimportパスを
 * 解決できないため意図的に値を重複させている。変えるときは両方直すこと）。 */
const FEATURE_NAME = "メッセージ";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // [呼び出し元の制限] service_role のJWTからの呼び出しのみ受け付ける。
  if (getJwtRole(req) !== "service_role") {
    return jsonResponse({ error: "forbidden" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const b = body as Record<string, unknown> | null;
  const familyId = b?.family_id;
  const slot = b?.slot;
  const message = b?.message;
  const recipientTokensRaw = b?.recipient_tokens;

  if (typeof familyId !== "string" || familyId.length === 0) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (slot !== 1 && slot !== 2) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (typeof message !== "string" || message.length === 0) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (!Array.isArray(recipientTokensRaw)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const tokens = recipientTokensRaw.filter(
    (t): t is string => typeof t === "string" && t.length > 0
  );
  if (tokens.length === 0) {
    return jsonResponse({ skipped: true, reason: "no_recipients" }, 200);
  }

  const title = FEATURE_NAME;
  const messageBody = message;
  // [タップ先の導線] notify-family-board-postの"family_board_post"とは
  // 別のtype値。タップ先の具体的な遷移は未確定（設計部75.14章・API仕様.md
  // 32.3章のとおりUIUXデザイン部の検討事項）。
  const data = { type: "family_scheduled_announcement", family_id: familyId, slot };

  if (env.pushDryRun) {
    console.warn(
      "notify-family-scheduled-announcement: PUSH_DRY_RUNが有効なため送信をスキップしました",
      { recipient_count: tokens.length, family_id: familyId, slot }
    );
    return jsonResponse(
      { skipped: true, reason: "push_dry_run", recipient_count: tokens.length },
      200
    );
  }

  const accessToken = env.expoAccessToken;
  const messages = tokens.map((to) => ({ to, title, body: messageBody, data }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("notify-family-scheduled-announcement: Expo push failed", res.status, errText);
      return jsonResponse({ error: "expo_push_failed" }, 502);
    }

    const result = (await res.json()) as { data?: ExpoTicket[] };
    const tickets = result.data ?? [];

    const staleTokens: string[] = [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
        const token = tokens[i];
        if (token) staleTokens.push(token);
      }
    });

    if (staleTokens.length > 0) {
      const admin = createAdminClient();
      const { error: deleteError } = await admin
        .from("push_tokens")
        .delete()
        .in("expo_push_token", staleTokens);
      if (deleteError) {
        console.error("notify-family-scheduled-announcement: stale token cleanup failed", deleteError);
      }
    }

    return jsonResponse({ sent: true, recipient_count: tokens.length, stale_removed: staleTokens.length });
  } catch (err) {
    console.error("notify-family-scheduled-announcement: Expo push call threw", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
