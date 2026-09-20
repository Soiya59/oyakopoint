/**
 * NGワードフィルタ（要件定義書07-32章 決定15〜19、主要画面ワイヤーフレーム.md
 * 57.7〜57.10節）の、送信画面側の呼び出しヘルパー。2026-09-21新設。
 *
 * [使い方]
 * - `guard(text)` は**送信ボタンを押した瞬間にだけ**呼ぶこと（決定16）。
 *   trueが返ったら、その場で処理を止めて既存の送信処理（API呼び出し）を
 *   呼ばないこと（「通信が発生していない」ことが要件）。
 * - 該当欄の`onChangeText`には必ず`clear`を差し込むこと（決定14「文字が
 *   変化した瞬間にメッセージを消す。再送信を待たない」）。
 * - `blocked`がtrueの間、該当欄の直下に`NgWordWarningText`
 *   （src/components/NgWordWarningText.tsx）を表示すること。
 * - 入力内容そのものは一切変更しない（決定13）。このフックは判定と表示
 *   フラグの管理のみを行い、入力値には触れない。
 * - 回数を数えない・文言を強めない（決定15）。このフックはそもそも
 *   カウンタを持たない設計にしてある。
 */
import { useCallback, useState } from "react";
import { containsNgWord } from "@/lib/ngWordFilter";

export function useNgWordGuard() {
  const [blocked, setBlocked] = useState(false);

  /** 送信ボタンを押した時点で呼ぶ。NGワードに当たればtrueを返し、blockedをtrueにする。 */
  const guard = useCallback((text: string): boolean => {
    if (containsNgWord(text)) {
      setBlocked(true);
      return true;
    }
    return false;
  }, []);

  /** 該当欄のonChangeTextから呼ぶ（決定14。文字が変わった瞬間にメッセージを消す）。 */
  const clear = useCallback(() => setBlocked(false), []);

  return { blocked, guard, clear };
}
