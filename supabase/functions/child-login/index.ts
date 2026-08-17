/**
 * child-login
 *
 * 参照: 設計部/成果物/認証・データ管理設計書.md 3.2章
 *
 * 読み書き対象テーブル:
 *   - families: invite_code から家族を特定（SELECT）
 *   - family_members: member_id の所属家族・role・is_active確認（SELECT）
 *   - family_member_pins: pin_hash/failed_attempts/locked_until の取得
 *     （SELECT）と、照合結果に応じた更新（UPDATE）。RLSポリシー未定義の
 *     default-denyテーブルのため、service_role経由でのみアクセス可能
 *     （スキーマ設計.sql 2b章）。
 * トリガー: family_member_pins への UPDATE 時に
 *   trg_family_member_pins_before_write（role='child'であることの確認）が
 *   発火するが、対象は既にchild確認済みのメンバーのため通過する。
 *
 * 認証: 不要（anon key）。
 * なぜservice_roleが必要か: family_member_pinsがRLS未定義のdefault-deny
 *   テーブルのため。またJWT署名にAPP_JWT_SECRET（旧SUPABASE_JWT_SECRET。
 *   2026-08-15改名。_shared/env.ts参照）が必要（3.2章）。
 */
import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/http.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { env } from "../_shared/env.ts";
import { comparePin } from "../_shared/pin.ts";
import { signChildToken } from "../_shared/jwt.ts";

const MAX_ATTEMPTS = 5; // 3.2章「5回連続失敗でlocked_until = now() + 15分を設定」
const LOCK_DURATION_MS = 15 * 60 * 1000;

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const b = body as Record<string, unknown> | null;
  const inviteCode = b?.invite_code;
  const memberId = b?.member_id;
  const pin = b?.pin;

  if (
    typeof inviteCode !== "string" ||
    inviteCode.trim().length === 0 ||
    typeof memberId !== "string" ||
    memberId.length === 0 ||
    typeof pin !== "string" ||
    pin.length === 0
  ) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const admin = createAdminClient();

  // 処理内容1: invite_code から families.id を特定し、member_id がそのfamily
  // かつ role='child' かつ is_active=true であることを確認。
  const normalizedCode = inviteCode.trim().toUpperCase();

  const { data: family, error: familyError } = await admin
    .from("families")
    .select("id")
    .eq("invite_code", normalizedCode)
    .maybeSingle();

  if (familyError) {
    console.error("child-login: families lookup failed", familyError);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  if (!family) {
    // [実装判断/設計書に無いケースの補完]
    // 3.2章はinvite_code自体が無効な場合の専用エラーコードを明記していない。
    // invite-lookup（3.1章）と同じ命名 invite_code_not_found を流用した。
    // 実装メモ「8. Edge Function実装」に記載。
    return jsonResponse({ error: "invite_code_not_found" }, 404);
  }

  const { data: member, error: memberError } = await admin
    .from("family_members")
    .select("id, family_id, role, is_active, display_name")
    .eq("id", memberId)
    .maybeSingle();

  if (memberError) {
    console.error("child-login: family_members lookup failed", memberError);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  if (
    !member ||
    member.family_id !== family.id ||
    member.role !== "child" ||
    !member.is_active
  ) {
    // [実装判断/設計書に無いケースの補完] 同上。member_idが該当家族の
    // 有効な子どもでない場合のエラーコードも3.2章に明記が無いため
    // member_not_found とした。
    return jsonResponse({ error: "member_not_found" }, 404);
  }

  // 処理内容2: family_member_pins から pin_hash / failed_attempts /
  // locked_until を取得。
  const { data: pinRow, error: pinError } = await admin
    .from("family_member_pins")
    .select("pin_hash, failed_attempts, locked_until")
    .eq("member_id", memberId)
    .maybeSingle();

  if (pinError) {
    console.error(
      "child-login: family_member_pins lookup failed",
      pinError
    );
    return jsonResponse({ error: "internal_error" }, 500);
  }

  if (!pinRow) {
    // [実装判断/設計書に無いケースの補完] 保護者がまだPINを設定していない
    // 子どもへのログイン試行。3.2章はこのケースを明記していないため、
    // invalid_pinと区別できる専用コード pin_not_set を返すこととした。
    // 実装メモに記載。
    return jsonResponse({ error: "pin_not_set" }, 409);
  }

  // locked_until が未来なら 423 Locked を返す（処理内容2）。
  if (
    pinRow.locked_until &&
    new Date(pinRow.locked_until).getTime() > Date.now()
  ) {
    return jsonResponse(
      { error: "locked", locked_until: pinRow.locked_until },
      423
    );
  }

  // 処理内容3: bcryptで照合。
  const matches = await comparePin(pin, pinRow.pin_hash);

  if (!matches) {
    const nextAttempts = pinRow.failed_attempts + 1;
    const shouldLock = nextAttempts >= MAX_ATTEMPTS;

    const { error: updateError } = await admin
      .from("family_member_pins")
      .update({
        failed_attempts: nextAttempts,
        locked_until: shouldLock
          ? new Date(Date.now() + LOCK_DURATION_MS).toISOString()
          : null,
        // family_member_pinsにはupdated_at自動更新トリガーが定義されて
        // いない（他テーブルのset_updated_at相当のトリガーが無い。
        // スキーマ設計.sql 2b章参照）ため、更新のたびにここで明示的に
        // 設定する。
        updated_at: new Date().toISOString(),
      })
      .eq("member_id", memberId);

    if (updateError) {
      console.error(
        "child-login: failed_attempts update failed",
        updateError
      );
      return jsonResponse({ error: "internal_error" }, 500);
    }

    // 3.2章「401 { "error": "invalid_pin", "attempts_remaining": n } を
    // 返す」。ロックが今回発生した場合も同様にこの401レスポンスを返し、
    // 次回以降の試行が上の locked_until チェックで423になる。
    return jsonResponse(
      {
        error: "invalid_pin",
        attempts_remaining: Math.max(0, MAX_ATTEMPTS - nextAttempts),
      },
      401
    );
  }

  // 成功: failed_attempts=0, locked_until=NULLにリセット。
  const { error: resetError } = await admin
    .from("family_member_pins")
    .update({
      failed_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("member_id", memberId);

  if (resetError) {
    console.error("child-login: reset update failed", resetError);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  const { token, expiresAt } = await signChildToken(env.jwtSecret, {
    familyId: member.family_id,
    familyMemberId: member.id,
    displayName: member.display_name,
  });

  // 3.2章「レスポンス（成功）」の形に厳密に従う。
  return jsonResponse({
    access_token: token,
    expires_at: expiresAt,
    member: {
      member_id: member.id,
      display_name: member.display_name,
      family_id: member.family_id,
    },
  });
});
