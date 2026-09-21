/**
 * notify-family-board-post
 *
 * 参照:
 *   - 設計部/成果物/スキーマ設計.sql 74章（74.8章・74.9章）
 *   - 設計部/成果物/API仕様.md 31章（31.3章「Edge Function notify-family-board-post の契約」）
 *   - 開発部/成果物/実装メモ.md 271章（notify-content-reportと同型の先行事例）
 *
 * 役割: family_board_posts へのINSERT直後、DBトリガー
 * （public.family_board_posts_after_insert_notify・マイグレーション
 * 20260930110000）から net.http_post 経由で呼ばれ、投稿者を除く家族の
 * 端末へExpo Push APIで通知をまとめて送る。
 *
 * [呼び出し元の制限・271.2.2節と同じ形]
 * このURLはSupabaseの既定設定（verify_jwt=true）により、有効なSupabase
 * JWTを持つ相手なら誰でも到達できてしまう——anon keyはアプリに同梱され
 * 公開されているため、「有効なJWTを持っていること」だけでは呼び出し元を
 * 絞れない。そこで、DBトリガーが送るAuthorizationヘッダーは
 * **service_role key**（新しい秘密を増やさず、プロジェクトの既存の
 * service_role keyをそのまま使う）を前提にし、本関数の中でJWTのroleクレーム
 * が'service_role'であることを確認する。満たさない呼び出しは401で拒否し、
 * Expoを一切呼ばない。
 *
 * [受け取るbody・★勝手に増やさないこと]
 * family_board_post_notification_payload()（スキーマ設計.sql 74.8章）が
 * 返すjsonbそのもの。post_id・author_display_name・recipient_tokensの3つ
 * だけ。投稿本文は含まれていない（含めようがない構造）。
 *
 * [ドライラン・★2026-09-22本部長差し戻しで訂正]
 * 当初はResendと同じ形（EXPO_ACCESS_TOKEN未設定＝ドライラン）にしていたが、
 * Expo Push API（https://exp.host/--/api/v2/push/send）はResendと異なり
 * 秘密鍵を必須としない公開APIであり、「キーが無い＝送れない」という
 * *事実*が無い。旧稿の設計は開発部が勝手に作った制約であり、本番で
 * シークレットを1つ設定し忘れると**通知機能が黙って何もしないまま
 * 「正常」に見えてしまう**——今朝pg_netが本番で未設定のまま報告の通知
 * メールが1通も届いていなかった件（トリガーが例外を握りつぶす設計で誰も
 * 気づけなかった、やること4-74）と同じ落とし穴を、もう1つ増やすところ
 * だった。
 *
 * 現在の設計:
 *   - **ドライランは`PUSH_DRY_RUN`（真偽値の専用スイッチ）でのみ選ぶ。**
 *     これが真のときだけ送らずログに出す。**未設定なら実際に送る**
 *     （設定を忘れたときに起きるのは「動くこと」であって「静かに
 *     止まること」ではない、という側に既定値を倒す）。
 *   - `EXPO_ACCESS_TOKEN`は送信可否とは無関係。**あればAuthorization
 *     ヘッダーに付けて送り、無ければ付けずにそのまま送る**（Expoの
 *     「Enhanced Security」を有効にした場合に備えた任意設定という
 *     位置づけ）。
 *
 *
 * [無効トークンの掃除・スキーマ設計.sql 74.2章]
 * Expoの送信結果（チケット）でDeviceNotRegisteredが返ったトークンは、
 * service_roleクライアントで直接 DELETE FROM push_tokens する。新しい
 * RPCは用意しない（service_roleはRLSを迂回する）。
 */
import { jsonResponse } from "../_shared/http.ts";
import { env } from "../_shared/env.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Authorizationヘッダーのbearerトークン（JWT）から role クレームだけを
 * 読む。Supabase Kong（既定 verify_jwt=true）が署名検証を済ませてから
 * この関数を呼ぶため、ここでは署名の再検証はしない（271章と同じ考え方）。
 */
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
  const postId = b?.post_id;
  const authorDisplayName = b?.author_display_name;
  const recipientTokensRaw = b?.recipient_tokens;

  if (typeof postId !== "string" || postId.length === 0) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (typeof authorDisplayName !== "string" || authorDisplayName.length === 0) {
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

  // [文言・API仕様.md 31.3章、主要画面ワイヤーフレーム.md 63.2.1節]
  // 受け手のロールで文言を分けない（1つのトークンが保護者・子ども双方に
  // 紐づきうるため、トークン単位では誰が読むか決められない。本部長確定）。
  const title = "家族の掲示板";
  const messageBody = `${authorDisplayName}さんが書き込みました`;
  // [タップ先の導線・要件定義書07-37章2-1節必須要件]
  const data = { type: "family_board_post", post_id: postId };

  // [ドライラン・2026-09-22本部長差し戻しで訂正・冒頭コメント参照]
  // PUSH_DRY_RUNが真のときだけ送らない。**未設定なら実際に送る**（既定は
  // 「送る」側）。EXPO_ACCESS_TOKENは送信可否とは無関係——設定を忘れても
  // 通知機能自体は黙って止まらない。
  if (env.pushDryRun) {
    console.warn(
      "notify-family-board-post: PUSH_DRY_RUNが有効なため送信をスキップしました",
      { recipient_count: tokens.length, post_id: postId }
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
        // [Enhanced Security対応・任意] 設定されていればAuthorizationヘッダーを
        // 付ける。未設定でもリクエスト自体は送る（Expo Push APIは秘密鍵を
        // 必須としない公開APIのため）。
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("notify-family-board-post: Expo push failed", res.status, errText);
      // [271章と同じ考え方] ここで例外にしても、呼び出し元（net.http_post）
      // は既に完了しておりDBの記録には影響しない。502はログで気づくための措置。
      return jsonResponse({ error: "expo_push_failed" }, 502);
    }

    const result = (await res.json()) as { data?: ExpoTicket[] };
    const tickets = result.data ?? [];

    // [無効トークンの掃除・スキーマ設計.sql 74.2章] レスポンスのチケットは
    // リクエストのmessages配列と同じ順序で返る（Expo公式仕様）。
    // DeviceNotRegisteredが返ったトークンをservice_roleで直接DELETEする。
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
        console.error("notify-family-board-post: stale token cleanup failed", deleteError);
        // 送信自体は成功しているため200のまま返す（掃除の失敗で通知の成功を無効化しない）。
      }
    }

    return jsonResponse({ sent: true, recipient_count: tokens.length, stale_removed: staleTokens.length });
  } catch (err) {
    console.error("notify-family-board-post: Expo push call threw", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
