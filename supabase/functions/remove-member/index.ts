/**
 * remove-member
 *
 * 参照: 設計部/成果物/認証・データ管理設計書.md 3.4章
 *       設計部/成果物/スキーマ設計.sql 68.5章(B)(C)(D)
 *       設計部/成果物/API仕様.md 24.3・24.5章
 *       要件定義書.md 07-33章 決定2・4・5・9
 *       開発部/成果物/実装メモ.md 273章
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
 *     ほか（07-33-3章の28テーブル）が連動削除される。
 *   - RPC transfer_family_ownership: [2026-09-21追加・要件定義書07-33章
 *     決定5] soft_removeモードの対象がオーナーで、他に在籍保護者がいる
 *     場合に呼ぶ。
 *   - auth.users: [2026-09-21追加・決定9] delete_familyモードで
 *     families削除が成功したあと、実行したオーナー本人のぶんだけを
 *     admin.auth.admin.deleteUser()でハード削除する。他のメンバーの
 *     auth.usersには一切触れない（決定9でいちばん大事な線引き）。
 *   [2026-09-09削除] Supabase Storage バケット chore-photos の削除処理は撤去した。
 *   証拠写真機能の残骸撤去（やること.md 5-4、開発部/成果物/実装メモ.md 180章）で
 *   chore-photosバケット自体をDBから削除した（マイグレーション
 *   20260917020000_drop_chore_photos.sql）ため、delete_familyモードでバケットを
 *   探して削除する処理は対象が存在せず不要になった。
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
 * 連動削除される）という不可逆な破壊的操作を実行する。[2026-09-21追加]
 * 加えて、実行したオーナー本人のauth.usersのハード削除（決定9）も行う
 * ようになった。設計はすでに 認証・データ管理設計書.md 3.4章・
 * スキーマ設計.sql 68.5章で確定しているためコード実装そのものは予定
 * どおりだが、実際にデプロイ後この関数を呼び出す行為自体は破壊的操作
 * であることを、開発部/成果物/実装メモ.mdに明記する
 * （開発部CLAUDE.md「破壊的なDB操作は、実行前に成果物に記録する」に対応）。
 *
 * ---- [2026-09-21変更・後方非互換] ----
 * delete_familyモードは confirm_family_name（家族の名前。前後の空白を
 * 落とした完全一致）を新たに必須で受け取る。一致しなければ
 * 400 family_name_mismatch を返し、何も実行しない（決定17の3段目の
 * サーバ側照合。API仕様.md 24.5章）。
 */
