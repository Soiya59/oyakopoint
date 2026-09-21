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
import { GENERIC_ERROR_MESSAGE } from "@/lib/errorMessages";
import type {
  AccountDeletionPreview,
  Category,
  Chore,
  ChoreCompletion,
  ChoreCompletionTotalEntry,
  ChoreNfcTag,
  ChoreNfcTagWithMember,
  ChoreReaction,
  ChoreWeeklyCompletionCount,
  Family,
  FamilyBoardPost,
  FamilyBoardPostWithAuthor,
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
  FamilyTreeWeeklyCompletionCount,
  GachaDrawResult,
  GachaMemberProgressSummary,
  GachaPresetOrnament,
  GachaPrizeKind,
  GratitudePoint,
  HabitCard,
  HabitCardChoreBreakdownRow,
  HabitFigureCatalogItem,
  HabitFigureGrant,
  HabitFigureGrantWithCatalog,
  HabitFigureGrantWithPlacement,
  HiddenContent,
  MemberAvatarRow,
  MemberBadge,
  MemberBadgeProgress,
  MemberBlock,
  MemberGoal,
  MemberPoints,
  OrnamentStickerPurchase,
  ReactionKind,
  ReportChoreCompletionByNfcTagResult,
  Reward,
  RewardRedemption,
  StampKey,
  StickerCatalogItem,
  StickerPurchaseWithCatalog,
  StickerTierReset,
  WeeklyFamilyDigest,
} from "@/types/domain";

