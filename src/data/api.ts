/**
 * Supabase呼び出しの薄いラッパー層。
 *
 * 参照: 設計部/成果物/API仕様.md（全章）
 * 各関数のコメントに対応する章番号を記載する。呼び出し先は3種類:
 * - PostgREST: `client.from(table)...`（RLSで保護される。client引数は
 *   保護者/子どものどちらのセッションで呼ぶかによって呼び出し元が
 *   src/lib/session.tsx の `client` を渡す）
 * - RPC: `supabase.rpc(...)`（SECURITY DEFINER関数。家族作成・参加は
 *   保護者の通常Auth JWTが前提のため常に既定の`supabase`クライアントを使う）
 * - Edge Function: `supabase.functions.invoke(...)`（anon key、または
 *   保護者の通常Auth JWTをAuthorizationヘッダーに使う。子ども専用クライアント
 *   からは呼ばない）
 *
 * service_role キー・APP_JWT_SECRETはこのファイルを含むクライアントコードに
 * 一切含まれない（開発部CLAUDE.md遵守事項）。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type {
  Category,
  Chore,
  ChoreCompletion,
  ChoreReaction,
  Family,
  FamilyBoardPost,
  FamilyBoardPostWithAuthor,
  FamilyBoardReaction,
  FamilyBoardReactionWithPostBody,
  FamilyBoardReactionWithReactor,
  FamilyDrawing,
  FamilyDrawingLineData,
  FamilyHomeCard,
  FamilyInvite,
  FamilyInviteLookupResult,
  FamilyMember,
  FamilyTreeMemberBreakdown,
  FamilyTreeSeason,
  GachaDrawResult,
  GachaMemberProgressSummary,
  GachaPresetOrnament,
  GachaPrizeKind,
  GratitudePoint,
  MemberPoints,
  ReactionKind,
  Reward,
  RewardRedemption,
  StampKey,
  WeeklyFamilyDigest,
} from "@/types/domain";

export interface ApiError {
  code: string;
  message: string;
  status?: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

const GENERIC_ERROR: ApiError = { code: "unknown_error", message: "通信エラーが発生しました" };

/**
 * PostgRESTが返す `code` は、`RAISE EXCEPTION ... USING ERRCODE = 'check_violation'`
 * のような可読名ではなく、Postgresの実際のSQLSTATE（5文字のコード）である
 * （API仕様.md 9章の可読名とスキーマ設計.sqlのUSING ERRCODE指定はPostgres内部で
 *  自動的にこのSQLSTATEへ変換される）。呼び出し側が可読名で分岐できるよう、
 * ここに対応表を集約する。
 */
export const PG_ERRCODE = {
  checkViolation: "23514", // 実行回数上限超過・ポイント残高不足（API仕様.md 9章）
  // [2026-08-16追記] 感謝ポイント（API仕様.md 7a章、スキーマ設計.sql 13章）の
  // 「週次原資超過」「取消期限超過・二重取消」「自己贈呈」もいずれも
  // check_violation（23514）として返る。既存コードと同一のためERRCODE自体の
  // 追加は不要（メッセージ本文はDB側のRAISE EXCEPTIONメッセージをそのまま表示すればよい）。
  foreignKeyViolation: "23503", // [2026-08-16追記] 感謝ポイントの送受信者が他家族の場合も同一
  uniqueViolation: "23505", // NFCタグ衝突・スタンプ重複・家族重複所属
  insufficientPrivilege: "42501", // [2026-08-16追記] 感謝ポイント取消でrevoked_at以外を変更しようとした場合も同一
  noDataFound: "P0002", // 招待コード無効（join_family_with_invite_code）
} as const;

/** PostgrestError（.code/.message持ち）をApiErrorへ正規化する（API仕様.md 9章のERRCODE対応）。 */
function fromPostgrestError(error: { code?: string | null; message?: string } | null): ApiError {
  if (!error) return GENERIC_ERROR;
  return { code: error.code ?? "unknown_error", message: error.message ?? GENERIC_ERROR.message };
}

/**
 * Edge Function呼び出しの共通ヘルパー。
 * supabase-js の functions.invoke() は非2xxレスポンス時に data=null, error=FunctionsHttpError
 * を返すのみで、レスポンスボディ（{ error: "invite_code_not_found" } 等）は
 * error.context（Response）から自前でJSONパースする必要があるため、ここに集約する。
 */
async function invokeEdgeFunction<T>(
  name: string,
  body: Record<string, unknown>
): Promise<ApiResult<T>> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (!error) {
    return { ok: true, data: data as T };
  }
  if (error instanceof FunctionsHttpError) {
    let parsed: { error?: string; [key: string]: unknown } | null = null;
    try {
      parsed = await error.context.json();
    } catch {
      parsed = null;
    }
    return {
      ok: false,
      error: {
        code: parsed?.error ?? "edge_function_error",
        message: parsed?.error ?? "サーバーでエラーが発生しました",
        status: error.context?.status,
      },
    };
  }
  return { ok: false, error: { code: "network_error", message: "通信できませんでした" } };
}

// ============================================================
// 1. 家族作成（保護者・最初の1人） / 2a. 保護者の招待受諾
// ============================================================

/** API仕様.md 1章 手順1: supabase.auth.signInWithOtp({ email }) */
export async function signInWithEmail(email: string, redirectTo: string): Promise<ApiResult<null>> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) return { ok: false, error: { code: error.name, message: error.message } };
  return { ok: true, data: null };
}

/**
 * マジックリンクのリダイレクトURL（`?code=...`または`#access_token=...`）を
 * 受け取ってセッションを確立する。
 *
 * [2026-08-15修正・本部長] 当初は「PKCEフロー（codeパラメータ）を優先し、
 * 無ければ何もしない（supabase-jsクライアント側のonAuthStateChangeに任せる）」
 * という設計コメントだったが、これは誤りだった。src/lib/supabase.ts の
 * createClient は detectSessionInUrl: false を明示的に指定しており
 * （React Native環境ではwindow.location.hrefが無いためexpo-linkingで手動処理
 * する設計、_layout.tsx参照）、supabase-js側の自動検出は最初から働かない。
 * そのため「codeが無ければ何もしない」実装のままだと、implicitフロー
 * （URLフラグメントに access_token=... が直接含まれる形式）で届いたリンクは
 * 永遠にセッション化されず、画面が「ログイン処理中…」のまま停止していた
 * （ユーザーと実際にメールリンクを踏んで検証した際に発見）。
 * 本プロジェクトのメールテンプレートはimplicitフロー形式のリンクを発行する
 * ため、code= が無い場合は access_token/refresh_token を自前でパースし
 * setSession() で明示的にセッションを確立するよう修正した。
 */
export async function completeEmailSignIn(url: string): Promise<ApiResult<null>> {
  if (url.includes("code=")) {
    const { error } = await supabase.auth.exchangeCodeForSession(url);
    if (error) return { ok: false, error: { code: error.name, message: error.message } };
    return { ok: true, data: null };
  }

  const fragment = url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
  const params = new URLSearchParams(fragment);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) {
    return { ok: false, error: { code: "invalid_callback_url", message: "リンクにトークンが含まれていません" } };
  }
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) return { ok: false, error: { code: error.name, message: error.message } };
  return { ok: true, data: null };
}

/** API仕様.md 1章 手順3: supabase.rpc('create_family_with_owner', ...) */
export async function createFamilyWithOwner(familyName: string, displayName: string): Promise<ApiResult<string>> {
  const { data, error } = await supabase.rpc("create_family_with_owner", {
    p_family_name: familyName,
    p_display_name: displayName,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as string };
}

/** API仕様.md 2a章 手順3: supabase.rpc('join_family_with_invite_code', ...) */
export async function joinFamilyWithInviteCode(inviteCode: string, displayName: string): Promise<ApiResult<string>> {
  const { data, error } = await supabase.rpc("join_family_with_invite_code", {
    p_invite_code: inviteCode,
    p_display_name: displayName,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as string };
}

// ============================================================
// 2. 招待（invite-lookup / child-login） 認証・データ管理設計書.md 3.1〜3.2章
// ============================================================

export interface InviteLookupChild {
  member_id: string;
  display_name: string;
  avatar_color: string | null;
}

export interface InviteLookupResult {
  family_id: string;
  family_name: string;
  children: InviteLookupChild[];
}

/** API仕様.md 2a章手順2・2c章手順1: Edge Function `invite-lookup` */
export async function inviteLookup(inviteCode: string): Promise<ApiResult<InviteLookupResult>> {
  return invokeEdgeFunction<InviteLookupResult>("invite-lookup", { invite_code: inviteCode });
}

export interface ChildLoginResult {
  access_token: string;
  expires_at: number;
  member: { member_id: string; display_name: string; family_id: string };
}

/** API仕様.md 2c章手順2: Edge Function `child-login` */
export async function childLogin(
  inviteCode: string,
  memberId: string,
  pin: string
): Promise<ApiResult<ChildLoginResult>> {
  return invokeEdgeFunction<ChildLoginResult>("child-login", {
    invite_code: inviteCode,
    member_id: memberId,
    pin,
  });
}

/**
 * 認証・データ管理設計書.md 3.3章: Edge Function `set-child-pin`。
 * 呼び出し元は保護者の通常Supabase Authセッションが必要（supabase.functions.invoke()が
 * 現在のセッションのaccess_tokenを自動でAuthorizationヘッダーに付与する）。
 */
export async function setChildPin(memberId: string, newPin: string): Promise<ApiResult<{ ok: true }>> {
  return invokeEdgeFunction<{ ok: true }>("set-child-pin", { member_id: memberId, new_pin: newPin });
}

/** 認証・データ管理設計書.md 3.4章: Edge Function `remove-member` */
export async function removeMember(
  memberId: string,
  mode: "soft_remove" | "delete_family"
): Promise<ApiResult<{ ok: true }>> {
  return invokeEdgeFunction<{ ok: true }>("remove-member", { member_id: memberId, mode });
}

// ============================================================
// 2d. みまもりメンバーの招待・参加（要件定義書.md 06章・07-7章、API仕様.md 2d章）
// 対応するスキーマはスキーマ設計.sql 25章 family_invites（新規）。
// ============================================================

/**
 * API仕様.md 2d章手順1: 招待発行（保護者操作）。role/family_id/created_by/status は
 * DBトリガー(family_invites_before_insert)が自動設定するため送らない
 * （RLS: family_invites_insert_by_parentにより保護者のみ実行可）。
 */
export async function createFamilyInvite(client: SupabaseClient, invitedEmail: string): Promise<ApiResult<FamilyInvite>> {
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await client
    .from("family_invites")
    .insert({ invited_email: invitedEmail.trim().toLowerCase(), token })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as FamilyInvite };
}

/** API仕様.md 2d章手順2: 発行済み招待の一覧（保護者操作、家族管理画面P14拡張用） */
export async function fetchFamilyInvites(client: SupabaseClient, familyId: string): Promise<ApiResult<FamilyInvite[]>> {
  const { data, error } = await client
    .from("family_invites")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as FamilyInvite[] };
}

