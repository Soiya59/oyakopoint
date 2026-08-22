-- ============================================================
-- みまもりメンバー機能5回目のスコープ変更:
-- 自分専用choreの可視性を「常に非公開」（63章）から「常に公開」へ反転
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-7章「（2026-08-22 スコープ変更・5回目・最新）」
--     以降の本文、「自分専用choreの公開方針」節
--   設計部/成果物/スキーマ設計.sql 19章（chores_select_scoped）・21b章
--     （chore_completions_select_scoped）・22章（chore_reactions_insert_scoped）の
--     5回目改訂版
--
-- 本ファイルは開発部/成果物/実装メモ.md 64章として、適用前に事前記録した内容を
-- そのまま反映したものである。63章
-- （20260823060000_shrink_supporter_scope.sql）で「常に非公開」に反転した
-- 3ポリシーのうち、下記3本を5回目のスコープ変更で再度「常に公開」へ反転する。
-- rewards・reward_redemptions関連は本対応の対象外（自分専用rewardは引き続き
-- 非公開のまま。要件定義書07-7章「自分専用choreの公開方針」参照）。変更していない。
--
-- 破壊性の評価（非破壊的と判断した理由）:
--   - 対象はいずれもRLSポリシーのDROP POLICY IF EXISTS → CREATE POLICYによる
--     置き換えのみで、テーブル構造・列・既存データには一切変更が無い
--   - chores_select_scoped・chore_completions_select_scopedは、いずれも「可視性の
--     条件をfamily_id一致のみに単純化する（scope='personal'を作成者本人に限定する
--     条件を撤廃する）」という変更であり、条件を緩めるだけで既存のparent/child向けの
--     正常系（scope='family'の行は元々全員に見えていた）には一切影響しない
--   - chore_reactions_insert_scopedは、「子どもが送れる対象」の条件を
--     `fm.role = 'parent'`から`fm.role IN ('parent','supporter')`に拡張するのみで、
--     既存の「保護者は誰にでも送れる」「みまもりメンバー自身が送る側になれる」という
--     条件（`current_family_role() IN ('parent','supporter')`部分）は変更しない
--   - chore_completions_insert_self（自分専用choreの完了報告を作成者本人に限定する
--     制約、みまもりメンバーが家族共有choreを完了報告できない制約）は本対応の対象外
--     であり、一切変更しない（「閲覧できる」ことと「完了報告できる」ことは分離される。
--     設計部/成果物/スキーマ設計.sql 21章冒頭コメント参照）
--   - 適用前に`curl`（anon keyのみ、非破壊的読み取り）で本番DBの現状を確認したところ、
--     現時点でみまもりメンバー「jiji」が自分専用choreを1件も登録していない
--     （scope='personal'の行が存在しない）ことを確認しており、可視性が変わることで
--     新たに露出する実データも現時点では存在しない（開発部/成果物/実装メモ.md 64章参照）
--   - このマイグレーションはJWT Signing Keysダッシュボードに一切触れない。
--     service_role キー等の秘密情報もこのファイルのどこにもハードコードしていない
-- ============================================================

-- ------------------------------------------------------------
-- 19. chores_select_scoped — scope条件を撤廃し家族全員に公開
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chores_select_scoped" ON chores;
CREATE POLICY "chores_select_scoped" ON chores
  FOR SELECT
  USING (family_id = current_family_id());

-- ------------------------------------------------------------
-- 21b. chore_completions_select_scoped — 都度JOINによる除外を撤廃し家族全員に公開
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chore_completions_select_scoped" ON chore_completions;
CREATE POLICY "chore_completions_select_scoped" ON chore_completions
  FOR SELECT
  USING (family_id = current_family_id());

-- ------------------------------------------------------------
-- 22. chore_reactions_insert_scoped — 子どもがみまもりメンバーの完了報告にも
--     リアクションできるよう再度拡張
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chore_reactions_insert_scoped" ON chore_reactions;
CREATE POLICY "chore_reactions_insert_scoped" ON chore_reactions
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND reacted_by = current_family_member_id()
    AND (
      current_family_role() IN ('parent', 'supporter')
      OR EXISTS (
        SELECT 1
        FROM chore_completions cc
        JOIN family_members fm ON fm.id = cc.reported_by
        WHERE cc.id = chore_reactions.completion_id
          AND fm.role IN ('parent', 'supporter')
      )
    )
  );
