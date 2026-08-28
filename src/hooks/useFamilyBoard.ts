/**
 * 家族の書き込みボード（要件定義書07-14章、API仕様.md 13章）向けデータ取得フック。
 * 2026-08-28追加・第1段階「見る側」のみ（投稿・削除は第2段階）。
 *
 * [E. useWeeklyDigestとの関係について（本部長指示に対応する判断）]
 * 既存の`useWeeklyDigest`（保護者ホームP7専用）は、07-8章の週次まとめメッセージ
 * “だけ” を取得するフックであり、07-14章の「書き込みがあれば最新1件、無ければ
 * まとめメッセージ」という優先順位ロジック自体は持っていない（そのロジックは
 * P7画面側のJSXのifで表現されていたわけでもなく、そもそも書き込みの概念が
 * 存在しなかった）。
 *
 * 今回`family_home_card` Viewが優先順位ロジックをDB側に1本化した
 * （スキーマ設計.sql 35d章「クライアント側の分岐ではなくView側で統合する」）ため、
 * P7はこの新しい`useFamilyHomeCard`に**置き換える**（併存させない）。
 * `useWeeklyDigest`自体は削除しない。理由: (1) `fetchLatestWeeklyFamilyDigest`は
 * `family_home_card`の内部実装として設計されたものではなく独立したAPI（API仕様.md
 * 10.1章）であり、まとめメッセージ単体を参照したい将来の用途（例:
 * デバッグ・週次生成バッチの動作確認画面等）を否定する理由が無い。(2) 現時点で
 * `useWeeklyDigest`を使っているのはP7のみであり、今回P7側の呼び出しを
 * `useFamilyHomeCard`に差し替えることで実質的に未使用になるが、ファイル自体の
 * 削除は「今回のスコープ外の掃除」であり本部長の指示にない変更を増やさないため
 * 見送る。C5・S1は元々`useWeeklyDigest`を使っていなかった（07-8章がC5を対象外と
 * していたため）ので、今回新規に導入するのは3画面とも`useFamilyHomeCard`のみで、
 * 「置き換え」対象はP7の1画面だけである。
 *
 * [S1固有の扱いについて（本部長指示Eの後半）]
 * `family_home_card`はロールを問わず同じ優先順位（書き込み＞まとめメッセージ）で
 * 1行を返すが、みまもりホーム（S1）にはそもそも「今週のできごと」カードの概念が
 * 元々存在せず（画面一覧・遷移図.md S1行「今回は対象外とする」）、まとめメッセージへ
 * フォールバックする先が無い（主要画面ワイヤーフレーム.md 22.1.3節・決定4）。
 * したがって本フック自体はロールを判別せず`family_home_card`の生データをそのまま
 * 返し、「source==='weekly_digest'の場合にまとめメッセージを表示するか、それとも
 * 空状態として扱うか」はP7/C5とS1で異なる判断になるため、呼び出し側
 * （app/parent/home.tsx・app/child/(tabs)/home.tsx・app/supporter/home.tsx）の
 * 表示ロジックに委ねる（本フックはデータ取得のみに責務を絞る）。
 */
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { fetchFamilyBoardPostsHistory, fetchFamilyHomeCard } from "@/data/api";
import type { FamilyBoardPostWithAuthor, FamilyHomeCard } from "@/types/domain";

export type FamilyBoardLoadState = "loading" | "error" | "ready";

/**
 * ホームカード（P7/C5/S1共通）用。familyIdが空の間は「まだ確定していないだけで
 * 待てば来る」可能性と「このまま来ない」可能性を区別できないため、
 * `loadState`を"loading"のまま据え置かず"error"に倒す（実装メモ.md 73.3章の教訓＝
 * 「入力が揃わないときにloadStateを変えずreturnする実装は永久ローディングの
 * 温床になる」への対応。app/parent/gratitude.tsxの既存対応と同じ判断）。
 * 通常はAppDataProvider側のゲートによりfamilyIdはこの時点で確定済みのはずであり、
 * このerror分岐は「想定外の状態での直接遷移」に対する保険として機能する
 * （再試行可能なerror状態にしておけば、familyIdが後から埋まった場合もreloadで復帰できる）。
 */
export function useFamilyHomeCard(familyId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<FamilyBoardLoadState>("loading");
  const [card, setCard] = useState<FamilyHomeCard | null>(null);

  const load = useCallback(async () => {
    if (!familyId) {
      setLoadState("error");
      return;
    }
    setLoadState("loading");
    const res = await fetchFamilyHomeCard(client, familyId);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setCard(res.data);
    setLoadState("ready");
  }, [client, familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loadState, card, reload: load };
}

/** 主要画面ワイヤーフレーム.md 22.0節決定7: 直近30件を初期表示し、「もっと見る」で30件ずつ追加する。 */
const PAGE_SIZE = 30;

/**
 * 投稿履歴一覧（P32/C27/S20）用。カードタップ時にのみ呼ばれる画面なので、
 * ホームカードとは独立したフックにしている。
 */
export function useFamilyBoardHistory(familyId: string) {
  const { client } = useSession();
  const [loadState, setLoadState] = useState<FamilyBoardLoadState>("loading");
  const [posts, setPosts] = useState<FamilyBoardPostWithAuthor[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    if (!familyId) {
      // 上のuseFamilyHomeCardと同じ判断（73.3章の教訓）。
      setLoadState("error");
      return;
    }
    setLoadState("loading");
    const res = await fetchFamilyBoardPostsHistory(client, familyId, { from: 0, to: PAGE_SIZE - 1 });
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setPosts(res.data);
    setHasMore(res.data.length === PAGE_SIZE);
    setLoadState("ready");
  }, [client, familyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!familyId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const res = await fetchFamilyBoardPostsHistory(client, familyId, {
      from: posts.length,
      to: posts.length + PAGE_SIZE - 1,
    });
    setLoadingMore(false);
    if (!res.ok) {
      // 追加読み込みの失敗はローディング表示を解除するだけにとどめ、一覧自体は
      // そのまま残す（「もっと見る」ボタンが再度表示され、そのまま再試行できる）。
      return;
    }
    setPosts((prev) => [...prev, ...res.data]);
    setHasMore(res.data.length === PAGE_SIZE);
  }, [client, familyId, posts.length, loadingMore, hasMore]);

  return { loadState, posts, hasMore, loadingMore, loadMore, reload: load };
}