/** API仕様.md 2d章手順2: 招待の取消（保護者操作）。pending→revokedのみ許可される。 */
export async function revokeFamilyInvite(client: SupabaseClient, inviteId: string): Promise<ApiResult<FamilyInvite>> {
  const { data, error } = await client
    .from("family_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as FamilyInvite };
}

/**
 * API仕様.md 2d章手順3: 招待プレビュー（未ログイン時）。SECURITY DEFINER RPCのため
 * anon/authenticatedのどちらでも呼べる。ログイン前に呼ぶ想定のため、常にデフォルトの
 * `supabase`クライアント（session.clientではない）を使う。
 */
export async function familyInviteLookup(token: string): Promise<ApiResult<FamilyInviteLookupResult>> {
  const { data, error } = await supabase.rpc("family_invite_lookup", { p_token: token });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: { code: "no_data_found", message: "招待が見つかりません" } };
  return { ok: true, data: row as FamilyInviteLookupResult };
}

/**
 * API仕様.md 2d章手順5: 参加確定。roleは引数に含まれず、常に招待発行時に保護者が
 * 固定した値がそのまま使われる（06章・07-7章「参加者本人が自己申告でロールを
 * 選べる設計にはしない」）。マジックリンク認証完了後（auth.uid()が存在する状態）に
 * 呼ぶため、常にデフォルトの`supabase`クライアントを使う。
 */
export async function acceptFamilyInvite(token: string, displayName: string): Promise<ApiResult<string>> {
  const { data, error } = await supabase.rpc("accept_family_invite", {
    p_token: token,
    p_display_name: displayName,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as string };
}

// ============================================================
// 家族データの読み込み（API仕様.md 3・6・6a・7章）
// ============================================================

export interface FamilyBundle {
  family: Family;
  members: FamilyMember[];
  categories: Category[];
  chores: Chore[];
  rewards: Reward[];
}

// [2026-08-30追加] 要件定義書07-15章「クエスト・ごほうびの登録者と最終編集者の記録」・
// API仕様.md 3c章/7c章。chores/rewardsの既存GETに登録者・最終編集者の表示名を
// 相乗りさせる（新しいAPI呼び出しを増やさない方針）。PostgRESTのFK名指定JOIN
// （列名ヒント）で、created_by/updated_by それぞれの参照先family_members行を
// 別名で取得する。対象がNULLの場合、PostgRESTはnullを返す
// （要件定義書07-15章4章「記録なし」表示の判定に使う）。
const CHORE_SELECT_WITH_CREATOR_EDITOR =
  "*, creator:family_members!created_by(display_name, is_active), editor:family_members!updated_by(display_name, is_active)";
const REWARD_SELECT_WITH_CREATOR_EDITOR =
  "*, creator:family_members!created_by(display_name, is_active), editor:family_members!updated_by(display_name, is_active)";

/** 家族の基本データ一式を取得する。RLSにより自分の家族の行のみが返る。 */
export async function fetchFamilyBundle(client: SupabaseClient, familyId: string): Promise<ApiResult<FamilyBundle>> {
  const [familyRes, membersRes, categoriesRes, choresRes, rewardsRes] = await Promise.all([
    client.from("families").select("*").eq("id", familyId).single(),
    client.from("family_members").select("*").eq("family_id", familyId).order("created_at"),
    client.from("categories").select("*").eq("family_id", familyId).order("sort_order"),
    client
      .from("chores")
      .select(CHORE_SELECT_WITH_CREATOR_EDITOR)
      .eq("family_id", familyId)
      .eq("is_active", true)
      .order("created_at"),
    client
      .from("rewards")
      .select(REWARD_SELECT_WITH_CREATOR_EDITOR)
      .eq("family_id", familyId)
      .eq("is_active", true)
      .order("created_at"),
  ]);

  if (familyRes.error) return { ok: false, error: fromPostgrestError(familyRes.error) };
  if (membersRes.error) return { ok: false, error: fromPostgrestError(membersRes.error) };
  if (categoriesRes.error) return { ok: false, error: fromPostgrestError(categoriesRes.error) };
  if (choresRes.error) return { ok: false, error: fromPostgrestError(choresRes.error) };
  if (rewardsRes.error) return { ok: false, error: fromPostgrestError(rewardsRes.error) };

  return {
    ok: true,
    data: {
      family: familyRes.data as Family,
      members: (membersRes.data ?? []) as FamilyMember[],
      categories: (categoriesRes.data ?? []) as Category[],
      chores: (choresRes.data ?? []) as Chore[],
      rewards: (rewardsRes.data ?? []) as Reward[],
    },
  };
}

/**
 * 家族名の変更（P17設定画面）。スキーマ設計.sql「families_update_by_parent」
 * ポリシー（保護者のみ、is_current_user_parent()）により、みまもりメンバー・
 * 子どもからの呼び出しはRLSで拒否される。
 */
/**
 * [2026-08-27追加] メンバーの表示名（ニックネーム）を変更する。
 *
 * 権限は既存のRLS `family_members_update_scoped` がそのまま担保する
 *   family_id = current_family_id() AND (is_current_user_parent() OR id = current_family_member_id())
 * すなわち**保護者は家族全員、本人は自分自身のみ**変更できる
 * （本部長・ユーザー協議で決めたルールと既存ポリシーが偶然一致していたため、
 * DB側の変更は不要だった）。役割・オーナー権限・所属家族の変更は
 * トリガー`family_members_before_update()`が引き続きブロックする。
 */
export async function updateMemberDisplayName(
  client: SupabaseClient,
  memberId: string,
  displayName: string
): Promise<ApiResult<FamilyMember>> {
  const { data, error } = await client
    .from("family_members")
    .update({ display_name: displayName })
    .eq("id", memberId)
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as FamilyMember };
}

/**
 * [2026-09-01追加] メンバーのアバターカラーを変更する（P14「設定」メンバーカード拡張）。
 * 参照: 主要画面ワイヤーフレーム.md 25章、開発部/成果物/実装メモ.md 100章。
 *
 * 権限は updateMemberDisplayName と同一で、既存のRLS `family_members_update_scoped`
 *   family_id = current_family_id() AND (is_current_user_parent() OR id = current_family_member_id())
 * がそのまま担保する（本部長がトリガー`family_members_before_update`は avatar_color を
 * 制限していないことを確認済み）。DB側に色の一意制約は追加していない（既存データに
 * 同色の在籍メンバーが存在するため）。「在籍中の他メンバーと同じ色は選べない」という
 * 重複防止は画面側のみで行う（src/lib/avatarColorAvailability.ts）。
 */
export async function updateMemberAvatarColor(
  client: SupabaseClient,
  memberId: string,
  avatarColor: string
): Promise<ApiResult<FamilyMember>> {
  const { data, error } = await client
    .from("family_members")
    .update({ avatar_color: avatarColor })
    .eq("id", memberId)
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as FamilyMember };
}

export async function updateFamilyName(
  client: SupabaseClient,
  familyId: string,
  name: string
): Promise<ApiResult<Family>> {
  const { data, error } = await client
    .from("families")
    .update({ name })
    .eq("id", familyId)
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as Family };
}

/**
 * API仕様.md 6章「獲得履歴」・6a章「日別実績」に対応。実施履歴カレンダー・通帳の両方が
 * 同じ完了報告一覧を参照するため、ここでまとめて取得する（chore_reactionsもネストする）。
 * `sinceIso` を指定すると reported_at >= sinceIso のみに絞る（無指定なら全件）。
 */
export async function fetchCompletions(
  client: SupabaseClient,
  familyId: string,
  sinceIso?: string
): Promise<ApiResult<ChoreCompletion[]>> {
  let query = client
    .from("chore_completions")
    .select("*")
    .eq("family_id", familyId)
    .order("reported_at", { ascending: false });
  if (sinceIso) query = query.gte("reported_at", sinceIso);
  const { data, error } = await query;
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as ChoreCompletion[] };
}

/**
 * 「まいにち」個人設定（chore_daily_flags、2026-08-22追加）。
 * 家族の他メンバーには見せない個人設定のため、familyIdではなくmemberIdで絞り込む
 * （RLSも本人の行のみ許可する設計。実装メモ.md参照）。
 */
export async function fetchMyDailyFlaggedChoreIds(
  client: SupabaseClient,
  memberId: string
): Promise<ApiResult<string[]>> {
  const { data, error } = await client
    .from("chore_daily_flags")
    .select("chore_id")
    .eq("member_id", memberId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []).map((row) => row.chore_id as string) };
}

export async function setChoreDailyFlag(
  client: SupabaseClient,
  familyId: string,
  memberId: string,
  choreId: string,
  flagged: boolean
): Promise<ApiResult<null>> {
  if (flagged) {
    const { error } = await client
      .from("chore_daily_flags")
      .upsert({ family_id: familyId, member_id: memberId, chore_id: choreId }, { onConflict: "member_id,chore_id" });
    if (error) return { ok: false, error: fromPostgrestError(error) };
    return { ok: true, data: null };
  }
  const { error } = await client
    .from("chore_daily_flags")
    .delete()
    .eq("member_id", memberId)
    .eq("chore_id", choreId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: null };
}

