-- ============================================================
-- chore_daily_flags: 「まいにち」個人設定
-- ============================================================
-- [2026-08-22追加・本部長] ユーザーから「やることリストに毎日タスクを入れたい、
-- 区分けしたい」との依頼を受けた。既存の`chores.is_repeatable`（くり返す設定・
-- 1日の上限回数）は「繰り返し可能かどうか」を表すchore全体の設定であり、
-- ユーザーの指摘どおり「毎日やる」という意味とは異なる（例: 1日3回まで
-- くり返せるが毎日やるとは限らない）。また「まいにち」の要否は人によって違う
-- （同じchoreでも、ある子どもは毎日のルーティンとして扱いたいが、別の家族は
-- そう思わない）ため、chore側の列ではなく、**メンバーごとの個人設定**として
-- 新設した。表示は「まいにち」のバッジのみを付け、対になるラベル
-- （「とくべつ」等）は作らない方針（ユーザー確認済み）。
-- ============================================================

CREATE TABLE IF NOT EXISTS chore_daily_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  chore_id UUID NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_chore_daily_flags_member_chore UNIQUE (member_id, chore_id)
);

CREATE INDEX IF NOT EXISTS idx_chore_daily_flags_member_id ON chore_daily_flags(member_id);

ALTER TABLE chore_daily_flags ENABLE ROW LEVEL SECURITY;

-- 個人設定のため、自分の行のみ見える・操作できる（家族の他メンバーには見せない）。
DROP POLICY IF EXISTS "chore_daily_flags_own_rows" ON chore_daily_flags;
CREATE POLICY "chore_daily_flags_own_rows" ON chore_daily_flags
  FOR ALL
  USING (member_id = current_family_member_id())
  WITH CHECK (
    family_id = current_family_id()
    AND member_id = current_family_member_id()
  );
