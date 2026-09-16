/**
 * アプリ全体の認証状態（セッション）管理。
 *
 * 参照:
 * - 設計部/成果物/認証・データ管理設計書.md 1章「認証方式の全体像」
 * - 設計部/成果物/API仕様.md 1章・2c章
 *
 * 保護者と子どもでは認証の仕組みがまったく異なる（1章参照）ため、
 * それぞれ別のSupabaseクライアント状態として扱う。
 * - 保護者: supabase.auth（マジックリンク）のセッションをそのまま使う。
 * - 子ども: Edge Function `child-login` が発行するカスタムJWTをExpo SecureStoreに
 *   保存し、そのJWTを Authorization ヘッダーに固定した専用クライアント
 *   （src/lib/childSession.ts の createChildDataClient）でPostgRESTを呼ぶ。
 *
 * status の意味:
 * - "loading": 起動直後、SecureStore/Supabase Authセッションの復元中。
 * - "signedOut": どちらの認証状態も無い（P1/C1へ誘導する）。
 * - "parentNoFamily": 保護者としてSupabase Authにログイン済みだが、
 *   family_membersにまだ行が無い（家族作成/参加が未完了。P4/P5へ誘導する）。
 * - "parent": 保護者としてログイン済み・家族に所属済み。
 * - "supporter": みまもりメンバー（要件定義書07-7章）としてログイン済み・家族に
 *   所属済み。認証方式は保護者と全く同じマジックリンク方式（06章・07-7章
 *   「認証・招待方式」）であり、family_members.role の違いだけで判定する。
 * - "child": 子どもとしてログイン済み（カスタムJWTが有効）。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase, supabaseAnonKey, supabaseUrl } from "./supabase";
import {
  ChildSessionInfo,
  clearChildSession,
  createChildDataClient,
  loadChildSession,
  saveChildSession,
} from "./childSession";
import type { FamilyMember } from "@/types/domain";

export type SessionStatus = "loading" | "signedOut" | "parentNoFamily" | "parent" | "supporter" | "child";

interface SessionContextValue {
  status: SessionStatus;
  /** データ操作（supabase.from/rpc）に使うべきクライアント。保護者/未ログイン時はデフォルトクライアント、
   *  子どもログイン時はカスタムJWTを固定した専用クライアント。 */
  client: SupabaseClient;
  authUser: User | null;
  parentMember: FamilyMember | null;
  childSession: ChildSessionInfo | null;
  /** create_family_with_owner / join_family_with_invite_code 実行後、または
   *  6桁コードでの保護者ログイン（verifyEmailOtp）成功後に呼び、parentMemberを
   *  再取得してstatusを進める（"parent"/"supporter"/"parentNoFamily"/"signedOut"）。
   *  こどもセッションが残っていれば先に破棄する（実装参照）。 */
  refreshParentMember: () => Promise<void>;
  /** child-login成功後に呼び、SecureStoreへ保存しつつ子どもセッションへ切り替える。 */
  loginChild: (info: ChildSessionInfo) => Promise<void>;
  /** returnToParent=true のときだけ、端末に残る保護者セッションへ復帰する（logoutChildの実装コメント参照）。 */
  logoutChild: (options?: { returnToParent?: boolean }) => Promise<void>;
  logoutParent: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * [2026-08-22変更] みまもりメンバー対応。当初は `.eq("role", "parent")` で
 * 保護者のみを引いていたが、みまもりメンバーも保護者と全く同じ
 * auth_user_id経由のマジックリンク認証を使う（06章・07-7章）ため、
 * role IN ('parent','supporter') に広げた。子ども（role='child'）は
 * auth_user_idを持たない設計（chk_child_has_no_auth_user）のため、
 * この条件だけで子どもの行が誤って返ることはない。
 *
 * [2026-08-22追加・本部長発見] 既存のバグ（今回の機能とは無関係、以前から存在）:
 * このクエリは`is_active`を一切見ていなかったため、remove-member(soft_remove)で
 * 退会済み（is_active=false）になった保護者が、そのアカウントでログインすると
 * 依然として`status:"parent"`として扱われてしまっていた。`current_family_id()`等の
 * RLSヘルパー関数側は`fm.is_active`を条件に含めているため、退会済みアカウントは
 * 実際にはどのRLSチェックも通らず（`is_current_user_parent()`が常にfalse相当になる
 * 等）、ユーザーが実機で「招待の送信がRLSエラーになる」という形で発見した。
 * `.eq("is_active", true)`を追加し、退会済みアカウントは`fetchParentMember`の
 * 時点で「見つからない」（→ status: "parentNoFamily"）として扱うようにした。
 */
