import { Redirect } from "expo-router";

/**
 * S1 みまもりホーム — 2026-09-09にタブ化（35章）に伴い廃止し、`app/supporter/(tabs)/family.tsx`
 * （かぞくタブ、初期表示）へ統合した。
 *
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 35.10節「やめる判断ができるか」・
 * 35.13節6「旧`app/supporter/home.tsx`のルート自体は…『かぞく区画へのリダイレクト』として
 * 残すことを推奨する（外部からの古いディープリンク・ブックマークへの配慮）」。
 * `app/parent/settings.tsx`（P17→P14統合時）と同じ前例に倣う。
 *
 * このファイルを削除せずリダイレクトとして残しているのは、`/supporter/home` を指す
 * 導線（古いブックマーク・ホーム画面ショートカット等）を404にしないため。
 * アプリ内の遷移コードは今回すべて `/supporter/family` へ直接書き換えたため、
 * このリダイレクトを実際に通るのは古い外部リンクを踏んだ場合のみになる。
 */
export default function SupporterHomeRedirect() {
  return <Redirect href="/supporter/family" />;
}
