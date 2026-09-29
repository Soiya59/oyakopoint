/**
 * notify-chore-request
 *
 * 参照:
 *   - 設計部/成果物/スキーマ設計.sql 82.6章・82.9章
 *   - 設計部/成果物/API仕様.md 38.5.1章「Edge Function notify-chore-request の契約」
 *   - supabase/functions/notify-comment/index.ts（同型の先行事例。骨格をそのまま流用）
 *   - 企画部/成果物/要件定義書.md 07-43章（決定12）
 *   - 開発部/成果物/実装メモ.md 335章
 *
 * 役割: 「おねがい」（chores.is_request=true）の2つの出来事のあと、DBトリガー
 * （chores_after_insert_notify_request / chore_completions_after_insert_notify_request_done、
 * マイグレーション 20261001010000）から net.http_post 経由で呼ばれ、宛先の1人に
 * Expo Push APIで通知を送る。
 *   - kind='chore_request'      : おねがいが作られた → 担当の子どもへ
 *   - kind='chore_request_done' : 子どもがおねがいをやってくれた → 依頼者（保護者1人）へ
 * 2種はbodyの形がほぼ同じなので1本にまとめている（設計部82.2章C）。
 *
 * [呼び出し元の制限] notify-comment/index.tsと同じ形。Authorizationヘッダーのbearerが
 * service_role JWTであることを確認し、満たさない場合は401でExpoを一切呼ばない。
 *
 * [受け取るbody] chore_request_notification_payload()（スキーマ設計.sql 82.6章）が返す
 * jsonbそのもの。kind・chore_id・completion_id・actor_display_name・recipient_tokens。
 * **おねがいの題名・ポイント・ひとことは一切含まれていない**（含めようがない構造。
 * 統括回答U5。ロック画面への露出を避ける）。
 *
 * [文言] 企画部案（要件定義書07-43章決定12）。定数1か所（MESSAGES）。
 * 催促・促しの言葉・感情の絵文字は入れない。役割による文言分岐はしない
 * （63.2.1節と同じ理由。トークンは端末に紐づき、共有端末では両方に届きうる）。
 *
 * [ドライラン] notify-commentと同じ。PUSH_DRY_RUNが真のときだけ送らない（既定は送る）。
 *
 * [無効トークンの掃除] DeviceNotRegisteredが返ったトークンをservice_roleクライアントで
 * 直接DELETEする（notify-commentと同じ）。
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

type RequestKind = "chore_request" | "chore_request_done";

function isRequestKind(v: unknown): v is RequestKind {
  return v === "chore_request" || v === "chore_request_done";
}

/** [API仕様.md 38.5.1章・企画部案] タイトルと本文。題名・ポイントは入れない。 */
const MESSAGES: Record<RequestKind, { title: string; body: (actor: string) => string }> = {
  // 子ども向け（ひらがな）。担当の子どもへ。
  chore_request: {
    title: "おねがい",
    body: (actor) => `${actor}から おねがいが とどいたよ`,
  },
  // 依頼者（保護者）向け。
  chore_request_done: {
    title: "おねがい",
    body: (actor) => `${actor}さんがおねがいをやってくれました`,
  },
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
  const kind = b?.kind;
  const choreId = b?.chore_id;
  const actorDisplayName = b?.actor_display_name;
  const recipientTokensRaw = b?.recipient_tokens;

  if (!isRequestKind(kind)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (typeof choreId !== "string" || choreId.length === 0) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (typeof actorDisplayName !== "string" || actorDisplayName.length === 0) {
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

  const message = MESSAGES[kind];
  const title = message.title;
  const messageBody = message.body(actorDisplayName);
  // [タップした先の導線] data.typeで振り分ける（NotificationSoftAsk.tsxのresolverForData）。
  // 題名・ポイントは入れない。
  const data = { type: kind, chore_id: choreId };

  if (env.pushDryRun) {
    console.warn(
      "notify-chore-request: PUSH_DRY_RUNが有効なため送信をスキップしました",
      { recipient_count: tokens.length, kind, chore_id: choreId, title, body: messageBody, data }
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
      console.error("notify-chore-request: Expo push failed", res.status, errText);
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
        console.error("notify-chore-request: stale token cleanup failed", deleteError);
      }
    }

    return jsonResponse({ sent: true, recipient_count: tokens.length, stale_removed: staleTokens.length });
  } catch (err) {
    console.error("notify-chore-request: Expo push call threw", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
