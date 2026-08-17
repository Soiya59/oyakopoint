/**
 * set-child-pin
 *
 * 参照: 設計部/成果物/認証・データ管理設計書.md 3.3章
 *
 * 読み書き対象テーブル:
 *   - family_members: 呼び出し元が保護者本人であることの解決（SELECT、
 *     _shared/parentAuth.ts経由）、対象member_idが同じfamilyのrole='child'
 *     であることの確認（SELECT）。
 *   - family_member_pins: pin_hashのUPSERT（failed_attempts=0,
 *     locked_until=NULLにリセット）。RLSポリシー未定義のdefault-deny
 *     テーブルのためservice_role経由でのみ書き込み可能（スキーマ設計.sql
 *     2b章）。
 * トリガー: family_member_pins への INSERT/UPDATE 時に
 *   trg_family_member_pins_before_write（role='child'であることの確認）が
 *   発火する。本関数側でも同じ確認を行っているが、DB側の多層防御として
 *   そのまま機能する。
 *
 * 認証: 必須。呼び出し元は保護者の通常のSupabase Authセッション（JWT）を
 *   Authorizationヘッダーで送る（3.3章）。
 * なぜservice_roleが必要か: 認可チェック自体は呼び出し元の保護者トークンで
 *   行うが、実際の書き込み先family_member_pinsはRLSポリシーが無いテーブル
 *   のため、書き込みにはservice_role clientを使う（3.3章）。
 */
import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/http.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { env } from "../_shared/env.ts";
import { hashPin, isValidPin } from "../_shared/pin.ts";
import { resolveParentCaller, ParentAuthError } from "../_shared/parentAuth.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const admin = createAdminClient();

  // 呼び出し元が保護者本人であることを解決する（3.3章）。
  let caller;
  try {
    caller = await resolveParentCaller(admin, env.jwtSecret, req);
  } catch (e) {
    if (e instanceof ParentAuthError) {
      return jsonResponse({ error: e.code }, e.status);
    }
    console.error("set-child-pin: caller resolution failed", e);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const b = body as Record<string, unknown> | null;
  const memberId = b?.member_id;
  const newPin = b?.new_pin;

  if (typeof memberId !== "string" || memberId.length === 0) {
    return jsonResponse({ error: "member_id_required" }, 400);
  }

  // 処理内容1: member_id が同じfamilyのrole='child'であることを確認
  // （他家族の子どものPINを変更できないようにする）。呼び出し元JWTからの
  // family_id解決自体は上のresolveParentCallerで完了済み。
  const { data: target, error: targetError } = await admin
    .from("family_members")
    .select("id, family_id, role, is_active")
    .eq("id", memberId)
    .maybeSingle();

  if (targetError) {
    console.error("set-child-pin: target lookup failed", targetError);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  if (!target || target.family_id !== caller.familyId || target.role !== "child") {
    // 3.3章「レスポンス: ... 権限エラー時403」。他家族の子ども・存在しない
    // member_id・child以外を指定した場合はすべて権限エラーとして403に
    // まとめる。
    return jsonResponse({ error: "forbidden" }, 403);
  }

  // 処理内容2: new_pin が4桁数字であることをバリデーション。
  if (!isValidPin(newPin)) {
    return jsonResponse({ error: "invalid_pin_format" }, 400);
  }

  // 処理内容3: bcryptでハッシュ化しfamily_member_pinsをUPSERT
  // （failed_attempts=0, locked_until=NULLにリセット）。
  const pinHash = await hashPin(newPin);

  const { error: upsertError } = await admin.from("family_member_pins").upsert(
    {
      member_id: memberId,
      pin_hash: pinHash,
      failed_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "member_id" }
  );

  if (upsertError) {
    console.error("set-child-pin: upsert failed", upsertError);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  // 3.3章「レスポンス: 200 { "ok": true }」
  return jsonResponse({ ok: true });
});
