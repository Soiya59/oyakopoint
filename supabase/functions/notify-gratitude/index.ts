/**
 * notify-gratitude
 *
 * 参照:
 *   - 設計部/成果物/スキーマ設計.sql 82.7章・82.9章
 *   - 設計部/成果物/API仕様.md 38.5.2章「Edge Function notify-gratitude の契約」
 *   - supabase/functions/notify-comment/index.ts（同型の先行事例。骨格をそのまま流用）
 *   - 企画部/成果物/要件定義書.md 07-5章（受領を通知する。未実装だった）・07-43章 統括回答U7
 *   - 開発部/成果物/実装メモ.md 335章
 *
 * 役割: 感謝ポイント（gratitude_points）へのINSERT直後、DBトリガー
 * （gratitude_points_after_insert_notify、マイグレーション 20261001010000）から
 * net.http_post 経由で呼ばれ、**受け取った人1人**にExpo Push APIで通知を送る。
 * 対象は感謝ポイント全般（おねがいと結びつけない）。贈った人・受け取った人のロールは問わない。
 *
 * [呼び出し元の制限] notify-comment/index.tsと同じ形。Authorizationヘッダーのbearerが
 * service_role JWTであることを確認し、満たさない場合は401でExpoを一切呼ばない。
 *
 * [受け取るbody] gratitude_notification_payload()（スキーマ設計.sql 82.7章）が返すjsonb
 * そのもの。gratitude_id・sender_display_name・recipient_tokensの3つ。
 * **額（points）・ひとこと（note）は一切含まれていない**（含めようがない構造。統括回答U7）。
 *
 * [文言] タイトル「ありがとう」・本文「{sender_display_name}から ありがとうが とどいたよ」
 * （統括が承認した文面）。贈った人のロールによる文言の分岐はしない。定数1か所（MESSAGE）。
 *
 * [ドライラン・無効トークンの掃除] notify-commentと同じ。
 */
import { jsonResponse } from "../_shared/http.ts";
import { env } from "../_shared/env.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** notify-comment/index.tsと同じ実装（署名の再検証はしない）。 */
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

/** [API仕様.md 38.5.2章・統括承認済みの文面] 額・ひとことは出さない。 */
const MESSAGE = {
  title: "ありがとう",
  body: (sender: string) => `${sender}から ありがとうが とどいたよ`,
};

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
  const gratitudeId = b?.gratitude_id;
  const senderDisplayName = b?.sender_display_name;
  const recipientTokensRaw = b?.recipient_tokens;

  if (typeof gratitudeId !== "string" || gratitudeId.length === 0) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (typeof senderDisplayName !== "string" || senderDisplayName.length === 0) {
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

  const title = MESSAGE.title;
  const messageBody = MESSAGE.body(senderDisplayName);
  // [タップした先の導線] data.typeで振り分ける（NotificationSoftAsk.tsxのresolverForData）。
  // 額・ひとことは入れない。
  const data = { type: "gratitude_received", gratitude_id: gratitudeId };

  if (env.pushDryRun) {
    console.warn(
      "notify-gratitude: PUSH_DRY_RUNが有効なため送信をスキップしました",
      { recipient_count: tokens.length, gratitude_id: gratitudeId, title, body: messageBody, data }
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
      console.error("notify-gratitude: Expo push failed", res.status, errText);
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
        console.error("notify-gratitude: stale token cleanup failed", deleteError);
      }
    }

    return jsonResponse({ sent: true, recipient_count: tokens.length, stale_removed: staleTokens.length });
  } catch (err) {
    console.error("notify-gratitude: Expo push call threw", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
