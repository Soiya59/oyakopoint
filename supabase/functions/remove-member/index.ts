/**
 * remove-member
 *
 * 参照: 設計部/成果物/認証・データ管理設計書.md 3.4章
 *
 * 読み書き対象テーブル・ストレージ:
 *   - family_members: 呼び出し元が保護者本人であることの解決（SELECT、
 *     _shared/parentAuth.ts経由）、対象member_idの確認（SELECT）、
 *     soft_removeモードでの is_active=false 更新（UPDATE）。
 *     [トリガー] trg_family_members_before_update
 *     （family_members_before_update()）は current_user='service_role' の
 *     場合はis_active変更ブロックを素通しする設計になっている
 *     （スキーマ設計.sql 2章のコメント参照）ため、本関数からのUPDATEは
 *     ブロックされない。
 *   - family_member_pins: soft_remove時にDELETEし、ログイン不可にする
 *     （3.4章）。
 *   - families: delete_familyモードでDELETE。ON DELETE CASCADEにより
 *     family_members / chores / chore_completions / rewards /
 *     reward_redemptions / categories / family_member_pins / push_tokens
 *     が連動削除される（スキーマ設計.sql 各テーブルのFK定義を参照。
 *     family_member_pins.member_id・push_tokens.member_id は
 *     family_members(id) への CASCADE のため、families削除→
 *     family_members削除の連鎖でさらに連動する）。
 *   - Supabase Storage バケット chore-photos: delete_familyモードでの
 *     証拠写真削除。StorageオブジェクトはRLS対象外のためservice_role
 *     （storage管理API）で実施する（3.4章・5章のフォルダ構成
 *     {family_id}/{completion_id}.jpg に基づき、family_idフォルダごと
 *     削除する）。
 *
 * 認証: 必須（保護者のJWT）。
 * なぜservice_roleが必要か: family_membersにDELETEポリシーを一切定義して
 *   いないため、通常のクライアントからは物理削除も退会も実行できない。
 *   会計整合性（chore_completions.reported_byのON DELETE RESTRICT）や
 *   オーナー不在防止などの業務ルールをアプリケーションコード側で一括
 *   チェックしてから処理する必要があるため、単純なRLSポリシーでは表現
 *   しきれず、Edge Function+service_roleに集約する（3.4章）。
 *
 * ---- 破壊的操作についての注記 ----
 * delete_familyモードは families 行のDELETE（CASCADEで家族の全データが
 * 連動削除される）という不可逆な破壊的操作を実行する。設計はすでに
 * 認証・データ管理設計書.md 3.4章で確定しているためコード実装そのものは
 * 予定どおりだが、実際にデプロイ後この関数を呼び出す行為自体は破壊的操作
 * であることを、開発部/成果物/実装メモ.mdに明記する
 * （開発部CLAUDE.md「破壊的なDB操作は、実行前に成果物に記録する」に対応）。
 */
import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/http.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { env } from "../_shared/env.ts";
import { resolveParentCaller, ParentAuthError } from "../_shared/parentAuth.ts";

