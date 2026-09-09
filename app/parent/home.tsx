import { Redirect } from "expo-router";

/**
 * P7 保護者ホーム — 2026-09-10にタブ化（UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md
 * 35章、みまもりの実装メモ182・183・186章を保護者へ広げたもの）に伴い廃止し、
 * `app/parent/(tabs)/index.tsx`（かぞくタブ、初期表示）へ統合した。実装メモ187章参照。
 *
 * `app/supporter/home.tsx`（S1、182章で先行対応済み）と同じ前例に倣う。このファイルを
 * 削除せずリダイレクトとして残しているのは、`/parent/home` を指す導線（古いブックマーク・
 * ホーム画面ショートカット等）を404にしないため。アプリ内の遷移コードは今回すべて
 * `/parent` へ直接書き換えたため、このリダイレクトを実際に通るのは古い外部リンクを
 * 踏んだ場合のみになる。
 */
export default function ParentHomeRedirect() {
  return <Redirect href="/parent" />;
}
