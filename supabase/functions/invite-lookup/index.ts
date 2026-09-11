/**
 * invite-lookup
 *
 * 参照: 設計部/成果物/認証・データ管理設計書.md 3.1章
 *
 * 読み書き対象テーブル（すべてSELECTのみ）:
 *   - families: invite_code から家族を特定（id, name）
 *   - family_members: 特定した家族の role='child' かつ is_active=true の
 *     メンバー一覧（id, display_name, avatar_color のみ）
 *   - member_avatars: 上記メンバーのうち絵が設定されている行の line_data のみ
 *     （[2026-09-11追加] 開発部/成果物/実装メモ.md 205.8章）
 * トリガー: なし（本関数はSELECTのみで書き込みを行わないため）。
 *
 * [2026-09-11追加・プライバシーの整理] 本関数は`member_avatars.line_data`を
 * 返すようになった。これにより、招待コードを知っている人であれば
 * ログイン前でも子どものアバターの絵を取得できるようになる（display_name・
 * avatar_colorと同じ露出範囲の拡張であり、新しい種類の露出ではない）。
 * 判断根拠は実装メモ205.8章に記録した。
 * 　- 本関数はすでに同じ条件（招待コードのみで認証なし）でdisplay_name・
 * 　  avatar_colorを返している。line_dataもそれと同じ「家族内で共有される
 * 　  招待コードを鍵とする」設計に乗る。
 * 　- 企画部要件定義書.md 07-13-2章は絵について「顔が写らず線と色の座標
 * 　  データのみ」「撮影日時や位置情報のような付随データが無い」と整理
 * 　  している。
 * 　- 招待コードは家族の中でのみ共有される想定の値である。
 *
 * 認証: 不要（anon key で呼び出し可）。
 *   [補足] 「認証不要」とはユーザー個別セッションが不要という意味であり、
 *   Supabase Edge Functionsのプラットフォームレベルのverify_jwt（既定値
 *   true）自体はスキップしない。anon keyそのものが有効なJWTのため、
 *   Expoアプリが `supabase.functions.invoke()`（内部でanon keyをAuthorization
 *   ヘッダーに付与する）で呼び出せば通過する。
 * なぜservice_roleが必要か: 呼び出し時点でクライアントはまだ
 *   family_membersの行を持たない（未参加）ため、通常のRLS経由では
 *   families/family_membersを一切参照できない。招待コードそのものを
 *   「鍵」としてfamilyを特定するロジックはRLSで表現できないため、
 *   Edge Function内でservice_role clientを使いRLSをバイパスして検索する
 *   （3.1章）。
 *
 * [レート制限に関する注記] 3.1章は「レート制限をSupabase側で設定し、
 * コード総当たりを防止する」としている。これはSupabaseダッシュボード側の
 * 運用設定（API Gateway/Edge Functionsのレート制限）であり、本関数の
 * コードでは実装していない。実装メモの「未検証・未実施」欄に記載する。
 */
import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse } from "../_shared/http.ts";
import { createAdminClient } from "../_shared/supabaseAdmin.ts";

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

  const inviteCode = (body as Record<string, unknown> | null)?.invite_code;
  if (typeof inviteCode !== "string" || inviteCode.trim().length === 0) {
    return jsonResponse({ error: "invite_code_required" }, 400);
  }

  const admin = createAdminClient();

  // スキーマ設計.sql 9章 join_family_with_invite_code() と同様、招待コードは
  // 大文字で正規化して照合する（generate_invite_code()の生成文字セットも
  // 大文字のみのため、これで保護者参加フローとの挙動を揃える）。
  const normalizedCode = inviteCode.trim().toUpperCase();

  const { data: family, error: familyError } = await admin
    .from("families")
    .select("id, name")
    .eq("invite_code", normalizedCode)
    .maybeSingle();

  if (familyError) {
    console.error("invite-lookup: families lookup failed", familyError);
    return jsonResponse({ error: "internal_error" }, 500);
  }

  if (!family) {
    // 3.1章「レスポンス（失敗）」: 404 { "error": "invite_code_not_found" }
    return jsonResponse({ error: "invite_code_not_found" }, 404);
  }

  const { data: children, error: childrenError } = await admin
    .from("family_members")
    .select("id, display_name, avatar_color")
    .eq("family_id", family.id)
    .eq("role", "child")
    .eq("is_active", true);

  if (childrenError) {
    console.error(
      "invite-lookup: family_members lookup failed",
      childrenError
    );
    return jsonResponse({ error: "internal_error" }, 500);
  }

  // [2026-09-11追加・実装メモ205.8章] 上記メンバーのうち絵が設定されている
  // 行だけをまとめて取る。member_id → line_data の辞書にして返す
  // （childrenの各要素に埋め込むと、children配列をそのままURLパラメータへ
  // JSON化して渡している呼び出し元（app/child-auth/invite-code.tsx）の
  // URLが最大20KB/人ぶん膨らむため、あえて別フィールドにする）。
  // family_idでも絞る（member_avatars_before_write()トリガーにより本来
  // family_idは常に一致するはずだが、admin clientはRLSを通らないため
  // 呼び出し側の意図を明示するための保険として付けておく）。
  const childIds = (children ?? []).map((c: { id: string }) => c.id);
  let childAvatars: Record<string, unknown> = {};
  if (childIds.length > 0) {
    const { data: avatarRows, error: avatarError } = await admin
      .from("member_avatars")
      .select("member_id, line_data")
      .eq("family_id", family.id)
      .in("member_id", childIds);

    if (avatarError) {
      console.error("invite-lookup: member_avatars lookup failed", avatarError);
      return jsonResponse({ error: "internal_error" }, 500);
    }

    childAvatars = (avatarRows ?? []).reduce(
      (acc: Record<string, unknown>, row: { member_id: string; line_data: unknown }) => {
        acc[row.member_id] = row.line_data;
        return acc;
      },
      {}
    );
  }

  // 3.1章「返す情報はニックネームとアバター色のみ」＋[2026-09-11追加]絵。
  // 生年月日・学校名等の個人情報は含めない（そもそもfamily_membersに
  // 存在しない。4章参照）。
  return jsonResponse({
    family_id: family.id,
    family_name: family.name,
    children: (children ?? []).map(
      (c: { id: string; display_name: string; avatar_color: string | null }) => ({
        member_id: c.id,
        display_name: c.display_name,
        avatar_color: c.avatar_color,
      })
    ),
    // [2026-09-11追加] member_id → line_data の辞書。絵が無いメンバーは
    // キー自体が存在しない（undefinedとして扱う）。
    child_avatars: childAvatars,
  });
});