/** API仕様.md 5章「あるファミリーのリアクション一覧」相当。通帳・完了報告一覧で使う。 */
export async function fetchReactions(client: SupabaseClient, familyId: string): Promise<ApiResult<ChoreReaction[]>> {
  const { data, error } = await client
    .from("chore_reactions")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as ChoreReaction[] };
}

/** API仕様.md 6章「消費履歴」 */
export async function fetchRedemptions(client: SupabaseClient, familyId: string): Promise<ApiResult<RewardRedemption[]>> {
  const { data, error } = await client
    .from("reward_redemptions")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as RewardRedemption[] };
}

/** API仕様.md 6章「現在残高」: member_points View */
export async function fetchMemberPoints(client: SupabaseClient, familyId: string): Promise<ApiResult<MemberPoints[]>> {
  const { data, error } = await client.from("member_points").select("*").eq("family_id", familyId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as MemberPoints[] };
}

// ============================================================
// 書き込み系（API仕様.md 3a・4・4a・5・7章）
// ============================================================

/**
 * API仕様.md 4章手順3: 完了報告の作成。family_id/points/chore_title/chore_emojiはDBトリガーが自動設定する。
 *
 * [2026-08-29] 証拠写真機能の廃止（要件定義書04章・07-11章・07-12章、2026-08-24決定）に伴い
 * photo_urlの送信をやめた。列自体は履歴保持のため残している。
 */
export async function reportCompletion(
  client: SupabaseClient,
  input: { chore_id: string; reported_by: string; note: string | null }
): Promise<ApiResult<ChoreCompletion>> {
  const { data, error } = await client
    .from("chore_completions")
    .insert({
      chore_id: input.chore_id,
      reported_by: input.reported_by,
      note: input.note,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as ChoreCompletion };
}

/** API仕様.md 5章: スタンプ／コメントのリアクション付与 */
export async function addReaction(
  client: SupabaseClient,
  input: { completion_id: string; reacted_by: string; kind: ReactionKind; stamp_key?: StampKey; comment_body?: string }
): Promise<ApiResult<ChoreReaction>> {
  const { data, error } = await client
    .from("chore_reactions")
    .insert({
      completion_id: input.completion_id,
      reacted_by: input.reacted_by,
      kind: input.kind,
      stamp_key: input.kind === "stamp" ? input.stamp_key ?? null : null,
      comment_body: input.kind === "comment" ? input.comment_body ?? null : null,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as ChoreReaction };
}

/** API仕様.md 7章: ごほうび交換申請 */
export async function redeemReward(
  client: SupabaseClient,
  input: { reward_id: string; member_id: string }
): Promise<ApiResult<RewardRedemption>> {
  const { data, error } = await client
    .from("reward_redemptions")
    .insert({ reward_id: input.reward_id, member_id: input.member_id })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as RewardRedemption };
}

/** API仕様.md 3a章手順3: NFCタグをchoreに紐づける */
/**
 * クエスト（chore）の完全削除。要件定義書07-14章…ではなく、2026-08-29のユーザー要望
 * 「クエストの削除を可能とする」への対応（軽微変更ルート）。
 *
 * [破壊的操作についての事前記録・開発部CLAUDE.md「破壊的なDB操作は実行前に記録する」]
 * choresの行をDELETEする。取り消せない。ただし**完了履歴・ポイント・家族の木・通帳は
 * 一切失われない**。理由は次の2点で、本部長が本番のFK定義を確認済み。
 *  - `chore_completions.chore_id` は ON DELETE SET NULL（CASCADEではない）
 *  - `chore_completions` は完了時点の `chore_title` / `chore_emoji` / `points` を
 *    行にスナップショットとして保持している
 * 連動して消えるのは `chore_daily_flags`（ON DELETE CASCADE、「まいにち」の個人設定）のみ。
 *
 * 失われるもの:
 *  - NFCタグとの結びつき。物理タグに書かれたトークンが宙に浮き、読み取っても
 *    「見つかりません」になる（タグ値は解放されるので別のクエストに再登録はできる）
 *  - 実施履歴カレンダーで過去の記録に付く「繰り返し系か」の印
 *    （app/parent/history.tsx がクエスト側を引くため。記録自体は残る）
 *
 * 権限は既存RLSが担保する（`chores_write_family_by_parent` / `chores_write_personal_by_creator`
 * はいずれも FOR ALL のため、DELETEも同じ条件で許可される）。
 */
export async function deleteChore(client: SupabaseClient, choreId: string): Promise<ApiResult<null>> {
  // [2026-08-29修正・本部長] `.select("id")` を付けて**実際に消えた行**を受け取る。
  // これが無いと、RLSで1行もマッチしなかった場合にPostgRESTがエラーを返さないため、
  // 「何も消えていないのに成功」になる（ユーザーが実機で「jijiを消しても消えない」と発見）。
  // 具体的には、みまもりメンバーが作った scope='personal' のクエストは
  // `chores_write_personal_by_creator`（作成者本人のみ）の対象で、保護者は削除できない。
  const { data, error } = await client.from("chores").delete().eq("id", choreId).select("id");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: {
        code: "not_deleted",
        message:
          "このクエストは削除できませんでした。みまもりメンバーが自分用に登録したクエストは、登録した本人だけが削除できます。",
      },
    };
  }
  return { ok: true, data: null };
}

export async function setChoreNfcTag(
  client: SupabaseClient,
  choreId: string,
  tagValue: string
): Promise<ApiResult<Chore>> {
  const { data, error } = await client
    .from("chores")
    .update({ nfc_tag_id: tagValue })
    .eq("id", choreId)
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as Chore };
}

/** API仕様.md 4a章手順2: トークンからchoreを特定（0件でもエラーにしない。maybeSingle） */
export async function findChoreByTag(client: SupabaseClient, tagValue: string): Promise<ApiResult<Chore | null>> {
  const { data, error } = await client
    .from("chores")
    .select("*")
    .eq("nfc_tag_id", tagValue)
    .eq("is_active", true)
    .maybeSingle();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data as Chore | null) ?? null };
}

