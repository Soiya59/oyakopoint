/**
 * family_deletion_codes（家族を削除するための確認コード）の検証ロジック。
 *
 * 参照: 設計部/成果物/スキーマ設計.sql 80.3・80.7章
 *       開発部/成果物/実装メモ.md 311章
 *
 * remove-member（delete_familyモード）・delete-account の2箇所から同じ
 * 検証ロジックを呼ぶため、_shared/parentAuth.ts と同じ考え方で1つの共有
 * ヘルパーにまとめた（80.7章の推奨）。
 *
 * [エラーコードの命名について・設計からの軽微な整理] スキーマ設計.sql
 * 80.7章の擬似コードは `code_not_requested`等の短い名前を示していたが、
 * 実際にHTTPレスポンスへ乗せる値はAPI仕様.md 36.4章・スキーマ設計.sql
 * 80.10章の一覧（`deletion_code_not_requested`等）であるため、変換の手間を
 * 無くすためエラー種別の内部表現も最初からその文字列そのものにした
 * （呼び出し元がそのまま`{ error: e.code }`で返せる）。設計判断の変更では
 * なく命名の整理であり、外部から見えるHTTP契約（80.10章）は変えていない。
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import { comparePin } from "./pin.ts";

// 80.3章「今回はSupabase Authを経由しない専用テーブル方式のため、
// child-loginのPIN照合（3.2章）と全く同じ数値を流用する」
export const DELETION_CODE_MAX_ATTEMPTS = 5;
export const DELETION_CODE_LOCK_DURATION_MS = 15 * 60 * 1000;
export const DELETION_CODE_TTL_MS = 60 * 60 * 1000; // 1時間
export const DELETION_CODE_RESEND_COOLDOWN_MS = 30 * 1000; // 30秒

/** `/^\d{6}$/`（80.7章「isValidPinの6桁版」）。 */
export function isValidDeletionCode(code: unknown): code is string {
  return typeof code === "string" && /^\d{6}$/.test(code);
}

export type DeletionCodeErrorCode =
  | "deletion_code_not_requested" // 行が無い（一度もrequestを呼んでいない）
  | "deletion_code_expired" // expires_at < now()
  | "deletion_code_locked" // locked_until が未来
  | "deletion_code_invalid"; // ハッシュ不一致

export class DeletionCodeVerifyError extends Error {
  status: number;
  code: DeletionCodeErrorCode;
  constructor(status: number, code: DeletionCodeErrorCode) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/**
 * family_deletion_codesを検証する。
 *
 * 呼び出し元（remove-member・delete-account）は、必ずJWTから解決した
 * 「呼び出し本人のmember_id」だけを渡すこと（クライアントが送るidを
 * そのまま渡さない。80.2章「他人の確認コードを、自分のリクエストで検証する」
 * という余地を呼び出し側の設計で塞ぐ）。
 *
 * 成功時は何もせず戻る（80.5章「コード検証成功後、明示的な削除は行わない」
 * ——使用済みコードの無効化は、後続の`DELETE FROM families`のCASCADEに
 * 任せる）。失敗時は{@link DeletionCodeVerifyError}を投げる。DB操作自体が
 * 失敗した場合は素のErrorを投げる（呼び出し元は500 internal_errorに丸める）。
 */
export async function verifyFamilyDeletionCode(
  admin: SupabaseClient,
  memberId: string,
  code: string
): Promise<void> {
  const { data: row, error } = await admin
    .from("family_deletion_codes")
    .select("code_hash, failed_attempts, locked_until, expires_at")
    .eq("member_id", memberId)
    .maybeSingle();

  if (error) {
    console.error("verifyFamilyDeletionCode: lookup failed", error);
    throw new Error("internal_error");
  }

  if (!row) {
    throw new DeletionCodeVerifyError(400, "deletion_code_not_requested");
  }

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    throw new DeletionCodeVerifyError(423, "deletion_code_locked");
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new DeletionCodeVerifyError(400, "deletion_code_expired");
  }

  const matches = await comparePin(code, row.code_hash);

  if (!matches) {
    const nextAttempts = row.failed_attempts + 1;
    const shouldLock = nextAttempts >= DELETION_CODE_MAX_ATTEMPTS;

    const { error: updateError } = await admin
      .from("family_deletion_codes")
      .update({
        failed_attempts: nextAttempts,
        locked_until: shouldLock
          ? new Date(Date.now() + DELETION_CODE_LOCK_DURATION_MS).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq("member_id", memberId);

    if (updateError) {
      console.error("verifyFamilyDeletionCode: failed_attempts update failed", updateError);
      throw new Error("internal_error");
    }

    throw new DeletionCodeVerifyError(400, "deletion_code_invalid");
  }

  // 一致: 行の明示的な削除・failed_attemptsのリセットは行わない（80.5・80.11章3番）。
  // 呼び出し元はこのあとconfirm_family_nameの照合→DELETE FROM familiesへ進み、
  // 成功すればCASCADEで本行も消える。confirm_family_nameの照合で失敗した場合は
  // 正しいコードのまま再試行できる。
}
