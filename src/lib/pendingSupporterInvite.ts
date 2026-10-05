/**
 * みまもりの招待コード（token）を、アプリの中（メモリ）で覚えておく。
 * [2026-10-05新設・やること4-96・実装メモ361章]
 *
 * なぜ要るか: ログインが成功すると、SessionProviderが「確認し直し」のために
 * statusを"loading"にし、src/data/store.tsx がその間 画面全体（Stack）を描かない。
 * ネイティブにはURLが無いので、作り直されたStackは最初の画面（P1）から始まる
 * （Web版はアドレス欄のURLが元の画面を覚えているので戻る）。招待リンクから開いた
 * ときは起動時のURLが同じ画面を指すので戻れたが、コードを貼る入口（supporter-code）
 * にはそれが無く、ログイン後にP1へ戻って参加の続きができなかった。
 *
 * このモジュールの変数は、画面（React）が作り直されても消えない。アプリを終了すると
 * 消える（それでよい。無ければP1の「みまもりの招待コードで参加」から貼り直す）。
 * 古いコードで意図しない画面へ進まないよう、10分で捨てる。
 */
const TTL_MS = 10 * 60 * 1000;

let pending: { token: string; at: number } | null = null;

export function setPendingSupporterInvite(token: string, now: number = Date.now()): void {
  pending = { token, at: now };
}

/** 覚えているコード。10分を過ぎていたら捨てて null。読んでも消さない（参加の成功か期限切れで消える）。 */
export function getPendingSupporterInvite(now: number = Date.now()): string | null {
  if (!pending) return null;
  if (now - pending.at > TTL_MS) {
    pending = null;
    return null;
  }
  return pending.token;
}

export function clearPendingSupporterInvite(): void {
  pending = null;
}
