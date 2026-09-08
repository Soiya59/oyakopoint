/**
 * アプリの前面復帰・画面遷移（フォーカスの戻り）のたびに、渡された再取得関数を
 * 「裏で」呼び出す共通フック（実装メモ.md 172章）。
 *
 * [背景] 統括からの指摘「アプリを開くと更新されていないときがある。スクロールしたり、
 * 開き直すと更新される」に対応するため、(1)アプリが前面に戻ったとき、(2)アプリ内で
 * 画面へ戻ってきたとき、の2つを起点に自動再取得する。呼び出し側（`src/data/store.tsx`の
 * `RealDataProviderImpl`、`useFamilyTreeSummary`、`useGachaProgress`、
 * `useFamilyHomeCard`）は、このフックからの呼び出しを「初回読み込み」と区別できる
 * よう、自前の`load()`に`{ background: true }`を渡す形で使う（全画面スピナー・
 * ウィジェットのスケルトン表示に切り替えないため）。
 *
 * [(1)前面復帰の検知について・react-native-webでの実機確認結果]
 * `AppState`だけで良いか（ブラウザのvisibilitychangeを別途listenする必要が無いか）を
 * `node_modules/react-native-web/dist/exports/AppState/index.js`を読んで確認した。
 * react-native-webの`AppState`は最初から`document.addEventListener('visibilitychange', ...)`
 * を内部でラップしており、`document.visibilityState`が`'hidden'`のときは`'background'`、
 * それ以外は`'active'`を返す実装になっている（iOS特有の`'inactive'`はWebには存在しない）。
 * したがって本アプリの本番環境であるGitHub Pages（Expo Web）でも、ネイティブと全く同じ
 * `AppState.addEventListener('change', ...)`だけで「タブを切り替えて戻ってきた」
 * 「別アプリに切り替えて戻ってきた」の両方を拾える。`document.visibilitychange`を
 * 別途listenする実装は不要と判断した（二重登録・二重発火を避けるため、あえて入れていない）。
 * なお`AppState.addEventListener`はWeb実装・ネイティブ実装のいずれも「購読した瞬間の
 * 状態」を同期的にemitしない（実際の状態遷移が起きたときのみ発火する）ため、マウント直後に
 * 誤発火して初回読み込みと二重に走ることは無い。
 *
 * [(2)画面遷移の検知について]
 * expo-routerの`usePathname()`は、スタックの戻る操作だけでなく、タブ切り替え
 * （フォーカスが移る操作全般）でも値が変わる。個々の画面に`useFocusEffect`を
 * 追加して回るのではなく、ここを起点に一括で拾う（既存画面ファイルを1つも
 * 変更せずに済む・50画面近くに同じ配線を繰り返さずに済むという理由で、この
 * 実装方式を選んだ）。forward navigation（新しい画面に進む場合）でも同様に発火するが、
 * 副作用は「無駄な再取得が1回増える」だけで実害は無いため、「戻ってきたときだけ」に
 * 絞り込む特別な判定はあえて入れていない。
 *
 * [間引き] 直前の発火からminIntervalMs未満なら無視する。呼び出し側の判断根拠は
 * `src/data/store.tsx`側のコメント参照（採用値・理由はそちらに集約する）。
 */
import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { usePathname } from "expo-router";

export const DEFAULT_BACKGROUND_REFRESH_MIN_INTERVAL_MS = 15000;

export function useBackgroundAutoRefresh(
  onRefresh: () => void,
  options?: { enabled?: boolean; minIntervalMs?: number }
) {
  const enabled = options?.enabled ?? true;
  const minIntervalMs = options?.minIntervalMs ?? DEFAULT_BACKGROUND_REFRESH_MIN_INTERVAL_MS;

  // onRefresh自体はコンポーネント側で毎レンダー新しい関数になり得るため、refに
  // 逃がして「最新のonRefreshを呼ぶが、effectの再購読は起こさない」形にする。
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const lastFiredAtRef = useRef(0);
  const previousPathnameRef = useRef<string | null>(null);
  const pathname = usePathname();

  const trigger = useCallback(() => {
    if (!enabled) return;
    const now = Date.now();
    if (now - lastFiredAtRef.current < minIntervalMs) return;
    // 呼び出し（非同期のfetch）が終わる前に次のイベントが重なっても二重発火しないよう、
    // 完了を待たずこの時点で記録する。
    lastFiredAtRef.current = now;
    onRefreshRef.current();
  }, [enabled, minIntervalMs]);

  // (1) アプリの前面復帰
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active") trigger();
    });
    return () => sub.remove();
  }, [trigger]);

  // (2) 画面遷移（フォーカスの戻り含む）。初回マウント時（previousPathnameRefがnull）は
  // 「起動時の読み込み」と区別できないため発火させない。
  useEffect(() => {
    if (previousPathnameRef.current === null) {
      previousPathnameRef.current = pathname;
      return;
    }
    if (previousPathnameRef.current !== pathname) {
      previousPathnameRef.current = pathname;
      trigger();
    }
  }, [pathname, trigger]);
}
