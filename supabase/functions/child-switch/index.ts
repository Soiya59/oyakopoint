/**
 * child-switch（新設・2026-09-27）
 *
 * 参照:
 *   - 要件定義書.md 07-41章
 *   - 設計部/成果物/スキーマ設計.sql 79章（特に79.1・79.2章）
 *   - 設計部/成果物/API仕様.md 35章
 *   - 開発部/成果物/実装メモ.md 311章
 *
 * 役割: 保護者（role='parent', is_active=true）が、PINを入力せずに自分の
 * 家族の子どもモードへ切り替える。`_shared/parentAuth.ts`の
 * `resolveParentCaller()`（`remove-member`等が使っているものと同一）と
 * `child-login`が発行しているのと同一の`signChildToken()`を組み合わせる
 * だけで、新しいロジックはほぼ無い（79.2章）。
 *
 * 読み書き対象テーブル:
 *   - family_members: resolveParentCallerが呼び出し元（役割・要件は
 *     child-loginと同一構造）を解決するためにSELECT。加えて、切替先の
 *     子どもが「呼び出し元と同じ家族のrole='child'かつis_active=true」で
 *     あることを確認するためにSELECT。
 *   - family_member_pins: 一切アクセスしない（79.2章手順4・79.4章）。
 *
 * 認証: 必須（保護者の通常Supabase Auth JWT）。`resolveParentCaller`が
 * role='parent'限定であるため、子ども用カスタムJWT・みまもりメンバーの
 * JWTでは403 forbiddenになる（79.7章、確認事項1「みまもりメンバーには
 * 広げない」をサーバー側でも二重に担保する）。
 *
 * なぜservice_roleが必要か: JWT署名に`CHILD_JWT_SIGNING_SECRET`が要る
 * （child-loginと同じ理由。79.2章）。
 *
 * ---- 破壊的操作についての注記 ----
 * このEdge Functionは破壊的操作を一切行わない（SELECTと子ども用JWTの
 * 発行のみ。families/family_membersへのUPDATE/DELETEは無い）。
 */
import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/http.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { env } from "../_shared/env.ts";
import { resolveParentCaller, ParentAuthError } from "../_shared/parentAuth.ts";
import { signChildToken } from "../_shared/jwt.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const admin = createAdminClient();

  let caller;
  try {
    // 79.2章「resolveFamilyMemberCallerではなくresolveParentCaller
    // （role='parent'限定の方）」。みまもりメンバー・子ども自身のJWTは
    // ここで403になる。
    caller = await resolveParentCaller(admin, env.jwtSecret, req);
  } catch (e) {
    if (e instanceof ParentAuthError) {
      return jsonResponse({ error: e.code }, e.status);
    }
    console.error("child-switch: caller resolution failed", e);
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

  if (typeof memberId !== "string" || memberId.length === 0) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  // 79.2章手順2: 切替先がcaller.familyIdと同じ家族のrole='child'かつ
  // is_active=trueであることを確認する（child-loginの処理内容1と同じ検証）。
  const { data: member, error: memberError } = await admin
    .from("family_members")
    .select("id, family_id, role, is_active, display_name")
    .eq("id", memberId)
    .maybeSingle();

  if (memberError) {
    console.error("child-switch: family_members lookup failed", memberError);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  if (
    !member ||
    member.family_id !== caller.familyId ||
    member.role !== "child" ||
    !member.is_active
  ) {
    // remove-member・child-loginと同じ命名規約（79.2章手順2）。
    return jsonResponse({ error: "member_not_found" }, 404);
  }

  // 79.2章手順3: child-loginが使っているのと同一関数・同一シークレット。
  // family_member_pinsには一切アクセスしない（79.2章手順4・79.4章）。
  const { token, expiresAt } = await signChildToken(env.childJwtSigningSecret, {
    familyId: member.family_id,
    familyMemberId: member.id,
    displayName: member.display_name,
  });

  // 79.2章「レスポンス（成功）」——child-loginと完全に同一の形。
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