export interface ApiError {
  code: string;
  message: string;
  status?: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

const GENERIC_ERROR: ApiError = { code: "unknown_error", message: GENERIC_ERROR_MESSAGE };

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

/**
 * PostgrestError（.code/.message持ち）をApiErrorへ正規化する（API仕様.md 9章のERRCODE対応）。
 *
 * [2026-09-17追加・やること.md 4-36 症状3] 第2引数`status`は任意。呼び出し元が
 * PostgrestResponseのHTTPステータスも持っている場合だけ渡す（`reportCompletion`
 * 参照）。既存の呼び出し元（statusを渡さない大多数）への影響は無い
 * （ApiError.statusはもともと省略可能）。
 */
function fromPostgrestError(error: { code?: string | null; message?: string } | null, status?: number): ApiError {
  if (!error) return { ...GENERIC_ERROR, status };
  return { code: error.code ?? "unknown_error", message: error.message ?? GENERIC_ERROR.message, status };
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
 * 認証・データ管理設計書.md 10.8章のエラー対応表に対応するGoTrueのerror_code定数。
 * PostgrestErrorのSQLSTATE（PG_ERRCODE、上記参照）とは別物の文字列であり、
 * `AuthApiError.code`に入る値。実装メモ.md 128章の実測で確認した内容:
 * - `otpExpired`: コードが違う場合・期限切れの場合のいずれも**この同一の値**が
 *   返る（HTTP 403）。ローカルSupabase（gotrue v2.195.0）で実際に確認済み
 *   （正しいコードを検証→成功、存在しないコード"000000"を検証→otp_expired、
 *   期限切れコードを検証→otp_expired、の3パターンをcurlで実測）。したがって
 *   verifyEmailOtpの呼び出し側はこの値だけでは「コード誤り」「期限切れ」を
 *   区別できない（設計部10.8章の指摘どおり、実装漏れではなく仕様）。
 * - `overEmailSendRateLimit`: 「再送する」を連打した場合に返る（HTTP 429）。
 *   ローカルで実測済み（`max_frequency`設定に基づき、1秒未満の間隔での連続送信で再現）。
 * - `overRequestRateLimit`: `token_verifications`（IP単位、5分あたり30回）超過時に
 *   返ると設計部10.9章が説明している値。**このコード自体はgotrueバイナリの文字列
 *   抽出で実在を確認したが、ローカル環境では37回連続でverifyOtpを叩いても
 *   429を再現できなかった**（ローカルCLIのレート制限実装が本番と異なる可能性がある。
 *   正直な申告として記録する）。本番での実際の挙動は統括・本部長が別途確認することを推奨。
 */
export const AUTH_ERRCODE = {
  otpExpired: "otp_expired",
  overEmailSendRateLimit: "over_email_send_rate_limit",
  overRequestRateLimit: "over_request_rate_limit",
  /**
   * [2026-09-20追加・実装メモ.md 262章] 上3つと違い、GoTrueのerror_code文字列
   * ではなく、`error.code`が無いときにverifyEmailOtp/signInWithPassword等が
   * フォールバックする`error.name`（`AuthError.name`、
   * node_modules/@supabase/auth-js/dist/module/lib/errors.js）。
   * node_modules/@supabase/auth-js/dist/module/lib/fetch.js 25〜43行目・109〜121行目
   * で確認済み: この名前になるのは次の2パターンのみで、いずれも`code`は付かない。
   * - fetch自体が失敗した場合（オフライン・DNS失敗・TLS拒否等）。この場合は
   *   `status`が`0`になる（120行目）。
   * - 500・501・502・503・504・520〜530番台（Cloudflare含む）のサーバー
   *   ゲートウェイ系エラーの場合。この場合は`status`に実際のHTTPステータスが入る
   *   （37行目・43行目）。
   * `status`も併せて見ることで、本当の通信断（0）とサーバー側の一時的な異常
   * （500番台）を区別できる（EmailCodeVerifyForm.tsx参照）。
   */
  retryableFetch: "AuthRetryableFetchError",
  /** 上記と同じ理由でerror.nameにフォールバックする値。JSONのパース等、
   * supabase-js自身が原因を特定できなかった場合に付く（同fetch.js 39行目）。 */
  unknown: "AuthUnknownError",
} as const;

/**
 * [2026-09-04新設] 認証・データ管理設計書.md 10.1章: signInWithEmailで送信した
 * 6桁コードを検証してセッションを確立する。`type: "email"`は@supabase/auth-jsの
 * EmailOtpTypeのうち新規サインアップ・既存ユーザーの再ログインの両方をカバーする値
 * （node_modules/@supabase/auth-js/dist/module/lib/types.d.ts参照、設計部10.1章で
 * 確認済み）。
 *
 * エラーの`code`にはPostgrestErrorのSQLSTATEではなく、AuthApiErrorが保持する
 * GoTrueのerror_code文字列（AUTH_ERRCODE参照）を入れる。実装メモ117章の教訓
 * （可読名の文字列比較をしない）を踏まえ、呼び出し側もAUTH_ERRCODEの定数と
 * 比較すること。
 *
 * [2026-09-17追加・やること.md 4-36 症状1] ここが「利用者がメールと6桁コードを
 * 自分で入力してログインする」唯一の呼び出し元（他にverifyOtpを呼ぶ箇所は無い。
 * `grep -rn "verifyOtp("`で確認済み）。呼び出し元の`src/components/
 * EmailCodeVerifyForm.tsx`は、この関数が成功を返した直後に`useSession().
 * refreshParentMember()`を明示的に呼び、こどもモードから保護者への切り替えを
 * 確定させる（`onAuthStateChange`の`SIGNED_IN`イベントを待って推測する方式は
 * 本部長レビューで指摘された競合・時間切れの懸念があり不採用にした。
 * `src/lib/session.tsx`のコメント参照）。
 */
export async function verifyEmailOtp(email: string, code: string): Promise<ApiResult<null>> {
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  if (error) {
    return {
      ok: false,
      error: { code: error.code ?? error.name, message: error.message, status: error.status },
    };
  }
  return { ok: true, data: null };
}

/**
 * [2026-09-11新設] 設計部/成果物/認証・データ管理設計書.md 11.4.2章。
 * Google Play・App Store両方の審査用アカウント専用の入口。supabase.auth.signInWithPassword
 * をそのまま呼ぶだけで、独自の検証ロジックは持たない（11.1章の却下理由1の
 * 再発を避けるため）。特定のメールアドレスをコード内でチェックする分岐も
 * 持たない（11.4章(b)の却下理由の再発を避けるため）——一般アカウントは
 * パスワードが設定されていないため、このアカウント以外で呼んでも
 * エラーになるだけで、実害は無い。
 *
 * [2026-09-11実測・実装メモ.md 206章] ローカルSupabase（gotrue）で、パスワード未設定
 * アカウントに対して任意の文字列を渡して実測したところ、`error.code`は
 * `"invalid_credentials"`（HTTP 400）だった。設計部11.4.2章・11.9章3の想定
 * （未実測）と一致することを確認した。AUTH_ERRCODEと同様の対応表は
 * app/onboarding/email.tsx側のエラー文言分岐に反映する。
 */
export async function signInWithPassword(email: string, password: string): Promise<ApiResult<null>> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return {
      ok: false,
      error: { code: error.code ?? error.name, message: error.message, status: error.status },
    };
  }
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

/**
 * API仕様.md 2f章手順③: supabase.rpc('join_family_with_invite_code', ...)
 * [2026-09-02改訂] 招待受諾フローにおける可視範囲の説明と同意取得（要件定義書.md
 * 06章、スキーマ設計.sql 40章）に伴い、2引数から3引数（p_consent_version追加）へ
 * 改訂した。呼び出し元（P6・app/onboarding/join-preview.tsx）は
 * InviteVisibilityConsent（src/components/InviteVisibilityConsent.tsx）が
 * エクスポートするJOIN_CONSENT_VERSIONを渡すこと。DB側の
 * current_join_consent_version()（スキーマ設計.sql 40.5章）と一致しない場合、
 * check_violation（「アプリが古い可能性があります…」）で拒否される（40.5章）。
 * 旧2引数版はスキーマ設計.sql 40.7章でDROP FUNCTION済みのため呼び出し不可。
 */
export async function joinFamilyWithInviteCode(
  inviteCode: string,
  displayName: string,
  consentVersion: number
): Promise<ApiResult<string>> {
  const { data, error } = await supabase.rpc("join_family_with_invite_code", {
    p_invite_code: inviteCode,
    p_display_name: displayName,
    p_consent_version: consentVersion,
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
  /**
   * [2026-09-11追加・実装メモ205.8章] member_id → line_data の辞書。
   * `InviteLookupChild`には含めない（`app/child-auth/invite-code.tsx`が
   * `children`をそのままURLパラメータへJSON化して次画面へ渡しているため、
   * 1件あたり最大20KBの絵をここへ足すとURLが人数分膨らんでしまう）。
   * 絵が未設定のメンバーはキー自体が存在しない。
   */
  child_avatars?: Record<string, FamilyDrawingLineData>;
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

/**
 * 認証・データ管理設計書.md 3.4章: Edge Function `remove-member`
 *
 * [2026-09-21変更・後方非互換・要件定義書07-33章 決定17、API仕様.md 24.5章]
 * mode:"delete_family" は confirmFamilyName（家族の名前。前後の空白を
 * 落とした完全一致でサーバ側が照合する）を新たに必須で渡す。一致しなければ
 * 400 family_name_mismatch が返る。mode:"soft_remove" では使わない
 * （省略可）。
 */
export async function removeMember(
  memberId: string,
  mode: "soft_remove" | "delete_family",
  confirmFamilyName?: string
): Promise<ApiResult<{ ok: true }>> {
  return invokeEdgeFunction<{ ok: true }>("remove-member", {
    member_id: memberId,
    mode,
    ...(mode === "delete_family" ? { confirm_family_name: confirmFamilyName ?? "" } : {}),
  });
}

/**
 * [新設・2026-09-21・要件定義書07-33章、スキーマ設計.sql 68.7章、API仕様.md 24.1章]
 * 「アカウントを削除する」「家族から抜ける」の確認画面に何を出すかを1本で
 * 引く。RPC `account_deletion_preview()`（SECURITY DEFINER）。家族に属して
 * いない人（parentNoFamily）が呼んでも必ずオブジェクトを返す（決定10）。
 */
export async function fetchAccountDeletionPreview(
  client: SupabaseClient
): Promise<ApiResult<AccountDeletionPreview>> {
  const { data, error } = await client.rpc("account_deletion_preview");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as AccountDeletionPreview };
}

/**
 * [新設・2026-09-21・要件定義書07-33章 決定1・3・9〜12、スキーマ設計.sql
 * 68.5章(A)、API仕様.md 24.4章] Edge Function `delete-account`。
 * 保護者・みまもりメンバーが、アプリの中から自分のログイン用アカウント
 * （auth.users）を削除する。家族に属していなくても呼べる（決定10）。
 * confirmFamilyName は「唯一の在籍保護者としてアカウントを削除する＝家族
 * ごと削除に合流する」場合のみ必須（account_deletion_preview()の
 * will_delete_family が true のとき）。
 */
export async function deleteAccount(
  confirmFamilyName?: string
): Promise<ApiResult<{ ok: true; family_deleted: boolean }>> {
  return invokeEdgeFunction<{ ok: true; family_deleted: boolean }>("delete-account", {
    ...(confirmFamilyName !== undefined ? { confirm_family_name: confirmFamilyName } : {}),
  });
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
  // [2026-09-01修正・本部長] 以前は crypto.randomUUID が使えない環境で
  // `${Date.now()}-${Math.random()...}` にフォールバックしていた。招待トークンは
  // 「知っていればみまもりメンバーとして家族に参加できる秘密情報」であり、
  // Math.random() は暗号論的に安全ではなく推測されうる。認証・データ管理設計書
  // 8.2章が「暗号論的に安全なランダムトークン」と定めている前提を満たさない
  // 経路だったため、フォールバックを廃止して安全でない値を作れないようにした。
  // 生成できない環境ではトークンを発行せずエラーを返す（実装メモ106章）。
  const token = globalThis.crypto?.randomUUID?.();
  if (!token) {
    return {
      ok: false,
      error: {
        code: "crypto_unavailable",
        message: "この端末では安全な招待コードを作れませんでした。アプリを最新にするか、別の端末からお試しください",
      },
    };
  }
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
 * API仕様.md 2f章手順③': 参加確定。roleは引数に含まれず、常に招待発行時に保護者が
 * 固定した値がそのまま使われる（06章・07-7章「参加者本人が自己申告でロールを
 * 選べる設計にはしない」）。マジックリンク認証完了後（auth.uid()が存在する状態）に
 * 呼ぶため、常にデフォルトの`supabase`クライアントを使う。
 * [2026-09-02改訂] joinFamilyWithInviteCodeと同様、2引数から3引数
 * （p_consent_version追加）へ改訂した。呼び出し元（S0・
 * app/onboarding/join-supporter.tsx）はJOIN_CONSENT_VERSIONを渡すこと。
 */
export async function acceptFamilyInvite(
  token: string,
  displayName: string,
  consentVersion: number
): Promise<ApiResult<string>> {
  const { data, error } = await supabase.rpc("accept_family_invite", {
    p_token: token,
    p_display_name: displayName,
    p_consent_version: consentVersion,
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

/**
 * [2026-09-11追加] メンバーのアバター（要件定義書07-27章、スキーマ設計.sql 54章）。
 * `member_avatars`は`family_members`とは別テーブルのため、既存の
 * `fetchFamilyBundle`・`fetchParentMember`の`select("*")`には一切影響しない
 * （54.1章 決定54-1の核心）。
 *
 * [取得] 家族分をまとめて1回取得する（54.7章）。呼び出し側
 * （`src/data/store.tsx`）は`useBackgroundAutoRefresh`が駆動する15秒間隔の
 * 背景更新にこの取得を載せないこと（54.7章・54.13章(4)）。
 */
export async function fetchMemberAvatars(
  client: SupabaseClient,
  familyId: string
): Promise<ApiResult<MemberAvatarRow[]>> {
  const { data, error } = await client
    .from("member_avatars")
    .select("member_id, line_data, updated_at")
    .eq("family_id", familyId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as MemberAvatarRow[] };
}

/**
 * アバターの絵を保存する（新規に描く・描き直すの両方、決定11〜12）。
 * `member_id`が`member_avatars`のPRIMARY KEYのため、`.upsert()`は
 * `INSERT ... ON CONFLICT (member_id) DO UPDATE`として動作する（54.7章）。
 * `family_id`は送らない（`member_avatars_before_write()`トリガーが対象
 * `member_id`の実際の所属家族へ必ず補正するため、54.2章）。
 * 権限は`member_avatars_write_self_or_parent`ポリシー（本人または保護者、
 * 54.5章）がそのまま担保する。
 */
export async function saveMemberAvatar(
  client: SupabaseClient,
  memberId: string,
  lineData: FamilyDrawingLineData
): Promise<ApiResult<null>> {
  const { error } = await client.from("member_avatars").upsert({ member_id: memberId, line_data: lineData });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: null };
}

/**
 * 「色にもどす」（決定5・決定20〜22）。行のDELETEで表す（54.2章・54.6章）。
 * 対象行が既に存在しない場合もエラーにはならない（削除0件のまま成功扱い）。
 */
export async function deleteMemberAvatar(client: SupabaseClient, memberId: string): Promise<ApiResult<null>> {
  const { error } = await client.from("member_avatars").delete().eq("member_id", memberId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: null };
}

// ============================================================
// member_blocks（ブロック。要件定義書07-32章 決定11〜14、
// 設計部/成果物/スキーマ設計.sql 69章、API仕様.md 26章、2026-09-20新設）
//
// [この回の範囲] 本部長指示により、判定ロジック・型・API・ストアまでを実装する。
// 画面（ブロックの設定UI・止めたときの表示）はUIUXデザイン部の設計待ちのため
// 今回は作らない（開発部/成果物/実装メモ.md参照）。
//
// [2026-09-20訂正・本部長からの当日指示] ブロックを「送る側」として使える
// のは保護者・みまもりメンバーのみで、子どもは使えない（07-32-7と07-32-9の
// 矛盾を本部長が07-32-7側で確定。子どもがブロックされる側に入ることは
// 変わらない）。RLS（69章）はこの制限を持たない（3ロールとも書ける設計の
// まま）ため、下の`blockMember`/`unblockMember`自体はロールを問わず呼べる
// 薄いラッパーのまま。**呼び出し側の役割制限は`src/data/store.tsx`の同名
// メソッド（`blockMember`/`unblockMember`）が行う**（子ども用画面を作らない
// ため実質到達しない経路だが、多層防御として明示的にガードしてある）。
// ============================================================

/**
 * API仕様.md 26.1章: 自分が非表示にしている相手の一覧を取得する。
 * SELECT RLS（member_blocks_select_own）が`blocker_member_id =
 * current_family_member_id()`のみを要求するため、familyIdを渡す必要が無い
 * （自分の行しか返らない。69.3章）。
 */
export async function fetchMyMemberBlocks(client: SupabaseClient): Promise<ApiResult<MemberBlock[]>> {
  const { data, error } = await client.from("member_blocks").select("*");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as MemberBlock[] };
}

/**
 * API仕様.md 26.1章: 相手を非表示にする（画面に「ブロック」という語は出さない。決定11）。
 * 同じ相手を2度指定した場合はべき等に扱う（`uq_member_blocks_pair`の
 * unique_violation・23505を捕まえ、既存の行をそのまま返す）——66章`hide_content()`の
 * 「2度実行しても同じ結果」という考え方と揃えた。
 */
export async function blockMember(
  client: SupabaseClient,
  familyId: string,
  blockerMemberId: string,
  blockedMemberId: string
): Promise<ApiResult<MemberBlock>> {
  const { data, error } = await client
    .from("member_blocks")
    .insert({ family_id: familyId, blocker_member_id: blockerMemberId, blocked_member_id: blockedMemberId })
    .select("*")
    .single();
  if (error) {
    if (error.code === PG_ERRCODE.uniqueViolation) {
      const existing = await client
        .from("member_blocks")
        .select("*")
        .eq("blocker_member_id", blockerMemberId)
        .eq("blocked_member_id", blockedMemberId)
        .maybeSingle();
      if (!existing.error && existing.data) {
        return { ok: true, data: existing.data as MemberBlock };
      }
    }
    return { ok: false, error: fromPostgrestError(error) };
  }
  return { ok: true, data: data as MemberBlock };
}

/**
 * API仕様.md 26.1章: 非表示を解除する（いつでも自分で解除できる。決定11）。
 * ブロック行のidを画面側に持たせずに済むよう、対象の相手のmember_idで
 * 指定する形にした（RLSの`member_blocks_delete_own`が
 * `blocker_member_id = current_family_member_id()`を強制するため、
 * 他人の行を誤って消すことはできない）。対象行が既に存在しない場合も
 * エラーにはならない（削除0件のまま成功扱い、`deleteMemberAvatar`と同じ方針）。
 */
export async function unblockMember(
  client: SupabaseClient,
  blockerMemberId: string,
  blockedMemberId: string
): Promise<ApiResult<null>> {
  const { error } = await client
    .from("member_blocks")
    .delete()
    .eq("blocker_member_id", blockerMemberId)
    .eq("blocked_member_id", blockedMemberId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: null };
}

/**
 * [2026-09-21新設・要件定義書07-32章、設計部/成果物/スキーマ設計.sql 66章]
 * 家族分の`hidden_contents`（運営が`hide_content()`で非表示にした行）を
 * まとめて取得する。SELECT RLS（hidden_contents_select_same_family）は
 * `family_id = current_family_id()`のみを要求する。この表は「種別＋対象id＋
 * 日時」だけを持ち、誰が報告したかも本文も入っていない（66.5章）。
 * クライアントはこの一覧をもとに、対象の行を一覧・表示から除く
 * （66.4章の対応表、★クライアント必須要件）。
 */
export async function fetchHiddenContents(
  client: SupabaseClient,
  familyId: string
): Promise<ApiResult<HiddenContent[]>> {
  const { data, error } = await client.from("hidden_contents").select("*").eq("family_id", familyId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as HiddenContent[] };
}

/**
 * [2026-09-21新設・要件定義書07-32章 決定20〜24・決定33、設計部/成果物/
 * スキーマ設計.sql 67.4章] 保護者が「家族のやりとりを使う」トグルを設定する。
 * `set_family_social_settings()`（SECURITY DEFINER）は保護者のみ呼べる
 * （みまもりメンバー・子どもは`insufficient_privilege`）。成功しても戻り値は
 * 持たないため、呼び出し側は成功後に`refresh()`でfamiliesを取り直すこと。
 */
export async function setFamilySocialSettings(
  client: SupabaseClient,
  interactionsEnabled: boolean
): Promise<ApiResult<null>> {
  const { error } = await client.rpc("set_family_social_settings", {
    p_interactions_enabled: interactionsEnabled,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: null };
}

/**
 * [2026-09-21新設・要件定義書07-32章 決定4・6・8〜12・30〜32、設計部/成果物/
 * スキーマ設計.sql 65.4章、主要画面ワイヤーフレーム.md 56.2節] お問い合わせ
 * （アプリ内の報告と統合済み）を送信する。3項目とも自由記述・すべて任意
 * （1つも渡さずに呼べる）。`submit_content_report()`（SECURITY DEFINER）は
 * 保護者とみまもりメンバーのみ呼べる（子どもは`insufficient_privilege`）。
 * 戻り値を持たない（履歴画面を作らないため、決定6）。
 */
export async function submitContentReport(
  client: SupabaseClient,
  params: { aboutText?: string | null; seenWhereText?: string | null; note?: string | null }
): Promise<ApiResult<null>> {
  const { error } = await client.rpc("submit_content_report", {
    p_about_text: params.aboutText ?? null,
    p_seen_where_text: params.seenWhereText ?? null,
    p_note: params.note ?? null,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: null };
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
  // [2026-09-08・統括指示] お気に入りに入れた順（新しいものが上）で並べる。
  // 統括の要望「おしっこ1人でできたを一番上に」に対し、上下の矢印による
  // 並べ替えは作らず、★を押し直せば一番上に来る形で満たす（実装メモ155章・156章）。
  // created_at はテーブル新設時（20260822082002）から入っており、列の追加は不要。
  const { data, error } = await client
    .from("chore_daily_flags")
    .select("chore_id, created_at")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
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
 * photo_urlの送信をやめた。
 * [2026-09-09削除] 列自体もDBから削除した（やること.md 5-4、開発部/成果物/実装メモ.md
 * 180章、マイグレーション20260917020000_drop_chore_photos.sql）。
 */
export async function reportCompletion(
  client: SupabaseClient,
  input: { chore_id: string; reported_by: string; note: string | null }
): Promise<ApiResult<ChoreCompletion>> {
  // [2026-09-17変更・やること.md 4-36 症状3] `status`（PostgRESTが返す実際のHTTP
  // ステータス）も受け取り、fromPostgrestErrorへ渡す。以前はdata/errorのみを
  // 見ており、通信断・RLS拒否・ログイン切れがすべて呼び出し元で見分けられず、
  // 「通信エラーが発生しました」の1文にまとめられていた（describeChoreReportFailure
  // 参照）。
  const { data, error, status } = await client
    .from("chore_completions")
    .insert({
      chore_id: input.chore_id,
      reported_by: input.reported_by,
      note: input.note,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error, status) };
  return { ok: true, data: data as ChoreCompletion };
}

/**
 * [2026-09-17新設・やること.md 4-36 症状3] `reportCompletion`が失敗したとき、
 * `PG_ERRCODE.checkViolation`（1日の上限。呼び出し元が先に個別処理する）以外の
 * 失敗を一律「通信エラーが発生しました」としていたのを改める。以前これが、
 * 保護者の画面がこどものJWTで送信していた不具合（症状2）の切り分けを実際に
 * 妨げた（403/42501が返っていたのに「通信エラー」としか表示されなかった）。
 *
 * 判定根拠（いずれも`node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts`
 * で確認済み）:
 * - `status === 0`: fetch自体が失敗した（オフライン等）場合、postgrest-jsは
 *   `code: ""`・`status: 0`の結果を返す（391行目以降のcatch節）。
 * - `code === PG_ERRCODE.insufficientPrivilege`（"42501"）: RLSポリシーによる拒否
 *   （PostgreSQLのSQLSTATE。PostgRESTはこれをHTTP 403として転送する。やること.md
 *   4-36で本部長が実測した403はこのケース）。
 * - `status === 401`: JWT自体が無効・期限切れで、PostgreSQLへ到達する前に
 *   PostgREST自身が拒否した場合（この場合はPostgresのSQLSTATEが付かない）。
 * - 上記のいずれにも当てはまらない場合は、原因を特定できないサーバー側の
 *   エラーとして扱う。
 *
 * いずれの文言も、統括の指摘どおりエラーコードをそのまま画面に出さず、
 * 利用者には「何をすればよいか」を示し、開発側は表示された文言の違いから
 * 原因を切り分けられるようにしている。
 */
export function describeChoreReportFailure(error: ApiError): string {
  if (error.status === 0) {
    return "通信状態を確認できませんでした。電波の良い場所で、もう一度お試しください。";
  }
  if (error.code === PG_ERRCODE.insufficientPrivilege) {
    return "この操作を行う権限を確認できませんでした。お手数ですが、アプリを一度終了して開き直し、もう一度お試しください。";
  }
  if (error.status === 401) {
    return "ログインの状態を確認できませんでした。お手数ですが、アプリを一度終了して開き直してから、もう一度お試しください。";
  }
  return "サーバーでエラーが発生しました。しばらくしてから、もう一度お試しください。";
}

/**
 * API仕様.md 4d節「完了報告の直後の取消（誤操作リカバリ、1分以内）」。
 * SECURITY DEFINERのRPC `cancel_chore_completion()`（スキーマ設計.sql 43章）が
 * 権限・時間窓・ガチャ未消費・木への飾り付け未消費・残高非マイナス化を確認した
 * うえで対象行を物理削除する。戻り値は「消えた完了報告」の確認情報のみで、
 * 取消後の家族の木・ガチャ進捗の最新値は含まれない（4d節）。呼び出し側は
 * 成功後、家族の木（9.1節）・ガチャ進捗（12.1節）を別途再取得すること。
 *
 * 起こりうるエラー（API仕様.md 11章、いずれもPG_ERRCODE経由で判定すること）:
 * - `no_data_found`: 対象が存在しない、または他家族の完了報告。
 * - `insufficient_privilege`: 対象クエストの区分に応じた権限が無い
 *   （メッセージが2種類あるため、UI側は分岐せずDB側のメッセージをそのまま表示してよい）。
 * - `check_violation`: 理由が複数ある（1分超過／ガチャ消費後／木の飾り付け済み／
 *   残高マイナス化）。UI側はメッセージ本文に含まれるキーワードで理由を判別すること
 *   （実装メモ.md 117.5章の教訓どおり、PG_ERRCODE.checkViolationとの比較が前提。
 *   可読名の文字列比較はしないこと）。
 */
export async function cancelChoreCompletion(
  client: SupabaseClient,
  completionId: string
): Promise<ApiResult<{ completion_id: string; chore_id: string | null; chore_title: string; reported_by: string; points: number }>> {
  const { data, error } = await client.rpc("cancel_chore_completion", { p_completion_id: completionId }).single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return {
    ok: true,
    data: data as { completion_id: string; chore_id: string | null; chore_title: string; reported_by: string; points: number },
  };
}

/**
 * API仕様.md 5章: コメントのリアクション付与。
 * [2026-09-10改訂・実装メモ.md 157章] スタンプ（kind='stamp'）の直接INSERTは
 * `chore_reactions_insert_scoped`ポリシーの改訂によりRLSで拒否されるようになった
 * （マイグレーション`20260910020000_toggle_chore_reaction_stamp.sql`）。スタンプの
 * 追加・切替・取消は下記`toggleReactionStamp`（RPC）に一本化したため、本関数は
 * 実質的にコメント（kind='comment'）専用になった。呼び出し側のシグネチャは
 * 後方互換のため変更していない。
 */
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

/**
 * [2026-09-10新設・実装メモ.md 157章] 完了報告へのスタンプ（絵文字）リアクションの
 * 追加・切替・取消。同じスタンプをもう一度送ると取消、違うスタンプを送ると切替になる
 * （SECURITY DEFINER関数`toggle_chore_reaction_stamp`側で判定する。呼び出し側は
 * 常に「押したスタンプの種類」だけを送ればよく、現在の状態を見て呼び分ける必要はない）。
 * 自分（呼び出し元のcurrent_family_member_id()）の分しか操作できない設計のため、
 * reacted_byをパラメータとして渡す必要が無い（渡しても無視されるのではなく、
 * そもそも関数シグネチャに存在しない）。
 */
export async function toggleReactionStamp(
  client: SupabaseClient,
  input: { completion_id: string; stamp_key: StampKey }
): Promise<ApiResult<{ removed: boolean; reaction_id: string | null }>> {
  const { data, error } = await client
    .rpc("toggle_chore_reaction_stamp", { p_completion_id: input.completion_id, p_stamp_key: input.stamp_key })
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as { removed: boolean; reaction_id: string | null } };
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

/**
 * [2026-09-01凍結・実装メモ.md 108章] 「1chore=1タグ」旧方式（chores.nfc_tag_id、
 * API仕様.md 3a章）専用の関数。要件定義書07-2章「作り直し：タグの人ごと化」により
 * 置き換わり（新方式は下記「NFCタグの人ごと化（chore_nfc_tags）」参照）、
 * どちらの関数も呼び出し元が無くなった（設計部/成果物/スキーマ設計.sql 39.9章
 * 「chores.nfc_tag_id列・インデックスは物理的に削除しない。新規の読み書きは
 * 発生させない」）。関数自体も列と同様、不可逆な削除を避けるためコードを削除せず
 * 残すが、新規のimport・呼び出しを追加しないこと。
 */
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

/** [2026-09-01凍結] 上記と同じ理由で呼び出し元が無い。API仕様.md 4a章手順2相当（旧方式）。 */
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

// ============================================================
// NFCタグの人ごと化（chore_nfc_tags、要件定義書07-2章「作り直し：タグの人ごと化」、
// 設計部/成果物/スキーマ設計.sql 39章、API仕様.md 3a-2章・4a-2章、
// 開発部/成果物/実装メモ.md 108章）
// ============================================================

/** API仕様.md 3a-2章手順5: 発行済みタグ一覧（持ち主の表示名つき、有効なもののみ）。 */
export async function fetchActiveChoreNfcTags(
  client: SupabaseClient,
  choreId: string
): Promise<ApiResult<ChoreNfcTagWithMember[]>> {
  const { data, error } = await client
    .from("chore_nfc_tags")
    .select("*, member:family_members!member_id(display_name)")
    .eq("chore_id", choreId)
    .is("revoked_at", null)
    .order("created_at");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data as ChoreNfcTagWithMember[]) ?? [] };
}

/**
 * API仕様.md 3a-2章手順4: chore×memberにタグを紐づける。
 * `family_id`は送らない（DBトリガーが対象クエストのfamily_idで強制補完する、39.3章）。
 * 上限5枚到達時は`check_violation`（PG_ERRCODE.checkViolation）で拒否される。
 */
export async function createChoreNfcTag(
  client: SupabaseClient,
  input: { chore_id: string; member_id: string; tag_value: string }
): Promise<ApiResult<ChoreNfcTag>> {
  const { data, error } = await client
    .from("chore_nfc_tags")
    .insert({ chore_id: input.chore_id, member_id: input.member_id, tag_value: input.tag_value })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as ChoreNfcTag };
}

/**
 * API仕様.md 3a-2章手順6: タグの解除（論理削除）。取消不可（un-revoke不可）。
 * クライアントが送る`revoked_at`の値そのものはサーバー側が常に`now()`で上書きする
 * （改ざん防止パターン、39.3章）ため、送る値自体はダミーの現在時刻でよい。
 */
export async function revokeChoreNfcTag(client: SupabaseClient, tagId: string): Promise<ApiResult<ChoreNfcTag>> {
  const { data, error } = await client
    .from("chore_nfc_tags")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tagId)
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as ChoreNfcTag };
}

/**
 * API仕様.md 4a-2章手順2: 代理報告RPC呼び出し。C13の裏側で1回だけ呼ぶ
 * （事前のSELECTは行わない。主要画面ワイヤーフレーム.md 7.6.3節「本部長レビューで確定」）。
 * 0行（`maybeSingle()`が`null`）は「タグ未登録／他家族／解除済み／削除済みクエスト」の
 * いずれかであり、原因を区別しない（39.6章「0件への収束」）。上限到達時は`RAISE
 * EXCEPTION`のため行データを返さず、`check_violation`エラーとして返る。
 */
export async function reportChoreCompletionByNfcTag(
  client: SupabaseClient,
  input: { tag_value: string; note?: string | null }
): Promise<ApiResult<ReportChoreCompletionByNfcTagResult | null>> {
  const { data, error } = await client
    .rpc("report_chore_completion_by_nfc_tag", { p_tag_value: input.tag_value, p_note: input.note ?? null })
    .maybeSingle();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data as ReportChoreCompletionByNfcTagResult | null) ?? null };
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
  // [2026-09-19改訂・要件定義書07-28章決定25・26、スキーマ設計.sql 57.1章]
  // 0以上の整数。「たまり方（ポイント／台紙）」の区別は撤去され、
  // クエストは1種類のみになった。0ポイントも許すが、既定値は0にせず
  // 0を推奨する文言も出さない（UI側の責務）。
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

/**
 * API仕様.md 3章「編集」: `supabase.from('chores').update({...}).eq('id', choreId)`
 */
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
// [2026-09-12追加] assigned_to（担当者）。ChoreFormInputのassigned_toと同型
// （要件定義書07-22章、スキーマ設計.sql 50章、API仕様.md 7d節、開発部/成果物/
// 実装メモ.md 163章）。未指定=NULL=誰でも交換可。
export interface RewardFormInput {
  name: string;
  emoji: string | null;
  cost: number;
  description: string | null;
  assigned_to: string | null;
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
      assigned_to: input.assigned_to,
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
      assigned_to: input.assigned_to,
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
 *
 * [2026-09-19改訂・要件定義書07-28章決定25] 台紙型（habit_card）という区分が
 * 撤去されたため、この関数は新規登録では呼ばれなくなった
 * （app/supporter/chore-edit.tsxは常にcreateSupporterSharedChoreを使う）。
 * 既存のscope='personal'行の編集はupdatePersonalChoreが引き続き担うため、
 * この関数自体は削除しない。
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
 * API仕様.md 3b-2章「新規登録」（要件定義書07-18章、2026-09-06新設）。
 * みまもりメンバーの新規クエスト登録は常に「みまもり共通」（scope: 'supporter_shared'）
 * になる。統括の簡素化指示により、登録時に「自分専用／みまもり共通」を選ばせる導線は
 * 作らない（createPersonalChoreはこの用途では新規に呼ばれなくなるが、既存の
 * scope='personal'行は残るため関数自体は削除しない）。
 * created_by/assigned_toは送らなくてよい（chores_before_writeが本人IDで補完し、
 * assigned_toは常にNULLへ強制される。スキーマ設計.sql 45.3章・45.4章）。RLS
 * chores_write_supporter_shared_by_creator によりrole='supporter'かつ本人のみ許可。
 */
export async function createSupporterSharedChore(
  client: SupabaseClient,
  familyId: string,
  input: PersonalChoreFormInput
): Promise<ApiResult<Chore>> {
  const { data, error } = await client
    .from("chores")
    .insert({
      family_id: familyId,
      scope: "supporter_shared",
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
 * [2026-09-06追記・45.16章] scope='supporter_shared'行に対してもそのまま流用できる
 * （呼び出し方は変更不要、対象IDがpersonalかsupporter_sharedかをクライアントが
 * 意識する必要がない設計）。
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

/**
 * API仕様.md 7b-2章「新規登録」（要件定義書07-18章決定6'、2026-09-06新設）。
 * みまもりメンバーの新規ごほうび登録は常に「みまもり共通」（scope: 'supporter_shared'）
 * になる（createPersonalRewardはこの用途では新規に呼ばれなくなるが、既存の
 * scope='personal'行は残るため関数自体は削除しない）。RLS
 * rewards_write_supporter_shared_by_creator によりrole='supporter'かつ本人のみ許可。
 */
export async function createSupporterSharedReward(
  client: SupabaseClient,
  familyId: string,
  input: PersonalRewardFormInput
): Promise<ApiResult<Reward>> {
  const { data, error } = await client
    .from("rewards")
    .insert({
      family_id: familyId,
      scope: "supporter_shared",
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
  // [2026-09-20改訂・やること.md 4-71] noteはnull許容（保護者トグルがオフの
  // 家族では、ひとことを書かずに贈れる。設計部/成果物/スキーマ設計.sql
  // 67.3章）。呼び出し元でtrim()した空文字はnullに寄せてから渡すこと。
  input: { sender_id: string; recipient_id: string; points: number; note: string | null }
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
 * API仕様.md 9.6章: 週ごとの記録（要件定義書07-9章新設節「週ごとの記録」、
 * スキーマ設計.sql 41章 family_tree_weekly_completion_counts）。
 * 進行中シーズン・過去シーズンのいずれも`seasonId`を渡すだけで同一クエリ形状で使える
 * （9.6章「現在の木・過去の木のいずれも同一Viewを同一クエリ形状で使える」）。
 * Viewは意図的にORDER BYを持たないため、呼び出し側で必ずweek_start昇順（時系列順）に
 * 並べること。completion_countの多い順に並べ替えてはならない（20.1a節・9.6章2.）。
 */
export async function fetchFamilyTreeWeeklyCompletionCounts(
  client: SupabaseClient,
  seasonId: string
): Promise<ApiResult<FamilyTreeWeeklyCompletionCount[]>> {
  const { data, error } = await client
    .from("family_tree_weekly_completion_counts")
    .select("family_id, season_id, season_start, week_start, completion_count")
    .eq("season_id", seasonId)
    .order("week_start", { ascending: true });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as FamilyTreeWeeklyCompletionCount[] };
}

/**
 * [2026-08-26新設・第4段階] 完了報告が景品と交換済みの場合の詳細。
 * `family_tree_decorations`経由で`gacha_draws`（さらにその先の
 * `gacha_preset_ornaments`／`family_drawings`）を辿った内容（API仕様.md 12.5章）。
 *
 * [2026-09-17追加・主要画面ワイヤーフレーム.md 46.3節末尾「開発部への申し送り」]
 * 木の飾りのタップ拡大表示（46.1〜46.9節）が「いつ木に飾ったか」
 * （`decoratedAt`＝`family_tree_decorations.decorated_at`、既存カラム）と、
 * 家族の絵の場合の「描いた人の名前・ID・題名」（`drawing.artistName`・
 * `artistId`・`title`＝`family_drawings.artist_member_id`/`title`、既存カラム）を
 * 必要とするため追加した。いずれも既存カラムのSELECT句への追加のみで、
 * DBスキーマ変更は伴わない（`fetchFamilyCollectedGachaDraws`の
 * `CollectedGachaDraw.drawing`と同じ埋め込みパターン）。
 */
export interface FamilyTreeDotPrize {
  decorationId: string;
  drawId: string;
  prizeKind: GachaPrizeKind;
  /** family_tree_decorations.decorated_at（いつ木に飾ったか）。 */
  decoratedAt: string;
  presetOrnament: { display_name: string; emoji: string | null } | null;
  /**
   * [2026-09-21追加・要件定義書07-32章] `drawingId`はブロック・
   * `hidden_contents`（content_kind='family_drawing'）の取得後フィルタで
   * 対象の絵を特定するために追加した（`family_drawings.id`）。表示自体には
   * 使わない（`src/lib/blockFilter.ts`の`stripBlockedTreeDotPrizes`・
   * `src/lib/hiddenContentFilter.ts`の`stripHiddenTreeDotPrizes`参照）。
   */
  drawing: { drawingId: string; line_data: FamilyDrawingLineData; artistName: string; artistId: string; title: string | null } | null;
}

/**
 * 木の上の自由配置ステッカー1件（要件定義書07-19章「決定29」、スキーマ設計.sql
 * 49章、API仕様.md 14.5節(b)のクエリ形状）。
 *
 * [2026-09-08新設・49章] `decorate_tree_with_sticker()`が「本人の色丸との交換」
 * から「木の上の任意の座標への自由配置」に変わったことに伴い、ステッカーは
 * `chore_completions`（色丸）を一切参照しなくなった（`completion_id`は常に
 * NULL）。このため`fetchFamilyTreeCompletionDots`（色丸起点の埋め込み）では
 * 構造的に取得できなくなり（PostgRESTの外部キー埋め込みはcompletion_id一致
 * でのみ結合するため）、`family_tree_decorations`単独を起点にした本型・
 * 専用の取得関数（`fetchFamilyTreeStickerPlacements`）に置き換えた。
 * 旧`FamilyTreeDotSticker`（`FamilyTreeCompletionDot.sticker`）は廃止した。
 *
 * [2026-09-17追加・主要画面ワイヤーフレーム.md 46.3節末尾] 木の飾りのタップ拡大
 * 表示（46.1〜46.9節）が「いつ置いたか」を必要とするため`decoratedAt`
 * （`family_tree_decorations.decorated_at`、既存カラム）を追加した。SELECT句への
 * 追加のみで、DBスキーマ変更は伴わない。
 */
export interface FamilyTreeStickerPlacement {
  decorationId: string;
  /** キャンバス相対の0〜1000正規化整数（`family_drawings.line_data`と同じ座標規約）。 */
  posX: number;
  posY: number;
  memberId: string;
  avatarColor: string | null;
  stickerPurchaseId: string;
  shape: "beetle" | "butterfly" | "flower" | "dragon";
  rarity: "bronze" | "silver" | "gold" | "crystal";
  stickerKey: string;
  displayName: string;
  /** family_tree_decorations.decorated_at（いつ木に置いたか）。 */
  decoratedAt: string;
}

/**
 * 完了報告1件ごとの視覚要素の色付け用（API仕様.md 9.2章）。今シーズン開始以降の完了報告を報告者の色付きで返す。
 * [2026-08-26改訂・第4段階] `prize`（非null＝景品に交換済み）を追加し、
 * `family_tree_decorations`をembedするよう変更した（API仕様.md 12.5章のクエリ形状）。
 * [2026-09-08改訂・49章] `sticker`フィールドは廃止した（上記`FamilyTreeStickerPlacement`
 * コメント参照。自由配置ステッカーは本型では一切表現しない、独立した表示レイヤー）。
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
  // [2026-09-08改訂・スキーマ設計.sql 49章] 自由配置ステッカーはcompletion_idを
  // 持たなくなったため、本クエリ（色丸起点の埋め込み）はガチャの景品のみを返す
  // クエリとして無変更のまま残す（API仕様.md 14.5節(a)「ガチャの景品のみを返す
  // クエリとして引き続き有効」）。sticker_purchaseの埋め込みは削除した
  // （構造的にヒットしなくなったため）。自由配置ステッカーの取得は
  // `fetchFamilyTreeStickerPlacements`（本関数の直後）を使う。
  let query = client
    .from("chore_completions")
    .select(
      "id, reported_at, reported_by, family_members!reported_by(avatar_color), " +
        "family_tree_decorations(id, draw_id, decoration_source, decorated_at, gacha_draws(prize_kind, " +
        "preset_ornament:gacha_preset_ornaments(display_name,emoji), " +
        "prize_drawing:family_drawings!gacha_draws_prize_drawing_id_fkey(id,line_data,title,artist_member_id," +
        "artist:family_members!artist_member_id(display_name))))"
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
          draw_id: string | null;
          decoration_source: "gacha" | "sticker";
          decorated_at: string;
          gacha_draws: {
            prize_kind: GachaPrizeKind;
            preset_ornament: { display_name: string; emoji: string | null } | null;
            prize_drawing: {
              id: string;
              line_data: FamilyDrawingLineData;
              title: string | null;
              artist_member_id: string;
              artist: { display_name: string } | null;
            } | null;
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
        decoration && decoration.decoration_source === "gacha" && decoration.gacha_draws && decoration.draw_id
          ? {
              decorationId: decoration.id,
              drawId: decoration.draw_id,
              prizeKind: decoration.gacha_draws.prize_kind,
              decoratedAt: decoration.decorated_at,
              presetOrnament: decoration.gacha_draws.preset_ornament,
              drawing: decoration.gacha_draws.prize_drawing
                ? {
                    drawingId: decoration.gacha_draws.prize_drawing.id,
                    line_data: decoration.gacha_draws.prize_drawing.line_data,
                    artistName: decoration.gacha_draws.prize_drawing.artist?.display_name ?? "だれか",
                    artistId: decoration.gacha_draws.prize_drawing.artist_member_id,
                    title: decoration.gacha_draws.prize_drawing.title,
                  }
                : null,
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

/**
 * API仕様.md 14.5節(b)「自由配置ステッカー（新規。family_tree_decorations単独、
 * family_id・season_id起点）」。指定シーズン（現在の木なら進行中シーズンのid、
 * 過去の木なら該当シーズンのid）に配置された自由配置ステッカー一覧を返す。
 * 誰が・どこに・どの意匠を貼ったかを1クエリで取得できる。並び順は指定しない
 * （呼び出し側は最前面固定で全件を重ねて描画するだけでよく、順序に意味を
 * 持たせない、スキーマ設計.sql 49.6章）。
 */
export async function fetchFamilyTreeStickerPlacements(
  client: SupabaseClient,
  familyId: string,
  seasonId: string
): Promise<ApiResult<FamilyTreeStickerPlacement[]>> {
  const { data, error } = await client
    .from("family_tree_decorations")
    .select(
      "id, pos_x, pos_y, decorated_at, " +
        "sticker_purchase:ornament_sticker_purchases(id, member_id, " +
        "family_members!member_id(avatar_color), " +
        "sticker_catalog(shape, rarity, sticker_key, display_name))"
    )
    .eq("family_id", familyId)
    .eq("season_id", seasonId)
    .eq("decoration_source", "sticker");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as unknown as {
    id: string;
    pos_x: number | null;
    pos_y: number | null;
    decorated_at: string;
    sticker_purchase: {
      id: string;
      member_id: string;
      family_members: { avatar_color: string | null } | null;
      sticker_catalog: {
        shape: "beetle" | "butterfly" | "flower" | "dragon";
        rarity: "bronze" | "silver" | "gold" | "crystal";
        sticker_key: string;
        display_name: string;
      } | null;
    } | null;
  }[];
  const out: FamilyTreeStickerPlacement[] = [];
  for (const r of rows) {
    // DB側CHECK制約（chk_family_tree_decorations_source_payload、49.1章）により
    // decoration_source='sticker'の行は常にpos_x/pos_y・sticker_purchase_idが
    // 非NULLだが、埋め込みが辿れなかった場合（他家族参照等、通常発生しない）に
    // 備えて防御的にスキップする。
    if (r.pos_x == null || r.pos_y == null || !r.sticker_purchase || !r.sticker_purchase.sticker_catalog) continue;
    out.push({
      decorationId: r.id,
      posX: r.pos_x,
      posY: r.pos_y,
      memberId: r.sticker_purchase.member_id,
      avatarColor: r.sticker_purchase.family_members?.avatar_color ?? null,
      stickerPurchaseId: r.sticker_purchase.id,
      shape: r.sticker_purchase.sticker_catalog.shape,
      rarity: r.sticker_purchase.sticker_catalog.rarity,
      stickerKey: r.sticker_purchase.sticker_catalog.sticker_key,
      displayName: r.sticker_purchase.sticker_catalog.display_name,
      decoratedAt: r.decorated_at,
    });
  }
  return { ok: true, data: out };
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
 *
 * [2026-09-02追加] `title`（お絵かきの題名、要件定義書07-13-2a章）。任意
 * 入力のため、未入力（呼び出し側でtrim後0文字になったもの含む）は必ず
 * `null`を渡すこと。空文字列`''`を送るとchk_family_drawings_title制約
 * （trim後1〜20字）に違反しINSERT自体が拒否される（API仕様.md 12.2節）。
 */
export async function createDrawing(
  client: SupabaseClient,
  lineData: FamilyDrawingLineData,
  title: string | null
): Promise<ApiResult<FamilyDrawing>> {
  const { data, error } = await client
    .from("family_drawings")
    .insert({ line_data: lineData, title })
    .select("*")
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as FamilyDrawing };
}

export interface DeleteDrawingResult {
  /**
   * [2026-09-08追加・やること.md 4-4] 削除しようとしたまさにその瞬間に、他の家族
   * メンバーのガチャがこの絵を引いて先に公開していた場合は`true`（このとき削除は
   * 行われておらず、絵は家族の記録として残っている）。通常の削除成功時は`false`。
   */
  published: boolean;
}

/**
 * API仕様.md 12.2章「未公開の絵を削除する（描き直したい場合）」
 * （【2026-08-25本部長決定B】family_drawings_delete_own_unpublishedポリシー）。
 * 公開済み（is_published=true）の行はRLSのUSING句を満たさないため対象0件になる
 * だけでエラーにはならない（33b章コメント）。
 *
 * [2026-09-08改訂・やること.md 4-4] 従来は0件のときに何もしていなかったが、
 * スキーマ設計.sql 33b章の申し送り「UI側はDELETE後にis_publishedを再取得して
 * 確認することを推奨する」に対応した。`.select("id")`でDELETEされた行数を見て、
 * 0件だった場合のみ対象行を再取得し、is_publishedを確認する。公開済みなら
 * `family_drawings_select_scoped`（33b章、`is_published OR artist_member_id = 自分`）
 * により本人からも見えるため、この再取得で判定できる（行が見当たらない場合は
 * 二重押下等で既に削除済みとみなし、published: falseのまま扱う＝実害なし）。
 */
export async function deleteDrawing(client: SupabaseClient, drawingId: string): Promise<ApiResult<DeleteDrawingResult>> {
  const { data, error } = await client.from("family_drawings").delete().eq("id", drawingId).select("id");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  if (data && data.length > 0) return { ok: true, data: { published: false } };

  const { data: row } = await client
    .from("family_drawings")
    .select("is_published")
    .eq("id", drawingId)
    .maybeSingle();
  return { ok: true, data: { published: row?.is_published === true } };
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
 *   同じ検証。この場合は元の絵は削除されずそのまま残る）。(c) 題名が
 *   trim後20字を超えている、または空白のみ等trim後0字（42.1・42.4章。
 *   同じく元の絵は削除されずそのまま残る）。
 * いずれもDB側のRAISE EXCEPTIONメッセージをそのまま表示すればよい。
 *
 * [2026-09-02追加] `p_new_title`が第3引数として必須になった（スキーマ設計.sql
 * 42.4章。旧2引数版はDROP FUNCTIONで廃止済み）。DEFAULT値は無いため、
 * 題名を変えない場合も既存の値をそのまま渡すこと（未入力にする場合は`null`）。
 */
export async function editUnpublishedDrawing(
  client: SupabaseClient,
  drawingId: string,
  lineData: FamilyDrawingLineData,
  title: string | null
): Promise<ApiResult<string>> {
  const { data, error } = await client.rpc("edit_unpublished_drawing", {
    p_drawing_id: drawingId,
    p_new_line_data: lineData,
    p_new_title: title,
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
  /**
   * [2026-09-08追加・主要画面ワイヤーフレーム.md 32.2a節「つくった・あつめたもの」]
   * 獲得した人のmember_id。コレクター棚でメンバーを選んだときの絞り込みに使う
   * （「絞り込みは既存の表示項目〈獲得した人・描いた人の名前〉による閲覧フィルタに
   * すぎない」との整理どおり、`gacha_draws.member_id`という既存の外部キーを
   * 表示名に加えて併せて返すだけであり、新規のデータ・新規のカラムは増えていない）。
   */
  collectorId: string;
  presetOrnament: { display_name: string; emoji: string | null } | null;
  /**
   * [2026-09-02追加] `title`はAPI仕様.md 12.4章「お絵かきの題名」。すでに
   * 公開済みの絵のみを対象にした一覧のため（gacha_draws経由）表示してよい。
   * 無い場合はnull（UI側は表示欄自体を出さない。07-13-2a章）。
   */
  /**
   * [2026-09-21追加・要件定義書07-32章] `drawingId`はhidden_contents
   * （content_kind='family_drawing'）・ブロックの取得後フィルタで対象の絵を
   * 特定するために追加した（`family_drawings.id`）。表示自体には使わない。
   */
  drawing: { drawingId: string; line_data: FamilyDrawingLineData; artistName: string; artistId: string; title: string | null } | null;
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
      "id, drawn_at, prize_kind, member_id, " +
        "collector:family_members!member_id(display_name), " +
        "preset_ornament:gacha_preset_ornaments(display_name,emoji), " +
        "prize_drawing:family_drawings!gacha_draws_prize_drawing_id_fkey(id,line_data,title,artist_member_id," +
        "artist:family_members!artist_member_id(display_name))"
    )
    .eq("family_id", familyId)
    .order("drawn_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as unknown as {
    id: string;
    drawn_at: string;
    prize_kind: GachaPrizeKind;
    member_id: string;
    collector: { display_name: string } | null;
    preset_ornament: { display_name: string; emoji: string | null } | null;
    prize_drawing: {
      id: string;
      line_data: FamilyDrawingLineData;
      title: string | null;
      artist_member_id: string;
      artist: { display_name: string } | null;
    } | null;
  }[];
  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      drawnAt: r.drawn_at,
      prizeKind: r.prize_kind,
      collectorName: r.collector?.display_name ?? "だれか",
      collectorId: r.member_id,
      presetOrnament: r.preset_ornament,
      drawing: r.prize_drawing
        ? {
            drawingId: r.prize_drawing.id,
            line_data: r.prize_drawing.line_data,
            artistName: r.prize_drawing.artist?.display_name ?? "だれか",
            artistId: r.prize_drawing.artist_member_id,
            title: r.prize_drawing.title,
          }
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
 * [2026-09-10改訂・実装メモ.md 159章→160章で仕様変更] 掲示板投稿へのスタンプの
 * 追加・取消。統括指示「掲示板も完了報告と同じく取消・切替できるように」を受け、
 * 157章（`toggleReactionStamp`）と同じRPC集約方式にした。
 *
 * [重要・旧実装からの変更点] 旧実装（103章・104章、〜2026-09-10）は
 * `family_board_reactions`への直接INSERTだったが、本改訂で
 * `family_board_reactions_insert_self`ポリシー自体をDROPし置き換えを作らなかった
 * ため（マイグレーション`20260910030000_toggle_family_board_reaction_stamp.sql`
 * 本体のコメント参照）、直接INSERTは以後RLSにより必ず拒否される。旧`addFamilyBoardReaction`
 * 関数は本関数に置き換えて削除した。
 *
 * [重要・160章での仕様変更] 159章時点は157章と同じ「1人1投稿につき有効な
 * スタンプは常に1件まで」を強制していた（違うスタンプを送ると既存のスタンプが
 * 消えて切り替わる）が、これは104章（統括が指示した「1人が最大4種類のスタンプを
 * 送れる」仕様）を実質撤回するものだったため、本番適用前に統括に確認したうえで
 * 撤回した（実装メモ.md 160章）。**現在の仕様は、同じスタンプをもう一度送ると
 * そのスタンプだけ取消（`removed: true`）、違うスタンプを送ると追加（自分の
 * 他のスタンプは消えない）、未送信なら新規追加。** 157章の完了報告
 * （1人1件まで）とは意図的に異なる仕様である。
 *
 * `reactor_member_id`は引数に取らない（RPC側が`current_family_member_id()`で
 * 呼び出し本人に固定するため、他人のスタンプを指定して操作する経路がそもそも
 * 存在しない）。想定される失敗:
 *   - `foreign_key_violation`（23503）: 対象投稿が存在しないか、既に削除されている
 *     （他家族の投稿を指定した場合もこれに収束する。区別しない設計）
 *   - `check_violation`（23514）: 自分の投稿への自己リアクション（UI側でボタン自体を
 *     出さないため通常到達しないが、多重防御として存在する）
 *   - `insufficient_privilege`（42501）: 未ログイン
 * `stamp_key`の空文字・NULL・長さ超過は既存のCHECK制約がDB側で拒否する。
 */
export async function toggleFamilyBoardReactionStamp(
  client: SupabaseClient,
  input: { post_id: string; stamp_key: StampKey }
): Promise<ApiResult<{ removed: boolean; reaction_id: string | null }>> {
  const { data, error } = await client
    .rpc("toggle_family_board_reaction_stamp", { p_post_id: input.post_id, p_stamp_key: input.stamp_key })
    .single();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as { removed: boolean; reaction_id: string | null } };
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

// ============================================================
// 14. 木を飾るステッカー購入とバッジ（要件定義書07-19章、API仕様.md 14章、
//     スキーマ設計.sql 47章、2026-09-07新設）
//
// [本章の配置について] 12・13章と同じ理由（既存の実際の章番号が他部署の成果物と
// ズレているため、これ以上ズレを広げないよう末尾に追加する）。
// ============================================================

/**
 * API仕様.md 14.1章「ステッカーカタログを見る」。12種（形3種×レアリティ4段）を
 * 常に同じ配置（形ごとに1行、レアリティ4段を列に固定）で表示するため、
 * shape→rarity（cost）の順で並べる。SVGの実データはDBに保存しない
 * （`sticker_key`がクライアント側アセット参照キー、theme.stickerCatalogOrder参照）。
 *
 * [2026-09-11改訂・要件定義書07-25-1章決定11、設計部/成果物/スキーマ設計.sql
 * 53.4章・53.9章] 参照先を`sticker_catalog`から`sticker_catalog_effective_prices`
 * （新設View）に変更した。列構成が完全に一致するため、この1行の変更のみで
 * 家族ごとの上書き価格（`family_sticker_prices`）が反映された値段を返すように
 * なる。`StickerShopPanel.tsx`・`useStickers.ts`は無改修（設計部53.9章のとおり）。
 */
export async function fetchStickerCatalog(client: SupabaseClient): Promise<ApiResult<StickerCatalogItem[]>> {
  const { data, error } = await client
    .from("sticker_catalog_effective_prices")
    .select("*")
    .eq("is_active", true)
    .order("shape")
    .order("points_cost");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as StickerCatalogItem[] };
}

export interface PurchaseStickerResult {
  purchase_id: string;
  sticker_catalog_id: string;
  points_spent: number;
  purchased_at: string;
}

/**
 * API仕様.md 14.2章「ステッカーを購入する」。`purchase_sticker()`（SECURITY DEFINER）が
 * 段階購入制（要件定義書07-19-14章「決定32〜34」。銅以外のレアリティは、同じ形の
 * ひとつ下のレアリティを家族の誰かが過去に購入したことがある場合のみ購入可。
 * 違反時は`check_violation`）・残高チェック（不足なら`check_violation`。両方の
 * 理由が同時に成立する場合は段階購入制のエラーを優先して返す、UIUXデザイン部
 * 32.0b節「決定29」に合わせた順序）を1トランザクションで検証する。
 * [2026-09-08改訂・決定39] 月次購入上限（旧決定31「同じ種類につき1人あたり
 * 月1枚」、2026-09-09導入）は統括判断により撤廃された。同じ種類を同じ月に
 * 何枚でも購入できる。取消APIは存在しない（決定24）。無効化/存在しないIDは
 * `foreign_key_violation`。
 */
export async function purchaseSticker(client: SupabaseClient, catalogId: string): Promise<ApiResult<PurchaseStickerResult>> {
  const { data, error } = await client.rpc("purchase_sticker", { p_catalog_id: catalogId });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: { code: "unknown_error", message: "購入結果を取得できませんでした" } };
  return { ok: true, data: row as PurchaseStickerResult };
}

/**
 * API仕様.md 14.3章「コレクター棚『区画3：自分のステッカー』」（2026-09-08改訂・
 * 主要画面ワイヤーフレーム.md 32.2a節により「集めたもの」区画・シール区分へ統合。
 * 旧「区画3」独立タブは廃止）。指定した`memberId`が購入したステッカー一覧（在庫）を
 * 新しい順で取得する。
 * `ornament_sticker_purchases_select_same_family`ポリシーにより家族の誰でも
 * 他メンバーの購入記録を閲覧できる（決定7・決定23）ため、`memberId`には呼び出し
 * 本人に限らず家族内の任意のメンバーIDを渡してよい（32.2a節メンバー選択チップ用）。
 *
 * [2026-09-08改訂・スキーマ設計.sql 49章「決定29」] `family_tree_decorations`の
 * 埋め込みを`season_id`だけでなく`id, pos_x, pos_y`まで拡張し、`placement`
 * （配置が無ければnull）として返す。同じ購入品は生涯に一度しか配置できない
 * ため（`uq_family_tree_decorations_sticker_once`）、埋め込みは実質0〜1件に
 * 収束する（asEmbeddedArrayで吸収）。持ち物として区画に残り続けるため、
 * 配置済みでも一覧からは消えない（決定16）。
 */
type StickerPurchaseRow = OrnamentStickerPurchase & {
  sticker_catalog: StickerPurchaseWithCatalog["sticker_catalog"];
  family_tree_decorations:
    | { id: string; season_id: string; pos_x: number | null; pos_y: number | null }[]
    | { id: string; season_id: string; pos_x: number | null; pos_y: number | null }
    | null;
};

/** `ornament_sticker_purchases`の1行をコレクター棚表示用の形へ変換する（fetchMyStickerPurchases/fetchFamilyStickerPurchasesの共通処理）。 */
function mapStickerPurchaseRow(r: StickerPurchaseRow, currentSeasonId: string | null): StickerPurchaseWithCatalog {
  const deco = asEmbeddedArray(r.family_tree_decorations)[0] ?? null;
  const placement =
    deco && deco.pos_x != null && deco.pos_y != null
      ? {
          decorationId: deco.id,
          seasonId: deco.season_id,
          posX: deco.pos_x,
          posY: deco.pos_y,
          isCurrentSeason: currentSeasonId != null && deco.season_id === currentSeasonId,
        }
      : null;
  return {
    id: r.id,
    family_id: r.family_id,
    member_id: r.member_id,
    sticker_catalog_id: r.sticker_catalog_id,
    points_spent: r.points_spent,
    purchased_at: r.purchased_at,
    sticker_catalog: r.sticker_catalog,
    placement,
  };
}

export async function fetchMyStickerPurchases(
  client: SupabaseClient,
  memberId: string,
  currentSeasonId: string | null
): Promise<ApiResult<StickerPurchaseWithCatalog[]>> {
  const { data, error } = await client
    .from("ornament_sticker_purchases")
    .select("*, sticker_catalog(shape, rarity, sticker_key, display_name), family_tree_decorations(id, season_id, pos_x, pos_y)")
    .eq("member_id", memberId)
    .order("purchased_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as unknown as StickerPurchaseRow[];
  return { ok: true, data: rows.map((r) => mapStickerPurchaseRow(r, currentSeasonId)) };
}

/**
 * [2026-09-08新設・実装メモ158章・統括の実機確認「あつめたものに、メダルも入れて
 * ほしい」] コレクター棚「集めたもの」区画・メンバー選択チップ「全員」選択時に、
 * 家族全員のメダル所有状況を一覧するための取得。`fetchMyStickerPurchases`と同じ
 * `ornament_sticker_purchases_select_same_family`ポリシー（`family_id =
 * current_family_id()`、スキーマ設計.sql・20260907020000マイグレーション）の範囲内で、
 * `member_id`ではなく`family_id`で絞り込む点のみが異なる。新規テーブル・新規列・
 * 新規ポリシーは追加していない（DBの変更なし）。
 */
export async function fetchFamilyStickerPurchases(
  client: SupabaseClient,
  familyId: string,
  currentSeasonId: string | null
): Promise<ApiResult<StickerPurchaseWithCatalog[]>> {
  const { data, error } = await client
    .from("ornament_sticker_purchases")
    .select("*, sticker_catalog(shape, rarity, sticker_key, display_name), family_tree_decorations(id, season_id, pos_x, pos_y)")
    .eq("family_id", familyId)
    .order("purchased_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as unknown as StickerPurchaseRow[];
  return { ok: true, data: rows.map((r) => mapStickerPurchaseRow(r, currentSeasonId)) };
}

/**
 * API仕様.md 14.4節「ステッカーを木に飾る」。統括要望「ステッカーは自分の好きな
 * ところに貼りたい」（2026-09-07）・スキーマ設計.sql 49章により、木への配置は
 * 「本人の今月の色丸1つとの交換」から「木の上の任意の座標への自由配置」に変わった。
 * `decorate_tree_with_sticker()`は「自分の」購入品しか受け付けず（他人の購入品は
 * DB側で拒否）、完了報告（色丸）は一切消費・参照しない。`posX`・`posY`は
 * キャンバス相対の0〜1000整数（範囲外は`check_violation`「木の外側には貼れません」）。
 * 同じ購入品は生涯に一度しか配置できない（決定29、`check_violation`）。
 * 戻り値は新規`family_tree_decorations.id`。
 */
export async function decorateTreeWithSticker(
  client: SupabaseClient,
  purchaseId: string,
  posX: number,
  posY: number
): Promise<ApiResult<string>> {
  const { data, error } = await client.rpc("decorate_tree_with_sticker", {
    p_purchase_id: purchaseId,
    p_pos_x: posX,
    p_pos_y: posY,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as string };
}

/**
 * API仕様.md 14.4節「[2026-09-07新設] すでに貼ったステッカーの座標を、その月の
 * うちに変更する」。統括判断（スキーマ設計.sql 49.12章）: 決定29「その月の木かぎり。
 * 翌月以降に置き直すことはできない」により、貼り直す機会が二度と来ないため、
 * その月のうちの移動を新設した。`move_tree_sticker()`は自分の配置・進行中
 * シーズンの配置のみを対象にする（他人の配置は`foreign_key_violation`「対象の
 * 配置が見つかりません」、過去シーズンの配置は`check_violation`「過去の木の配置は
 * 動かせません」）。座標のみを更新し、購入・シーズン・所有者は変更しない。
 */
export async function moveTreeSticker(
  client: SupabaseClient,
  decorationId: string,
  posX: number,
  posY: number
): Promise<ApiResult<string>> {
  const { data, error } = await client.rpc("move_tree_sticker", {
    p_decoration_id: decorationId,
    p_pos_x: posX,
    p_pos_y: posY,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as string };
}

/**
 * API仕様.md 14.7章「バッジ（累計到達）」。自分（または家族の誰か）が獲得済みの
 * バッジ一覧。`member_badges_select_same_family`により家族の誰でも閲覧可能。
 */
export async function fetchMemberBadges(client: SupabaseClient, memberId: string): Promise<ApiResult<MemberBadge[]>> {
  const { data, error } = await client
    .from("member_badges")
    .select("*")
    .eq("member_id", memberId)
    .order("achieved_at");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as MemberBadge[] };
}

/** API仕様.md 14.7章「メンバー×指標ごとの現在の累計値（進捗表示用）」。 */
export async function fetchMemberBadgeProgress(
  client: SupabaseClient,
  memberId: string
): Promise<ApiResult<MemberBadgeProgress[]>> {
  const { data, error } = await client.from("member_badge_progress").select("*").eq("member_id", memberId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as MemberBadgeProgress[] };
}

/**
 * API仕様.md 14.7章「各指標の到達段階一覧（青天井の階段）」。DB側
 * `badge_tier_thresholds()`（純関数、PUBLIC実行可能のままREVOKEされていない、
 * スキーマ設計.sql 47.6章）を正とする。昇順の整数配列を返す。
 */
export async function fetchBadgeTierThresholds(client: SupabaseClient, badgeKey: string): Promise<ApiResult<number[]>> {
  const { data, error } = await client.rpc("badge_tier_thresholds", { p_badge_key: badgeKey });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as number[] };
}

// ============================================================
// 14.8 メダルの段階リセット（要件定義書07-25-1章決定19〜29、UIUXデザイン部
// 40章、設計部/成果物/スキーマ設計.sql 52章、2026-09-11新設）
// ============================================================

/**
 * P14「メダルの設定」・買う画面（P37/C30/S23）の両方が使う生データ取得。
 * `sticker_tier_resets_select_same_family`（family_id一致、ロール制限なし。
 * 設計部52.3章）により家族の誰でも読める。専用View・RPCは追加しない
 * （設計部52.6章・52.7章の判断。集計はクライアント側で行う既存方針を踏襲）。
 */
export async function fetchStickerTierResets(client: SupabaseClient, familyId: string): Promise<ApiResult<StickerTierReset[]>> {
  const { data, error } = await client.from("sticker_tier_resets").select("*").eq("family_id", familyId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as StickerTierReset[] };
}

export interface ResetStickerTierResult {
  reset_id: string;
  shape: string;
  reset_at: string;
  reset_by: string;
}

/**
 * P14「メダルの設定」（要件定義書07-25-1章決定20〜27、UIUXデザイン部40.1節）。
 * `reset_sticker_tier()`（SECURITY DEFINER・保護者限定、設計部52.4章）を呼ぶ。
 * 保護者以外が呼ぶと`insufficient_privilege`。存在しない形を渡すと
 * `foreign_key_violation`。取り消しAPIは存在しない（決定24）。「ぜんぶ」は
 * クライアントが対象shapeの数だけ本関数を繰り返し呼び出すことで実現する
 * （設計部決定52-5、配列引数の一括RPCは不採用）。
 */
export async function resetStickerTier(client: SupabaseClient, shape: string): Promise<ApiResult<ResetStickerTierResult>> {
  const { data, error } = await client.rpc("reset_sticker_tier", { p_shape: shape });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, error: { code: "unknown_error", message: "リセット結果を取得できませんでした" } };
  return { ok: true, data: row as ResetStickerTierResult };
}

// ============================================================
// メダルの値段を家族ごとに編集できるようにする（要件定義書07-25-1章決定
// 10〜18、UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 41章、設計部/
// 成果物/スキーマ設計.sql 53章、2026-09-11新設）。
// 画面は`app/parent/sticker-settings.tsx`（メダル管理）。41章は「設定」の
// 中を前提に書かれているが、業務指示によりこの画面へ読み替える。
// ============================================================

export interface FamilyStickerPriceRow {
  shape: string;
  rarity: "bronze" | "silver" | "gold" | "crystal";
  points_cost: number;
}

/**
 * 現在の有効価格（家族の上書きがあればそれ、無ければ既定値）を取得する。
 * 設計部53.9章の推奨どおり、`sticker_catalog_effective_prices`を形
 * `beetle`（カブトムシ）1つに絞って取得する。決定13「同じレアリティなら
 * 形によらず同額」の前提により、1つの形の4行（銅・銀・金・クリスタル）を
 * 取得すれば家族の現在の有効価格が過不足なく揃う。
 */
export async function fetchFamilyStickerPrices(client: SupabaseClient): Promise<ApiResult<FamilyStickerPriceRow[]>> {
  const { data, error } = await client
    .from("sticker_catalog_effective_prices")
    .select("shape, rarity, points_cost")
    .eq("shape", "beetle")
    .eq("is_active", true);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as FamilyStickerPriceRow[] };
}

export interface SetFamilyStickerPricesResultRow {
  rarity: "bronze" | "silver" | "gold" | "crystal";
  points_cost: number;
  is_override: boolean;
}

/**
 * メダルの値段（銅・銀・金・クリスタル）を家族単位でまとめて1回で保存する。
 * `set_family_sticker_prices()`（SECURITY DEFINER・保護者限定、設計部53.5章）を
 * 呼ぶ。0pt禁止・単調性（銅≤銀≤金≤クリスタル、決定18）はサーバー側でも
 * 検証され、違反時は`check_violation`で拒否される。保護者以外が呼ぶと
 * `insufficient_privilege`。保存値が既定値と一致するレアリティは上書き行が
 * 削除される（決定9）。
 */
export async function setFamilyStickerPrices(
  client: SupabaseClient,
  prices: { bronze: number; silver: number; gold: number; crystal: number }
): Promise<ApiResult<SetFamilyStickerPricesResultRow[]>> {
  const { data, error } = await client.rpc("set_family_sticker_prices", {
    p_bronze: prices.bronze,
    p_silver: prices.silver,
    p_gold: prices.gold,
    p_crystal: prices.crystal,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as SetFamilyStickerPricesResultRow[] };
}

// ============================================================
// シール帳（習慣カード）とフィギュア（要件定義書07-28章2026-09-19全面改訂・
// 決定25〜33、API仕様.md 17章、スキーマ設計.sql 57章、開発部/成果物/
// 実装メモ.md 256章、2026-09-17新設・2026-09-19全面作り替え）
// [重要] 新しい完了報告経路・新しい取消経路は一切作らない（決定25。
// どのクエストの完了報告でもシールが埋まる）。完了報告・取消は
// reportCompletion/cancelChoreCompletionをそのまま使う。
// ============================================================

/**
 * API仕様.md 17.6節「絵柄の一覧（作成/選び直し画面用）」。クライアント側で
 * kind_keyごとにグルーピングし、1種類につき4段階（銅/銀/金/クリスタル）の
 * プレビューをまとめて表示する（絵柄選び直し画面で使う）。
 */
export async function fetchHabitFigureCatalog(client: SupabaseClient): Promise<ApiResult<HabitFigureCatalogItem[]>> {
  const { data, error } = await client
    .from("habit_figure_catalog")
    .select("*")
    .eq("is_active", true)
    .order("sort_order")
    .order("tier");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as HabitFigureCatalogItem[] };
}

/**
 * API仕様.md 17.2節「帯（じぶんタブのシール帳カード・進み具合のみ）」。
 * `habit_cards_select_same_family`により家族の誰でも他メンバーのシール帳を
 * 閲覧できる（決定12）ため、`memberId`には家族内の任意のメンバーIDを渡して
 * よい。決定27「進行中の冊は常に1冊」により、常にちょうど1件が返る
 * （nullが返るのは異常系のみ）。
 */
export async function fetchActiveHabitCard(client: SupabaseClient, memberId: string): Promise<ApiResult<HabitCard | null>> {
  const { data, error } = await client
    .from("habit_cards")
    .select("*")
    .eq("member_id", memberId)
    .eq("status", "active")
    .maybeSingle();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data as HabitCard | null) ?? null };
}

/** API仕様.md 17.4節「完成した冊の一覧」（コレクション、決定31）。 */
export async function fetchCompletedHabitCards(client: SupabaseClient, memberId: string): Promise<ApiResult<HabitCard[]>> {
  const { data, error } = await client
    .from("habit_cards")
    .select("*")
    .eq("member_id", memberId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as HabitCard[] };
}

/**
 * API仕様.md 17.2節・17.3節「進み具合・進行中の内訳」、17.4節「完成した冊
 * すべての内訳（まとめて1回）」。`habit_card_chore_breakdown`（スキーマ設計.sql
 * 57.7章View）を冊のID配列で1回だけ取得する（N+1にしない。冊の枚数ぶん
 * 個別に呼ばない）。並び替え・件数の絞り込み（多い順上位5件＋ほか◯件）は
 * クライアント側の仕事（DB側は素の集計行を返すのみ）。
 */
export async function fetchHabitCardChoreBreakdown(
  client: SupabaseClient,
  habitCardIds: string[]
): Promise<ApiResult<HabitCardChoreBreakdownRow[]>> {
  if (habitCardIds.length === 0) return { ok: true, data: [] };
  const { data, error } = await client
    .from("habit_card_chore_breakdown")
    .select("*")
    .in("habit_card_id", habitCardIds);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as HabitCardChoreBreakdownRow[] };
}

/**
 * API仕様.md 16章「クエストごとの累計実施回数」（やること.md 4-55）。
 * `chore_completion_totals`（スキーマ設計.sql 56章）を`family_id`のみで
 * 絞って家族ぶんをまとめて1回で取る（決定56-6。C5・P19・S5・P10の4画面
 * 共通の標準パターン、クエストごとに問い合わせを飛ばさない＝N+1にしない）。
 * 呼び出し側（`useChoreCompletionTotals`）が`chore_id`をキーにしたルックアップ
 * を1つ作る。
 */
export async function fetchChoreCompletionTotals(
  client: SupabaseClient,
  familyId: string
): Promise<ApiResult<ChoreCompletionTotalEntry[]>> {
  const { data, error } = await client
    .from("chore_completion_totals")
    .select("chore_id, member_id, total_count")
    .eq("family_id", familyId);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as ChoreCompletionTotalEntry[] };
}

/**
 * API仕様.md 17.5節「絵柄の選び直し」。`choose_habit_card_kind()`は
 * 「まだ何も積み上がっていない（累計0件）」の間だけ呼び出せる
 * （スキーマ設計.sql 57.6章、check_violationで拒否されうる）。
 */
export async function chooseHabitCardKind(
  client: SupabaseClient,
  habitCardId: string,
  kindKey: string
): Promise<ApiResult<string>> {
  const { data, error } = await client.rpc("choose_habit_card_kind", {
    p_habit_card_id: habitCardId,
    p_kind_key: kindKey,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as string };
}

/**
 * API仕様.md 17.4節「完成した冊すべての内訳」と同じ理由で、獲得済み
 * フィギュア（決定30「獲得したフィギュア: 銅・銀・金・クリスタルの4体」）も
 * 冊のID配列でまとめて1回取得する（N+1にしない、49-B.6節開発部への
 * 実装メモ）。
 */
export async function fetchHabitFigureGrantsForCards(
  client: SupabaseClient,
  habitCardIds: string[]
): Promise<ApiResult<HabitFigureGrantWithCatalog[]>> {
  if (habitCardIds.length === 0) return { ok: true, data: [] };
  const { data, error } = await client
    .from("habit_figure_grants")
    .select("*, habit_figure_catalog(kind_display_name, kind_display_name_child, kind_emoji, figure_key, display_name)")
    .in("habit_card_id", habitCardIds)
    .order("granted_at");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as unknown as HabitFigureGrantWithCatalog[] };
}

/**
 * API仕様.md 17.7節「直近で新しく付与されたフィギュアが無いか確認する」。
 * 完了報告成功直後に呼び、返ってきた行の`granted_at`が完了報告の
 * `reported_at`以上であれば「今回の報告で新しく獲得した」ものとして演出を
 * 出す（同一トランザクション内の`now()`は完全に一致するため`>=`で判定できる。
 * 呼び出し元はComparisonの根拠をコード内コメントに残すこと）。
 */
export async function fetchLatestHabitFigureGrant(
  client: SupabaseClient,
  memberId: string
): Promise<ApiResult<HabitFigureGrantWithCatalog | null>> {
  const { data, error } = await client
    .from("habit_figure_grants")
    .select("*, habit_figure_catalog(kind_display_name, kind_display_name_child, kind_emoji, figure_key, display_name)")
    .eq("member_id", memberId)
    .order("granted_at", { ascending: false })
    .limit(1);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as unknown as HabitFigureGrantWithCatalog[];
  return { ok: true, data: rows[0] ?? null };
}

/**
 * API仕様.md 17.7節「段階到達時の自動付与・木への配置」。
 * `decorate_tree_with_habit_figure()`は自分の獲得物・今シーズンのみ受け付ける。
 * `posX`・`posY`はキャンバス相対の0〜1000整数（ステッカーと同じ規約）。
 * 57.9章のとおり変更なし。
 */
export async function decorateTreeWithHabitFigure(
  client: SupabaseClient,
  grantId: string,
  posX: number,
  posY: number
): Promise<ApiResult<string>> {
  const { data, error } = await client.rpc("decorate_tree_with_habit_figure", {
    p_grant_id: grantId,
    p_pos_x: posX,
    p_pos_y: posY,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as string };
}

/**
 * API仕様.md 17.7節「貼ったフィギュアの座標を、その月のうちに動かす」。
 * `move_tree_habit_figure()`は自分の配置・進行中シーズンの配置のみを対象にする。
 */
export async function moveTreeHabitFigure(
  client: SupabaseClient,
  decorationId: string,
  posX: number,
  posY: number
): Promise<ApiResult<string>> {
  const { data, error } = await client.rpc("move_tree_habit_figure", {
    p_decoration_id: decorationId,
    p_pos_x: posX,
    p_pos_y: posY,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as string };
}

/**
 * API仕様.md 17.7節「木の表示への埋め込み」。ステッカーの
 * `fetchFamilyTreeStickerPlacements`と同型（family_tree_decorations単独を
 * 起点にした専用クエリ。decoration_source='habit_figure'の行のみを対象にする）。
 */
export interface FamilyTreeHabitFigurePlacement {
  decorationId: string;
  posX: number;
  posY: number;
  memberId: string;
  avatarColor: string | null;
  grantId: string;
  tier: "bronze" | "silver" | "gold" | "crystal";
  kindDisplayName: string;
  /** 決定71（主要画面ワイヤーフレーム.md 49-B.15章）。子ども向けひらがな表記。NULL=未入力。 */
  kindDisplayNameChild: string | null;
  kindEmoji: string | null;
  figureKey: string;
  displayName: string;
  decoratedAt: string;
}

export async function fetchFamilyTreeHabitFigurePlacements(
  client: SupabaseClient,
  familyId: string,
  seasonId: string
): Promise<ApiResult<FamilyTreeHabitFigurePlacement[]>> {
  const { data, error } = await client
    .from("family_tree_decorations")
    .select(
      "id, pos_x, pos_y, decorated_at, " +
        "habit_figure_grant:habit_figure_grants(id, member_id, tier, " +
        "family_members!member_id(avatar_color), " +
        "habit_figure_catalog(kind_display_name, kind_display_name_child, kind_emoji, figure_key, display_name))"
    )
    .eq("family_id", familyId)
    .eq("season_id", seasonId)
    .eq("decoration_source", "habit_figure");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as unknown as {
    id: string;
    pos_x: number | null;
    pos_y: number | null;
    decorated_at: string;
    habit_figure_grant: {
      id: string;
      member_id: string;
      tier: "bronze" | "silver" | "gold" | "crystal";
      family_members: { avatar_color: string | null } | null;
      habit_figure_catalog: {
        kind_display_name: string;
        kind_display_name_child: string | null;
        kind_emoji: string | null;
        figure_key: string;
        display_name: string;
      } | null;
    } | null;
  }[];
  const out: FamilyTreeHabitFigurePlacement[] = [];
  for (const r of rows) {
    // DB側CHECK制約（chk_family_tree_decorations_source_payload）により
    // decoration_source='habit_figure'の行は常にpos_x/pos_y・
    // habit_figure_grant_idが非NULLだが、埋め込みが辿れなかった場合
    // （他家族参照等、通常発生しない）に備えて防御的にスキップする。
    if (r.pos_x == null || r.pos_y == null || !r.habit_figure_grant || !r.habit_figure_grant.habit_figure_catalog) continue;
    out.push({
      decorationId: r.id,
      posX: r.pos_x,
      posY: r.pos_y,
      memberId: r.habit_figure_grant.member_id,
      avatarColor: r.habit_figure_grant.family_members?.avatar_color ?? null,
      grantId: r.habit_figure_grant.id,
      tier: r.habit_figure_grant.tier,
      kindDisplayName: r.habit_figure_grant.habit_figure_catalog.kind_display_name,
      kindDisplayNameChild: r.habit_figure_grant.habit_figure_catalog.kind_display_name_child,
      kindEmoji: r.habit_figure_grant.habit_figure_catalog.kind_emoji,
      figureKey: r.habit_figure_grant.habit_figure_catalog.figure_key,
      displayName: r.habit_figure_grant.habit_figure_catalog.display_name,
      decoratedAt: r.decorated_at,
    });
  }
  return { ok: true, data: out };
}

/**
 * コレクター棚「集めたもの」区画・フィギュア区分（主要画面ワイヤーフレーム.md
 * 49.2章決定3-③・決定27、開発部/成果物/実装メモ.md 237章）。`fetchMyStickerPurchases`と
 * 同じ「木への配置状況を付与する」パターン。`habit_figure_grants`は`member_id`列を
 * 直接持つため、`ornament_sticker_purchases`と違いhabit_cardsへのJOINは不要。
 */
type HabitFigureGrantRow = HabitFigureGrant & {
  habit_figure_catalog: HabitFigureGrantWithCatalog["habit_figure_catalog"];
  family_tree_decorations:
    | { id: string; season_id: string; pos_x: number | null; pos_y: number | null }[]
    | { id: string; season_id: string; pos_x: number | null; pos_y: number | null }
    | null;
};

function mapHabitFigureGrantRow(r: HabitFigureGrantRow, currentSeasonId: string | null): HabitFigureGrantWithPlacement {
  const deco = asEmbeddedArray(r.family_tree_decorations)[0] ?? null;
  const placement =
    deco && deco.pos_x != null && deco.pos_y != null
      ? {
          decorationId: deco.id,
          seasonId: deco.season_id,
          posX: deco.pos_x,
          posY: deco.pos_y,
          isCurrentSeason: currentSeasonId != null && deco.season_id === currentSeasonId,
        }
      : null;
  return {
    id: r.id,
    family_id: r.family_id,
    habit_card_id: r.habit_card_id,
    member_id: r.member_id,
    tier: r.tier,
    figure_catalog_id: r.figure_catalog_id,
    triggering_completion_id: r.triggering_completion_id,
    granted_at: r.granted_at,
    habit_figure_catalog: r.habit_figure_catalog,
    placement,
  };
}

export async function fetchMyHabitFigureGrants(
  client: SupabaseClient,
  memberId: string,
  currentSeasonId: string | null
): Promise<ApiResult<HabitFigureGrantWithPlacement[]>> {
  const { data, error } = await client
    .from("habit_figure_grants")
    .select("*, habit_figure_catalog(kind_display_name, kind_display_name_child, kind_emoji, figure_key, display_name), family_tree_decorations(id, season_id, pos_x, pos_y)")
    .eq("member_id", memberId)
    .order("granted_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as unknown as HabitFigureGrantRow[];
  return { ok: true, data: rows.map((r) => mapHabitFigureGrantRow(r, currentSeasonId)) };
}

/** 「全員」選択時の「フィギュア」区分（`fetchFamilyStickerPurchases`と同じ考え方）。 */
export async function fetchFamilyHabitFigureGrants(
  client: SupabaseClient,
  familyId: string,
  currentSeasonId: string | null
): Promise<ApiResult<HabitFigureGrantWithPlacement[]>> {
  const { data, error } = await client
    .from("habit_figure_grants")
    .select("*, habit_figure_catalog(kind_display_name, kind_display_name_child, kind_emoji, figure_key, display_name), family_tree_decorations(id, season_id, pos_x, pos_y)")
    .eq("family_id", familyId)
    .order("granted_at", { ascending: false });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  const rows = (data ?? []) as unknown as HabitFigureGrantRow[];
  return { ok: true, data: rows.map((r) => mapHabitFigureGrantRow(r, currentSeasonId)) };
}

// ============================================================
// 利用規約への同意＋Play Families安全リマインダー（やること.md 2-22、
// 市場調査部レポート サマリー表#1・#7、開発部/成果物/実装メモ.md 181章）。
// supabase/migrations/20260918010000_terms_consent.sql参照。
// join_family_with_invite_code/acceptFamilyInviteと違い、参加時ではなく
// 「ログインするたびに1回だけ確認する」導線のため、保護者・みまもりの
// デフォルトクライアントだけでなく子ども専用クライアント（session.client）
// からも呼べるよう、呼び出し元のclientをそのまま受け取る設計にする。
// ============================================================

/**
 * 現在ログイン中のメンバーが、現行バージョンの利用規約＋安全リマインダーに
 * 同意済みかどうか。`has_agreed_to_current_terms()`（SECURITY DEFINER）。
 */
export async function hasAgreedToCurrentTerms(client: SupabaseClient): Promise<ApiResult<boolean>> {
  const { data, error } = await client.rpc("has_agreed_to_current_terms");
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: Boolean(data) };
}

/**
 * 利用規約＋安全リマインダーへの同意を記録する。`consentVersion`は
 * src/components/TermsConsentGate.tsx の TERMS_CONSENT_VERSION を渡すこと。
 * DB側 current_terms_consent_version() と一致しない場合、check_violation
 * （「アプリが古い可能性があります…」）で拒否される。
 */
export async function recordTermsConsent(client: SupabaseClient, consentVersion: number): Promise<ApiResult<null>> {
  const { error } = await client.rpc("record_terms_consent", { p_consent_version: consentVersion });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: null };
}

// ============================================================
// 振り返る機会（要件定義書07-35章、設計部/成果物/API仕様.md 29章、
// スキーマ設計.sql 72章）。先週分（jst_week_start_date()区切り）が確定した
// 状態でのみ提示する。当日進行中の週のweek_startでは絶対に問い合わせない
// こと（29.4章）。
// ============================================================

/**
 * API仕様.md 29.1章・項目1「先週の家族全体の完了報告数」。41章の既存View
 * `family_tree_weekly_completion_counts`をfamily_id・week_startで1行だけ
 * 絞る（0件の週は行が無いため`maybeSingle`）。
 */
export async function fetchFamilyTreeWeeklyCompletionCountForWeek(
  client: SupabaseClient,
  familyId: string,
  weekStart: string
): Promise<ApiResult<Pick<FamilyTreeWeeklyCompletionCount, "week_start" | "completion_count"> | null>> {
  const { data, error } = await client
    .from("family_tree_weekly_completion_counts")
    .select("week_start, completion_count")
    .eq("family_id", familyId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data as Pick<FamilyTreeWeeklyCompletionCount, "week_start" | "completion_count"> | null) ?? null };
}

/**
 * API仕様.md 29.2章・項目3「その週によく行われたクエストの上位」。72章の
 * 新設View`chore_weekly_completion_counts`をfamily_id・week_startで絞って
 * 家族ぶんをまとめて1回で取る。並び替え・上位5件＋「ほか◯件」への要約は
 * 呼び出し側（src/lib/weeklyReviewDisplay.ts）の仕事（Viewは意図的に
 * ORDER BYを持たない、72章コメント）。
 */
export async function fetchChoreWeeklyCompletionCounts(
  client: SupabaseClient,
  familyId: string,
  weekStart: string
): Promise<ApiResult<ChoreWeeklyCompletionCount[]>> {
  const { data, error } = await client
    .from("chore_weekly_completion_counts")
    .select("family_id, chore_id, week_start, completion_count")
    .eq("family_id", familyId)
    .eq("week_start", weekStart);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as ChoreWeeklyCompletionCount[] };
}

/**
 * API仕様.md 29.3章・項目4「その週にシール帳が1冊完成した場合」。
 * `habit_cards`をfamily_id・status='completed'・completed_atが先週の範囲に
 * 収まるもので絞る（2026-09-19のシール帳作り替え〈07-28章決定27〉以降、
 * `archive_reason`列は撤去済みのため、設計部/成果物/API仕様.md 29.3章の
 * `archive_reason='crystal_completed'`という例示は現行スキーマと食い違う。
 * 本関数は実装済みの現行スキーマ〈status='completed'〉に合わせている。
 * 実装メモ参照）。家族の誰かが完成させれば対象になる（本人に絞らない）。
 */
export async function fetchFamilyCompletedHabitCardsInRange(
  client: SupabaseClient,
  familyId: string,
  fromIsoInclusive: string,
  toIsoExclusive: string
): Promise<ApiResult<HabitCard[]>> {
  const { data, error } = await client
    .from("habit_cards")
    .select("*")
    .eq("family_id", familyId)
    .eq("status", "completed")
    .gte("completed_at", fromIsoInclusive)
    .lt("completed_at", toIsoExclusive);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as HabitCard[] };
}

// ============================================================
// 自分で目標を決める（要件定義書07-36章、設計部/成果物/API仕様.md 28章、
// スキーマ設計.sql 71章）。
// ============================================================

/**
 * API仕様.md 28.3章「いまの目標を取得する」（3ロール共通）。
 * `retired_at IS NULL`の行は1人につき高々1件（71.1章の部分UNIQUEインデックス）。
 */
export async function fetchActiveMemberGoal(client: SupabaseClient, memberId: string): Promise<ApiResult<MemberGoal | null>> {
  const { data, error } = await client
    .from("member_goals")
    .select("*")
    .eq("member_id", memberId)
    .is("retired_at", null)
    .maybeSingle();
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data as MemberGoal | null) ?? null };
}

/**
 * API仕様.md 28.3章の家族版。保護者向けカード（61.3節決定7）は子ども全員分を
 * 1枚のカードにまとめて表示するため、family_idだけで一括取得する
 * （子どもの人数ぶん個別に問い合わせない＝N+1にしない）。
 */
export async function fetchActiveMemberGoalsForFamily(client: SupabaseClient, familyId: string): Promise<ApiResult<MemberGoal[]>> {
  const { data, error } = await client
    .from("member_goals")
    .select("*")
    .eq("family_id", familyId)
    .is("retired_at", null);
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: (data ?? []) as MemberGoal[] };
}

/**
 * API仕様.md 28.1章「新しい目標を登録する・差し替える」（保護者操作）。
 * `set_member_goal()`（SECURITY DEFINER）経由のみ。直接`.insert(...)`は
 * RLSに拒否される（71.4章・意図的）。
 */
export async function setMemberGoal(
  client: SupabaseClient,
  memberId: string,
  goalText: string,
  linkedChoreId: string | null
): Promise<ApiResult<string>> {
  const { data, error } = await client.rpc("set_member_goal", {
    p_member_id: memberId,
    p_goal_text: goalText,
    p_linked_chore_id: linkedChoreId,
  });
  if (error) return { ok: false, error: fromPostgrestError(error) };
  return { ok: true, data: data as string };
}