/** API仕様.md 2b章手順1: 子どもプロフィール作成（保護者操作） */
export async function createChildProfile(
  client: SupabaseClient,
  input: { family_id: string; display_name: string; avatar_color: string | null }
): Promise<ApiResult<FamilyMember>> {
  const { data, error } = await client
    .from("family_members")
    .insert({
      family_id: input.family_id,
      display_name: input.display_name,
      role: "child",
      avatar_color: input.avatar_color,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as FamilyMember };
}

/**
 * chore作成・編集フォーム（P11）の入力値。API仕様.md 3章「新規登録」「編集」に対応。
 * [2026-08-16追加] P11は従来スタブ表示のみで保存機能が無く、P19の「じぶんのお手伝い一覧」
 * が空のときの「お手伝い管理で追加する」導線（`router.push("/parent/chore-edit")`、id無し）
 * が行き止まりになっていた不具合の対応で新設した（開発部/成果物/実装メモ.md参照）。
 *
 * [2026-08-20追加] 当初`emoji`はフォーム対象外だったが、絵文字が一切表示されず
 * 一覧が見にくいとユーザーが実機で発見したため、自由入力（OS標準の絵文字キーボードを
 * 使う想定のTextInput）でフォームに追加した（43章のレイアウト改善に続く見やすさ改善）。
 */
export interface ChoreFormInput {
  category_id: string | null;
  title: string;
  emoji: string | null;
  points: number;
  is_repeatable: boolean;
  daily_limit: number | null;
  assigned_to: string | null;
}

/**
 * API仕様.md 3章「新規登録」: `supabase.from('chores').insert({ family_id, category_id,
 * title, emoji, points, is_repeatable, daily_limit, assigned_to })`。
 *
 * [注記] スキーマ設計.sql 4章 `chores_before_write` トリガーは、
 * `is_repeatable=true かつ daily_limit未指定(NULL)`のINSERTに限りdaily_limitをサーバー側で
 * 1に補完する（05章の記載どおりのデフォルト仕様）。そのためこの関数でdaily_limit=nullを
 * 渡しても、新規作成時のみ実際にはDB側で1として保存される（「無制限」にはならない）。
 * 「無制限」にしたい場合は作成後にupdateChore()でdaily_limit=nullを送る（UPDATE時は
 * このトリガーの自動補完が働かないため、そのままNULLとして保存される）。既存承認済みの
 * スキーマの挙動であり、本タスクでは変更していない（開発部/成果物/実装メモ.md参照）。
 */
export async function createChore(
  client: SupabaseClient,
  familyId: string,
  input: ChoreFormInput
): Promise<ApiResult<Chore>> {
  const { data, error } = await client
    .from("chores")
    .insert({
      family_id: familyId,
      category_id: input.category_id,
      title: input.title,
      emoji: input.emoji,
      points: input.points,
      is_repeatable: input.is_repeatable,
      daily_limit: input.daily_limit,
      assigned_to: input.assigned_to,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as Chore };
}

/** API仕様.md 3章「編集」: `supabase.from('chores').update({...}).eq('id', choreId)` */
export async function updateChore(
  client: SupabaseClient,
  choreId: string,
  input: ChoreFormInput
): Promise<ApiResult<Chore>> {
  const { data, error } = await client
    .from("chores")
    .update({
      category_id: input.category_id,
      title: input.title,
      emoji: input.emoji,
      points: input.points,
      is_repeatable: input.is_repeatable,
      daily_limit: input.daily_limit,
      assigned_to: input.assigned_to,
    })
    .eq("id", choreId)
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as Chore };
}

/**
 * [2026-08-18実装・本部長] P13（ごほうび登録・編集）が長らくStubScreenのままで
 * 「ごほうびの追加ができない」とユーザーが実機で発見した。P11（chore-edit、実装メモ.md
 * 21章）と同じ構成で、rewards用のフォーム入力型・作成/更新APIを新設する。
 *
 * [2026-08-20追加] 当初`emoji`はフォーム対象外だったが、ChoreFormInputと同じ理由
 * （43章のレイアウト改善に続く見やすさ改善）でフォームに追加した。
 */
export interface RewardFormInput {
  name: string;
  emoji: string | null;
  cost: number;
  description: string | null;
}

export async function createReward(
  client: SupabaseClient,
  familyId: string,
  input: RewardFormInput
): Promise<ApiResult<Reward>> {
  const { data, error } = await client
    .from("rewards")
    .insert({
      family_id: familyId,
      name: input.name,
      emoji: input.emoji,
      cost: input.cost,
      description: input.description,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as Reward };
}

export async function updateReward(
  client: SupabaseClient,
  rewardId: string,
  input: RewardFormInput
): Promise<ApiResult<Reward>> {
  const { data, error } = await client
    .from("rewards")
    .update({
      name: input.name,
      emoji: input.emoji,
      cost: input.cost,
      description: input.description,
    })
    .eq("id", rewardId)
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as Reward };
}

// ============================================================
// 3b. 自分専用chore管理（みまもりメンバー操作、要件定義書.md 07-7章、API仕様.md 3b章）
// 対応するスキーマはスキーマ設計.sql 19章（chores.created_by/scope、
// chores_write_personal_by_creatorポリシー）。
// [2026-08-23改訂] is_shared_with_family（可視性トグル）は要件定義書07-7章4回目の
// スコープ変更により撤回した。[2026-08-23再改訂・5回目のスコープ変更] 自分専用chore
// は常に家族全員に公開される（4回目時点の「常に非公開」から反転）。可視性を選べる
// 設定（トグル）は引き続き設けない。編集・完了報告は引き続き作成者本人のみに限定。
// ============================================================

export interface PersonalChoreFormInput {
  title: string;
  emoji: string | null;
  points: number;
  is_repeatable: boolean;
  daily_limit: number | null;
}

/**
 * API仕様.md 3b章「新規登録」: created_by/assigned_toは送らなくてよい
 * （DBトリガーchores_before_writeが呼び出し本人のmember_idで強制上書きする）。
 * scope: 'personal' 固定。RLS chores_write_personal_by_creator によりrole='supporter'
 * かつ本人のみ許可される。
 */
export async function createPersonalChore(
  client: SupabaseClient,
  familyId: string,
  input: PersonalChoreFormInput
): Promise<ApiResult<Chore>> {
  const { data, error } = await client
    .from("chores")
    .insert({
      family_id: familyId,
      scope: "personal",
      title: input.title,
      emoji: input.emoji,
      points: input.points,
      is_repeatable: input.is_repeatable,
      daily_limit: input.daily_limit,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as Chore };
}

/**
 * API仕様.md 3b章「編集」: scope列自体はペイロードに含めない
 * （DBトリガーが「公開範囲（scope）は作成後に変更できません」で拒否するため）。
 */
export async function updatePersonalChore(
  client: SupabaseClient,
  choreId: string,
  input: PersonalChoreFormInput
): Promise<ApiResult<Chore>> {
  const { data, error } = await client
    .from("chores")
    .update({
      title: input.title,
      emoji: input.emoji,
      points: input.points,
      is_repeatable: input.is_repeatable,
      daily_limit: input.daily_limit,
    })
    .eq("id", choreId)
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as Chore };
}

/** API仕様.md 3b章「論理削除（非表示化）」 */
export async function deactivateChore(client: SupabaseClient, choreId: string): Promise<ApiResult<null>> {
  const { error } = await client.from("chores").update({ is_active: false }).eq("id", choreId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: null };
}

// ============================================================
// 7b. 自分専用reward管理・交換（みまもりメンバー操作、要件定義書.md 07-7章、API仕様.md 7b章）
// 対応するスキーマはスキーマ設計.sql 20章（rewards.created_by/scope、
// rewards_write_personal_by_creatorポリシー）・23章（reward_redemptions_insert_scoped）。
// ============================================================

export interface PersonalRewardFormInput {
  name: string;
  emoji: string | null;
  cost: number;
  description: string | null;
}

export async function createPersonalReward(
  client: SupabaseClient,
  familyId: string,
  input: PersonalRewardFormInput
): Promise<ApiResult<Reward>> {
  const { data, error } = await client
    .from("rewards")
    .insert({
      family_id: familyId,
      scope: "personal",
      name: input.name,
      emoji: input.emoji,
      cost: input.cost,
      description: input.description,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as Reward };
}

export async function updatePersonalReward(
  client: SupabaseClient,
  rewardId: string,
  input: PersonalRewardFormInput
): Promise<ApiResult<Reward>> {
  const { data, error } = await client
    .from("rewards")
    .update({
      name: input.name,
      emoji: input.emoji,
      cost: input.cost,
      description: input.description,
    })
    .eq("id", rewardId)
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as Reward };
}

/** API仕様.md 7b章「論理削除（非表示化）」 */
export async function deactivateReward(client: SupabaseClient, rewardId: string): Promise<ApiResult<null>> {
  const { error } = await client.from("rewards").update({ is_active: false }).eq("id", rewardId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: null };
}

/**
 * ごほうび（reward）の完全削除。2026-08-29のユーザー要望「ごほうびにおいても削除できる
 * ようにしてほしい」への対応（軽微変更ルート）。クエストの deleteChore と対になる。
 *
 * [破壊的操作についての事前記録・開発部CLAUDE.md「破壊的なDB操作は実行前に記録する」]
 * rewardsの行をDELETEする。取り消せない。ただし**交換履歴とポイントは失われない**。
 * 本番のFK定義を確認済み:
 *  - `reward_redemptions.reward_id` は ON DELETE SET NULL（CASCADEではない）
 *  - `reward_redemptions` は交換時点の `reward_name` と `cost` を行に保持している
 *
 * **クエスト削除との違い**: `chore_completions` は絵文字も保存しているが、
 * `reward_redemptions` に emoji 列は無い（実装メモ.md 6.1章の設計判断）。そのため
 * ごほうびを削除すると、**過去の交換履歴の絵文字が元の絵文字ではなく🎁になる**
 * （src/data/store.tsx buildLedgers のフォールバック）。名前・ポイント・日付は残る。
 *
 * 権限は既存RLSが担保する（`rewards_write_family_by_parent` /
 * `rewards_write_personal_by_creator` はいずれも FOR ALL のためDELETEも同条件で許可）。
 */
export async function deleteReward(client: SupabaseClient, rewardId: string): Promise<ApiResult<null>> {
  // deleteChore と同じ理由で `.select("id")` を付ける（上のコメント参照）。
  const { data, error } = await client.from("rewards").delete().eq("id", rewardId).select("id");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: {
        code: "not_deleted",
        message:
          "このごほうびは削除できませんでした。みまもりメンバーが自分用に登録したごほうびは、登録した本人だけが削除できます。",
      },
    };
  }
  return { ok: true, data: null };
}

// ============================================================
// 感謝ポイント（API仕様.md 7a章、スキーマ設計.sql 13〜14章）
// [2026-08-16新設] 要件定義書.md v0.6 07-5章対応。全メンバー間（保護者⇄保護者、
// 保護者⇄子ども、子ども⇄子ども）で送付・受取可能。「合計贈った数／もらった数」の
// ランキング集計はAPI仕様.md 7a.3章の申し送りどおりクライアント側でも一切行わないこと。
// ============================================================

/**
 * API仕様.md 7a.1章: 呼び出し本人の残存原資（きょうまだ贈れるpt、0〜日次配布額）。
 * [2026-08-27改訂] 週50pt→1日3pt（20260827180000_gratitude_daily_allowance.sql）。
 * SECURITY DEFINER RPCのため、呼び出し本人以外の残存原資は取得できない
 * （ランキング防止のための設計判断、スキーマ設計.sql 13e章参照）。
 */
export async function fetchMyGratitudeGiveableBalance(client: SupabaseClient): Promise<ApiResult<number>> {
  const { data, error } = await client.rpc("my_gratitude_giveable_balance");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as number };
}

/**
 * API仕様.md 7a.2章手順2: 感謝ポイントを贈る。
 * sender_id/family_idはRLS・トリガーが強制するため必須ではないが、他の書き込み系
 * 関数（reportCompletion等）と一貫させ明示的に渡す。
 */
export async function sendGratitudePoints(
  client: SupabaseClient,
  input: { sender_id: string; recipient_id: string; points: number; note: string }
): Promise<ApiResult<GratitudePoint>> {
  const { data, error } = await client
    .from("gratitude_points")
    .insert({
      sender_id: input.sender_id,
      recipient_id: input.recipient_id,
      points: input.points,
      note: input.note,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as GratitudePoint };
}

/** 贈り主/受取人の表示名・アバター色をネストした感謝ポイント1行（履歴表示用）。 */
export interface GratitudePointWithCounterpart extends GratitudePoint {
  family_members: { display_name: string; avatar_color: string | null } | null;
}

/** API仕様.md 7a.3章: 自分が贈った履歴（recipient側の表示名をネスト取得） */
export async function fetchGratitudeSentHistory(
  client: SupabaseClient,
  memberId: string
): Promise<ApiResult<GratitudePointWithCounterpart[]>> {
  const { data, error } = await client
    .from("gratitude_points")
    .select("*, family_members!recipient_id(display_name, avatar_color)")
    .eq("sender_id", memberId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as unknown as GratitudePointWithCounterpart[] };
}

/** API仕様.md 7a.3章: 自分が受け取った履歴（sender側の表示名をネスト取得） */
export async function fetchGratitudeReceivedHistory(
  client: SupabaseClient,
  memberId: string
): Promise<ApiResult<GratitudePointWithCounterpart[]>> {
  const { data, error } = await client
    .from("gratitude_points")
    .select("*, family_members!sender_id(display_name, avatar_color)")
    .eq("recipient_id", memberId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as unknown as GratitudePointWithCounterpart[] };
}

/**
 * API仕様.md 7a.3章「家族全体のログ」相当。P16/C8通帳への統合表示用
 * （主要画面ワイヤーフレーム.md 4章）。取消済み分の除外は呼び出し側（src/data/store.tsx）
 * が revoked_at で行う（家族全体のログ自体は取消済みも含めて返す。取消履歴は
 * 「贈った履歴」側〔fetchGratitudeSentHistory〕でユーザー自身が確認できるようにするため）。
 */
export async function fetchGratitudeLog(client: SupabaseClient, familyId: string): Promise<ApiResult<GratitudePoint[]>> {
  const { data, error } = await client
    .from("gratitude_points")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as GratitudePoint[] };
}

