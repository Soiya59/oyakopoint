-- 07-35章「振り返る機会」2026-09-22改訂（要件定義書07-35章0-2節・4節・5節、
-- 設計部/成果物/スキーマ設計.sql 72章、特に72.8章）
--
-- 本番に既に適用済みの `chore_weekly_completion_counts`（20260930080000、
-- 家族全体合算・member_idなし）を、member_id列を持つ版へ作り直す。
--
-- [なぜ CREATE OR REPLACE VIEW ではなく DROP → CREATE か] `member_id`を
-- `chore_id`の直後（56.3章 chore_completion_totals と同じ列順）に置くため、
-- 既存列 `week_start` が3列目から4列目へ後退する。PostgreSQLの
-- CREATE OR REPLACE VIEW は既存列の並び替えを許さない
-- （`ERROR: cannot change name of view column "week_start" to "member_id"`）。
-- 末尾に追加すれば置き換えは可能だが、56.3章と列順が揃わなくなるため
-- 不採用（72.8章「検討した代替案・不採用」）。
--
-- [DROPしても安全であることの確認・72.8章] 本Viewを参照するView・関数は
-- スキーマ設計.sql内に見当たらない。CASCADE無しのDROPで足りる
-- （依存物が残っていれば失敗して知らせてくれるため、巻き込み削除の心配もない）。
--
-- [変わらないこと] `WHERE cc.chore_id IS NOT NULL`（72.3章）・
-- `security_invoker = true`（72.5章）はいずれも維持する。RLS・EXECUTE権限・
-- rls_checks.sql（S1/S3/S4）への影響は無い（Viewの置き換えのみ、72.5章）。
--
-- [本部長指示によりDB接続は行わない・マイグレーション作成のみ]
-- ローカル検証（`npx supabase db reset`等）は開発部の担当範囲。本番適用
-- （`npx supabase db push`）は行わない。実行前記録は実装メモ278章参照。

DROP VIEW IF EXISTS public.chore_weekly_completion_counts;

CREATE VIEW public.chore_weekly_completion_counts
WITH (security_invoker = true) AS
SELECT
  cc.family_id,
  cc.chore_id,
  cc.reported_by AS member_id,
  public.jst_week_start_date(cc.reported_at) AS week_start,
  COUNT(*)::INT AS completion_count
FROM chore_completions cc
WHERE cc.chore_id IS NOT NULL
GROUP BY cc.family_id, cc.chore_id, cc.reported_by, public.jst_week_start_date(cc.reported_at);

COMMENT ON VIEW public.chore_weekly_completion_counts IS
  '要件定義書07-35章4節・5節（2026-09-22改訂）。クエスト（chore_id）×実施した本人（member_id=reported_by、56.3章chore_completion_totalsと同じ命名）×jst_week_start_date()の週単位の完了報告件数。56.3章chore_completion_totals（起点を持たない生涯累計）とは別物であり、混同しないこと（対応関係は72.3章）。chore_id IS NULLの行（56.3章と同じくchore物理削除のON DELETE SET NULL由来）はWHEREで除外する（56.3章と異なり本Viewは「多い順の上位」を出す用途のため、削除済みクエストの幽霊行がランキングに混ざるのは望ましくない、72.3章参照）。ORDER BYは持たせない（41章と同じ理由。並べ替えは呼び出し側の.order()に委ねる）。security_invoker=trueのためchore_completions_select_scoped（既存RLS）がそのまま適用され、新しいRLSポリシーの追加は不要。2026-09-21新設・2026-09-22改訂（member_id列を追加し、家族全体合算だった旧版から本人単位の集計に変更。72.7章・72.8章参照）。';
