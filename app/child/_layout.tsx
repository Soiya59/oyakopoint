import React, { useEffect } from "react";
import { Slot, router, usePathname } from "expo-router";
import { View } from "react-native";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import Screen from "@/components/Screen";
import theme from "@/theme/theme";

// [2026-09-01追加・実装メモ.md 108章] NFCタグの人ごと化（要件定義書07-2章「作り直し：
// タグの人ごと化」）により、C13/C14（このパス）には子ども以外（保護者・みまもり
// メンバー）もログイン中の端末から到達しうるようになった。既存の物理タグに書き込んだ
// URLは`/child/nfc-scan`で固定されており変更できない（src/lib/nfc.ts:68、UIUXデザイン部/
// 成果物/主要画面ワイヤーフレーム.md 7.6.4節「移行の制約」）ため、この2画面だけ下記の
// 「子どもセッション以外はトップへ戻す」ガードの対象から除外する。
const NFC_PATHS_ANY_ROLE = ["/child/nfc-scan", "/child/nfc-complete"];

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
 *
 * [2026-09-01追記・実装メモ.md 108章] 上記「`session.status`が`"child"`以外の場合も
 * トップ画面へ誘導する」は、NFCタグの人ごと化（要件定義書07-2章「作り直し：タグの
 * 人ごと化」）により`/child/nfc-scan`・`/child/nfc-complete`の2画面に限って撤回した
 * （保護者・みまもりメンバーもこの2画面には到達できる必要があるため）。ファイル冒頭の
 * `NFC_PATHS_ANY_ROLE`・`notChildSession`の分岐参照。それ以外の`/child/`配下の画面
 * （C5等）は、このコメントの元の記述どおり`"child"`以外なら引き続きトップへ戻す。
 */
export default function ChildLayout() {
  const { state } = useAppData();
  const { logoutChild, status } = useSession();
  const pathname = usePathname();
  const isNfcPath = NFC_PATHS_ANY_ROLE.includes(pathname);
  const me = state.members.find((m) => m.id === state.activeChildMemberId);
  const staleSession = Boolean(state.activeChildMemberId) && !me;
  // NFCの2画面は、いずれかのロール（子ども・保護者・みまもりメンバー）でログイン
  // 済みでありさえすれば通す。未ログイン（"signedOut"）・家族未所属
  // （"parentNoFamily"）・復元中（"loading"）のときだけトップへ戻す
  // （report_chore_completion_by_nfc_tag()自体がログイン必須のため、ここで弾いても
  // 弾かなくてもRPC側で最終的に拒否されるが、画面が空のまま固まるのを避ける）。
  const notChildSession = isNfcPath
    ? status === "signedOut" || status === "parentNoFamily"
    : status !== "child";
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