/**
 * API仕様.md 7a.4章: 誤操作取消（送信から5分以内・送信者本人のみ）。
 * クライアントが指定するrevoked_atの値自体は使われず、BEFORE UPDATEトリガー
 * （gratitude_points_before_update）が常にサーバー側のnow()で上書きする。
 */
export async function revokeGratitudePoints(
  client: SupabaseClient,
  gratitudePointId: string
): Promise<ApiResult<GratitudePoint>> {
  const { data, error } = await client
    .from("gratitude_points")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", gratitudePointId)
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as GratitudePoint };
}

// ============================================================
// 家族の木（要件定義書07-9章、API仕様.md 9章）・
// 色分けによる個人の可視化（07-10章、API仕様.md 9.2〜9.3章）
// 対応するスキーマはスキーマ設計.sql 29章（family_tree_seasons本体・
// family_tree_current_season/family_tree_member_breakdown の2View）。
// 書き込みはトリガー・SECURITY DEFINER関数のみが行うため、本ファイルには
// 読み取り専用の関数のみを用意する（クライアント側に「木を育てる」専用APIは
// 存在しない。API仕様.md 9.5節）。
// ============================================================

/** API仕様.md 9.1章: 進行中シーズンの状態（0件のことがあり得るためmaybeSingle）。 */
export async function fetchFamilyTreeCurrentSeason(
  client: SupabaseClient,
  familyId: string
): Promise<ApiResult<FamilyTreeSeason | null>> {
  const { data, error } = await client
    .from("family_tree_current_season")
    .select("*")
    .eq("family_id", familyId)
    .maybeSingle();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data as FamilyTreeSeason | null) ?? null };
}

/** API仕様.md 9.4章: 過去分も含めた全シーズン一覧（新しい順）。20.0節決定6「先月の木」表示用。 */
export async function fetchFamilyTreeSeasonHistory(
  client: SupabaseClient,
  familyId: string
): Promise<ApiResult<FamilyTreeSeason[]>> {
  const { data, error } = await client
    .from("family_tree_seasons")
    .select("*")
    .eq("family_id", familyId)
    .order("season_start", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as FamilyTreeSeason[] };
}

/**
 * API仕様.md 9.3章: 詳細内訳（今シーズンのメンバー別完了報告件数）。
 * 必須3条件（07-10章）: 呼び出し側は必ずmember_created_at昇順で並べ替えること。
 * completion_count順にソートしてはならない（Viewは意図的にORDER BYを持たない）。
 */
export async function fetchFamilyTreeMemberBreakdown(
  client: SupabaseClient,
  familyId: string
): Promise<ApiResult<FamilyTreeMemberBreakdown[]>> {
  const { data, error } = await client
    .from("family_tree_member_breakdown")
    .select("*")
    .eq("family_id", familyId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as FamilyTreeMemberBreakdown[];
  // ソートしない要件（07-10章必須条件1）を満たしつつ、表示順だけ登録順に揃える。
  return { ok: true, data: [...rows].sort((a, b) => (a.member_created_at < b.member_created_at ? -1 : 1)) };
}

/**
 * [2026-08-26新設・第4段階] 完了報告が景品と交換済みの場合の詳細。
 * `family_tree_decorations`経由で`gacha_draws`（さらにその先の
 * `gacha_preset_ornaments`／`family_drawings`）を辿った内容（API仕様.md 12.5章）。
 */
export interface FamilyTreeDotPrize {
  decorationId: string;
  drawId: string;
  prizeKind: GachaPrizeKind;
  presetOrnament: { display_name: string; emoji: string | null } | null;
  drawing: { line_data: FamilyDrawingLineData } | null;
}

/**
 * 完了報告1件ごとの視覚要素の色付け用（API仕様.md 9.2章）。今シーズン開始以降の完了報告を報告者の色付きで返す。
 * [2026-08-26改訂・第4段階] `prize`（非null＝景品に交換済み）を追加し、
 * `family_tree_decorations`をembedするよう変更した（API仕様.md 12.5章のクエリ形状）。
 */
export interface FamilyTreeCompletionDot {
  id: string;
  reported_at: string;
  reported_by: string;
  avatar_color: string | null;
  prize: FamilyTreeDotPrize | null;
}

/**
 * [2026-08-26改訂・第4段階] `seasonEndIso`を追加した。省略時（進行中シーズン）は
 * 従来どおり`reported_at >= seasonStartIso`のみで絞り込む。指定すると
 * `< seasonEndIso`も加わり、過去シーズンの木を当時のデータのまま再現する用途にも
 * 使える（API仕様.md 12.5章「過去の木」区画のクエリと同じ形状。
 * [2026-08-27追加・第5段階] コレクター棚「過去の木」区画（本ファイル末尾
 * `fetchFamilyCollectedGachaDraws`の近く、useCollectorShelf.ts）が
 * `seasonEndIso`を指定してこの関数をそのまま呼び出す）。
 */
/**
 * PostgRESTの埋め込み結果を必ず配列として扱うための正規化。
 *
 * [2026-08-26修正・本部長] `family_tree_decorations.completion_id`には
 * UNIQUE制約があるため、PostgRESTはこの埋め込みを**1対1と判断してオブジェクトで返す**
 * （配列ではない）。実装当初は配列前提で`[0]`を取っていたため、景品が常に
 * undefinedとなり木に一切表示されず、また「飾り済みか」の判定
 * （`.length === 0`）も常にtrueになり飾り済みの記録が候補に出続けていた。
 * 実際のAPIレスポンスを確認して判明。将来UNIQUE制約が外れれば配列で返るため、
 * どちらの形でも動くようにここで吸収する。
 */
function asEmbeddedArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export async function fetchFamilyTreeCompletionDots(
  client: SupabaseClient,
  familyId: string,
  seasonStartIso: string,
  seasonEndIso?: string | null
): Promise<ApiResult<FamilyTreeCompletionDot[]>> {
  let query = client
    .from("chore_completions")
    .select(
      "id, reported_at, reported_by, family_members!reported_by(avatar_color), " +
        "family_tree_decorations(id, draw_id, gacha_draws(prize_kind, " +
        "preset_ornament:gacha_preset_ornaments(display_name,emoji), " +
        "prize_drawing:family_drawings!gacha_draws_prize_drawing_id_fkey(line_data)))"
    )
    .eq("family_id", familyId)
    .gte("reported_at", seasonStartIso)
    .order("reported_at");
  if (seasonEndIso) query = query.lt("reported_at", seasonEndIso);
  const { data, error } = await query;
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as unknown as {
    id: string;
    reported_at: string;
    reported_by: string;
    family_members: { avatar_color: string | null } | null;
    // UNIQUE制約のためPostgRESTはオブジェクトで返す（asEmbeddedArrayで吸収する）。
    family_tree_decorations:
      | {
          id: string;
          draw_id: string;
          gacha_draws: {
            prize_kind: GachaPrizeKind;
            preset_ornament: { display_name: string; emoji: string | null } | null;
            prize_drawing: { line_data: FamilyDrawingLineData } | null;
          } | null;
        }
      | null;
  }[];
  return {
    ok: true,
    data: rows.map((r) => {
      // family_tree_decorationsはcompletion_idにUNIQUE制約があるため実際は0〜1件だが、
      // PostgRESTの埋め込みは（gacha_draws側からの`family_tree_decorations(id)`と
      // 同様に）配列で返る。API仕様.md 12.3章「空配列の行が未反映」と同じ扱いで
      // 先頭要素の有無だけを見る。
      const decoration = asEmbeddedArray(r.family_tree_decorations)[0] ?? null;
      const prize: FamilyTreeDotPrize | null =
        decoration && decoration.gacha_draws
          ? {
              decorationId: decoration.id,
              drawId: decoration.draw_id,
              prizeKind: decoration.gacha_draws.prize_kind,
              presetOrnament: decoration.gacha_draws.preset_ornament,
              drawing: decoration.gacha_draws.prize_drawing,
            }
          : null;
      return {
        id: r.id,
        reported_at: r.reported_at,
        reported_by: r.reported_by,
        avatar_color: r.family_members?.avatar_color ?? null,
        prize,
      };
    }),
  };
}

// ============================================================
// 今週のまとめメッセージ（要件定義書07-8章、API仕様.md 10章）
// 対応するスキーマはスキーマ設計.sql 31章（weekly_family_digests本体・
// generate_weekly_family_digest/generate_weekly_family_digests_for_all_families）。
// 生成は週次バッチ（pg_cron）のみが行う。クライアントからは直近1件を読むだけでよい
// （API仕様.md 10.1章）。生成用RPCはservice_roleにのみEXECUTE権限があり、
// クライアント（authenticated）からは呼び出せない（実装メモ.md 66章参照）。
// ============================================================

// ============================================================
// お絵かき（要件定義書07-13-2章、API仕様.md 12.2章）
// [2026-08-26新設・第2段階] 対応するスキーマはスキーマ設計.sql 33b章 family_drawings。
// 第1段階（DB基盤、実装メモ.md 69章）は本部長により秘匿性検証済み・本番適用済み。
// [重要] draw_gacha()等（33d章・API仕様.md 12.3章）はガチャ機能（第3段階）の範囲であり、
// ここには一切実装しない。
// ============================================================

/**
 * API仕様.md 12.2章「自分の絵の一覧（未公開＋公開済み）を見る」。RLS
 * （family_drawings_select_scoped、33b章）により他人の未公開の絵は構造上
 * 一切返らない（0件になるだけでエラーにもならない）。第2段階のUIは未公開分のみを
 * 表示に使うが、クエリ自体はAPI仕様.md記載どおり絞り込まずに取得しておく
 * （将来のコレクター棚〔第5段階〕実装時にそのまま流用できるようにするため）。
 */
export async function fetchMyDrawings(client: SupabaseClient, memberId: string): Promise<ApiResult<FamilyDrawing[]>> {
  const { data, error } = await client
    .from("family_drawings")
    .select("*")
    .eq("artist_member_id", memberId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as FamilyDrawing[] };
}

/**
 * API仕様.md 12.2章「新しい絵を描いて保存」。family_id/artist_member_id/is_published/
 * published_at/revealed_by_draw_idはいずれもDBトリガー（family_drawings_before_insert、
 * 33b章）が常に上書きするため送らない。未公開の保有上限（同時3枚、
 * max_unpublished_drawings_per_member()）を超えるINSERTはcheck_violation（23514、
 * PG_ERRCODE.checkViolation）で拒否される。クライアント側でも同じ上限（
 * theme.drawingLimits）で事前にボタンを無効化し、通常この経路のエラーには
 * 到達しない設計だが、DB側を最終防衛線として保つ（開発部CLAUDE.md/API仕様.md 12.2章）。
 */
export async function createDrawing(
  client: SupabaseClient,
  lineData: FamilyDrawingLineData
): Promise<ApiResult<FamilyDrawing>> {
  const { data, error } = await client
    .from("family_drawings")
    .insert({ line_data: lineData })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as FamilyDrawing };
}

