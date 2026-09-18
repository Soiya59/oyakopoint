/**
 * 「この案内はもう見た／読んだ」を端末に覚えておく仕組み。
 * UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 50.3節（決定8〜10）、
 * 開発部/成果物/実装メモ.md 247章。
 *
 * [何に使うか（2種類、50.3節決定10）]
 * 1. タブごとの案内カード（50.2節）: そのタブを初めて開いたときに1つだけ出て、
 *    ×で閉じたら以後出ない。`src/components/TabIntroBubble.tsx`が使う。
 * 2. 規約同意の直後の「読んだ」ステップ（50.4節）: 保護者・みまもりメンバーが
 *    「読んだ」ボタンを押したら以後出ない。`src/components/TermsConsentGate.tsx`の
 *    `usePostConsentGuideGate`が使う。
 *
 * [なぜ`src/lib/lastSeen.ts`と同じ考え方で、しかし別モジュールにするのか]
 * 目的（「もう出さない」を覚える）・保存先（AsyncStorage、DB非使用）・
 * memberIdごとに個別のキーを持つ設計は`lastSeen.ts`と完全に同じであり、
 * 「メモリキャッシュ＋端末保存＋購読」という構成もそのまま複製する。
 * ただし`lastSeen.ts`が扱う値は「最後に見た時刻」（数値）なのに対し、本モジュールが
 * 扱うのは「見た／見ていない」という真偽値1つだけで、初期値の扱い（フォールバックの
 * 向き）も逆になる（`introSeenLogic.ts`の`computeIsSeen`コメント参照）。型が異なる
 * 別の用途のため、`lastSeen.ts`を拡張せず新しいモジュールにする
 * （50.3節決定10の申し送りどおり）。
 *
 * [新しいテーブル・DB列は増やさない理由]
 * 「読んだか／閉じたか」は本人以外の誰も参照しない情報であり、家族の他の
 * メンバーや保護者が確認する必要が無い。`lastSeen.ts`と同じ判断（新しいテーブル・
 * RLS・書き込みRPCを増やすコストに見合わない）を踏襲する。
 *
 * [キーの作り方・状態遷移は`introSeenLogic.ts`に切り出し済み]
 * このファイルは「AsyncStorageへの読み書き」「Reactが再描画するための購読」という
 * 入出力だけを担当する。判断そのもの（キーの組み立て・見た/見ていないの判定）は
 * `src/lib/introSeenLogic.ts`（RN非依存の純粋関数）にあり、`node
 * src/lib/introSeenLogic.verify.ts`で検証できる。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  applyHydration,
  applyMarkSeen,
  buildIntroSeenKey,
  computeIsSeen,
  createIntroSeenState,
  type IntroSurface,
} from "./introSeenLogic";

export type { IntroSurface };

const state = createIntroSeenState();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribeIntroSeen(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 端末に保存された値をキャッシュへ読み込む。同じキーに対して二度目以降は何もしない。
 * 読み込みに失敗しても例外を投げない（黙って「まだ見ていない」扱いのまま進む、
 * `lastSeen.ts`の`hydrateLastSeen`と同じ方針）。
 */
export async function hydrateIntroSeen(surface: IntroSurface, memberId: string): Promise<void> {
  if (!memberId) return;
  const key = buildIntroSeenKey(surface, memberId);
  if (state.hydrated.has(key)) return;
  try {
    const raw = await AsyncStorage.getItem(key);
    applyHydration(state, key, raw);
  } catch {
    // 端末の保存領域が使えない場合は「まだ見ていない」（＝案内を出す）扱いのまま動かす。
    applyHydration(state, key, null);
  }
  emit();
}

/** 現時点で「見た」と判定してよいか（`introSeenLogic.ts`の`computeIsSeen`参照）。 */
export function isIntroSeen(surface: IntroSurface, memberId: string): boolean {
  if (!memberId) return true;
  return computeIsSeen(state, buildIntroSeenKey(surface, memberId));
}

/**
 * 「見た／読んだ」ことにする。押した瞬間にキャッシュを更新して購読者へ通知し、
 * 端末への書き込みはその後ろで行う（`lastSeen.ts`の`markSeen`と同じ、書き込み
 * 失敗時も画面上は成功したまま進める）。
 */
export async function markIntroSeen(surface: IntroSurface, memberId: string): Promise<void> {
  if (!memberId) return;
  const key = buildIntroSeenKey(surface, memberId);
  applyMarkSeen(state, key);
  emit();
  try {
    await AsyncStorage.setItem(key, "1");
  } catch {
    // 端末へ書けなくてもキャッシュ上は「見た」ままにする。次回起動時にもう一度
    // 出ることがあるだけで、体験としては破綻しない（50.3節）。
  }
}

/** テスト・アカウント切り替え用。端末の保存は消さず、メモリ上だけ捨てる。 */
export function resetIntroSeenCacheForTests(): void {
  state.cache.clear();
  state.hydrated.clear();
}
