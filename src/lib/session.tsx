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
  /** create_family_with_owner / join_family_with_invite_code 実行後に呼び、
   *  parentMemberを再取得してstatusを"parent"に進める。 */
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

  const refreshParentMember = useCallback(async () => {
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
  }, []);

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
   * 子どもセッションを終了する。
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
  const clearChildOnly = useCallback(async () => {
    childSessionRef.current = null;
    await clearChildSession();
    setChildSessionState(null);
    setChildClient(null);
  }, []);

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

  const client = childClient ?? supabase;

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
