import React, { useEffect } from "react";
import { Slot, router } from "expo-router";
import { View } from "react-native";
import { useSession } from "@/lib/session";
import Screen from "@/components/Screen";

/**
 * [2026-09-04追加・実装メモ.md 125章] `app/child/_layout.tsx`（子どもセッション以外を
 * 弾くガード）と違い、`app/parent/`配下にはこれまでガードが存在しなかった。そのため
 * 未ログイン（`session.status === "signedOut"`）のままでも、`src/data/store.tsx`の
 * `EMPTY_STATE`（`family: { id: "", name: "", ... }`）で保護者ホーム
 * （`app/parent/home.tsx:156` `{state.family.name} の ホーム`）が描画され、
 * 「◯◯の」の部分が空欄で表示されてしまっていた（統括の報告：みまもりメンバーが
 * Gmailのリンクを開いた際に同種の空欄が発生。詳細は125章参照）。
 *
 * `app/child/_layout.tsx`を雛形に、保護者向けの同種ガードをここに追加する。
 *
 * - `status === "loading"` の間はリダイレクトしない。判定前（＝復元中の未確定な
 *   状態）でリダイレクトを走らせると、正常にログイン済みの保護者まで弾いてしまう
 *   （この分岐を誤ると全員が弾かれるため最大のリスク）。なお`src/data/store.tsx`の
 *   `RealDataProviderImpl`は`session.status === "loading"`の間、`AppDataProvider`
 *   自体が全画面スピナー（`LoadingScreen`）を返し、この`_layout`より外側で
 *   止めている。したがってこの分岐が実際にこの位置で評価される場面は現状無い想定だが、
 *   将来`AppDataProvider`より外側でこの`_layout`が使われる構成変更が入っても
 *   空欄が再発しないよう、念のため明示的にガードしておく。
 * - `status === "signedOut"` / `"parentNoFamily"` は `"/"`（P1トップ画面）へ戻す。
 *   トップ画面（`app/index.tsx`）は`session.status`を見て、`"parentNoFamily"`なら
 *   家族作成/参加への案内を、それ以外なら通常のログイン導線（家族をつくる／
 *   招待コードで参加／こどもモードで使う）を出す。どちらの画面も家族名を表示
 *   しないため、この経路では空欄は発生しない。
 * - `status === "supporter"` / `"child"` で保護者パスに来た場合は、それぞれ
 *   自分のホームへ送る（誤って自分のロールと違う画面に留まらせないため）。
 */
export default function ParentLayout() {
  const { status } = useSession();

  const redirectTo: string | null =
    status === "signedOut" || status === "parentNoFamily"
      ? "/"
      : status === "supporter"
      ? "/supporter/home"
      : status === "child"
      ? "/child/home"
      : null; // "loading" と "parent" はリダイレクトしない

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo]);

  // "parent"のときだけ本来の画面（Slot配下、家族名を含む）を描画する。
  // それ以外（"loading"を含む）はリダイレクト完了までホーム本体を描画しない。
  if (status === "parent") {
    return <Slot />;
  }

  return (
    <Screen tone="parent">
      <View style={{ flex: 1 }} />
    </Screen>
  );
}
