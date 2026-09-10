/**
 * 「最後にその画面を見た時刻」を端末に覚えておく仕組み（実装メモ.md 190章）。
 *
 * [背景・統括の指摘（2026-09-11）]
 * 「完了報告の新着や上のベルマークについて、24時間以内の件数を表示しているが、それが
 * 分かりにくい」。それまでの実装は`Date.now() - 24時間`を基準にした「24時間以内に
 * 起きたことの件数」であり、**未読件数ではなかった**。そのため、
 *   (1) 開いて全部読んでも数字が消えない（24時間経つまで残る）
 *   (2) 見ないまま24時間経つと静かに消える（気づかないうちに無くなる）
 * という2つの困りごとが起きていた。本モジュールは基準を「最後にその画面を見た時刻」に
 * 差し替え、開けば0になるようにする。
 *
 * [なぜ端末に保存するのか（DBに持たない理由）]
 * 「どこまで読んだか」は本人以外の誰も参照しない情報であり、家族の他のメンバーにも
 * 見せる必要がない。列を1つ足してDBに持てば機種を変えても引き継げるが、そのために
 * テーブル・RLS・書き込み用のRPCを増やすことになる。統括の一貫した方針
 * （「機能はあればあるほど複雑になる」）に照らし、まず端末保存で始める。
 * 端末を変えたときは「一度だけ多めに出る」だけで、実害が無い（下記の初期値の扱い）。
 *
 * [初期値の扱い＝これまでの見え方からの引き継ぎ]
 * 保存された値がまだ無いとき（＝この機能が入って最初に開くまでの間）は、**従来どおり
 * 24時間前を基準にする**。いきなり0にしてしまうと、それまで溜まっていた新着が
 * 統括の目に触れないまま消えることになるため。一度その画面を開けば以後は未読方式に
 * 切り替わる。
 *
 * [SecureStoreではなくAsyncStorageを使う理由]
 * 秘密情報ではない（時刻の数値のみ）。`src/lib/childSession.ts`がトークンを
 * SecureStoreに入れているのは中身が認証情報だからで、本モジュールは対象外。
 *
 * [その場で反映するための購読の仕組み]
 * AsyncStorageは非同期のため、書き込みの完了を待ってから画面を描き直すと数字が
 * 消えるまでに一拍遅れる。そこでメモリ上のキャッシュを正とし、`markSeen`は
 * キャッシュを先に更新して購読者へ通知し、端末への書き込みはその後ろで行う。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 「見た」を数える単位。ベル（とどいたよ）と完了報告は**別々に数える**。
 *
 * 行き先が違う画面であり、中身も違う（ベル＝自分がもらったスタンプ・コメント・感謝
 * ポイント／完了報告＝家族の誰かが出した報告）。1つにまとめると、ベルを開いただけで
 * 完了報告の新着まで消えてしまい、見ていないものを見たことにしてしまう
 * （統括との確認済み・2026-09-11）。
 */
export type SeenSurface = "inbox" | "completions";

export const DEFAULT_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

const storageKey = (surface: SeenSurface, memberId: string) => `oyakopoint.lastSeen.${surface}.${memberId}`;

/** メモリ上のキャッシュ。値は「最後に見た時刻」のエポックミリ秒。 */
const cache = new Map<string, number>();
/** 端末からの読み込みを済ませたキー。未読み込みのキーを何度も読みにいかないための印。 */
const hydrated = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribeLastSeen(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 端末に保存された値をキャッシュへ読み込む。読み込めたら購読者へ通知する。
 * 同じキーに対して二度目以降は何もしない。
 */
export async function hydrateLastSeen(surface: SeenSurface, memberId: string): Promise<void> {
  if (!memberId) return;
  const key = storageKey(surface, memberId);
  if (hydrated.has(key)) return;
  hydrated.add(key);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    cache.set(key, parsed);
    emit();
  } catch {
    // 端末の保存領域が使えない場合（プライベートモード等）は、初期値の扱い
    // （24時間前を基準にする）のまま動かす。黙って落とさず、従来の見え方に戻るだけ。
  }
}

/** キャッシュ上の「最後に見た時刻」。まだ無ければnull。 */
export function getLastSeen(surface: SeenSurface, memberId: string): number | null {
  if (!memberId) return null;
  return cache.get(storageKey(surface, memberId)) ?? null;
}

/**
 * その画面を「見た」ことにする。**入口がどこであったかは問わない。**
 *
 * 統括の指摘（2026-09-11）どおり、基準は「どのボタンから来たか」ではなく
 * 「その画面が開かれたこと」にする。保護者ホームの「完了報告（新着◯件）」カードからでも、
 * その下の「最近の報告」の行からでも、どちらも同じ`/parent/approvals`へ飛ぶため、
 * 押したボタンで区別すると片方から入ったときに新着が残り続けてしまう。
 * 画面側で呼ぶことにしておけば、あとから入口が増えても正しく動く。
 */
export async function markSeen(surface: SeenSurface, memberId: string, atMs?: number): Promise<void> {
  if (!memberId) return;
  const key = storageKey(surface, memberId);
  const value = atMs ?? Date.now();
  const previous = cache.get(key);
  // 何度呼ばれても、時刻が戻ることはない（画面に留まっている間の連続呼び出し対策）。
  if (previous !== undefined && previous >= value) return;
  cache.set(key, value);
  hydrated.add(key);
  emit();
  try {
    await AsyncStorage.setItem(key, String(value));
  } catch {
    // 端末へ書けなくてもキャッシュ上は「見た」ままにする。アプリを開き直すと
    // 元に戻るが、その回のうちは数字が0のままになり、体験として破綻しない。
  }
}

/** テスト・アカウント切り替え用。端末の保存は消さず、メモリ上だけ捨てる。 */
export function resetLastSeenCacheForTests(): void {
  cache.clear();
  hydrated.clear();
}
