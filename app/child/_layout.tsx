import React, { useEffect } from "react";
import { Slot, router } from "expo-router";
import { View } from "react-native";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import Screen from "@/components/Screen";
import theme from "@/theme/theme";

/**
 * [2026-08-16追加・本部長] `app/child/`配下の各画面（C5等）は
 * `state.members.find((m) => m.id === state.activeChildMemberId)!` という
 * 非nullアサーションで自分自身のメンバー情報を取得している。src/data/store.tsxの
 * ローディングゲート（`familyId && !loadedOnce`）は「データ未取得」は防ぐが、
 * 「データは取得できたが、activeChildMemberIdに該当するメンバーがその中に
 * 存在しない」ケース（例: 使い回された古い子どもセッションが指すメンバーが
 * 既に削除・再作成されている等）までは防げず、ユーザーが実機で
 * "Cannot read properties of undefined (reading 'display_name')" のクラッシュに
 * 複数回遭遇した。ここで`app/child/`配下全体（(tabs)グループ・report等の
 * 単独画面の両方）を横断する共通ガードとして、該当メンバーが見つからない場合は
 * 子どもセッションを破棄してトップ画面へ戻す（クラッシュさせず再ログインを促す）。
 *
 * [2026-08-18追加・本部長] 物理NFCタグに書き込んだURL（`/child/nfc-scan?tagValue=...`、
 * 35章参照）を実際にタップすると、Android OSがそのURLを新しいタブ/ブラウザ文脈で
 * 開くため、その場で**子どもとしてログインした状態が無い**ケースが起こりうる
 * （子ども自身が事前にログインしていない・別ブラウザプロファイルで開かれた等）。
 * この場合、従来のガードは`state.activeChildMemberId`が空文字列（未ログイン扱い）の
 * ときは何もしない設計だったため、`app/child/nfc-scan.tsx`が`EMPTY_STATE`のまま
 * 描画され、`me`が`undefined`のまま`process()`内で参照されて処理が静かに
 * 失敗し（非同期関数内の未捕捉例外はエラー画面にならないことがある）、
 * 「タグを読み取っています」の表示のまま固まる不具合としてユーザーが実機で発見した。
 * `session.status`が`"child"`以外（未ログイン・保護者ログイン中等）の場合も
 * 同様にトップ画面へ誘導するようガード条件を拡張した。
 * なお`src/data/store.tsx`のゲート（32章）により、この画面に到達する時点で
 * `session.status`は必ず解決済み（"loading"ではない）であることが保証されている。
 */
export default function ChildLayout() {
  const { state } = useAppData();
  const { logoutChild, status } = useSession();
  const me = state.members.find((m) => m.id === state.activeChildMemberId);
  const staleSession = Boolean(state.activeChildMemberId) && !me;
  const notChildSession = status !== "child";
  const shouldRedirect = staleSession || notChildSession;

  useEffect(() => {
    if (!shouldRedirect) return;
    if (staleSession) {
      void logoutChild().then(() => router.replace("/"));
    } else {
      router.replace("/");
    }
  }, [shouldRedirect, staleSession, logoutChild]);

  if (shouldRedirect) {
    return (
      <Screen tone="child">
        <View style={{ flex: 1 }} />
      </Screen>
    );
  }

  return <Slot />;
}