async function fetchParentMember(userId: string): Promise<FamilyMember | null> {
  const { data, error } = await supabase
    .from("family_members")
    .select("*")
    .eq("auth_user_id", userId)
    .in("role", ["parent", "supporter"])
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.error("session: family_members lookup failed", error);
    return null;
  }
  return (data as FamilyMember | null) ?? null;
}

/** member.role からSessionStatusを決める（fetchParentMemberの結果があるとき）。 */
function statusForMember(member: FamilyMember | null): SessionStatus {
  if (!member) return "parentNoFamily";
  return member.role === "supporter" ? "supporter" : "parent";
}

/**
 * [2026-09-17新設・やること.md 4-36 症状1] `status === "child"`のときに、万一
 * `childClient`が無い（本来あり得ない）場合のダミークライアント。
 *
 * [経緯・本部長レビュー差し戻し1回目] 当初`const client = status === "child" &&
 * childClient ? childClient : supabase;`としていたが、これは`status`が`"child"`で
 * `childClient`が`null`のとき**保護者の`supabase`クライアント（高い権限）へ黙って
 * 倒れる**という、今回の不具合（保護者がこどもの権限で弾かれる＝安全側）とは
 * **逆向きの取り違え**を生む式だった（本部長指摘）。
 *
 * [経緯・本部長レビュー差し戻し2回目] 1回目の直しとして、`?? throwDisabledChildClientError()`
 * のように**その場で例外を投げる**関数にしていた。しかし`client`は`SessionProvider`の
 * 描画本体（`return`の直前）で評価される値であり、ここで`throw`すると**Reactの
 * 描画そのものが失敗する**。本部長が`app/`・`src/`を「ErrorBoundary」
 * 「componentDidCatch」「getDerivedStateFromError」の3語で検索し**0件**と確認した
 * とおり、このアプリには例外を受け止めるError Boundaryが無い。つまりこの例外が
 * 一度でも実際に起きると、**アプリ全体が白い画面のまま操作不能になる**
 * （子どもが使っている端末で起きれば特に重大）。「安全側に倒す」という方向は
 * 正しかったが、**描画を壊す形で倒してはいけなかった**。
 *
 * [採った対応] 描画中には例外を投げず、代わりに「使おうとした瞬間に必ず失敗する
 * クライアント」を返す（`Proxy`で全プロパティアクセスを`fail`にすり替える）。
 * `client.from(...)`・`client.rpc(...)`のような呼び出しパターン（このファイル冒頭の
 * コメント参照）であれば、`client.from`を読んだ時点で`fail`関数が返り、それを
 * `(table)`のように呼び出した瞬間に例外が飛ぶ。描画自体（`SessionProvider`が
 * `value`を`Provider`へ渡すところ）は成功するため、白画面にはならない。
 * `console.warn`を1回鳴らし、統括向けの文言は持たせない（本部長指摘どおり、
 * 開発側が気づければよく、利用者に見せる必要はない）。
 *
 * これにより、`status === "child"`のときに保護者の`supabase`（高い権限）が
 * 返ることは引き続き絶対に無い（`supabase`を返す分岐は`status !== "child"`の
 * ときだけ。下記`client`の式参照）。
 */
