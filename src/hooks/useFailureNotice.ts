/**
 * [2026-09-29新設・やること.md 4-40の残り、開発部/成果物/実装メモ.md 331章]
 * 画面の「失敗の文言」の状態を、目印（src/lib/apiFailureDisplay.tsの`ref`）とひとまとめに
 * 持つフック。これまで多くの画面が`const [errorMessage, setErrorMessage] = useState<string | null>`
 * に`res.error.message`（PostgRESTの生の文言）を入れていたのを、次の形に置き換える。
 *
 *   const { errorMessage, errorRef, setErrorMessage, showFailure } = useFailureNotice("parent");
 *   ...
 *   if (!res.ok) { showFailure(res.error); return; }   // 原因に応じた文言＋目印
 *   setErrorMessage("名前を入力してください");           // 入力チェック等（目印なし）
 *   setErrorMessage(null);                              // 消す（目印も消える）
 *   ...
 *   {errorMessage && <Text>{errorMessage}</Text>}
 *   <FailureRefText value={errorRef} tone="parent" />
 *
 * `setErrorMessage`は従来のsetStateと同じ使い方（文字列かnull。目印は必ず消える）。
 */
import { useCallback, useState } from "react";
import type { ApiError } from "@/data/api";
import type { FailureTone } from "@/lib/apiFailure";
import { describeApiFailure } from "@/lib/apiFailureDisplay";

export function useFailureNotice(tone: FailureTone) {
  const [notice, setNotice] = useState<{ message: string | null; ref: string | null }>({ message: null, ref: null });

  /** 入力チェック・案内など、通信の失敗ではない文言を出す／消す（目印は付かない）。 */
  const setErrorMessage = useCallback((message: string | null) => setNotice({ message, ref: null }), []);

  /** API呼び出しの失敗を、原因に応じた文言と目印で出す。`fallback`は「原因を特定できない」ときの一文。 */
  const showFailure = useCallback(
    (error: ApiError, opts?: { fallback?: string; source?: "pg" | "edge"; useDbMessage?: boolean }) => {
      const f = describeApiFailure(tone, error, opts);
      setNotice({ message: f.message, ref: f.ref });
    },
    [tone]
  );

  return { errorMessage: notice.message, errorRef: notice.ref, setErrorMessage, showFailure };
}
