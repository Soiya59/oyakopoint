import { Redirect } from "expo-router";

/**
 * C18 かぞくのがんばり（子ども） — 2026-09-10に子ども下部タブ4区画化
 * （UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 36章、開発部/成果物/
 * 実装メモ.md 188章）に伴い、`app/child/(tabs)/family.tsx`（かぞくタブ）へ統合した。
 *
 * `app/parent/home.tsx`（187章）・`app/supporter/activity.tsx`は削除せずリダイレクトと
 * して残す前例に倣い、このファイルも削除せずリダイレクトにした。`/child/family-activity`
 * を指す導線（古いブックマーク等）を404にしないため。アプリ内の遷移コードは今回すべて
 * `/child/family`（新タブ）へ直接書き換えたため、このリダイレクトを実際に通るのは
 * 古い外部リンクを踏んだ場合のみになる。
 */
export default function ChildFamilyActivityRedirect() {
  return <Redirect href="/child/family" />;
}