import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/http.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";
import { env } from "../_shared/env.ts";
import { resolveFamilyMemberCaller, ParentAuthError } from "../_shared/parentAuth.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const admin = createAdminClient();

  let caller;
  try {
    // [2026-08-22変更] みまもりメンバー（07-7章）の「家族から抜ける」（自分自身の
    // soft_remove）を許可するため、role IN ('parent','supporter') を受け付ける
    // resolveFamilyMemberCaller に切り替えた。家族管理そのものの操作
    // （他者のsoft_remove・delete_family）はみまもりメンバーには許可しないよう、
    // 下記で caller.role による追加チェックを行う。
    caller = await resolveFamilyMemberCaller(admin, env.jwtSecret, req);
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
    // [2026-09-21変更・要件定義書07-33章 決定4・5] 以前はis_owner=trueの
    // 保護者をsoft_removeしようとすると常に409 owner_cannot_soft_remove
    // （「先にオーナー権限を委譲するか」という、委譲する手段が存在しない
    // 案内文言）を返していた。決定5により、他に在籍保護者がいれば
    // transfer_family_ownership()でオーナー権限を自動的に移してから
    // 抜けさせる。決定4により、他に在籍保護者がいなければ「家族ごと削除に
    // 合流」させる必要があるが、それは家族名の入力を伴う別の重さの操作
    // （delete_familyモード）であり、このEdge Function内で無言のまま
    // families行を消すことはしない。クライアントはaccount_deletion_preview()
    // の will_delete_family で事前に分岐し、合流するケースでは
    // soft_removeではなくdelete_familyモードを呼ぶ設計になっている
    // （API仕様.md 24.1・24.3章、主要画面ワイヤーフレーム.md 59.3.1節）。
    // そのため、ここでNULLが返るのは「クライアントの判定が古い（レース）」
    // という想定外の場合のみであり、409で止めてdelete_familyへの案内を返す
    // （「委譲」という存在しない機能はもう案内しない）。
    if (target.is_owner) {
      const { data: newOwnerId, error: transferError } = await admin.rpc(
        "transfer_family_ownership",
        { p_family_id: caller.familyId, p_from_member_id: target.id }
      );
      if (transferError) {
        console.error("remove-member: transfer_family_ownership failed", {
          family_id: caller.familyId,
        });
        return jsonResponse({ error: "internal_error" }, 500);
      }
      if (!newOwnerId) {
        return jsonResponse(
          {
            error: "owner_must_delete_family",
            hint: "他に在籍している保護者がいないため、抜けるには家族を削除してください",
          },
          409
        );
      }
      // 委譲成功。このまま下のsoft_remove処理へ進み、対象（元オーナー）を
      // is_active=falseにする。
    }

    // [2026-08-22追加] みまもりメンバー（07-7章）は家族管理操作（他者の退会）を
    // 行えない。呼び出し元がsupporterの場合、対象は自分自身（家族から抜ける）に
    // 限定する。
    if (caller.role === "supporter" && target.id !== caller.memberId) {
      return jsonResponse({ error: "forbidden" }, 403);
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

    // [2026-09-22追加・設計部/成果物/スキーマ設計.sql 74.12章「★申し送り」]
    // soft_removeはfamily_membersの行を物理削除しないため、push_tokensの
    // ON DELETE CASCADEが発火せず、退会後も端末識別子（Expoプッシュ
    // トークン）が残り続ける不具合があった。family_member_pinsと同じ
    // タイミングで明示的にDELETEし、退会したメンバーの端末識別子を
    // ここで消す。DB側の変更は不要（本関数はservice_role権限で動くため、
    // push_tokensのRLS〈本人限定〉を迂回してこのDELETEを実行できる）。
    const { error: pushTokenDeleteError } = await admin
      .from("push_tokens")
      .delete()
      .eq("member_id", memberId);

    if (pushTokenDeleteError) {
      console.error("remove-member: push token delete failed", pushTokenDeleteError);
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

  // [2026-09-21追加・要件定義書07-33章 決定17、API仕様.md 24.5章]
  // confirm_family_name（家族の名前）の照合。正しさの検査のためではなく
  // 一拍置かせるためだが、画面だけの検査だとAPIを直接叩く経路（開発中の
  // クライアント・再送・リトライ）で素通りするため、サーバ側でも1回照合
  // する。比較は前後の空白を落とした完全一致（大文字小文字の正規化は
  // しない。家族名は日本語であり、正規化が別の取り違えを生む）。
  const confirmFamilyName = typeof b?.confirm_family_name === "string" ? b.confirm_family_name : null;
  const { data: family, error: familyLookupError } = await admin
    .from("families")
    .select("name")
    .eq("id", caller.familyId)
    .maybeSingle();
  if (familyLookupError) {
    console.error("remove-member: family lookup failed", { family_id: caller.familyId });
    return jsonResponse({ error: "internal_error" }, 500);
  }
  const actualName = family?.name?.trim() ?? "";
  if ((confirmFamilyName ?? "").trim() !== actualName) {
    return jsonResponse({ error: "family_name_mismatch" }, 400);
  }

  // [2026-09-09削除] Supabase Storageの証拠写真削除処理は撤去した。証拠写真機能の
  // 残骸撤去（やること.md 5-4、開発部/成果物/実装メモ.md 180章）でchore-photos
  // バケット自体を削除した（マイグレーション20260917020000_drop_chore_photos.sql）
  // ため、対象が存在せず不要になった。

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

  // [2026-09-21追加・要件定義書07-33章 決定9] families削除が成功した
  // あとに、実行したオーナー本人のauth.usersだけをハード削除する。
  // 他のメンバーのauth.usersには絶対に触れない（決定9でいちばん
  // 大事な線引き。別世帯の大人〈みまもりメンバー〉やもう一方の保護者の
  // ログイン手段は、その人自身のものであって家族の持ち物ではない）。
  // shouldSoftDelete（第2引数）はtrueにしない——ソフト削除だと
  // auth.usersの行もメールアドレスも残り、「データの完全削除」に
  // ならない。
  const { error: deleteUserError } = await admin.auth.admin.deleteUser(caller.authUserId, false);
  if (deleteUserError) {
    console.error("remove-member: auth.admin.deleteUser failed", { family_id: caller.familyId });
    // families行は既に削除済みで元に戻せない。auth.usersの削除だけが
    // 失敗した状態であり、この人は「家族は無いがログインアカウントは残る」
    // 状態になる（68.2章と同じ考え方）。もう一度「アカウントを削除する」
    // （delete-account）を押せば、家族に属していない人として手順5だけが
    // 走り完了する。
    return jsonResponse({ error: "internal_error" }, 500);
  }

  return jsonResponse({ ok: true });
});