/**
 * API仕様.md 12.2章「未公開の絵を削除する（描き直したい場合）」
 * （【2026-08-25本部長決定B】family_drawings_delete_own_unpublishedポリシー）。
 * 公開済み（is_published=true）の行はRLSのUSING句を満たさないため対象0件になる
 * だけでエラーにはならない（33b章コメント参照。呼び出し側で「削除できなかった」旨の
 * ハンドリングは不要）。
 */
export async function deleteDrawing(client: SupabaseClient, drawingId: string): Promise<ApiResult<null>> {
  const { error } = await client.from("family_drawings").delete().eq("id", drawingId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: null };
}

/**
 * API仕様.md 12.2a章「未公開の絵を編集する」（2026-09-01・統括決定「公開前の編集」）。
 * SECURITY DEFINERのRPC `edit_unpublished_drawing()`（スキーマ設計.sql 38章）が
 * 「対象が自分の未公開の絵であることを確認→削除→新しい線データでINSERT」を
 * 1トランザクションで不可分に行い、成功時は新しい絵のidを返す。
 *
 * 起こりうるエラー（API仕様.md 11章）:
 * - `no_data_found`（P0002）: 対象が存在しない、または自分の未公開の絵でない。
 *   自分の未公開の絵一覧からのみ編集導線を出していれば通常は到達しない。
 * - `check_violation`（23514）: (a) 編集中に他の家族のガチャで対象の絵が
 *   先に公開された（このRPC固有のメッセージ「この絵はすでに家族に公開
 *   されました。編集内容は保存されていません」が返る）。(b) 線データが
 *   33b章の上限（線数・点数・バイト数・パレット）を超えている（createDrawingと
 *   同じ検証。この場合は元の絵は削除されずそのまま残る）。
 * いずれもDB側のRAISE EXCEPTIONメッセージをそのまま表示すればよい。
 */
export async function editUnpublishedDrawing(
  client: SupabaseClient,
  drawingId: string,
  lineData: FamilyDrawingLineData
): Promise<ApiResult<string>> {
  const { data, error } = await client.rpc("edit_unpublished_drawing", {
    p_drawing_id: drawingId,
    p_new_line_data: lineData,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as string };
}

// ============================================================
// ガチャ（要件定義書07-13-1章、API仕様.md 12.1・12.3章）
// [2026-08-26新設・第3段階] 対応するスキーマはスキーマ設計.sql 33a章
// gacha_member_progress_summary／33c章 gacha_preset_ornaments／
// 33d章 gacha_draws・draw_gacha()。第1段階（69章）で本番適用・秘匿性検証済み。
// [2026-08-26追加・第4段階] 木への飾り付け（decorate_tree_with_gacha_prize()、
// family_tree_decorations）は本セクション末尾に追加した。
// [2026-08-27追加・第5段階] コレクター棚「集めたもの」区画向けの一覧クエリ
// （fetchFamilyCollectedGachaDraws）は本セクション末尾に追加した。
// ============================================================

/**
 * API仕様.md 12.1章「あと◯回でガチャ」。行が存在しない（`maybeSingle()`が`null`）
 * 場合は対象メンバーがまだ1件も完了報告していない状態であり、呼び出し側は
 * remaining_until_next_draw=5・can_draw_now=falseとして扱うこと（スキーマ設計.sql 33a章）。
 */
export async function fetchGachaProgressSummary(
  client: SupabaseClient,
  memberId: string
): Promise<ApiResult<GachaMemberProgressSummary | null>> {
  const { data, error } = await client
    .from("gacha_member_progress_summary")
    .select("*")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data as GachaMemberProgressSummary | null) ?? null };
}

/**
 * API仕様.md 12.3章「ガチャを引く」。`draw_gacha()`は引数を一切取らない
 * （景品をクライアントが指定できないようにするための構造的な設計、スキーマ設計.sql 33d章）。
 * `RETURNS TABLE`のため`data`は配列で返る（常に1行）。
 */
export async function drawGacha(client: SupabaseClient): Promise<ApiResult<GachaDrawResult>> {
  const { data, error } = await client.rpc("draw_gacha");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: { code: "unknown_error", message: "抽選結果を取得できませんでした" } };
  return { ok: true, data: row as GachaDrawResult };
}

/**
 * API仕様.md 12.3章「景品の詳細」既製の飾り側。`gacha_preset_ornaments_select_authenticated`
 * ポリシーにより認証済みなら誰でもSELECT可（全家族共通のグローバルカタログ、33c章）。
 */
export async function fetchGachaPresetOrnament(
  client: SupabaseClient,
  ornamentId: string
): Promise<ApiResult<GachaPresetOrnament>> {
  const { data, error } = await client
    .from("gacha_preset_ornaments")
    .select("*")
    .eq("id", ornamentId)
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as GachaPresetOrnament };
}

/** `family_drawings`に作成者の表示名をネストした、ガチャ結果表示用の1行。 */
export interface GachaPrizeDrawing extends FamilyDrawing {
  family_members: { display_name: string } | null;
}

/**
 * API仕様.md 12.3章「景品の詳細」家族の絵側。`draw_gacha()`実行後は既に
 * `is_published=true`になっているため`family_drawings_select_scoped`ポリシーの
 * SELECT条件（`is_published`側）を満たし、家族の誰からでも取得できる。
 * 「誰が描いたものかが分かる形にする」（依頼要件、07-13-2章「秘密が初めて家族に
 * 公開される瞬間」）ため、作成者の表示名をネストして取得する。
 */
export async function fetchGachaPrizeDrawing(
  client: SupabaseClient,
  drawingId: string
): Promise<ApiResult<GachaPrizeDrawing>> {
  const { data, error } = await client
    .from("family_drawings")
    .select("*, family_members!artist_member_id(display_name)")
    .eq("id", drawingId)
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as unknown as GachaPrizeDrawing };
}

// ------------------------------------------------------------
// 木への飾り付け（要件定義書07-13-4章、API仕様.md 12.3章）
// [2026-08-26新設・第4段階] 対応するスキーマはスキーマ設計.sql 33e章
// family_tree_decorations・decorate_tree_with_gacha_prize()。第1段階（69章）で
// 本番適用済み（家族の木のDB基盤と同じマイグレーションに含まれる）。
// コレクター棚（第5段階、集めたもの一覧・過去の木）は本ファイル末尾の専用セクションに
// 実装した（fetchFamilyCollectedGachaDraws。過去の木は既存のfetchFamilyTreeCompletionDots・
// fetchFamilyTreeSeasonHistoryをそのまま流用するため新規関数は無い）。
// ------------------------------------------------------------

/**
 * API仕様.md 12.3章「自分のガチャ結果のうち、まだ木に反映していないものを見る」。
 * 主要画面ワイヤーフレーム.md 21.2節「未配置の景品あり」バナー（ガチャ画面）用。
 */
export interface UndecoratedGachaDraw {
  draw_id: string;
  prize_kind: GachaPrizeKind;
  preset_ornament_id: string | null;
  prize_drawing_id: string | null;
  drawn_at: string;
}

export async function fetchUndecoratedGachaDraws(
  client: SupabaseClient,
  memberId: string
): Promise<ApiResult<UndecoratedGachaDraw[]>> {
  const { data, error } = await client
    .from("gacha_draws")
    .select("id, prize_kind, preset_ornament_id, prize_drawing_id, drawn_at, family_tree_decorations(id)")
    .eq("member_id", memberId)
    // [2026-08-27追加] 木に飾れるのは家族の絵のみ（既製の飾りは棚に保管するだけ）。
    // 飾れないものに対して「まだ飾っていない景品があります」と案内してしまうと、
    // 促されたのに飾れないという行き止まりになるため、ここで除外する。
    // DB側でも decorate_tree_with_gacha_prize() が既製の飾りを拒否する
    // （マイグレーション 20260827063303、UIだけの制限にしない方針）。
    .eq("prize_kind", "family_drawing")
    .order("drawn_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as unknown as {
    id: string;
    prize_kind: GachaPrizeKind;
    preset_ornament_id: string | null;
    prize_drawing_id: string | null;
    drawn_at: string;
    family_tree_decorations: { id: string } | { id: string }[] | null;
  }[];
  return {
    ok: true,
    data: rows
      .filter((r) => asEmbeddedArray(r.family_tree_decorations).length === 0)
      .map((r) => ({
        draw_id: r.id,
        prize_kind: r.prize_kind,
        preset_ornament_id: r.preset_ornament_id,
        prize_drawing_id: r.prize_drawing_id,
        drawn_at: r.drawn_at,
      })),
  };
}

