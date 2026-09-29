/**
 * 完了報告（chore_completions）の初回取得の内部ページング用の純粋関数
 * （やること.md 4-58・4-47原因②、設計部 スキーマ設計.sql 58.6章・決定58-4・58-6、
 * API仕様.md 18.1節、実装メモ.md 330章）。
 *
 * PostgRESTの`max_rows`（ローカルは`supabase/config.toml`の1,000。本番も既定は1,000）を
 * 超える件数は、1回の問い合わせでは先頭1,000件で黙って切られる。`load()`の初回取得
 * だけ、総件数（`count: 'exact'`が返す`Content-Range`）を見て`.range()`で分けて
 * 取り、全件をそろえる（背景更新・報告後・取消後の再取得は直近3日を取り直す
 * 254章の設計のまま変えない）。この暫定策は、通帳のDB側ページング（18.2節、
 * 一般公開後）が入れば不要になる。
 *
 * ここには「何ページに分けるか」「どの範囲を取るか」「取った結果をどうつなぐか」の
 * 計算だけを置く（通信はしない）。node で直接検証できるよう、相対import・
 * パスエイリアス非依存にしてある（`completionPaging.verify.ts`）。
 */

/** 1ページの件数。PostgRESTの`max_rows`既定値（1,000）に合わせる。 */
export const COMPLETIONS_PAGE_SIZE = 1000;

/**
 * ページ数の上限（決定58-6・2026-09-19統括承認）。20ページ＝2万件。これを超える家族は
 * 「新しい側の2万件」だけを読み込む（`reported_at`降順のまま先頭から数える）。
 */
export const COMPLETIONS_MAX_PAGES = 20;

export interface PageRange {
  /** `.range(from, to)`の from（0始まり、両端含む）。 */
  from: number;
  to: number;
}

/**
 * 最初の1ページを取ったあと、実際に使うページ幅を決める。
 *
 * 通常は要求した`requestedSize`のまま。ただしサーバー側の`max_rows`が要求より小さく
 * （例: 本番が500に設定されている）、最初のページが「要求より少なく、かつ総件数より
 * 少ない」件数で返ってきた場合は、サーバーに切られたということなので、返ってきた
 * 件数を実際のページ幅として使う。こうしないと、2ページ目以降の範囲が
 * 実際に返る行と食い違い、行が抜ける（設計部58.9章7.「max_rowsの具体的な数値には
 * 依存しない設計」を守るための保険）。
 */
export function resolvePageSize(requestedSize: number, firstPageLength: number, total: number): number {
  if (firstPageLength > 0 && firstPageLength < requestedSize && firstPageLength < total) {
    return firstPageLength;
  }
  return requestedSize;
}

export interface RemainingPagesPlan {
  /** 2ページ目以降に取る範囲（`Promise.all`で並列に取る）。1ページで足りるときは空。 */
  ranges: PageRange[];
  /** 全体のページ数（1ページ目を含む。上限適用後）。 */
  totalPages: number;
  /** 上限（maxPages）で打ち切って、古い側の一部を取らないとき true。 */
  truncated: boolean;
}

/**
 * 総件数`total`を`pageSize`件ずつ分けたとき、1ページ目を除いて何を取るか。
 * ページ数は最大`maxPages`。上限を超える分は取らない（新しい側の
 * `pageSize * maxPages`件だけ）。
 */
export function planRemainingPages(total: number, pageSize: number, maxPages: number): RemainingPagesPlan {
  if (!Number.isFinite(total) || total <= 0 || pageSize <= 0 || maxPages <= 0) {
    return { ranges: [], totalPages: total > 0 ? 1 : 0, truncated: false };
  }
  const neededPages = Math.ceil(total / pageSize);
  const totalPages = Math.min(neededPages, maxPages);
  const ranges: PageRange[] = [];
  for (let page = 1; page < totalPages; page += 1) {
    ranges.push({ from: page * pageSize, to: page * pageSize + pageSize - 1 });
  }
  return { ranges, totalPages, truncated: neededPages > maxPages };
}

/**
 * ページごとの結果を、順序を保ったまま1本につなぐ。同じ行（既定は`id`、`keyOf`で変更可。
 * 日別集計は`activity_date`と`member_id`の組）が2回出たら最初の1件だけ
 * 残す。ページを取っている最中に新しい報告が1件入ると、それまでの行が1つ後ろへ
 * ずれて、ページの境目の行が前後のページに重複して現れうるため（新しい行が
 * 増える方向なので、抜けは起きず、重複だけが起きる）。
 */
export function mergeCompletionPages<T>(pages: T[][], keyOf?: (row: T) => string): T[] {
  const key = keyOf ?? ((row: T) => (row as unknown as { id: string }).id);
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const page of pages) {
    for (const row of page) {
      const k = key(row);
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(row);
    }
  }
  return merged;
}