const CHORE_PHOTOS_BUCKET = "chore-photos"; // 認証・データ管理設計書.md 5章

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const admin = createAdminClient();

  let caller;
  try {
    caller = await resolveParentCaller(admin, env.jwtSecret, req);
  } catch (e) {
    if (e instanceof ParentAuthError) {
      return jsonResponse({ error: e.code }, e.status);
    }
    console.error("remove-member: caller resolution failed", e);
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
  const mode = b?.mode;

  if (typeof memberId !== "string" || memberId.length === 0) {
    return jsonResponse({ error: "member_id_required" }, 400);
  }
  if (mode !== "soft_remove" && mode !== "delete_family") {
    return jsonResponse({ error: "invalid_mode" }, 400);
  }

  const { data: target, error: targetError } = await admin
    .from("family_members")
    .select("id, family_id, role, is_owner, is_active")
    .eq("id", memberId)
    .maybeSingle();

  if (targetError) {
    console.error("remove-member: target lookup failed", targetError);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  if (!target || target.family_id !== caller.familyId) {
    // [実装判断/設計書に無いケースの補完] 3.4章は対象が他家族/存在しない
    // 場合の専用エラーコードを明記していない。invite-lookup(3.1章)の404
    // 命名規約に合わせ member_not_found とした。実装メモに記載。
    return jsonResponse({ error: "member_not_found" }, 404);
  }

  if (mode === "soft_remove") {
    // バリデーション: is_owner=trueの保護者をsoft_removeしようとした場合は
    // 409 owner_cannot_soft_remove を返す（3.4章「バリデーション」の
    // 記載どおり。オーナー不在状態を防ぐ）。
    if (target.is_owner) {
      return jsonResponse(
        {
          error: "owner_cannot_soft_remove",
          hint: "先にオーナー権限を委譲するか delete_family を使ってください",
        },
        409
      );
    }

    // [実装判断/解釈の記録] 3.4章は soft_remove の対象を「子ども、または
    // 離脱する保護者自身」と記載している。これを「role='parent'の対象を
    // soft_removeできるのは本人（＝離脱する保護者自身）がAuthorizationの
    // 保護者本人としてリクエストした場合のみであり、他の保護者を強制的に
    // 退会させる操作はこのAPIの対象外」と解釈した。子ども(role='child')に
    // ついてはそのような制限の記載が無いため、家族内のどの保護者からでも
    // 退会させられる。この解釈の是非は実装メモ「8. Edge Function実装」に
    // 課題として記録し、設計部の確認を仰ぐ。
    if (target.role === "parent" && target.id !== caller.memberId) {
      return jsonResponse({ error: "forbidden" }, 403);
    }

    // 対象メンバーを is_active=false にする（子ども、または離脱する保護者
    // 自身）。会計履歴は保持される（3.4章）。
    const { error: updateError } = await admin
      .from("family_members")
      .update({ is_active: false })
      .eq("id", memberId);

    if (updateError) {
      console.error("remove-member: soft_remove update failed", updateError);
      return jsonResponse({ error: "internal_error" }, 500);
    }

    // family_member_pins の行も削除しログイン不可にする（3.4章）。
    // 対象が保護者自身の離脱の場合、そもそも行が存在しないためno-opになる。
    const { error: pinDeleteError } = await admin
      .from("family_member_pins")
      .delete()
      .eq("member_id", memberId);

    if (pinDeleteError) {
      console.error("remove-member: pin delete failed", pinDeleteError);
      return jsonResponse({ error: "internal_error" }, 500);
    }

    // 3.4章「レスポンス: 200 { "ok": true }」
    return jsonResponse({ ok: true });
  }

  // mode === "delete_family"
  //
  // [実装判断] 3.4章「member_idがis_owner=trueのオーナー本人であることを
  // 確認した上で」という記載を、「呼び出し元自身がオーナーであり、かつ
  // リクエストのmember_idとして自分自身のidを指定していること」と解釈した。
  // 単に「対象member_idがis_owner=trueであること」だけをチェックすると、
  // オーナーではない別の保護者がオーナーのmember_idを指定して家族全体を
  // 代理削除できてしまう抜け穴が生まれるため、呼び出し元本人がオーナー
  // であることも合わせて要求する。この解釈の是非は実装メモ「8. Edge
  // Function実装」に課題として記録し、設計部の確認を仰ぐ。
  if (!caller.isOwner || memberId !== caller.memberId || !target.is_owner) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  // Supabase Storageの証拠写真を削除する（5章のフォルダ構成
  // {family_id}/{completion_id}.jpg に従い、family_idフォルダごと削除）。
  //
  // [実装判断] Storage削除に失敗しても families 行の削除（退会処理本体）は
  // 継続する。Storageのライフサイクルルール（5章、90日で自動削除）が
  // 最終的な安全網になるため、Storage側の一時的な失敗で保護者の削除
  // リクエストそのものをブロックしない方が妥当と判断した。失敗はログに
  // 残す。
  try {
    const { data: files, error: listError } = await admin.storage
      .from(CHORE_PHOTOS_BUCKET)
      .list(caller.familyId);

    if (listError) {
      console.error("remove-member: storage list failed", listError);
    } else if (files && files.length > 0) {
      const paths = files.map(
        (f: { name: string }) => `${caller.familyId}/${f.name}`
      );
      const { error: removeError } = await admin.storage
        .from(CHORE_PHOTOS_BUCKET)
        .remove(paths);
      if (removeError) {
        console.error("remove-member: storage remove failed", removeError);
      }
    }
  } catch (storageException) {
    console.error("remove-member: storage cleanup threw", storageException);
  }

  // families行をDELETE。ON DELETE CASCADEで家族に紐づく全データが削除される
  // （このファイル冒頭コメント参照）。
  const { error: deleteFamilyError } = await admin
    .from("families")
    .delete()
    .eq("id", caller.familyId);

  if (deleteFamilyError) {
    console.error("remove-member: family delete failed", deleteFamilyError);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  return jsonResponse({ ok: true });
});
