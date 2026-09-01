-- 家族の木の内訳から、退会したメンバーが消えていた問題の修正
--
-- 参照: 開発部/成果物/実装メモ.md 99章、主要画面ワイヤーフレーム.md 20.0節決定5
--
-- 何が起きていたか:
--   family_members の SELECT ポリシーは family_id = current_family_id() のみで
--   is_active を見ていないため、退会者（is_active=false）の完了報告は木の上に
--   色丸として出続ける。一方 family_tree_member_breakdown ビューは WHERE fm.is_active
--   で絞っていたため、退会者は内訳に一切載らなかった。
--   結果、「木にあるのに内訳に無い色」が生まれ、その色が誰のものか辿れなかった。
--   本番では退会者3名（せいや・せいや１・ふうか）に完了報告が計7件あり、
--   実際にこの状態になっていた。
--
-- 修正:
--   WHERE fm.is_active を HAVING fm.is_active OR COUNT(cc.id) > 0 に置き換える。
--   - 在籍中のメンバーは、そのシーズンの報告が0件でも従来どおり全員表示する（決定5）
--   - 退会したメンバーは、そのシーズンに1件以上報告している場合のみ表示する
--     （退会者を無条件に並べると、当時いなかった人まで凡例に出てしまうため）
--
-- 破壊性: 非破壊的。CREATE OR REPLACE VIEW で列名・型・並びは一切変更していない
--   （family_id, season_id, season_start, member_id, display_name, avatar_color,
--    member_created_at, completion_count の8列のまま）。返る行が増える方向にのみ変わる。
--   security_invoker=true も従来どおり維持する。
--
-- 事前確認（実装メモ95.3章の依存関係クエリを実行済み）:
--   - このビューを参照する他のビュー: 0件
--   - このビューを参照する関数: 0件
--   - このビューに対するポリシー: 0件（security_invoker=true のビュー）
--   - クライアントの参照箇所: src/data/api.ts:1130 の1箇所のみ
--     （fetchFamilyTreeMemberBreakdown → P26/C20/S14 の「内訳を見る」）

CREATE OR REPLACE VIEW public.family_tree_member_breakdown
WITH (security_invoker = true) AS
SELECT
  fm.family_id,
  fts.id AS season_id,
  fts.season_start,
  fm.id AS member_id,
  fm.display_name,
  fm.avatar_color,
  fm.created_at AS member_created_at,
  COUNT(cc.id)::INT AS completion_count
FROM family_members fm
JOIN family_tree_seasons fts
  ON fts.family_id = fm.family_id AND fts.season_end IS NULL
LEFT JOIN chore_completions cc
  ON cc.family_id = fm.family_id
 AND cc.reported_by = fm.id
 AND cc.reported_at >= (fts.season_start::timestamp AT TIME ZONE 'Asia/Tokyo')
GROUP BY fm.family_id, fts.id, fts.season_start, fm.id, fm.display_name, fm.avatar_color, fm.created_at
HAVING fm.is_active OR COUNT(cc.id) > 0;
