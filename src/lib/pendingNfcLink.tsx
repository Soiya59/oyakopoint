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
 *
 * [2026-09-13改訂・実装メモ.md 217章／実機クラッシュの再発防止]
 * 213.9章では「保留中の値を`consume()`し忘れる経路がある」という穴を、
 * `app/child/nfc-scan.tsx`のマウント時に`consume()`を呼ぶことで塞いだ。
 * しかし`consume()`は「`tagValue`というReact stateを外から`null`に書き換える」
 * 設計だったため、**値を消費したかどうかの判断が、呼び出し側が毎回正しく
 * `consume()`を呼ぶことに依存していた**（＝経路が増えるたびに呼び忘れの
 * リスクが残る。実際、本部長差し戻しの反省点そのもの）。加えて、`tagValue`が
 * Reactの再レンダーを経由するstateである以上、これを読む側（`app/index.tsx`）の
 * `useEffect`の依存配列に含めざるを得ず、依存が絡み合う余地そのものが
 * バグの温床だった。
 *
 * そこで**「値の受け渡し」と「一度きりの消費」を、Reactの再レンダーを経由しない
 * `ref`ベースの`take()`関数1本に集約**した。`take()`は何回・どこから・どんな順で
 * 呼ばれても、**最初の1回だけ**実際の値（あれば）を返し、それ以降は必ず`null`を返す
 * （呼び出し側が`consume()`を呼び忘れる、または二重に呼んでしまう余地そのものを
 * なくす）。Contextが公開する`resolved`（起動時URLの確認が完了したかどうか）は
 * 一度きり`false→true`に変わるだけの単純なbooleanで、`take()`の呼び出しでは
 * 変化しない（＝`take()`を呼んでも再レンダーは起きない）ため、
 * `usePendingNfcLink()`を使う側の`useEffect`が`take()`を挟んでループする経路は
 * 構造的に無くなる。
 */
const PENDING_URL_TIMEOUT_MS = 2000;

interface PendingNfcLinkValue {
  /**
   * 起動時URLの確認が完了したかどうか。`false`の間、呼び出し側は転送を保留すること。
   * 一度`true`になった後は変化しない。
   */
  resolved: boolean;
  /**
   * 保留中の値を取り出す。**呼び出せるのは実質1回分だけ**（`ref`で管理しており、
   * 2回目以降は常に`null`を返す）。`resolved`が`false`の間に呼んでも`null`が返る
   * （まだ確認が終わっていないだけであり、`resolved`をチェックしてから呼ぶこと）。
   * NFC報告のURLでなかった場合も`null`。
   */
  take: () => string | null;
}

const noop = () => null;

const PendingNfcLinkContext = createContext<PendingNfcLinkValue>({
  resolved: false,
  take: noop,
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
  // [2026-09-13改訂・217章] 実際の値は`valueRef`（ref）に持ち、Reactのstateには
  // 「確認が完了したか」という1回きりのbooleanだけを持たせる。値そのものを
  // stateにすると、それを読む側のuseEffectの依存配列に値が乗り、再レンダーの
  // たびに「もう一度見る」余地が生まれる。ref化することで、値は`take()`という
  // 単一の入口からしか観測できず、その入口自体が「1回だけ」を保証する。
  const [resolved, setResolved] = useState(false);
  const valueRef = useRef<string | null>(null);
  const takenRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), PENDING_URL_TIMEOUT_MS);
    });

    Promise.race([Linking.getInitialURL(), timeout])
      .then((url) => {
        if (cancelled) return;
        valueRef.current = extractPendingNfcTagValue(url);
        setResolved(true);
      })
      .catch(() => {
        if (!cancelled) {
          valueRef.current = null;
          setResolved(true);
        }
      });

    return () => {
      cancelled = true;
    };
    // 起動時に1回だけ確認する（依存配列は意図的に空。setResolved等はReactが
    // 安定した参照を保証するため、exhaustive-depsの警告対象にもならない）。
  }, []);

  // [2026-09-13改訂・217章] `consume()`（外から`null`に書き換える方式）を廃止し、
  // 「呼んだ側がその場で値を受け取り、以後は誰が呼んでも`null`」という`take()`に
  // 一本化した。`consumedRef`と`valueRef`の2つを毎回同じ手順
  // （`if (takenRef.current) return null; takenRef.current = true; return
  // valueRef.current;`）でしか触らないため、呼び出し順・呼び出し回数に関わらず
  // 結果は一意に決まる（＝「呼び忘れたら再発火する」「二重に呼んでも安全か
  // 逐一確認する」という設計上の負担が呼び出し側から無くなる）。
  const take = useCallback((): string | null => {
    if (takenRef.current) return null;
    takenRef.current = true;
    return valueRef.current;
  }, []);

  // Contextの`value`をuseMemoで包み、`resolved`が変わらない限り（＝`take()`を
  // 呼んだだけでは）作り直さないようにする。`take`自体は`useCallback([])`で
  // 参照が永久に安定しているため、実質`resolved`が変わったときだけ作り直される。
  const value = useMemo<PendingNfcLinkValue>(() => ({ resolved, take }), [resolved, take]);

  return <PendingNfcLinkContext.Provider value={value}>{children}</PendingNfcLinkContext.Provider>;
}

export function usePendingNfcLink(): PendingNfcLinkValue {
  return useContext(PendingNfcLinkContext);
}
