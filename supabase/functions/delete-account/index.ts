/**
 * delete-account（新設・2026-09-21）
 *
 * 参照:
 *   - 要件定義書.md 07-33章 決定1・3・9〜12
 *   - 設計部/成果物/スキーマ設計.sql 68.5章(A)
 *   - 設計部/成果物/API仕様.md 24.4章
 *   - 開発部/成果物/実装メモ.md 273章
 *
 * 役割: 「アカウントを削除する」（決定1のB）。保護者・みまもりメンバーが、
 * アプリの中から自分のログイン用アカウント（auth.users）を削除する。
 * remove-member とは別のEdge Functionとして新設する理由:
 * remove-member が使う resolveFamilyMemberCaller
 * （_shared/parentAuth.ts）は family_members の行が is_active=true で
 * 引けることを前提にしており、引けないと403を返す。つまり家族に属して
 * いない人（決定10・parentNoFamilyの画面にいる人）は、いまの入口からは
 * 1歩も入れない。既存の退会処理にifを足して混ぜるより、入口の違う関数を
 * 1本立てるほうが安全である（既存の退会処理に一切手を入れない）。
 *
 * 読み書き対象テーブル・認証基盤:
 *   - family_members: SELECT（自分の行を auth_user_id + is_active=true で
 *     引く）、soft_remove相当のUPDATE（is_active=false）。
 *   - family_member_pins: soft_remove相当のDELETE。
 *   - families: 家族ごと削除に合流する場合のDELETE（決定4。
 *     ON DELETE CASCADEにより家族の全データが連動削除される。
 *     スキーマ設計.sql 07-33-3の28テーブル一覧を参照）。
 *   - RPC transfer_family_ownership: オーナーで、他に在籍保護者がいる
 *     場合に呼ぶ（決定5）。
 *   - auth.users: admin.auth.admin.deleteUser()でハード削除（決定9・11）。
 *
 * 認証: 保護者／みまもりメンバーのJWT（家族に属していなくてもよい。決定10）。
 * resolveFamilyMemberCaller は使わない（上記の理由）。
 *
 * ---- 破壊的操作についての注記 ----
 * このEdge Functionは、状況により (a) 自分のfamily_members行のsoft_remove、
 * (b) families行のDELETE（CASCADEで家族の全データが連動削除される。決定4）、
 * (c) auth.usersのハード削除（決定9）——のいずれか、または複数を実行する
 * 不可逆な破壊的操作である。実行前に開発部/成果物/実装メモ.md 273章へ記録
 * 済み（開発部CLAUDE.md「破壊的なDB操作は、実行前に成果物に記録する」）。
 *
 * ---- 消す順番（★決定11。スキーマ設計.sql 68.2章） ----
 * ①家族側の始末（transfer_family_ownership／soft_remove／DELETE FROM
 * families）を先に完了させ、②そのうえでauth.usersを消す。①が失敗したら
 * ②を実行しない。①が成功し②が失敗した場合、もう一度「アカウントを削除
 * する」を押せば、今度は手順2で行が引けず手順5（auth.users削除）だけが
 * 走る（べき等）。
 */
