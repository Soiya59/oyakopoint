import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as Linking from "expo-linking";
import { NFC_SCAN_PATH, NFC_TAG_VALUE_PARAM } from "./nfc.shared";

/**
 * 「閉じた状態からNFCタグ／URLで起動すると報告画面に到達せずホーム画面になる」不具合
 * （やること.md 2-4、実装メモ.md 213章）の修正。
 *
 * [背景・根拠は実装メモ.md 213章に詳細]
 * expo-routerがAndroidの起動時URLを取得する内部実装
 * （node_modules/expo-router/build/link/linking.js の getInitialURL()）は、
 * node_modules/expo-router/build/fork/useLinking.native.js の
 * getInitialURLWithTimeout() を使っており、これは
 * `Promise.race([Linking.getInitialURL(), 150msでnullに解決するタイマー]))`
 * という実装になっている。コールドスタート（`am force-stop`後の起動）はJSバンドルの
 * 評価・ブリッジ初期化等で150msを超えることがあり、その場合はnullで確定し、
 * expo-router側は「ホーム画面から起動された」ものとして扱ってルートURL
 * （`Linking.createURL('/')`）にフォールバックする
 * （node_modules/expo-router/build/link/linking.js 55〜75行目、
 * `parseExpoGoUrlFromListener(url) ?? getRootURL()`。urlがnullなら
 * `!url`がtrueになりurlそのもの＝nullが返るため`??`でgetRootURL()に落ちる）。
 * これが「起動intentは正しく届いている（adb logcatで確認済み）のに
 * report_chore_completion_by_nfc_tag が一度も呼ばれない」の直接原因と判断した
 * （実機で計測はできていないため、150ms超過という時間の推測部分は推測と明記する）。
 *
 * この150msのレースはexpo-router内部の実装であり、こちらのコードからは
 * 変更できない。そこで、同じ`expo-linking`の`Linking.getInitialURL()`を
 * **レース無しで**（＝待てるだけ待って）自前でもう一度呼び、結果を
 * `app/_layout.tsx`のRootLayout（`SessionProvider`より前＝`src/data/store.tsx`の
 * `session.status === "loading"`ゲートの影響を受けない場所）で保持しておく。
 * `app/index.tsx`はセッション確定後の転送先を決める際、まずこの保留中のURLを見て、
 * NFC報告のURLであれば通常のロール別ホーム転送より優先して`/child/nfc-scan`へ渡す
 * （详细はapp/index.tsx側のコメント）。
 *
 * [完全な無制限待ちにはしていない理由]
 * `Linking.getInitialURL()`のレースが150msに設定されているのは、RN本体の既知の問題
 * （`getInitialURL()`のPromiseが端末条件によっては解決しないことがある、
 * facebook/react-native#25675）への回避策だと明記されている
 * （useLinking.native.js内コメント「Workaround for
 * https://github.com/facebook/react-native/issues/25675」）。150msは
 * コールドスタートには短すぎるが、完全に無制限で待つと同じ問題を踏んだ場合に
 * ホーム転送そのものが永久に止まる（＝通常起動のユーザーまで巻き込む）リスクがある。
 * そのため、コールドスタートの重さを吸収しつつ上限は設ける方針とし、
 * `PENDING_URL_TIMEOUT_MS`（2000ms）でこちらも打ち切る。この数値は
 * 「一般的なコールドスタートのオーバーヘッドを十分に吸収できる長さ」という
 * 経験的な判断であり、実機計測に基づく厳密な値ではない。
 */
const PENDING_URL_TIMEOUT_MS = 2000;

interface PendingNfcLinkValue {
  /**
   * `undefined`: 起動時URLの確認がまだ終わっていない（呼び出し側は転送を保留すること）。
   * `null`: 確認済みだが、NFC報告のURLではなかった（通常の転送でよい）。
   * `string`: NFC報告のURLで、値は`tagValue`。まだ`consume()`されていなければ未消費。
   */
  tagValue: string | null | undefined;
  /** 消費済みにする（`router.replace`した直後に呼び、二重遷移・再訪時の再発火を防ぐ）。 */
  consume: () => void;
}

const noop = () => {};