function createDisabledChildClient(): SupabaseClient {
  console.warn(
    'session.client: status="child"ですがchildClientがありません（想定外の状態）。',
    "保護者の権限へフォールバックしないため、このクライアントで行う操作はすべて失敗します。"
  );
  const fail = (): never => {
    throw new Error(
      "session.client: 無効な状態のクライアント（childClient不在）が使用されました（想定外）。"
    );
  };
  // SupabaseClientのどのプロパティ・メソッドへのアクセスも`fail`を返す。
  // `client.from("x")`のように呼び出された瞬間に例外を投げる（読み取っただけでは投げない）。
  return new Proxy({} as SupabaseClient, {
    get: () => fail,
  });
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [parentMember, setParentMember] = useState<FamilyMember | null>(null);
  const [childSession, setChildSessionState] = useState<ChildSessionInfo | null>(null);
  const [childClient, setChildClient] = useState<SupabaseClient | null>(null);
  // [2026-08-16修正・本部長] 31章参照。onAuthStateChangeのコールバックが
  // `await loadChildSession()`でSecureStore/AsyncStorageを再読みしていたため、
  // loginChild()内のsaveChildSession()の書き込みと非同期の読み取りタイミングが
  // 競合し、書き込み完了前にコールバックが「子どもセッション無し」と誤判定して
  // status を"signedOut"へ巻き戻してしまう不具合があった（ログイン成功直後の
  // 一過性クラッシュの真因。実装メモ.md 31章「続報」参照）。childSessionの最新値を
  // 同期的に参照できるrefを用意し、非同期ストレージ読み取りへの依存を無くす。
  const childSessionRef = useRef<ChildSessionInfo | null>(null);

  /**
   * 子どもセッションを終了する（状態のみ。保護者への復帰は呼び出し元の責務）。
   *
   * [2026-09-17移動・やること.md 4-36 症状2] 以前は`logoutChild`の直前に定義されて
   * いたが、`refreshParentMember`からも呼べるよう、`refreshParentMember`より前に
   * 定義位置を移した（`useCallback`の依存配列にJS変数を書く都合上、参照する側より
   * 前で`const`宣言されている必要がある）。ロジック自体は変更していない。
   *
   * [2026-08-29修正・本部長／軽微変更ルート] 従来は無条件で`signedOut`にしていたため、
   * **同じ端末に保護者のログインが残っていても、必ずトップ画面へ戻され、
   * 保護者はメールのリンクを踏み直す必要があった**（ユーザーの指摘
   * 「親と子供の切り替えはめんどいよね？」）。
   *
   * 実際には `loginChild` も本関数も `supabase.auth.signOut()` を呼んでおらず、
   * **保護者のSupabase Authセッションは端末に生き残っている**。
   * 捨てていたのではなく、戻り先を見に行っていなかっただけだった。
   *
   * [2026-09-17追加・本部長レビュー差し戻し] `setStatus("loading")`をここに追加した。
   * 呼び出し元（`onAuthStateChange`・`refreshParentMember`・`logoutChild`のいずれも）は、
   * この関数が返ったあと、`supabase.auth.getSession()`・`fetchParentMember()`といった
   * 非同期処理を経てから最終的な`status`（"parent"等）を確定させる。そのため、
   * `setChildClient(null)`（＝下記`client`の式が`childClient`を使わなくなる瞬間）と
   * `status`が`"child"`のままである期間との間に、**`status`が`"child"`なのに
   * `childClient`が`null`という一瞬の窓ができ得る**（本部長指摘）。この窓の間に
   * 何らかの理由で`/child/`配下の画面がまだ生きていて`client`を使う操作をすると、
   * 保護者の権限で送信されてしまう（下記`client`の式のコメント参照）。
   *
   * ここで`setChildClient(null)`と同じ場所（同じ同期的な処理の流れ、間に`await`を
   * 挟まない）で`setStatus("loading")`も呼ぶことで、React 18の自動バッチングにより
   * 両方が同じ再描画で反映される。`status`が`"loading"`の間は、`src/data/store.tsx`の
   * `RealDataProviderImpl`が`if (session.status === "loading" || ...) return
   * <LoadingScreen />;`（実装メモ.md 32章）でアプリ全体を全画面スピナーに切り替える
   * ため、この移行中はどの画面も`client`を使った操作を実行できない。つまり
   * 「`status`が`"child"`なのに`childClient`が無い」窓ではなく、「`status`が
   * `"loading"`で何も操作できない」窓に置き換えることで、危険な窓そのものを消す。
   */
  const clearChildOnly = useCallback(async () => {
    childSessionRef.current = null;
    await clearChildSession();
    setChildSessionState(null);
    setChildClient(null);
    setStatus("loading");
  }, []);

  /**
   * [2026-09-17追加・やること.md 4-36 症状2] 呼び出し元は3箇所。
   * `create-family.tsx`・`join-preview.tsx`は、家族作成/参加のRPC（`supabase`
   * デフォルトクライアント＝保護者自身のSupabase Authセッションで実行、
   * `childClient`は一切介さない）が成功した"直後"にしか呼ばない。
   * `src/components/EmailCodeVerifyForm.tsx`は、6桁コードの検証（`verifyEmailOtp`＝
   * `supabase.auth.verifyOtp()`）が成功した"直後"にしか呼ばない（症状1の対応、
   * 下の`onAuthStateChange`のコメント参照）。いずれも、この時点で「今まさに
   * 保護者として認証・特権操作を成功させた」ことがサーバー側で確認済みであり、
   * その一方で`childSessionRef`がまだ残っているとすれば、それは既に無関係な残骸
   * （例: こどもが使っていた同じ端末で、保護者が別のメール・招待コードでログイン
   * し直した場合など）である。
   *
   * これを放置すると2つの問題が起きる。(1) 下記`client`の導出が古い子どもの
   * `childClient`をそのまま返し、以後この保護者が呼ぶPostgRESTリクエストが
   * 子どものJWTで送信される（症状2そのもの。403 / 42501の実測と一致）。
   * (2) `childSessionRef.current`が真のままだと、以後の`onAuthStateChange`の
   * 正規のイベント（例: トークン自動更新）まで無視され続けてしまう。
   * そのため、ここで確実に子どもセッションを破棄してから保護者情報を取得する。
   */
  const refreshParentMember = useCallback(async () => {
    if (childSessionRef.current) {
      await clearChildOnly();
    }
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    setAuthUser(user);
    if (!user) {
      setParentMember(null);
      setStatus("signedOut");
      return;
    }
    const member = await fetchParentMember(user.id);
    setParentMember(member);
    setStatus(statusForMember(member));
  }, [clearChildOnly]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      if (!isSupabaseConfigured()) {
        // .env未設定環境向けフォールバック。この場合、画面はsrc/data/store.tsxの
        // モックデータ層を使う（isSupabaseConfigured()を直接参照する側の設計は
        // 変更していない）。SessionProviderはsignedOut相当のまま何もしない。
        if (mounted) setStatus("signedOut");
        return;
      }

      const restoredChild = await loadChildSession();
      if (restoredChild) {
        if (!mounted) return;
        childSessionRef.current = restoredChild;
        setChildSessionState(restoredChild);
        setChildClient(createChildDataClient(supabaseUrl, supabaseAnonKey, restoredChild.accessToken));
        setStatus("child");
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      const user = data.session?.user ?? null;
      setAuthUser(user);
      if (user) {
        const member = await fetchParentMember(user.id);
        if (!mounted) return;
        setParentMember(member);
        setStatus(statusForMember(member));
      } else {
        setStatus("signedOut");
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      // 子どもセッションが有効な間は、保護者側のAuth状態変化（別クライアントの
      // supabase.authだが念のため）を無視し、子どもセッションを維持する。
      // [2026-08-16修正] 以前はここで`await loadChildSession()`によりストレージを
      // 再読みしていたが、loginChild()の書き込みと競合するレースコンディションが
      // あった（実装メモ.md 31章「続報」参照）。childSessionRefは常に最新のReact
      // 状態と同期しており非同期読み取りを伴わないため、これを参照する。
      //
      // [2026-09-17検討・却下・本部長レビュー] 一時は「`event === "SIGNED_IN"`かつ
      // 直前に明示的な操作フラグが立っていれば例外的に通す」という案を試した
      // （やること.md 4-36 症状1）。しかし本部長のレビューで、(a) 6桁コード入力から
      // 実際の`SIGNED_IN`到達までの間に、端末に残る保護者の別セッションが
      // `_recoverAndRefresh()`由来の`SIGNED_IN`を先に発火させると、フラグがそちらに
      // 消費されてしまう、(b) 猶予時間（旧実装は15秒）を回線が悪いときに超える
      // 可能性がある、という2点の指摘を受けた。いずれも「フラグが立ってから
      // 対応するイベントが来るまでの間に時間差がある」という設計そのものに起因する
      // ため、時間差を無くす方向へ設計を変更した。
      //
      // [採用した対応] `src/data/api.ts`の`verifyEmailOtp()`を呼んでいるのは
      // `src/components/EmailCodeVerifyForm.tsx`の1箇所だけ（`grep -rn "verifyOtp("`
      // で確認済み）。このコンポーネントは`SessionProvider`の内側にあり`useSession()`
      // を呼べるため、**イベントを待って推測するのをやめ、6桁コードの検証に成功した
      // その場で`refreshParentMember()`を直接呼んでもらう**形にした
      // （`EmailCodeVerifyForm.tsx`のコメント参照）。`refreshParentMember()`は
      // 呼ばれた時点で`childSessionRef.current`が残っていれば`clearChildOnly()`を
      // 呼ぶ（下記コメント）ため、こどもモードからの復帰もここで正しく処理される。
      // その結果、この`onAuthStateChange`は31章当時と同じ、単純な「こどもセッションが
      // 有効な間は無条件で無視する」という形に戻せる。時間窓・イベントの奪い合いが
      // 構造的に起こらない。
      if (childSessionRef.current) return;

      const user = session?.user ?? null;
      setAuthUser(user);
      if (user) {
        const member = await fetchParentMember(user.id);
        setParentMember(member);
        setStatus(statusForMember(member));
      } else {
        setParentMember(null);
        setStatus("signedOut");
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const loginChild = useCallback(async (info: ChildSessionInfo) => {
    // refはストレージ書き込み・状態伝播を待たず即座に更新する
    // （onAuthStateChangeのコールバックが直後に発火してもレースしないようにするため）。
    childSessionRef.current = info;
    await saveChildSession(info);
    setChildSessionState(info);
    setChildClient(createChildDataClient(supabaseUrl, supabaseAnonKey, info.accessToken));
    setStatus("child");
  }, []);

  /**
   * 子どもセッションを終了したあと、保護者への復帰まで行う（`clearChildOnly`は
   * 上（`refreshParentMember`の直前）に定義位置を移した。ロジック自体は変更なし）。
   *
   * [2026-08-29修正・本部長／軽微変更ルート] 従来は無条件で`signedOut`にしていたため、
   * **同じ端末に保護者のログインが残っていても、必ずトップ画面へ戻され、
   * 保護者はメールのリンクを踏み直す必要があった**（ユーザーの指摘
   * 「親と子供の切り替えはめんどいよね？」）。
   *
   * そこで、子どもセッションを消したあとに保護者セッションの有無を確認し、
   * **残っていれば保護者（またはみまもりメンバー）として復帰する**。
   * 残っていなければ従来どおり`signedOut`。
   *
   * [これは権限を緩めない] 復帰先は「その端末で既に認証済みだったセッション」であり、
   * 新たに認証を通すわけではない。保護者でログインしたことのない端末では
   * 戻り先が無いため、従来どおりトップ画面へ出る。
   *
   * [逆方向（保護者→子ども）は変更しない] 子どもアカウントへ入るには引き続きPINが要る。
   * 未公開のお絵かき（`family_drawings`のRLSが`artist_member_id = 本人`で保護し、
   * UIも「あなたの ひみつ（じぶんだけ みえるよ）」と明示している）の壁を、
   * 利便性のために崩さないため。
   */
  const logoutChild = useCallback(
    async (options?: { returnToParent?: boolean }) => {
      await clearChildOnly();
      if (options?.returnToParent) {
        // refreshParentMember は保護者セッションが無ければ自分でsignedOutにする。
        await refreshParentMember();
        return;
      }
      // 既定は従来どおり。子ども同士の切り替え（次のPIN入力までの一時的な未ログイン）や、
      // 期限切れセッションの後始末では、保護者へ復帰させてはいけない。
      setStatus("signedOut");
    },
    [clearChildOnly, refreshParentMember]
  );

  const logoutParent = useCallback(async () => {
    await supabase.auth.signOut();
    setAuthUser(null);
    setParentMember(null);
    setStatus("signedOut");
  }, []);

  /**
   * [2026-09-17変更・やること.md 4-36 症状2、本部長レビューで再修正]
   * 以前は`childClient ?? supabase`だった。`status`と`childClient`は別々のstateで
   * あり、`refreshParentMember()`のように`status`だけを更新して`childClient`に
   * 触れない呼び出し元が存在しうる（上の`refreshParentMember`のコメント参照）。
   * そのため`childClient`が残っているという理由だけでは子どものクライアントを
   * 使わせず、`status === "child"`であることも合わせて要求する構造上の不変条件に
   * した。これにより、仮に将来別の場所で同種の更新漏れが入っても、「statusは
   * 保護者なのに子どものJWTで送信する」という症状2の形の不具合そのものが
   * 起こり得なくなる。`app/child/_layout.tsx`のNFC_PATHS_ANY_ROLE（3ロールから
   * 到達するC13/C14）は`status`に応じてこの式が自然に`supabase`／`childClient`を
   * 選ぶだけなので、影響しない。
   *
   * [本部長レビュー差し戻し・2026-09-17] 当初`status === "child" && childClient ?
   * childClient : supabase`としていたが、この式は`status === "child"`かつ
   * `childClient`が`null`のとき**保護者の`supabase`（高い権限）へ黙って倒れる**。
   * これは今回の不具合（安全側＝保護者がこどもの権限で弾かれる）とは逆向きの、
   * 危険な取り違えである。
   *
   * この組み合わせ自体は、設計上起こらないはずである。`childClient`を`null`にする
   * のは`clearChildOnly()`だけであり（`setChildClient(null)`を呼ぶのはここ1箇所。
   * `grep -n "setChildClient("`で確認済み）、`clearChildOnly()`は`childClient`を
   * `null`にするのと同じタイミングで`status`も`"loading"`へ変える（下記
   * `clearChildOnly`のコメント参照）。逆に`childClient`を非nullにする2箇所
   * （`loginChild()`・マウント時の`restoredChild`分岐）は、いずれも`setChildClient`
   * と`setStatus("child")`を同じ同期的な処理の流れの中で（間に`await`を挟まず）
   * 呼んでおり、React 18の自動バッチングにより同じ再描画にまとまる。したがって
   * 「`status`が`"child"`なのに`childClient`が`null`」というレンダーは、実装が
   * 正しく保たれている限り原理的に生じない。
   *
   * とはいえ「起こらないはず」であることと「実際に起きたときに安全側へ倒れる」
   * ことは別の要求である。将来どこかに同種の更新漏れが混入した場合に備え、
   * この式自体を「`status === "child"`のとき保護者の`supabase`が返ることは
   * 絶対に無い」という形にする。`childClient`が無い場合は`supabase`へ
   * フォールバックしない。
   *
   * [本部長レビュー差し戻し・2回目] 当初はここで`?? throwDisabledChildClientError()`
   * のように直接`throw`していたが、この式は`SessionProvider`の描画中に評価される
   * ため、投げると**描画そのものが失敗し、Error Boundaryが存在しないこのアプリでは
   * 画面全体が白くなって操作不能になる**（本部長が`ErrorBoundary`等3語で検索し0件を
   * 確認）。描画は壊さず、`childClient`が無いときは「使おうとした瞬間にだけ失敗する
   * クライアント」（`createDisabledChildClient`、上のコメント参照）を返すよう改めた。
   */
  const client: SupabaseClient =
    status === "child" ? childClient ?? createDisabledChildClient() : supabase;

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      client,
      authUser,
      parentMember,
      childSession,
      refreshParentMember,
      loginChild,
      logoutChild,
      logoutParent,
    }),
    [status, client, authUser, parentMember, childSession, refreshParentMember, loginChild, logoutChild, logoutParent]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
