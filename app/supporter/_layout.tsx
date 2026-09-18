import React, { useEffect } from "react";
import { Slot, router } from "expo-router";
import { View } from "react-native";
import { useSession } from "@/lib/session";
import Screen from "@/components/Screen";
import { PostConsentGuideScreen, TermsConsentModal, useTermsConsentGate, usePostConsentGuideGate } from "@/components/TermsConsentGate";

/**
 * [2026-09-04追加・実装メモ.md 125章] `app/parent/_layout.tsx`と対の、みまもり
 * メンバー向けガード。経緯・各分岐の理由はそちらのコメントと同じ（`app/child/_layout.tsx`
 * を雛形にしている）。統括が実際に踏んだ不具合そのもの
 * （みまもりメンバーがGmailのリンクをiOS Safariで開くと「◯◯の みまもり」の◯◯が
 * 空欄で出る＝`app/supporter/home.tsx:93`が`state.family.name`（未ログイン時は
 * `src/data/store.tsx`の`EMPTY_STATE`で空文字）をそのまま描画していた）はこの
 * ファイルが直接対応する。
 *
 * - `status === "loading"` の間はリダイレクトしない（`app/parent/_layout.tsx`の
 *   コメント参照。判定前に飛ばすと正常なログイン済み利用者まで弾いてしまう）。
 * - `status === "signedOut"` / `"parentNoFamily"` は `"/"`（P1トップ画面）へ戻す。
 * - `status === "parent"` / `"child"` でみまもりパスに来た場合は、それぞれ自分の
 *   ホームへ送る。
 *
 * [2026-09-09追加・実装メモ.md 181章] `app/parent/_layout.tsx`と対の、利用規約
 * への同意取得＋Play Families安全リマインダーのゲート（やること.md 2-22）。
 * 経緯・設計はそちらのコメント・src/components/TermsConsentGate.tsxを参照。
 *
 * [2026-09-18追加・主要画面ワイヤーフレーム.md 50.4節、実装メモ.md 247章]
 * `app/parent/_layout.tsx`と対の、規約同意の直後の「読んだ」ステップ。
 */
export default function SupporterLayout() {
  const { status, client, parentMember } = useSession();

  const redirectTo: string | null =
    status === "signedOut" || status === "parentNoFamily"
      ? "/"
      : status === "parent"
      ? "/parent"
      : status === "child"
      ? "/child/home"
      : null; // "loading" と "supporter" はリダイレクトしない

  const consent = useTermsConsentGate(status === "supporter", client);
  const guideActive = status === "supporter" && !consent.loading && !consent.needsConsent;
  const guide = usePostConsentGuideGate(guideActive, parentMember?.id ?? "");

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo]);

  // "supporter"のときだけ本来の画面（Slot配下、家族名を含む）を描画する。
  // それ以外（"loading"を含む）はリダイレクト完了までホーム本体を描画しない。
  if (status === "supporter") {
    if (consent.loading) {
      return (
        <Screen tone="supporter">
          <View style={{ flex: 1 }} />
        </Screen>
      );
    }
    if (consent.needsConsent) {
      return <TermsConsentModal role="supporter" onAgreed={consent.markAgreed} />;
    }
    if (guide.loading) {
      return (
        <Screen tone="supporter">
          <View style={{ flex: 1 }} />
        </Screen>
      );
    }
    if (guide.needsGuide) {
      return <PostConsentGuideScreen role="supporter" onDone={guide.markSeen} />;
    }
    return <Slot />;
  }

  return (
    <Screen tone="supporter">
      <View style={{ flex: 1 }} />
    </Screen>
  );
}
