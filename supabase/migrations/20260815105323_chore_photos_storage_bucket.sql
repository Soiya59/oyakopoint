
-- ============================================================
-- 11. Storage: chore-photos バケット（証拠写真）
-- ============================================================
-- [2026-08-15追加] 認証・データ管理設計書.md 5章「証拠写真」で説明のみされていた
-- Storageバケットを、実際のプロジェクトに作成するためのSQLとして初めて明文化する。
--
-- フォルダ構成: {family_id}/{member_id}-{timestamp}.jpg
--   [変更] 認証・データ管理設計書.md 5章の例（{family_id}/{completion_id}.jpg）から
--   変更。completion_idはchore_completionsへのINSERT成功後にしか確定せず、
--   chore_completionsには子ども自身のUPDATE権限が無い（9.6.1節、5c章参照）ため、
--   INSERT後にphoto_urlだけを書き足す経路が取れない。そのため開発部の実装
--   （app/child/report.tsx、実装メモ.md 15.7節）では、アップロードをINSERTより
--   先に行えるよう family_id/member_id/timestamp の組み合わせに変更した。
--   RLSポリシー（下記）はフォルダの第1階層（family_id）のみを見るため、
--   ファイル名部分のこの変更によるRLS上の影響は無い。
--
-- [未実施・次のステップ] 認証・データ管理設計書.md 5章の「90日ライフサイクル
-- ルールで自動削除」は、SupabaseダッシュボードのStorage設定（またはMmanagement API）
-- での設定が必要であり、本SQL（マイグレーション経由の操作）には含まれない。
-- バケット作成後、ユーザーが別途ダッシュボードから設定すること。
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('chore-photos', 'chore-photos', false)
ON CONFLICT (id) DO NOTHING;

-- 家族内の誰でも（保護者・子ども問わず）自分の家族フォルダへアップロード可能。
-- current_family_id()はJWTのfamily_idカスタムクレーム（子ども）または
-- auth_user_id経由のルックアップ（保護者）の両方に対応済み（0章参照）ため、
-- 子どものカスタムJWT・保護者の標準Authセッションのどちらでも同じ条件で動く。
DROP POLICY IF EXISTS "chore_photos_insert_own_family" ON storage.objects;
CREATE POLICY "chore_photos_insert_own_family" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'chore-photos'
    AND (storage.foldername(name))[1] = current_family_id()::text
  );

-- 家族内の誰でも自分の家族の写真を閲覧可能（完了報告一覧・詳細での表示用）
DROP POLICY IF EXISTS "chore_photos_select_own_family" ON storage.objects;
CREATE POLICY "chore_photos_select_own_family" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'chore-photos'
    AND (storage.foldername(name))[1] = current_family_id()::text
  );

-- UPDATE/DELETEはクライアントに開放しない。chore_completionsが追記専用ログである
-- 設計思想（5章）と一貫させる。家族削除時の一括削除はremove-member Edge Function
-- がservice_role経由で行う（認証・データ管理設計書.md 3.4章5.参照、RLS対象外のため
-- service_role操作にはここでのポリシーは影響しない）。
