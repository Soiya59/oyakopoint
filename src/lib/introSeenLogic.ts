/**
 * `src/lib/introSeen.ts`の中身のうち、AsyncStorage（React Native依存）を
 * 一切使わない部分だけを切り出した純粋ロジック。
 *
 * 切り出した理由: 開発部CLAUDE.mdの検証ルール（`src/lib/drawingCanvasCoords.verify.ts`
 * と同じ流儀で、`node`だけで実行できる検証を書く）を満たすため。React Native実行環境
 * が無いと動かないコード（AsyncStorage呼び出し）を含んだままでは`node`で直接検証
 * できないので、「キーの作り方」「見た／見ていないの状態遷移」という**判断そのもの**を
 * ここに寄せ、`introSeen.ts`側は「このキーで端末に保存する／端末から読む」という
 * 入出力だけを担当する薄いラッパーにする。
 */

/** どの案内を指すか。タブ案内は`tabKey`ごとに個別のキーを持つ。 */
export type IntroSurface = { kind: "tab"; tabKey: string } | { kind: "postConsentGuide" };

/**
 * 保存キーを組み立てる（純粋関数）。`memberId`ごとに別のキーになることで、
 * 「メンバーが変われば別々に記録される」（1台の端末で複数の子どもプロフィールを
 * PINで切り替える運用・夫婦で同じタブレットを使う運用のいずれでも、片方が閉じた
 * 案内がもう片方にも閉じたことになる、という誤動作を避ける）。
 */
export function buildIntroSeenKey(surface: IntroSurface, memberId: string): string {
  return surface.kind === "tab"
    ? `oyakopoint.introSeen.tab.${surface.tabKey}.${memberId}`
    : `oyakopoint.introSeen.postConsentGuide.${memberId}`;
}

/**
 * メモリ上の状態。
 * - `cache`: 「見た（true）」という記録があるキーの集合。
 * - `hydrated`: 端末からの読み込みを試みた（成功・失敗を問わない）キーの集合。
 */
export interface IntroSeenState {
  cache: Set<string>;
  hydrated: Set<string>;
}

export function createIntroSeenState(): IntroSeenState {
  return { cache: new Set(), hydrated: new Set() };
}

/**
 * 端末から読み込んだ結果を状態へ反映する。`storedValue`は
 * `AsyncStorage.getItem`の戻り値そのもの（見つからない・失敗のいずれも`null`で表す）。
 * 何度呼んでも安全（冪等）。
 */
export function applyHydration(state: IntroSeenState, key: string, storedValue: string | null): void {
  state.hydrated.add(key);
  if (storedValue === "1") {
    state.cache.add(key);
  }
}

/** 「見た／読んだ」ことにする。 */
export function applyMarkSeen(state: IntroSeenState, key: string): void {
  state.cache.add(key);
  state.hydrated.add(key);
}

/**
 * 現時点で「見た」と判定してよいか。
 * - 読み込みが完了していない間は`true`（＝表示しない。フリッカー防止、
 *   50.3節「間違って出ないことの方が、間違って一瞬出ることより気にならない」）。
 * - 読み込みが完了していれば、記録の有無をそのまま返す（記録が無ければ`false`
 *   ＝まだ見ていない＝表示する）。
 */
export function computeIsSeen(state: IntroSeenState, key: string): boolean {
  if (!state.hydrated.has(key)) return true;
  return state.cache.has(key);
}
