-- ============================================================
-- 双方向リアクション（子→親、07-6章 次フェーズ）の実装
-- ============================================================
-- [2026-08-20実装・本部長] 設計部/成果物/スキーマ設計.sql 15章「双方向リアクション
-- （子→親、次フェーズ）— 設計方針メモ」で示された前提条件（(1) 07-4章の親の完了報告が
-- MVPでリリース済み、(2) 少数家族でのベータテスト・定性ヒアリングを経ること）が
-- 満たされ、ユーザーから実機テストを経て「こどもからも他の人にリアクションできる
-- ようにしたい」との依頼があったため着手する。
--
-- 15章の見込みどおり、新規テーブル・新規列は不要で、chore_reactionsの
-- INSERTポリシーのみを拡張する（見込み2の実装方式(a)を採用）。
--   - 対象completionのreported_by先family_members.roleが'parent'の場合
--     → 保護者・子どものどちらもリアクション可（子→親方向を新たに許可）
--   - roleが'child'の場合 → 従来どおり保護者のみリアクション可
--     （子ども同士の相互リアクションは07-6章の対象外、次フェーズでも許可しない）
-- kind/stamp_key/comment_body列の再設計・承認/点数評価の追加は行わない（見込み1・3）。
-- ============================================================

DROP POLICY IF EXISTS "chore_reactions_insert_by_parent" ON chore_reactions;

CREATE POLICY "chore_reactions_insert_scoped" ON chore_reactions
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND reacted_by = current_family_member_id()
    AND (
      is_current_user_parent()
      OR EXISTS (
        SELECT 1
        FROM chore_completions cc
        JOIN family_members fm ON fm.id = cc.reported_by
        WHERE cc.id = chore_reactions.completion_id
          AND fm.role = 'parent'
      )
    )
  );
