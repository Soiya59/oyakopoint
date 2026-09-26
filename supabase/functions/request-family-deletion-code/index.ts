/**
 * request-family-deletion-code（新設・2026-09-27）
 *
 * 参照:
 *   - 要件定義書.md 07-42章
 *   - 設計部/成果物/スキーマ設計.sql 80章（特に80.4・80.8・80.14章）
 *   - 設計部/成果物/API仕様.md 36.1章
 *   - 開発部/成果物/実装メモ.md 311章
 *
 * 役割: 「家族を削除する」（経路A・B・C、80.0章）を実行する直前に、
 * 実行者（オーナー）のログイン用メールアドレスへ6桁の確認コードを送る。
 *
 * 読み書き対象テーブル:
 *   - family_members: resolveParentCallerが呼び出し元（role='parent',
 *     is_active=true）を解決するためにSELECT。
 *   - family_deletion_codes: 既存行のrequested_at確認（SELECT）、
 *     新しいコードのUPSERT（INSERT/UPDATE）。RLSポリシー未定義の
 *     default-denyテーブルのため、service_role経由でのみアクセス可能
 *     （スキーマ設計.sql 80.2章）。
 *
 * 認証: 必須。`resolveParentCaller()`（79.2章・remove-member等と同一、
 * role='parent'限定）に加え、`caller.isOwner`が`false`なら403 forbidden
 * を返す（このコードはオーナーが家族を削除する場面でしか使わない。80.4章）。
 *
 * なぜservice_roleが必要か: family_deletion_codesがRLS未定義の
 * default-denyテーブルのため。
 *
 * ---- 破壊的操作についての注記 ----
 * このEdge Function自体はfamilies/family_membersへの変更を一切行わない
 * （family_deletion_codesへのUPSERTとメール送信のみ）。
 *
 * ---- ローカルでの動作確認について ----
 * RESEND_API_KEY未設定の環境（ローカル）では、実際にResendへは送らず、
 * 送る予定だった6桁のコードをログへ出す（notify-content-report・
 * スキーマ設計.sql 80.12章5番と同じ考え方）。本番ではRESEND_API_KEYが
 * 必ず設定されているためこの分岐に入らない。
 */
import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/http.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { env } from "../_shared/env.ts";
import { resolveParentCaller, ParentAuthError } from "../_shared/parentAuth.ts";
import { hashPin } from "../_shared/pin.ts";
import {
  DELETION_CODE_RESEND_COOLDOWN_MS,
  DELETION_CODE_TTL_MS,
} from "../_shared/deletionCode.ts";

// 送信元: notify-content-report・既存ログインコードと同一（認証・データ
// 管理設計書.md 12.9節「2用件でResendのアカウントを分けない」方針）。
const FROM_ADDRESS = "おやこポイント <noreply@mail.soiyalab.com>";

/**
 * 6桁の確認コードを暗号学的に安全な乱数で生成する（80.4章手順4。
 * Math.random()は使わない）。
 */
function generateDeletionCode(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (arr[0] % 1_000_000).toString().padStart(6, "0");
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const admin = createAdminClient();

  // 手順1: resolveParentCaller + isOwner確認。
  let caller;
  try {
    caller = await resolveParentCaller(admin, env.jwtSecret, req);
  } catch (e) {
    if (e instanceof ParentAuthError) {
      return jsonResponse({ error: e.code }, e.status);
    }
    console.error("request-family-deletion-code: caller resolution failed", e);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  if (!caller.isOwner) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  // 手順2: 宛先メールアドレスの取得（JWTのemailクレームのみ。追加の
  // 管理API呼び出しは不要）。
  if (!caller.email) {
    console.error("request-family-deletion-code: caller has no email claim", {
      family_id: caller.familyId,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }

  // 手順3: サーバー側の再送間隔チェック（クライアント側30秒クールダウンが
  // 直接叩かれても素通りしないための防御）。
  const { data: existing, error: lookupError } = await admin
    .from("family_deletion_codes")
    .select("requested_at")
    .eq("member_id", caller.memberId)
    .maybeSingle();

  if (lookupError) {
    console.error("request-family-deletion-code: lookup failed", {
      family_id: caller.familyId,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }

  if (
    existing &&
    Date.now() - new Date(existing.requested_at).getTime() < DELETION_CODE_RESEND_COOLDOWN_MS
  ) {
    return jsonResponse({ error: "resend_too_soon" }, 429);
  }

  // 手順4〜6: 6桁コードを生成しbcryptでハッシュ化、UPSERT。
  const code = generateDeletionCode();
  const codeHash = await hashPin(code);
  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(Date.now() + DELETION_CODE_TTL_MS).toISOString();

  const { error: upsertError } = await admin.from("family_deletion_codes").upsert({
    member_id: caller.memberId,
    code_hash: codeHash,
    failed_attempts: 0,
    locked_until: null,
    expires_at: expiresAtIso,
    requested_at: nowIso,
    updated_at: nowIso,
  });

  if (upsertError) {
    console.error("request-family-deletion-code: upsert failed", {
      family_id: caller.familyId,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }

  // 手順7: メール送信（80.8章の文面方針。80.14章「心当たりがない場合は…」の
  // 注意書きを含める）。
  const subject = "おやこポイント 家族を削除するための確認コード";
  const text =
    `家族を削除するための確認コードです。\n\n` +
    `確認コード: ${code}\n\n` +
    `このコードは1時間だけ使えます。\n\n` +
    `心当たりがない場合は、このメールは無視してください。家族は削除されません。`;

  const resendApiKey = env.resendApiKey;
  if (!resendApiKey) {
    // [ドライラン・ローカル限定] 本番ではRESEND_API_KEYが必ず設定されて
    // いるためこの分岐に入らない前提（notify-content-reportと同一）。
    console.warn(
      "request-family-deletion-code: RESEND_API_KEY未設定のため送信をスキップしました（ローカル限定でコードをログへ出す）",
      { to: caller.email, subject, code }
    );
    return jsonResponse({ ok: true });
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
        to: [caller.email],
        subject,
        text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("request-family-deletion-code: Resend send failed", res.status, errText);
      // 手順7「送信失敗時は502。UPSERTした行はそのまま残るため、利用者が
      // もう一度押せば新しいコードで再試行できる」。
      return jsonResponse({ error: "resend_failed" }, 502);
    }

    // 手順8: コードそのものは絶対にレスポンスへ含めない。
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("request-family-deletion-code: Resend call threw", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