/**
 * 木に飾る対象として選べる、自分の今シーズンの完了報告（未交換分のみ）。
 * 主要画面ワイヤーフレーム.md 21.0節「新規APIの要否について（確定）」のとおり、
 * 新規APIの追加は不要という本部長判断に基づき、既存の`chore_completions`への
 * 通常SELECT（RLS: 家族内は閲覧可）で成立させる。
 */
export interface DecoratableCompletion {
  id: string;
  chore_title: string;
  chore_emoji: string;
  reported_at: string;
}

export async function fetchMyDecoratableCompletions(
  client: SupabaseClient,
  familyId: string,
  memberId: string,
  seasonStartIso: string
): Promise<ApiResult<DecoratableCompletion[]>> {
  const { data, error } = await client
    .from("chore_completions")
    .select("id, chore_title, chore_emoji, reported_at, family_tree_decorations(id)")
    .eq("family_id", familyId)
    .eq("reported_by", memberId)
    .gte("reported_at", seasonStartIso)
    .order("reported_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as unknown as {
    id: string;
    chore_title: string;
    chore_emoji: string;
    reported_at: string;
    family_tree_decorations: { id: string } | { id: string }[] | null;
  }[];
  return {
    ok: true,
    data: rows
      .filter((r) => asEmbeddedArray(r.family_tree_decorations).length === 0)
      .map((r) => ({ id: r.id, chore_title: r.chore_title, chore_emoji: r.chore_emoji, reported_at: r.reported_at })),
  };
}

/**
 * API仕様.md 12.3章「選んだ色丸に景品を飾る」。`decorate_tree_with_gacha_prize()`は
 * 「自分の」ガチャ結果と「自分の」今シーズンの完了報告しか受け付けず、他人の
 * ID・過去シーズンのID・既に交換済みのIDを渡した場合はいずれもDB側で拒否される
 * （スキーマ設計.sql 33e章、検証はすべてfunction内で完結）。戻り値は新規
 * `family_tree_decorations.id`（UUID）。
 */
export async function decorateTreeWithGachaPrize(
  client: SupabaseClient,
  drawId: string,
  completionId: string
): Promise<ApiResult<string>> {
  const { data, error } = await client.rpc("decorate_tree_with_gacha_prize", {
    p_draw_id: drawId,
    p_completion_id: completionId,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as string };
}

// ------------------------------------------------------------
// コレクター棚「集めたもの」区画（要件定義書07-13-3章、API仕様.md 12.4章）
// [2026-08-27新設・第5段階（最終段階）]
// 「過去の木」区画は新規関数を追加しない（要件定義書07-13-7章・API仕様.md 12.5章の
// とおり既存の`fetchFamilyTreeCompletionDots`〔seasonEndIso指定〕・
// `fetchFamilyTreeSeasonHistory`〔29章〕の組み合わせで完全に再現できるため）。
//
// [本部長への実装メモ・重要] API仕様.md 12.4章記載のクエリ例
// `prize_drawing:family_drawings(line_data,artist_member_id)` は
// 第4段階でPGRST201（曖昧な関係）を引き起こした形と全く同じ形（gacha_draws↔
// family_drawingsの相互参照）である。本関数では33d章コメントに明記されている
// 実際のFK制約名（`gacha_draws_prize_drawing_id_fkey`、`ALTER TABLE ADD COLUMN
// prize_drawing_id UUID NULL REFERENCES family_drawings(id)`の暗黙生成名）を
// 明示して回避した。実際に叩いて確認した結果は開発部/成果物/実装メモ.md
// 「第5段階：コレクター棚」章に記録した。
// ------------------------------------------------------------

/**
 * コレクター棚「集めたもの」区画の1件（API仕様.md 12.4章）。
 * `gacha_draws`から見て`member_id`（誰が引いたか＝獲得した人）・
 * `preset_ornament_id`・`prize_drawing_id`はいずれも本テーブル自身が持つ外部キー
 * であるため、埋め込みは常に単一オブジェクトで返る（`family_tree_decorations`の
 * ような「UNIQUE制約により1対1になったため配列がオブジェクトに変わる」特殊系
 * ではない。第4段階の教訓`asEmbeddedArray`はここでは不要）。
 */
export interface CollectedGachaDraw {
  id: string;
  drawnAt: string;
  prizeKind: GachaPrizeKind;
  /** ガチャを引いて獲得した人（07-13-3章「引いた人のものではなく家族のもの」だが、獲得の記録として表示する）。 */
  collectorName: string;
  presetOrnament: { display_name: string; emoji: string | null } | null;
  drawing: { line_data: FamilyDrawingLineData; artistName: string } | null;
}

/**
 * API仕様.md 12.4章「家族が集めた景品一覧（家族共有・永久保管）」。
 * `gacha_draws_select_same_family`ポリシーにより家族全員が閲覧可能。未公開の絵は
 * `draw_gacha()`が景品として選んだ時点で必ず`is_published=true`に更新済みのため
 * （33d章）、本クエリが未公開の絵を返すことは構造上ない（UI側の絞り込みは不要だが、
 * 依頼の「未公開の絵は棚に出してはいけない」はDB側の`family_drawings_select_scoped`
 * ポリシーとあわせてこの経路でも二重に守られている）。
 */
export async function fetchFamilyCollectedGachaDraws(
  client: SupabaseClient,
  familyId: string
): Promise<ApiResult<CollectedGachaDraw[]>> {
  const { data, error } = await client
    .from("gacha_draws")
    .select(
      "id, drawn_at, prize_kind, " +
        "collector:family_members!member_id(display_name), " +
        "preset_ornament:gacha_preset_ornaments(display_name,emoji), " +
        "prize_drawing:family_drawings!gacha_draws_prize_drawing_id_fkey(line_data," +
        "artist:family_members!artist_member_id(display_name))"
    )
    .eq("family_id", familyId)
    .order("drawn_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as unknown as {
    id: string;
    drawn_at: string;
    prize_kind: GachaPrizeKind;
    collector: { display_name: string } | null;
    preset_ornament: { display_name: string; emoji: string | null } | null;
    prize_drawing: { line_data: FamilyDrawingLineData; artist: { display_name: string } | null } | null;
  }[];
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      drawnAt: r.drawn_at,
      prizeKind: r.prize_kind,
      collectorName: r.collector?.display_name ?? "だれか",
      presetOrnament: r.preset_ornament,
      drawing: r.prize_drawing
        ? { line_data: r.prize_drawing.line_data, artistName: r.prize_drawing.artist?.display_name ?? "だれか" }
        : null,
    })),
  };
}

/** API仕様.md 10.1章: 直近（今週）のメッセージを取得する。未生成のごく短い時間帯は0件（null）になり得る。 */
export async function fetchLatestWeeklyFamilyDigest(
  client: SupabaseClient,
  familyId: string
): Promise<ApiResult<WeeklyFamilyDigest | null>> {
  const { data, error } = await client
    .from("weekly_family_digests")
    .select("*")
    .eq("family_id", familyId)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data as WeeklyFamilyDigest | null) ?? null };
}

// ============================================================
// 13. 家族の書き込みボード（要件定義書07-14章、API仕様.md 13章、
//     スキーマ設計.sql 35〜36章、2026-08-28追加）
//
// [2026-08-28追加] 第1段階は「見る」機能のみだった。
// [2026-08-29追加・第2段階] 投稿（13.1章）・上限確認RPC（13.2章）・削除（13.5章、
// 2026-08-29改訂＝RPC方式）を追加する。プッシュ通知（13.6章）は実装しない
// （要件定義書08章「実装状況の記録・2026-08-28追加」、本部長指示）。
// ============================================================

/**
 * API仕様.md 13.3章: ホームカードに表示する内容を1件取得する
 * （family_board_postsの削除されていない最新1件があればそれ、無ければ
 * weekly_family_digestsの当該週メッセージ、という優先順位の統合をDB側の
 * View〈family_home_card〉が1本化している。クライアント側では分岐しない）。
 * 投稿もまとめメッセージも1件も無い家族（参加直後等）では0件（null）になり得る。
 */
export async function fetchFamilyHomeCard(
  client: SupabaseClient,
  familyId: string
): Promise<ApiResult<FamilyHomeCard | null>> {
  const { data, error } = await client
    .from("family_home_card")
    .select("*")
    .eq("family_id", familyId)
    .maybeSingle();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data as FamilyHomeCard | null) ?? null };
}

/**
 * API仕様.md 13.4章: 家族の投稿履歴（新しい順・無期限保存）を範囲指定で取得する
 * （主要画面ワイヤーフレーム.md 22.0節決定7「直近30件＋『もっと見る』」に対応する
 * ページング用。`range`はSupabaseの`.range(from, to)`と同じ0始まり・両端含む指定）。
 *
 * `family_board_posts`は`author_member_id`・`deleted_by_member_id`の2列で
 * `family_members`を参照しており、埋め込み先テーブルが同じで曖昧になり得る
 * （実装メモ.md 73.3章のPGRST201と同種のリスク）。`!author_member_id`という
 * 列名ヒントで明示的に解消している（本番の`gratitude_points`が
 * `sender_id`/`recipient_id`の2列で`family_members`を参照する全く同じ形で
 * 既に本番稼働しており、`family_members!recipient_id(...)`/`family_members!sender_id(...)`
 * が有効であることを確認済み＝実装メモ.md 79章の検証を参照。同じ列名ヒント方式を踏襲した）。
 *
 * [2026-09-01再改訂・実装メモ.md 104章] `family_board_reactions`を`reactions`という
 * エイリアスでネストして取得する。**旧仕様（103章）は「他者の行をそもそも取ってこない」
 * ことをRLSで保証していたが、統括決定「一覧に他人の反応を出してよい。LINEみたいに
 * 個数もわかる感じで」を受け、この制限は撤回した。** `family_board_reactions_select_
 * same_family`というRLSのSELECTポリシーが`family_id = current_family_id()`のみを
 * 要求するようになったため、この埋め込みクエリは家族内の全メンバーが送った反応
 * （0件以上）を返す。呼び出し側（useFamilyBoardHistory・FamilyBoardHistoryPanel）が
 * `stamp_key`ごとに集計して個数を出し、`reactor_member_id`が自分のものと一致する行の
 * 有無で「自分は送信済みか」を判定する（主要画面ワイヤーフレーム.md 22.2.1節「一覧での
 * 表示（LINE風・個数）」参照。設計判断の詳細はマイグレーション本体のコメント参照）。
 */
