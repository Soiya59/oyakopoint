/**
 * 完了報告の直後の取消（要件定義書07-17章、UIUXデザイン部/成果物/
 * 主要画面ワイヤーフレーム.md 28章）で、C7・C5・P8・S2の4画面が共通して使う
 * ロール別の文言・エラーメッセージの振り分けをここに集約する。
 *
 * [重要] エラー種別の判定は必ずPG_ERRCODE（SQLSTATE）との比較で行う。
 * `check_violation`は理由が複数あるため、DB側のRAISE EXCEPTIONメッセージの
 * 内容（キーワード）で追加に分岐する。可読名の文字列比較はしない
 * （開発部/成果物/実装メモ.md 111.5章で`join-supporter.tsx`の同種バグを
 * 修正した経緯を踏襲する。設計部/成果物/API仕様.md 9章参照）。
 */
import { PG_ERRCODE, type ApiError } from "@/data/api";

export type CancelTone = "parent" | "child" | "supporter";

/** 28.1節「3ロールの文言・トーン一覧」。 */
export const CANCEL_LABEL: Record<CancelTone, string> = {
  parent: "取消",
  supporter: "取消",
  child: "とりけす",
};

export const CANCEL_PROCESSING_TEXT: Record<CancelTone, string> = {
  parent: "処理中…",
  supporter: "処理中…",
  child: "とりけしています…",
};

/** 28.1節「取消成功時の一言」。 */
export const CANCEL_SUCCESS_TEXT: Record<CancelTone, string> = {
  parent: "取り消しました",
  supporter: "取り消しました",
  child: "とりけしました",
};

/**
 * 28.7節「取消不可の3ケースの伝え方」・11章のエラー一覧に対応する。
 *
 * [開発部の判断] 43.5章で判明した「木の色丸としてすでに景品と交換済み」
 * （check_violation、`family_tree_decorations`）は、07-17章・28章の設計時点
 * ではまだ発見されていなかった第4のcheck_violation理由である。UIUXデザイン部の
 * 28.7節は明示的に「3ケース」として設計されており、専用の文言は割り当てられて
 * いない。本ケースは「ガチャの景品としてすでに使われた（＝ガチャ消費の結果）」
 * という点で概念的にガチャ消費後のケースと同種であり、かつ発生頻度が
 * 極めて低い（保守的なガチャ判定をすり抜けた稀な時系列の組み合わせのみ）ため、
 * 開発部の判断でガチャ消費後と同じ文言に丸める。UIUXデザイン部・企画部への
 * 申し送り事項として実装メモ.md 120章に記録する。
 */
export function cancelCompletionErrorText(tone: CancelTone, error: ApiError): string {
  if (error.code === PG_ERRCODE.checkViolation) {
    if (error.message.includes("ガチャ") || error.message.includes("木の色丸")) {
      return tone === "child" ? "ガチャを ひいたあとは、とりけせないよ" : "ガチャを引いたあとは、取り消せません";
    }
    if (error.message.includes("マイナス")) {
      return tone === "child" ? "とりけすと ポイントが たりなくなっちゃうよ" : "ポイントが足りないため、取り消せません";
    }
    if (error.message.includes("1分")) {
      // サーバー側の時間窓超過。クライアント側は1分経過でリンクごと非表示にする
      // 設計（28.0節決定4）のため通常は到達しない。端末時計のずれ等への保険。
      return tone === "child" ? "じかんが すぎちゃったよ" : "時間が過ぎたため取り消せません";
    }
  }
  if (error.code === PG_ERRCODE.noDataFound) {
    // 対象が見つからない（すでに他の人が取り消した等）。UI側は一覧の再取得で
    // 通常は解消する。存在しない場合と他家族の場合を意図的に区別しない
    // （API仕様.md 4d節・11章）。
    return tone === "child" ? "みつからなかったよ" : "見つかりませんでした";
  }
  if (error.code === PG_ERRCODE.insufficientPrivilege) {
    // UI側で対象ロールにのみ取消導線を出していれば通常は発生しない想定
    // （API仕様.md 11章）。
    return tone === "child" ? "できなかったよ" : "この操作はできません";
  }
  return tone === "child" ? "とどきませんでした…" : "通信エラーが発生しました";
}
