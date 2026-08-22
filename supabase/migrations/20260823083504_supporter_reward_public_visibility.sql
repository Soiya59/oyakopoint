-- ============================================================
-- みまもりメンバー機能: 自分専用ごほうび(rewards)も家族に公開する
-- （5回目のスコープ変更でchoresのみ公開したのと同じ扱いをrewardsにも適用）
-- ============================================================
-- ユーザー要望: 「ごほうびも」家族に見せたい（お手伝いと同じ扱いにする）。
--
-- 破壊性の評価（非破壊的と判断した理由）:
--   - DROP POLICY IF EXISTS → CREATE POLICYによる置き換えのみで、テーブル構造・
--     既存データには一切変更が無い
--   - 条件をfamily_id一致のみに単純化するだけで、既存のparent/child向けの正常系
--     （scope='family'の行は元々全員に見えていた）には一切影響しない
--   - 交換権限（reward_redemptions、自分専用rewardは作成者本人のみ交換可）は
--     本対応の対象外であり一切変更しない（「見える」ことと「交換できる」ことは
--     分離される）
-- ============================================================
DROP POLICY IF EXISTS "rewards_select_scoped" ON rewards;
CREATE POLICY "rewards_select_scoped" ON rewards
  FOR SELECT
  USING (family_id = current_family_id());
