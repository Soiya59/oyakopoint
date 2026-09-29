/**
 * [2026-09-30新設・主要画面ワイヤーフレーム.md 69章、開発部/成果物/実装メモ.md 334章]
 * 数秒だけ出して自動で消える文言（成功メッセージ・案内の1行）を持つ小さなフック。
 * 「アバターを描く」3画面が各自で`setTimeout(() => set(null), 4000)`を書いていた
 * （消し忘れ・画面を離れたあとの更新が起きうる）のを、1か所にまとめた。
 * 画面を離れたら（アンマウント）タイマーは止める。
 *
 *   const [message, flash, clear] = useFlashMessage();
 *   flash("保存しました");   // 4秒後に自動で消える（新しく出すと前のタイマーは捨てる）
 *   clear();                  // すぐ消す
 */
import { useCallback, useEffect, useRef, useState } from "react";

export const FLASH_MESSAGE_MS = 4000;

export function useFlashMessage(durationMs: number = FLASH_MESSAGE_MS) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const clear = useCallback(() => {
    clearTimer();
    setMessage(null);
  }, []);

  const flash = useCallback(
    (next: string) => {
      clearTimer();
      setMessage(next);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setMessage(null);
      }, durationMs);
    },
    [durationMs]
  );

  useEffect(() => clearTimer, []);

  return [message, flash, clear] as const;
}
