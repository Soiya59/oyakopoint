/**
 * 感謝ポイントを贈る画面（P22/C17、および2026-09-07新設のみまもり向け画面）が
 * 共通で使う、送信エラーの日本語文言への変換をここに集約する。
 *
 * [きっかけ・実装メモ.md 141章] `app/parent/gratitude-send.tsx`が
 * `res.error.message`（PostgrestErrorのmessageそのもの）をそのまま画面に表示して
 * いたため、RLSポリシー違反時にPostgresの生の英語メッセージ
 * （`new row violates row-level security policy for table "gratitude_points"`）が
 * 利用者に見えてしまっていた（統括が実機で確認した不具合。スキーマ設計.sql 48章の
 * きっかけ）。`src/lib/cancelChoreCompletion.ts`の`cancelCompletionErrorText`と同じ
 * 考え方（ERRCODEで一次分岐し、check_violationは複数の理由があるためDB側の
 * RAISE EXCEPTIONメッセージの内容で追加に分岐する）をここでも踏襲する。
 *
 * [重要] エラー種別の判定は必ずPG_ERRCODE（SQLSTATE）との比較で行う。可読名の
 * 文字列比較はしない（実装メモ.md 111.5章の教訓）。
 */
import { PG_ERRCODE, type ApiError } from "@/data/api";

export type GratitudeTone = "parent" | "child" | "supporter";

export function gratitudeSendErrorText(tone: GratitudeTone, error: ApiError): string {
  if (error.code === PG_ERRCODE.checkViolation) {
    // 自己贈呈禁止（chk_gratitude_no_self_gift）はPostgresの素の制約違反メッセージ
    // （英語、制約名を含む）が返るため、専用の日本語文言に置き換える。宛先選択UIから
    // 自分自身は除外済みのため通常は到達しない想定（防御的な保険）。
    if (error.message.includes("chk_gratitude_no_self_gift")) {
      return tone === "child" ? "じぶんには おくれないよ" : "自分自身には贈れません";
    }
    // 今日贈れる残り原資の超過（gratitude_daily_allowance関連トリガー）は、DB側の
    // RAISE EXCEPTIONメッセージ自体が既に前向きな日本語文（「今日贈れる感謝ポイントの
    // 残り原資（◯pt）を超えています（残り◯pt）」）のため、保護者・みまもり向けは
    // そのまま使ってよい（API仕様.md 11章755行目・主要画面ワイヤーフレーム.md 10.2章の
    // 判断を踏襲）。子ども向けはひらがな・やさしい語調に寄せた専用文言を返す
    // （`app/child/gratitude-send.tsx`が元々持っていた文言をそのまま踏襲）。
    if (error.message.includes("原資")) {
      return tone === "child" ? "きょうは もう いっぱい おくったよ。また あした！" : error.message;
    }
    return tone === "child" ? "おくれなかったよ" : "贈れませんでした";
  }
  if (error.code === PG_ERRCODE.foreignKeyViolation) {
    // 送信者・受取人が見つからない、または家族が異なる（gratitude_points_before_insert）。
    // いずれもDB側のRAISE EXCEPTIONメッセージが既に日本語（`20260827180000_
    // gratitude_daily_allowance.sql`）のためそのまま使う。宛先選択UIは同じ家族の
    // アクティブなメンバーのみを候補にしているため通常は到達しない想定（防御的な保険）。
    return error.message;
  }
  if (error.code === PG_ERRCODE.insufficientPrivilege) {
    // RLS（gratitude_points_insert_self）違反。生のPostgresメッセージ（英語）は
    // 利用者に一切見せない。48章の改訂によりロールを理由にした拒否は無くなったが、
    // 将来別の理由でRLSが働いた場合の保険として汎用の日本語文言に倒す。
    return tone === "child" ? "おくれなかったよ" : "この操作はできません";
  }
  return tone === "child" ? "とどきませんでした…" : "通信エラーが発生しました";
}
