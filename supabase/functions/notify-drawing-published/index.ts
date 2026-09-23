/**
 * notify-drawing-published
 *
 * 参照:
 *   - 設計部/成果物/スキーマ設計.sql 76.10章
 *   - 設計部/成果物/API仕様.md 33章（33.7.1章「Edge Function notify-drawing-published の契約」）
 *   - supabase/functions/notify-family-board-post/index.ts（同型の先行事例。骨格をそのまま流用）
 *   - 開発部/成果物/実装メモ.md 293章
 *
 * 役割: family_drawings.is_publishedがfalse→trueに変わった直後（＝家族の
 * 誰かがガチャで自分の絵を引いた瞬間）、DBトリガー
 * （family_drawings_after_publish_notify、マイグレーション20260930140000）
 * から net.http_post 経由で呼ばれ、描いた本人へ「絵が公開された」ことを
 * Expo Push APIで通知する。要件定義書07-38章4章「最優先」の通知。
 *
 * [families.push_notifications_enabled・やりとりトグルのいずれの対象にも
 * しない] DBトリガー側が常時ONで呼ぶ（本Functionはゲートの判定をしない。
 * ゲートの判定自体がDBトリガー側に無い設計のため、本Functionに渡ってきた
 * 時点で常に送信対象）。
 *
 * [呼び出し元の制限・文言・ドライラン・無効トークンの掃除] いずれも
 * notify-comment/index.tsと同じ骨格。
 */
import { jsonResponse } from "../_shared/http.ts";
import { env } from "../_shared/env.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

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
  const drawingId = b?.drawing_id;
  const recipientTokensRaw = b?.recipient_tokens;

  if (typeof drawingId !== "string" || drawingId.length === 0) {
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

  // [文言・要件定義書07-38章4-4節] 絵の題名・発見者の名前は含めない。
  const title = "コレクション";
  const messageBody = "あなたの絵が、かぞくに とどきました！";
  const data = { type: "drawing_published", drawing_id: drawingId };

  if (env.pushDryRun) {
    console.warn(
      "notify-drawing-published: PUSH_DRY_RUNが有効なため送信をスキップしました",
      { recipient_count: tokens.length, drawing_id: drawingId }
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
      console.error("notify-drawing-published: Expo push failed", res.status, errText);
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
        console.error("notify-drawing-published: stale token cleanup failed", deleteError);
      }
    }

    return jsonResponse({ sent: true, recipient_count: tokens.length, stale_removed: staleTokens.length });
  } catch (err) {
    console.error("notify-drawing-published: Expo push call threw", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
