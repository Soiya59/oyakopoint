-- 07-9章「家族の木」週ごとの記録（新規View、2026-09-02追加）
-- 設計部/成果物/スキーマ設計.sql 41章のDDLをそのまま写したもの（開発部/成果物/
-- 実装メモ.md 113章）。View新設のみで、テーブル・ポリシー・関数は増えない。
-- RLSは新規に持たない（security_invoker=trueにより呼び出しユーザー自身の
-- family_tree_seasons_select_same_family・chore_completions側の既存RLSが
-- そのまま適用される。スキーマ設計.sql 41章「RLS: 新しいポリシーは不要」参照）。
--
-- [本部長指示によりDB接続は行わない・マイグレーション作成のみ]
-- ローカル検証（`npx supabase db reset`等）は開発部の担当範囲。本番適用
-- （`npx supabase db push`）は行わない。実行前記録は実装メモ113章参照。

CREATE OR REPLACE VIEW public.family_tree_weekly_completion_counts
WITH (security_invoker = true) AS
SELECT
  fts.family_id,
  fts.id AS season_id,
  fts.season_start,
  public.jst_week_start_date(cc.reported_at) AS week_start,
  COUNT(cc.id)::INT AS completion_count
FROM family_tree_seasons fts
JOIN chore_completions cc
  ON cc.family_id = fts.family_id
 AND cc.reported_at >= (fts.season_start::timestamp AT TIME ZONE 'Asia/Tokyo')
 AND (
   fts.season_end IS NULL
   OR cc.reported_at < (fts.season_end::timestamp AT TIME ZONE 'Asia/Tokyo')
 )
GROUP BY fts.family_id, fts.id, fts.season_start, public.jst_week_start_date(cc.reported_at);

COMMENT ON VIEW public.family_tree_weekly_completion_counts IS
  '07-9章「週ごとの記録」。シーズン(family_tree_seasons)内の完了報告数を、jst_week_start_date()の週単位・家族全体合計で集計する。メンバー別内訳は持たない（家族全体合計のみという要件のため）。ORDER BYを意図的に持たせていない（29b章と同じ理由。クライアントはweek_start昇順＝時系列順にのみ並べ、completion_countの多い順に並べ替えないこと）。0件の週は行として現れない（ゼロ埋めしない設計判断は41章冒頭コメント参照）。security_invoker=trueのためfamily_tree_seasons_select_same_family・chore_completionsの既存RLSがそのまま適用される。';
