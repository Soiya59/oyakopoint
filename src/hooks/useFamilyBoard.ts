/**
 * 家族の書き込みボード（要件定義書07-14章、API仕様.md 13章）向けデータ取得フック。
 * 2026-08-28追加・第1段階「見る側」のみ。
 * 2026-08-29追加・第2段階: 投稿数残数取得（useFamilyBoardRemainingToday）・
 * 削除/取消（useFamilyBoardHistory().removePost）を追加した。
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
import {
  addFamilyBoardReaction,
  deleteFamilyBoardPost,
  fetchFamilyBoardPostsHistory,
  fetchFamilyBoardReactionsForPost,
  fetchFamilyHomeCard,
  fetchMyFamilyBoardPostsRemainingToday,
  PG_ERRCODE,
} from "@/data/api";
import type { FamilyBoardPostWithAuthor, FamilyBoardReactionWithReactor, FamilyHomeCard, StampKey } from "@/types/domain";

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

  // [2026-08-29追加・第2段階] 削除（本人の5分以内取消・保護者の是正削除）。
  // API仕様.md 13.5章（2026-08-29改訂）のとおり、直接UPDATEではなく
  // RPC `delete_family_board_post` 経由でのみ行う（設計部/成果物/スキーマ設計.sql
  // 36章。直接UPDATEは`42501`で必ず拒否される、本番検証済み）。
  //
  // 「取消」（本人・確認ダイアログなし）と「削除」（保護者の是正・確認ダイアログあり）は
  // 呼び出すRPC自体は同一で、権限判定（本人5分以内／保護者は無制限／それ以外拒否）は
  // すべてサーバー側（BEFORE UPDATEトリガー）が行う。UI側の確認ダイアログの有無だけが
  // 2つの操作の違いであるため、フック側は単一の`removePost`のみを公開する
  // （UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 22.4節）。
  const [removingPostId, setRemovingPostId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ postId: string; code: string; message: string } | null>(null);

  const removePost = useCallback(
    async (postId: string): Promise<boolean> => {
      setRemovingPostId(postId);
      setActionError(null);
      const res = await deleteFamilyBoardPost(client, postId);
      setRemovingPostId(null);
      if (!res.ok) {
        setActionError({ postId, code: res.error.code, message: res.error.message });
        // no_data_found（対象が既に無い）の場合は、次のreloadを待たずに一覧から
        // 即時除去しておく（例: 別タブ・他メンバーの操作により既に削除済みだった場合）。
        if (res.error.code === PG_ERRCODE.noDataFound) {
          setPosts((prev) => prev.filter((p) => p.id !== postId));
        }
        return false;
      }
      // Eの教訓（投稿成功後の一覧更新忘れ）と対になる: 削除成功時も一覧を
      // 古いままにしない。全件reloadではなく該当行をローカルで即時除去する
      // （ページング位置・スクロール位置を崩さないため）。
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      return true;
    },
    [client]
  );

  // [2026-09-01追加・実装メモ.md 103章／104章で改訂] 投稿へのスタンプリアクション
  // （要件定義書07-14章「リアクション（スタンプ）の追加」、主要画面ワイヤーフレーム.md
  // 22.2.1節）。取消不可のため「送る」操作のみを公開する（removePostと違い、逆方向の
  // 操作は無い）。
  // [104章] 「1人1投稿1スタンプ」→「1人1投稿につきスタンプの種類ごとに1個（4種類まで）」
  // へ改訂されたため、`reactingReaction`は{postId, stampKey}のまま
  // （送信中はそのスタンプだけを止め、同じ投稿の他のスタンプは押せる。22.2.1節
  // 「押したあとの見え方」の「送信中（このスタンプ）」参照）。
  const [reactingReaction, setReactingReaction] = useState<{ postId: string; stampKey: StampKey } | null>(null);
  const [reactionError, setReactionError] = useState<{ postId: string; message: string } | null>(null);

  const reactToPost = useCallback(
    async (postId: string, memberId: string, stampKey: StampKey): Promise<boolean> => {
      setReactingReaction({ postId, stampKey });
      setReactionError(null);
      const res = await addFamilyBoardReaction(client, {
        post_id: postId,
        reactor_member_id: memberId,
        stamp_key: stampKey,
      });
      setReactingReaction(null);
      if (!res.ok) {
        // 22.2.1節「対象投稿が削除済み」: 対象投稿がトリガー内のSELECTで見つからず
        // foreign_key_violationになった場合は、次のreloadを待たずに一覧からその投稿を
        // 即時除去する（removePostのno_data_found処理と同じ考え方）。
        if (res.error.code === PG_ERRCODE.foreignKeyViolation) {
          setPosts((prev) => prev.filter((p) => p.id !== postId));
        }
        // unique_violation（同じ投稿・同じスタンプへの二重送信）は、UI側で既送信の
        // スタンプへのタップを無効化しているため通常到達しないが、競合（別タブ・
        // 別デバイスからのほぼ同時送信）で起こり得る。楽観的な加算をfabricateせず
        // reload()で実際の状態（家族全員分の反応）を取り直す。
        if (res.error.code === PG_ERRCODE.uniqueViolation) {
          void load();
        }
        setReactionError({ postId, message: res.error.message });
        return false;
      }
      // [104章] 全件reloadではなく該当投稿のreactions配列に1件追加するだけで
      // ローカル更新する（removePostと同じくページング位置・スクロール位置を
      // 崩さないため）。旧仕様（103章）はmy_reactionを1件で置き換えていたが、
      // 家族全員分を保持する配列になったため「追加」に変わる。
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? { ...p, reactions: [...p.reactions, { stamp_key: stampKey, reactor_member_id: memberId }] }
            : p
        )
      );
      return true;
    },
    [client, load]
  );

  // [2026-09-01追加・104章] 22.2.1節「内訳の見せ方（誰が押したか）」用。
  // 「だれが送ったか見る」リンクをタップした時点で呼ばれる遅延取得（一覧取得時には
  // 反応者の氏名を含めないため、この関数が唯一の取得経路になる）。
  const viewReactorsForPost = useCallback(
    async (postId: string): Promise<{ ok: true; data: FamilyBoardReactionWithReactor[] } | { ok: false; message: string }> => {
      const res = await fetchFamilyBoardReactionsForPost(client, postId);
      if (!res.ok) return { ok: false, message: res.error.message };
      return { ok: true, data: res.data };
    },
    [client]
  );

  return {
    loadState,
    posts,
    hasMore,
    loadingMore,
    loadMore,
    reload: load,
    removingPostId,
    actionError,
    removePost,
    reactingReaction,
    reactionError,
    reactToPost,
    viewReactorsForPost,
  };
}

/**
 * API仕様.md 13.2章: 呼び出し本人が今日まだ投稿できる残り件数（0〜5）。
 * 投稿履歴一覧（P32/C27/S20）の「投稿する」ボタン直下の残数表示・上限到達時の
 * ブロック文言（主要画面ワイヤーフレーム.md 22.3.3節）に使う。
 *
 * `my_family_board_posts_remaining_today()`は引数を取らず`current_family_member_id()`
 * で呼び出し本人に絞るため、familyIdの確定を待つ必要が無い（useFamilyHomeCard/
 * useFamilyBoardHistoryと違い「入力が揃わないときにloadStateを変えずreturnする」
 * 対象になるような入力自体が存在しない設計＝実装メモ.md 73.3章の教訓が
 * そもそも当てはまらないケース）。
 */
export function useFamilyBoardRemainingToday() {
  const { client } = useSession();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<FamilyBoardLoadState>("loading");

  const load = useCallback(async () => {
    setLoadState("loading");
    const res = await fetchMyFamilyBoardPostsRemainingToday(client);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setRemaining(res.data);
    setLoadState("ready");
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return { remaining, loadState, reload: load };
}
