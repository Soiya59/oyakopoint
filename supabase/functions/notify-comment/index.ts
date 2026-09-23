/**
 * notify-comment
 *
 * 参照:
 *   - 設計部/成果物/スキーマ設計.sql 76.9章（76.9.1章・76.9.2章）
 *   - 設計部/成果物/API仕様.md 33章（33.6.1章「Edge Function notify-comment の契約」）
 *   - supabase/functions/notify-family-board-post/index.ts（同型の先行事例。骨格をそのまま流用）
 *   - 開発部/成果物/実装メモ.md 293章
 *
 * 役割: family_board_comments・chore_reactions（kind='comment'）・
 * family_drawing_comments の3テーブルへのINSERT直後、DBトリガー
 * （family_board_comments_after_insert_notify / chore_reactions_after_
 * insert_notify / family_drawing_comments_after_insert_notify、
 * マイグレーション 20260930140000）から net.http_post 経由で呼ばれ、
 * コメントされた投稿・完了報告・絵の「持ち主」1人にだけExpo Push APIで
 * 通知を送る。3種のペイロードの形（kind・comment_id・commenter_display_
 * name・recipient_tokens）が完全に同一のため、Edge Functionを1本に
 * まとめている（スキーマ設計.sql 76.9章）。
 *
 * [呼び出し元の制限] notify-family-board-post/index.tsと同じ形。
 * Authorizationヘッダーのbearerがservice_role JWTであることを確認し、
 * 満たさない場合は401でExpoを一切呼ばない。
 *
 * [受け取るbody] comment_notification_payload()（スキーマ設計.sql
 * 76.9.1章）が返すjsonbそのもの。kind・comment_id・commenter_display_
 * name・recipient_tokensの4つ。コメント本文は一切含まれていない
 * （含めようがない構造）。
 *
 * [文言] タイトルはkindに応じて出し分ける（家族の掲示板／完了報告／
 * コレクション）。本文は3種とも「{commenter_display_name}さんが
 * コメントしました」の定型文のみ。コメントの中身は一切出さない
 * （統括決定）。
 *
 * [ドライラン] notify-family-board-post/index.tsと同じ、PUSH_DRY_RUNが
 * 真のときだけ送らない（既定は送る）。
 *
 * [無効トークンの掃除] DeviceNotRegisteredが返ったトークンをservice_role
 * クライアントで直接DELETEする（74.2章と同じ）。
 */
import { jsonResponse } from "../_shared/http.ts";
import { env } from "../_shared/env.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** notify-family-board-post/index.tsと同じ実装（署名の再検証はしない）。 */
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

type CommentKind = "family_board_comment" | "chore_reaction_comment" | "family_drawing_comment";

/** [API仕様.md 33.6.1章] kindに応じたタイトル。遷移先の画面名をそのまま使う
 * （通知タップ後に開く画面と一致させる、63.2.1節と同じ考え方）。 */
const TITLE_BY_KIND: Record<CommentKind, string> = {
  family_board_comment: "家族の掲示板",
  chore_reaction_comment: "完了報告",
  family_drawing_comment: "コレクション",
};

function isCommentKind(v: unknown): v is CommentKind {
  return v === "family_board_comment" || v === "chore_reaction_comment" || v === "family_drawing_comment";
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
  const kind = b?.kind;
  const commentId = b?.comment_id;
  const commenterDisplayName = b?.commenter_display_name;
  const recipientTokensRaw = b?.recipient_tokens;

  if (!isCommentKind(kind)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (typeof commentId !== "string" || commentId.length === 0) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (typeof commenterDisplayName !== "string" || commenterDisplayName.length === 0) {
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

  const title = TITLE_BY_KIND[kind];
  // [統括決定] コメントの中身は一切出さない。「◯◯さんがコメントしました」
  // の定型文のみ。役割による文言分岐は行わない（63.2.1節と同じ理由）。
  const messageBody = `${commenterDisplayName}さんがコメントしました`;
  // [タップした先の導線] data.kind/comment_idを含める。どの画面を開くかは
  // クライアント側（UIUXデザイン部の画面設計）の判断に委ねる。
  const data = { type: "comment", kind, comment_id: commentId };

  if (env.pushDryRun) {
    console.warn(
      "notify-comment: PUSH_DRY_RUNが有効なため送信をスキップしました",
      { recipient_count: tokens.length, kind, comment_id: commentId }
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
      console.error("notify-comment: Expo push failed", res.status, errText);
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
        console.error("notify-comment: stale token cleanup failed", deleteError);
      }
    }

    return jsonResponse({ sent: true, recipient_count: tokens.length, stale_removed: staleTokens.length });
  } catch (err) {
    console.error("notify-comment: Expo push call threw", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
