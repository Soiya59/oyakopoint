/**
 * [2026-09-29新設・やること.md 4-40の残り、開発部/成果物/実装メモ.md 331章]
 * API呼び出しの失敗を、画面に出す「文言」と「目印」の組にする。判断そのものは
 * src/lib/apiFailure.ts（純粋関数、apiFailure.verify.tsで確認）、目印の形は
 * src/lib/pgFailureRef.ts・edgeFailureRef.ts（317章）にある。ここは文言の既定値
 * （errorMessages.ts、244章）を足してつなぐだけの薄い層。
 *
 * 使い方（画面側）:
 *   const f = describeApiFailure("parent", res.error);
 *   setErrorMessage(f.message); setErrorRef(f.ref);
 *   ...
 *   <FailureRefText value={errorRef} tone="parent" />
 *
 * 画面が既存の一文（例: スタンプ送信の失敗）を持っているときは、`fallback`で渡す。
 * 電波・混み合い・ログイン切れ・権限拒否のときだけ文言が入れ替わり、それ以外は
 * 既存の一文のまま（文言の意味は変えない）。DB側が日本語で書いたメッセージは、
 * 従来どおり出していた画面ではそのまま出す。従来は固定の一文だけだった画面は
 * `useDbMessage: false`で固定の一文のままにする。
 */
import type { ApiError } from "@/data/api";
import {
  apiFailureMessage,
  classifyApiFailure,
  type ApiFailureKind,
  type FailureSource,
  type FailureTone,
} from "@/lib/apiFailure";
import { formatEdgeFailureRef } from "@/lib/edgeFailureRef";
import { GENERIC_ERROR_MESSAGE, GENERIC_ERROR_MESSAGE_CHILD } from "@/lib/errorMessages";
import { formatPgFailureRef } from "@/lib/pgFailureRef";

export interface FailureDisplay {
  /** 画面に出す文言。 */
  message: string;
  /** 「目印」として添える短い識別子（"{status}-{記号}"）。個人情報を含まない。 */
  ref: string;
}

/** 失敗の「種類」と「目印」だけが欲しいとき（画面側が既存の文言を持っている場合）。 */
export function failureDetail(error: ApiError, source: FailureSource = "pg"): { kind: ApiFailureKind; ref: string } {
  return {
    kind: classifyApiFailure(error, source),
    ref: source === "edge" ? formatEdgeFailureRef(error) : formatPgFailureRef(error),
  };
}

export function describeApiFailure(
  tone: FailureTone,
  error: ApiError,
  opts?: { fallback?: string; source?: FailureSource; useDbMessage?: boolean }
): FailureDisplay {
  const source = opts?.source ?? "pg";
  const fallback = opts?.fallback ?? (tone === "child" ? GENERIC_ERROR_MESSAGE_CHILD : GENERIC_ERROR_MESSAGE);
  const kind = classifyApiFailure(error, source);
  return {
    message: apiFailureMessage(kind, tone, error, fallback, opts?.useDbMessage ?? true),
    ref: source === "edge" ? formatEdgeFailureRef(error) : formatPgFailureRef(error),
  };
}
