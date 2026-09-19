-- クエストごとの累計実施回数（新設View、やること.md 4-55、2026-09-19追加）
-- 設計部/成果物/スキーマ設計.sql 56章のDDLをそのまま写したもの（開発部/成果物/
-- 実装メモ.md 258章）。新設はView 1本のみ。新しいテーブル・索引・トリガー・
-- RPCは一切無い（56.2章・56.9章）。
--
-- [数え方] chore_id × 実施した本人（member_id=reported_by）ごとに
-- chore_completionsを生涯全件COUNTする。期間の絞り込みは一切行わない
-- （4-47①のsinceIsoとは無関係、56.1章。データソースを意図的に分離する設計）。
--
-- [取り方・56.4章決定56-6] 標準の取り方は`family_id`のみで絞る家族ぶん1回。
-- `member_id`では絞らない（C5・P19・S5・P10の4画面共通）。
--
-- [RLS・56.5章] Viewはsecurity_invoker=trueのため、呼び出しユーザー自身の
-- chore_completions RLS（chore_completions_select_scoped、
-- family_id = current_family_id()）がそのまま適用される。新しいポリシーは
-- 追加しない（S1・S3・S4いずれも増減なしの見込み、56.8章）。
--
-- [本部長指示によりDB接続は行わない・マイグレーション作成のみ]
-- ローカル検証（`npx supabase db reset`等）は開発部の担当範囲。本番適用
-- （`npx supabase db push`）は行わない。

CREATE OR REPLACE VIEW public.chore_completion_totals
WITH (security_invoker = true) AS
SELECT
  cc.family_id,
  cc.chore_id,
  cc.reported_by AS member_id,
  COUNT(*)::INT AS total_count
FROM chore_completions cc
GROUP BY cc.family_id, cc.chore_id, cc.reported_by;

COMMENT ON VIEW public.chore_completion_totals IS
  'やること.md 4-55。クエスト（chore_id）×実施した本人（member_id=reported_by）ごとの生涯累計実施回数。期間の絞り込みは一切行わない（4-47①のsinceIsoとは無関係、スキーマ設計.sql 56.1章）。security_invoker=trueのため、呼び出しユーザー自身のchore_completions RLS（chore_completions_select_scoped、family_id = current_family_id()）がそのまま適用される。chore_idがNULLの行（chore_completions.chore_idのON DELETE SET NULL、家族全体削除等の例外経路でchoreが物理削除された場合）も1グループとして現れうるが、削除済みchoreはクライアントの一覧に表示されないため参照されない（無害）。';
