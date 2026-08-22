/**
 * set-child-pin / remove-member 共通:
 * 「呼び出し元が保護者本人であること」の解決処理。
 *
 * 参照: 設計部/成果物/認証・データ管理設計書.md 3.3章・3.4章
 *   3.3章: 「呼び出し元は保護者の通常のSupabase Authセッション（JWT）を
 *   Authorization ヘッダーで送る。Edge Function内でそのJWTを検証し、
 *   family_members を引いて role='parent' かつ対象の子どもと同じ
 *   family_id であることを確認する。」
 *
 * Authorization: Bearer <保護者のJWT> を検証し、対応するfamily_members行
 * （role='parent', is_active=true）をservice_role clientで引いて
 * family_id/member_id/is_ownerを解決する。
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import { verifyToken } from "./jwt.ts";

export interface ParentCaller {
  familyId: string;
  memberId: string;
  isOwner: boolean;
  authUserId: string;
}

/**
 * [2026-08-22追加] みまもりメンバー（role='supporter'）対応。
 * remove-member は「家族から抜ける」（自分自身のsoft_remove）をみまもりメンバー
 * 自身にも許可する必要がある（要件定義書07-7章はみまもりメンバーの家族管理操作を
 * 禁止しているが、S13設定画面の「家族から抜ける」は自分自身の退会であり、他者への
 * 管理操作ではないため対象外と判断した）。一方 set-child-pin 等の純粋な家族管理
 * 操作は引き続き resolveParentCaller（role='parent'限定）のみを使い、
 * このヘルパーは使わせない。
 */
export interface FamilyMemberCaller extends ParentCaller {
  role: "parent" | "supporter";
}

export class ParentAuthError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function extractBearerToken(req: Request): string {
  const header =
    req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    throw new ParentAuthError(401, "missing_authorization");
  }
  const token = header.slice(7).trim();
  if (!token) {
    throw new ParentAuthError(401, "missing_authorization");
  }
  return token;
}

export async function resolveParentCaller(
  admin: SupabaseClient,
  jwtSecret: string,
  req: Request
): Promise<ParentCaller> {
  const token = extractBearerToken(req);

  let authUserId: string;
  try {
    const claims = await verifyToken(jwtSecret, token);
    authUserId = claims.sub;
  } catch {
    throw new ParentAuthError(401, "invalid_token");
  }

  const { data: member, error } = await admin
    .from("family_members")
    .select("id, family_id, is_owner, role, is_active, auth_user_id")
    .eq("auth_user_id", authUserId)
    .eq("role", "parent")
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("resolveParentCaller: family_members lookup failed", error);
    throw new ParentAuthError(500, "internal_error");
  }

  if (!member) {
    // トークン自体は有効だが、保護者としてfamily_membersに紐づいていない
    // （子ども用カスタムJWTで呼ばれた・未参加アカウント・is_active=false等）。
    // 3.3章「権限エラー時403」に合わせ403で統一する。
    throw new ParentAuthError(403, "forbidden");
  }

  return {
    familyId: member.family_id,
    memberId: member.id,
    isOwner: member.is_owner,
    authUserId,
  };
}

/**
 * [2026-08-22追加] resolveParentCaller と同じ検証だが、role IN ('parent','supporter')
 * を許可する（remove-member専用）。set-child-pin等、家族管理そのものの操作には
 * このヘルパーを使わないこと（resolveParentCaller のまま role='parent' 限定を維持する）。
 */
export async function resolveFamilyMemberCaller(
  admin: SupabaseClient,
  jwtSecret: string,
  req: Request
): Promise<FamilyMemberCaller> {
  const token = extractBearerToken(req);

  let authUserId: string;
  try {
    const claims = await verifyToken(jwtSecret, token);
    authUserId = claims.sub;
  } catch {
    throw new ParentAuthError(401, "invalid_token");
  }

  const { data: member, error } = await admin
    .from("family_members")
    .select("id, family_id, is_owner, role, is_active, auth_user_id")
    .eq("auth_user_id", authUserId)
    .in("role", ["parent", "supporter"])
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("resolveFamilyMemberCaller: family_members lookup failed", error);
    throw new ParentAuthError(500, "internal_error");
  }

  if (!member) {
    throw new ParentAuthError(403, "forbidden");
  }

  return {
    familyId: member.family_id,
    memberId: member.id,
    isOwner: member.is_owner,
    authUserId,
    role: member.role as "parent" | "supporter",
  };
}
