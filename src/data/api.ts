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
  FamilyDrawing,
  FamilyDrawingLineData,
  FamilyInvite,
  FamilyInviteLookupResult,
  FamilyMember,
  FamilyTreeMemberBreakdown,
  FamilyTreeSeason,
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

/** 家族の基本データ一式を取得する。RLSにより自分の家族の行のみが返る。 */
export async function fetchFamilyBundle(client: SupabaseClient, familyId: string): Promise<ApiResult<FamilyBundle>> {
  const [familyRes, membersRes, categoriesRes, choresRes, rewardsRes] = await Promise.all([
    client.from("families").select("*").eq("id", familyId).single(),
    client.from("family_members").select("*").eq("family_id", familyId).order("created_at"),
    client.from("categories").select("*").eq("family_id", familyId).order("sort_order"),
    client.from("chores").select("*").eq("family_id", familyId).eq("is_active", true).order("created_at"),
    client.from("rewards").select("*").eq("family_id", familyId).eq("is_active", true).order("created_at"),
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

/** API仕様.md 4章手順3: 完了報告の作成。family_id/points/chore_title/chore_emojiはDBトリガーが自動設定する。 */
export async function reportCompletion(
  client: SupabaseClient,
  input: { chore_id: string; reported_by: string; photo_url: string | null; note: string | null }
): Promise<ApiResult<ChoreCompletion>> {
  const { data, error } = await client
    .from("chore_completions")
    .insert({
      chore_id: input.chore_id,
      reported_by: input.reported_by,
      photo_url: input.photo_url,
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

// ============================================================
// 感謝ポイント（API仕様.md 7a章、スキーマ設計.sql 13〜14章）
// [2026-08-16新設] 要件定義書.md v0.6 07-5章対応。全メンバー間（保護者⇄保護者、
// 保護者⇄子ども、子ども⇄子ども）で送付・受取可能。「合計贈った数／もらった数」の
// ランキング集計はAPI仕様.md 7a.3章の申し送りどおりクライアント側でも一切行わないこと。
// ============================================================

/**
 * API仕様.md 7a.1章: 呼び出し本人の残存原資（今週まだ贈れるpt、0〜週次配布額）。
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

/** 完了報告1件ごとの視覚要素の色付け用（API仕様.md 9.2章）。今シーズン開始以降の完了報告を報告者の色付きで返す。 */
export interface FamilyTreeCompletionDot {
  id: string;
  reported_at: string;
  reported_by: string;
  avatar_color: string | null;
}

export async function fetchFamilyTreeCompletionDots(
  client: SupabaseClient,
  familyId: string,
  seasonStartIso: string
): Promise<ApiResult<FamilyTreeCompletionDot[]>> {
  const { data, error } = await client
    .from("chore_completions")
    .select("id, reported_at, reported_by, family_members!reported_by(avatar_color)")
    .eq("family_id", familyId)
    .gte("reported_at", seasonStartIso)
    .order("reported_at");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as unknown as {
    id: string;
    reported_at: string;
    reported_by: string;
    family_members: { avatar_color: string | null } | null;
  }[];
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      reported_at: r.reported_at,
      reported_by: r.reported_by,
      avatar_color: r.family_members?.avatar_color ?? null,
    })),
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