export async function fetchFamilyBoardPostsHistory(
  client: SupabaseClient,
  familyId: string,
  range: { from: number; to: number }
): Promise<ApiResult<FamilyBoardPostWithAuthor[]>> {
  const { data, error } = await client
    .from("family_board_posts")
    .select(
      "*, family_members!author_member_id(display_name, avatar_color), reactions:family_board_reactions(stamp_key, reactor_member_id)"
    )
    .eq("family_id", familyId)
    .order("created_at", { ascending: false })
    .range(range.from, range.to);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as unknown as FamilyBoardPostWithAuthor[] };
}

/**
 * [2026-09-01追加・実装メモ.md 104章] 主要画面ワイヤーフレーム.md 22.2.1節「内訳の
 * 見せ方（誰が押したか）」用: ある投稿に届いた反応を、反応者の表示名・アバター色付きで
 * 新しい順に取得する。「だれが送ったか見る」リンクをタップした一段階先でのみ呼ぶ
 * （一覧取得〈fetchFamilyBoardPostsHistory〉には反応者の氏名を含めない設計、
 * 上記コメント参照）。RLS（family_board_reactions_select_same_family）により、
 * 対象投稿が同じ家族のものである限り家族全員分の反応が返る。
 */
export async function fetchFamilyBoardReactionsForPost(
  client: SupabaseClient,
  postId: string
): Promise<ApiResult<FamilyBoardReactionWithReactor[]>> {
  const { data, error } = await client
    .from("family_board_reactions")
    .select("id, stamp_key, reactor_member_id, created_at, family_members!reactor_member_id(display_name, avatar_color)")
    .eq("post_id", postId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as unknown as FamilyBoardReactionWithReactor[] };
}

/**
 * API仕様.md 13.2章: 呼び出し本人が今日まだ投稿できる残り件数（0〜5）。
 * `family_id`・`author_member_id`のいずれも引数に取らない（RPCがGUCから
 * `current_family_member_id()`を読んで呼び出し本人に絞るため、familyIdが
 * 未確定でも呼び出せる＝実装メモ.md 73.3章「入力が揃わないときにloadStateを
 * 変えずreturnしない」の対象にそもそもならない設計）。
 */
export async function fetchMyFamilyBoardPostsRemainingToday(client: SupabaseClient): Promise<ApiResult<number>> {
  const { data, error } = await client.rpc("my_family_board_posts_remaining_today");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as number };
}

/**
 * API仕様.md 13.1章: 投稿する。
 *
 * [重要・2026-08-29修正] 13.1章の原文は「`author_member_id`はクライアントから
 * 送る必要はない」としているが、これは本番検証で誤りだと判明した。
 * `family_board_posts.author_member_id`列にはDB側のDEFAULTが無く（NOT NULL、
 * デフォルト値なし）、かつBEFORE INSERTトリガー`family_board_posts_before_insert`
 * （スキーマ設計.sql 35b章）が`NEW.author_member_id`を使って投稿者の`family_id`を
 * 逆引きする実装になっている。RLSの`WITH CHECK`はBEFORE INSERTトリガーが
 * `NEW`を確定させた**後**に評価されるため、`author_member_id`を送らずにINSERTすると、
 * RLSに弾かれるより先にトリガー内の投稿者検索が空振りし、`23503`
 * 「投稿者が見つからないか無効化されています」で必ず失敗する（本番のトランザクション内
 * ＋ROLLBACKで実際に再現・修正双方を確認済み。開発部/成果物/実装メモ.md 81章参照）。
 * したがって呼び出し側は自分自身の`member_id`を明示的に渡すこと。RLS
 * `family_board_posts_insert_self`が`author_member_id = current_family_member_id()`を
 * 引き続き強制するため、他人になりすましたINSERTは`42501`で拒否される（検証済み）。
 * `family_id`・`created_at`は従来どおりクライアントから送る必要が無い
 * （BEFORE INSERTトリガーがサーバー側で確定させる）。1日5件の上限に達している場合は
 * `check_violation`（PG_ERRCODE.checkViolation）でINSERT自体が拒否される。
 */
export async function createFamilyBoardPost(
  client: SupabaseClient,
  body: string,
  authorMemberId: string
): Promise<ApiResult<FamilyBoardPost>> {
  const { data, error } = await client
    .from("family_board_posts")
    .insert({ body, author_member_id: authorMemberId })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as FamilyBoardPost };
}

/**
 * API仕様.md 13.5章（2026-08-29改訂＝RPC方式）: 削除（本人の5分以内取消・
 * 保護者の是正削除）。
 *
 * [重要] 13.5章に旧記述として残る「直接UPDATEで`deleted_at`を埋める」方式は
 * **使わないこと。** SELECTポリシー（`deleted_at IS NULL`で削除済みを隠す）と
 * 論理削除UPDATEが両立せず、必ず`42501`（RLS違反）で拒否される（本番検証済み。
 * 設計部/成果物/スキーマ設計.sql 36章、開発部/成果物/実装メモ.md 80.3章参照）。
 * 直接UPDATEの経路自体（RLSポリシー`family_board_posts_update_soft_delete`）は
 * 本番マイグレーション20260829020000で削除済みのため、直接UPDATEで書いても
 * 「更新対象0件」または権限エラーになるだけで、原理的に成功しない。
 *
 * 権限判定（本人5分以内／保護者は時間制限なし／それ以外拒否）は35c章のBEFORE
 * UPDATEトリガーがそのまま行う。本関数はRLSを迂回して同じ行に到達するための
 * SECURITY DEFINER RPCラッパーを呼ぶだけで、判定ロジック自体は一切持たない。
 */
export async function deleteFamilyBoardPost(client: SupabaseClient, postId: string): Promise<ApiResult<null>> {
  const { error } = await client.rpc("delete_family_board_post", { p_post_id: postId });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: null };
}

/**
 * 要件定義書07-14章「リアクション（スタンプ）の追加」・主要画面ワイヤーフレーム.md
 * 22.2.1節: 投稿へのスタンプ送信（2026-09-01追加・実装メモ.md 103章、104章で
 * 「1人1投稿1スタンプ」→「1人1投稿につきスタンプの種類ごとに1個（4種類まで）」へ改訂）。
 *
 * `chore_reactions`の`addReaction`と同じ形（直接INSERT、確認ダイアログなしの
 * タップ即送信）。取消不可・自己リアクション不可・スタンプの種類ごとに1個までの
 * 判定はすべてDB側（BEFORE INSERTトリガー・一意制約・RLS）が行うため、本関数自体は
 * 判定ロジックを持たない。想定される失敗:
 *   - `foreign_key_violation`（23503）: 対象投稿が存在しないか、既に削除されている
 *     （論理削除された投稿へのリアクションはトリガー内のSELECTがRLSにより空振りする
 *     ため、この経路で拒否される。マイグレーション本体のコメント参照）
 *   - `check_violation`（23514）: 自分の投稿への自己リアクション（UI側でボタン自体を
 *     出さないため通常到達しないが、多重防御として存在する）
 *   - `unique_violation`（23505）: 同じ投稿・同じスタンプに既に別タブ・別デバイス等で
 *     先に送信済み（`(post_id, reactor_member_id, stamp_key)`の一意制約）
 * `family_id`・`created_at`はクライアントから送る必要が無い（BEFORE INSERTトリガーが
 * 対象投稿からサーバー側で確定させる、family_board_posts_before_insertと同じ設計）。
 */
export async function addFamilyBoardReaction(
  client: SupabaseClient,
  input: { post_id: string; reactor_member_id: string; stamp_key: StampKey }
): Promise<ApiResult<FamilyBoardReaction>> {
  const { data, error } = await client
    .from("family_board_reactions")
    .insert({
      post_id: input.post_id,
      reactor_member_id: input.reactor_member_id,
      stamp_key: input.stamp_key,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as FamilyBoardReaction };
}

/**
 * [2026-09-01追加・実装メモ.md 104章] 「とどいたもの」（`InboxPanel`）へ掲示板
 * リアクションを合流させるための家族全体ログ取得。主要画面ワイヤーフレーム.md
 * 22.2.2節「『とどいたもの』への掲示板リアクション受信表示」に対応する。
 *
 * `fetchReactions`（chore_reactions）・`fetchGratitudeLog`（gratitude_points）と
 * 同じ「家族全体を取得し、呼び出し側〈InboxPanel〉が自分宛の分だけを
 * client側でフィルタする」という既存パターンを踏襲する。対象投稿の`body`・
 * `author_member_id`を`family_board_posts`から埋め込み取得する（22.2.2節「対象が
 * 分かる一言＝投稿本文の先頭抜粋」の材料として使う）。埋め込みに`!inner`を使わない
 * 通常のto-one embedのため、対象投稿が論理削除されRLSにより見えなくなった場合は
 * `family_board_posts`側がnullになるだけで行自体は残る（呼び出し側がnullを
 * 弾く設計、InboxPanel.tsx参照）。
 */
export async function fetchFamilyBoardReactionsLog(
  client: SupabaseClient,
  familyId: string
): Promise<ApiResult<FamilyBoardReactionWithPostBody[]>> {
  const { data, error } = await client
    .from("family_board_reactions")
    .select("*, family_board_posts(body, author_member_id)")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as unknown as FamilyBoardReactionWithPostBody[] };
}
