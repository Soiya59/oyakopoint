/**
 * notify-content-report
 *
 * 参照:
 *   - 設計部/成果物/スキーマ設計.sql 65.5章（運営への通知の呼び出し口）
 *   - 設計部/成果物/API仕様.md 25章（送信手段の比較・25.7章 実装手順）
 *   - 開発部/成果物/実装メモ.md 271章
 *
 * 役割: content_reports へのINSERT直後、DBトリガー
 * （public.content_reports_after_insert_notify・マイグレーション
 * 20260930060000）から net.http_post 経由で呼ばれ、運営（統括）宛に
 * 「お問い合わせ（報告）が1件入りました」という通知メールをResend経由で
 * 送る。
 *
 * [呼び出し元の制限・★重要]
 * このURLは Supabase の既定設定（verify_jwt=true）により、有効な
 * Supabase JWTを持つ相手なら誰でも到達できてしまう——anon keyはアプリに
 * 同梱され公開されているため、「有効なJWTを持っていること」だけでは
 * 呼び出し元を絞れない。そこで、DBトリガーが送るAuthorizationヘッダーは
 * **service_role key**（新しい秘密を増やさず、プロジェクトの既存の
 * service_role keyをそのまま使う。設計部方針「既存のAPIキーをそのまま
 * 使い回してよい」に倣った。API仕様.md 25.6章）を前提にし、本関数の中で
 * JWTのroleクレームが'service_role'であることを確認する。満たさない
 * 呼び出しは401で拒否し、Resendを一切呼ばない。
 *
 * [送る中身・★勝手に増やさないこと]
 * report_id だけ（スキーマ設計.sql 65.1章・65.2章で対象種別・自由記述
 * 本文の列がそもそも廃止/非搭載のため、本文・表示名・家族名・
 * family_idはいずれも載せない。決定10）。
 *
 * [動かすために設定が必要なもの（詳細は実装メモ271章）]
 *   - Edge Function シークレット RESEND_API_KEY
 *     （既存のResendのAPIキーを流用。新規発行不要）
 *   - Edge Function シークレット CONTENT_REPORT_NOTIFY_TO（任意。
 *     未設定ならDEFAULT_NOTIFY_TOを使う）
 *   - Supabase Vault の content_report_notify_url /
 *     content_report_notify_bearer（呼び出し元＝トリガー側。
 *     マイグレーション20260930060000のコメント参照）
 *
 * [ローカルでの動作確認について]
 * RESEND_API_KEY が未設定の環境では、実際にResendへは送らず、送る予定
 * だった内容をログに出すだけに留める（下記参照）。これにより「トリガー
 * →この関数が呼ばれる」ことを、実際にメールを送らずに確かめられる。
 */
import { jsonResponse } from "../_shared/http.ts";
import { env } from "../_shared/env.ts";

// アプリ内で公開している運営の連絡先と同じ既定値
// （src/lib/legalLinks.ts の CONTACT_EMAIL）。Edge Function（Deno）と
// Expoアプリ（Node/TypeScript）はモジュール解決系が別
// （supabase/functions/deno.jsonc参照）のため直接importできず、値を
// 複製している。両者がずれた場合は src/lib/legalLinks.ts を正とする。
// 秘密ではない（アプリの問い合わせ画面に既に表示している値そのもの）ため
// ハードコードして問題ないと判断した。宛先を変えたい場合だけ、Edge
// Functionシークレット CONTENT_REPORT_NOTIFY_TO を設定すればよい
// （任意・未設定でもこの既定値で動く）。
const DEFAULT_NOTIFY_TO = "soiyalab.contact@gmail.com";

// Resendでドメイン検証済みの送信元。認証・データ管理設計書.md 12.9節で
// ログインコードのメールに使っているのと同じアカウント・同じドメインを
// そのまま使う（設計部方針：2用件でResendのアカウントを分けない）。
const FROM_ADDRESS = "おやこポイント <noreply@mail.soiyalab.com>";

/**
 * Authorizationヘッダーのbearerトークン（JWT）から role クレームだけを
 * 読む。Supabase Kong（既定 verify_jwt=true）が署名検証を済ませてから
 * この関数を呼ぶため、ここでは署名の再検証はしない（プラットフォームの
 * 検証結果を信頼する）。あくまで「service_role keyかどうか」の識別だけに
 * 使う。
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  // [呼び出し元の制限] service_role のJWTからの呼び出しのみ受け付ける
  // （上のコメント参照）。DBトリガー以外（＝anon keyしか持たない一般の
  // 呼び出し元）からの直接呼び出しをここで止める。
  if (getJwtRole(req) !== "service_role") {
    return jsonResponse({ error: "forbidden" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const reportId = (body as Record<string, unknown> | null)?.report_id;
  if (typeof reportId !== "string" || reportId.length === 0) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const to = env.contentReportNotifyTo ?? DEFAULT_NOTIFY_TO;
  const subject = "おやこポイント お問い合わせ（報告）が届きました";
  // [載せてよい内容はreport_idまでという制約] スキーマ設計.sql 65.5章(2)。
  // 自由記述の本文・表示名・家族名・family_idは一切含めない。
  const text =
    `お問い合わせ（アプリ内の報告）が1件届きました。\n\n` +
    `報告ID: ${reportId}\n\n` +
    `内容はSupabaseのTable EditorまたはSQL Editorで確認してください` +
    `（スキーマ設計.sql 65.7章）。`;

  const resendApiKey = env.resendApiKey;
  if (!resendApiKey) {
    // [ドライラン] RESEND_API_KEY未設定のときは実際にResendを呼ばず、
    // 送る予定だった内容をログに出すだけに留める。本番ではこの分岐に
    // 入らない前提（実装メモ271章）。
    console.warn(
      "notify-content-report: RESEND_API_KEY未設定のため送信をスキップしました",
      { to, subject, report_id: reportId }
    );
    return jsonResponse(
      { skipped: true, reason: "resend_api_key_not_set" },
      200
    );
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [to],
        subject,
        text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(
        "notify-content-report: Resend send failed",
        res.status,
        errText
      );
      // [65.5章(1)の考え方の延長] ここで例外を投げても、呼び出し元
      // （net.http_post）は既に完了しておりDBの記録には影響しない。
      // 502を返すのはSupabaseのEdge Function実行ログで気づけるようにする
      // ためだけの措置。
      return jsonResponse({ error: "resend_failed" }, 502);
    }

    return jsonResponse({ sent: true });
  } catch (err) {
    console.error("notify-content-report: Resend call threw", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
