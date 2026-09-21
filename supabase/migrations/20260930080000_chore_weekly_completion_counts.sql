-- 07-35章「振り返る機会」項目3（その週によく行われたクエストの上位、新規View、
-- 2026-09-21追加）
-- 設計部/成果物/スキーマ設計.sql 72章のDDLをそのまま写したもの（開発部/成果物/
-- 実装メモ.md 参照）。View新設のみで、テーブル・ポリシー・関数は増えない。
-- RLSは新規に持たない（security_invoker=trueにより呼び出しユーザー自身の
-- chore_completions_select_scoped（既存RLS）がそのまま適用される。スキーマ
-- 設計.sql 72.5章「RLS: 新しいポリシーは不要」参照）。
--
-- [56.3章chore_completion_totalsとの違い] あちらは起点を持たない生涯累計
-- （chore_id×member_id）。こちらはjst_week_start_date()の週単位・家族全体
-- 合計（chore_id×week_start）。用途が異なるため別Viewとして新設する
-- （72.2章・72.3章参照）。
--
-- [本部長指示によりDB接続は行わない・マイグレーション作成のみ]
-- ローカル検証（`npx supabase db reset`等）は開発部の担当範囲。本番適用
-- （`npx supabase db push`）は行わない。実行前記録は実装メモ参照。

CREATE OR REPLACE VIEW public.chore_weekly_completion_counts
WITH (security_invoker = true) AS
SELECT
  cc.family_id,
  cc.chore_id,
  public.jst_week_start_date(cc.reported_at) AS week_start,
  COUNT(*)::INT AS completion_count
FROM chore_completions cc
WHERE cc.chore_id IS NOT NULL
GROUP BY cc.family_id, cc.chore_id, public.jst_week_start_date(cc.reported_at);

COMMENT ON VIEW public.chore_weekly_completion_counts IS
  '要件定義書07-35章4節・5節。クエスト（chore_id）×jst_week_start_date()の週単位の完了報告件数（家族全体、メンバーを問わず合算）。56.3章chore_completion_totals（起点を持たない生涯累計）とは別物であり、混同しないこと。chore_id IS NULLの行（56.3章と同じくchore物理削除のON DELETE SET NULL由来）はWHEREで除外する（56.3章と異なり本Viewは「多い順の上位」を出す用途のため、削除済みクエストの幽霊行がランキングに混ざるのは望ましくない、72.3章参照）。ORDER BYは持たせない（41章と同じ理由。並べ替えは呼び出し側の.order()に委ねる）。security_invoker=trueのためchore_completions_select_scoped（既存RLS）がそのまま適用され、新しいRLSポリシーの追加は不要。';