const PendingNfcLinkContext = createContext<PendingNfcLinkValue>({
  tagValue: undefined,
  consume: noop,
});

/**
 * URL文字列がNFC報告画面（`NFC_SCAN_PATH`）を指しているかを判定し、`tagValue`を返す。
 *
 * [`/oyakopoint`プレフィックスの有無を自前で吸収する設計]
 * ネイティブビルドに`EXPO_BASE_URL`（`app.json`の`experiments.baseUrl: "/oyakopoint"`、
 * `node_modules/babel-preset-expo/build/configs/expo.js` 230行目でプラットフォーム
 * 判定なしに常にinlineされる。プラットフォーム分岐が無いことをコード上確認したため
 * ネイティブにも同じ値が入っているはずだが、この関数自体はその値の有無に依存しない
 * 設計にした）が実際に入っているかを前提にせず、URL文字列内に`NFC_SCAN_PATH`が
 * どこかに含まれていれば良い、という部分一致で判定する。これにより
 * `https://soiya59.github.io/oyakopoint/child/nfc-scan?...`（プレフィックスあり）・
 * `https://soiya59.github.io/child/nfc-scan?...`（プレフィックスなし）・
 * 将来`oyakopoint://child/nfc-scan?...`のようなカスタムスキームが来ても、
 * いずれも同じロジックで拾える。依頼では「自前で剥がす」という前提だったが、
 * 剥がさなくても部分一致で両対応できるため、あえて剥がす処理は追加していない
 * （`NFC_SCAN_PATH`は`/child/nfc-scan`のみで他の画面パスの接頭辞になっていないため、
 * 部分一致による誤検出のリスクは実質無い。念のため直後に`?`か文字列終端が続く
 * ことも確認する）。
 */
export function extractPendingNfcTagValue(url: string | null | undefined): string | null {
  if (!url) return null;
  const pathPattern = new RegExp(`${NFC_SCAN_PATH}(\\?|$)`);
  if (!pathPattern.test(url)) return null;
  const paramPattern = new RegExp(`[?&]${NFC_TAG_VALUE_PARAM}=([^&]+)`);
  const match = url.match(paramPattern);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * `app/_layout.tsx`のRootLayoutで、`SessionProvider`より外側に置く
 * （`src/data/store.tsx`の`session.status === "loading"`ゲートより前に
 * `Linking.getInitialURL()`を呼び切るため）。
 */
export function PendingNfcLinkProvider({ children }: { children: React.ReactNode }) {
  const [tagValue, setTagValue] = useState<string | null | undefined>(undefined);
  const consumedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), PENDING_URL_TIMEOUT_MS);
    });

    Promise.race([Linking.getInitialURL(), timeout])
      .then((url) => {
        if (cancelled || consumedRef.current) return;
        setTagValue(extractPendingNfcTagValue(url));
      })
      .catch(() => {
        if (!cancelled && !consumedRef.current) setTagValue(null);
      });

    return () => {
      cancelled = true;
    };
    // 起動時に1回だけ確認する（依存配列は意図的に空。setTagValue等はReactが
    // 安定した参照を保証するため、exhaustive-depsの警告対象にもならない）。
  }, []);

  // [2026-09-13追加・実装メモ.md 213.9章／本部長差し戻し対応] useCallbackで
  // 参照を安定させる。安定させないと、`app/index.tsx`のようにこの関数を
  // useEffectの依存配列に含めている呼び出し元で、毎レンダーeffectが走ってしまう。
  const consume = useCallback(() => {
    consumedRef.current = true;
    setTagValue(null);
  }, []);

  // [2026-09-13追加・同上] ContextのvalueをuseMemoで包み、tagValue・consumeの
  // 参照が変わらない限りvalueオブジェクト自体を作り直さないようにする
  // （consumeは上のuseCallbackで既に安定しているため、実質tagValueが変わった
  // ときだけ作り直される）。
  const value = useMemo<PendingNfcLinkValue>(() => ({ tagValue, consume }), [tagValue, consume]);

  return <PendingNfcLinkContext.Provider value={value}>{children}</PendingNfcLinkContext.Provider>;
}

export function usePendingNfcLink(): PendingNfcLinkValue {
  return useContext(PendingNfcLinkContext);
}