import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/http.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { env } from "../_shared/env.ts";
import { extractBearerToken, ParentAuthError } from "../_shared/parentAuth.ts";
import { verifyToken } from "../_shared/jwt.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const admin = createAdminClient();

  // 手順1: JWTを検証してauthUserIdを得る。resolveFamilyMemberCallerは
  // 使わない（family_membersの行が引けない人＝決定10の対象者を
  // 403で弾いてしまうため）。
  let authUserId: string;
  try {
    const token = extractBearerToken(req);
    const claims = await verifyToken(env.jwtSecret, token);
    authUserId = claims.sub;
  } catch (e) {
    if (e instanceof ParentAuthError) {
      return jsonResponse({ error: e.code }, e.status);
    }
    return jsonResponse({ error: "invalid_token" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const b = body as Record<string, unknown> | null;
  const confirmFamilyName = typeof b?.confirm_family_name === "string" ? b.confirm_family_name : null;

  let familyDeleted = false;

  // 手順2: family_members を auth_user_id = authUserId AND is_active = true
  // で引く。uq_family_members_auth_user_id が
  // WHERE auth_user_id IS NOT NULL AND is_active の部分ユニークインデックス
  // なので、在籍中の行は多くても1つ。引けなければ手順5へ飛ぶ（決定10の経路）。
  const { data: member, error: memberError } = await admin
    .from("family_members")
    .select("id, family_id, is_owner")
    .eq("auth_user_id", authUserId)
    .eq("is_active", true)
    .maybeSingle();

  if (memberError) {
    console.error("delete-account: family_members lookup failed", memberError);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  if (member) {
    if (member.is_owner) {
      // 手順3: オーナーならtransfer_family_ownership()をRPCで呼ぶ。
      const { data: newOwnerId, error: transferError } = await admin.rpc(
        "transfer_family_ownership",
        { p_family_id: member.family_id, p_from_member_id: member.id }
      );
      if (transferError) {
        console.error("delete-account: transfer_family_ownership failed", {
          family_id: member.family_id,
        });
        return jsonResponse({ error: "internal_error" }, 500);
      }

      if (!newOwnerId) {
        // 戻り値がNULL＝他に在籍保護者がいない（決定4）→家族ごと削除に合流する。
        const { data: family, error: familyLookupError } = await admin
          .from("families")
          .select("name")
          .eq("id", member.family_id)
          .maybeSingle();
        if (familyLookupError) {
          console.error("delete-account: family lookup failed", { family_id: member.family_id });
          return jsonResponse({ error: "internal_error" }, 500);
        }
        const actualName = family?.name?.trim() ?? "";
        // 決定17の3段目をサーバ側でも照合する（画面だけの検査だとAPIを
        // 直接叩く経路で素通りするため）。比較は前後の空白を落とした完全一致。
        if ((confirmFamilyName ?? "").trim() !== actualName) {
          return jsonResponse({ error: "family_name_mismatch" }, 400);
        }

        const { error: deleteFamilyError } = await admin
          .from("families")
          .delete()
          .eq("id", member.family_id);
        if (deleteFamilyError) {
          console.error("delete-account: family delete failed", { family_id: member.family_id });
          return jsonResponse({ error: "internal_error" }, 500);
        }
        familyDeleted = true;
        // family_membersの行はfamiliesのCASCADEで既に消えている。
        // 手順4（soft_remove）は行わない。
      }
    }

    if (!familyDeleted) {
      // 手順4: 自分をsoft_removeする（remove-memberと同じ2つ）。
      // オーナーで委譲が成功した場合も、オーナーでなかった場合も、ここを通る。
      const { error: updateError } = await admin
        .from("family_members")
        .update({ is_active: false })
        .eq("id", member.id);
      if (updateError) {
        console.error("delete-account: soft_remove update failed", { family_id: member.family_id });
        return jsonResponse({ error: "internal_error" }, 500);
      }
      const { error: pinDeleteError } = await admin
        .from("family_member_pins")
        .delete()
        .eq("member_id", member.id);
      if (pinDeleteError) {
        console.error("delete-account: pin delete failed", { family_id: member.family_id });
        return jsonResponse({ error: "internal_error" }, 500);
      }
    }
  }

  // 手順5: auth.usersをハード削除する（決定9・決定11）。
  // shouldSoftDelete（第2引数）をtrueにしないこと——ソフト削除だと
  // auth.usersの行が残り、メールアドレスも残る。それでは「データの完全
  // 削除」にならない。既定（false）のまま呼ぶ。
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(authUserId, false);
  if (deleteUserError) {
    console.error("delete-account: auth.admin.deleteUser failed", { has_family: Boolean(member) });
    // ここで失敗しても、手順3・4は既に完了している。利用者にもう一度
    // 押してもらえば、手順2で行が引けず手順5だけが走る（べき等。68.2章）。
    return jsonResponse({ error: "internal_error" }, 500);
  }

  return jsonResponse({ ok: true, family_deleted: familyDeleted });
});
