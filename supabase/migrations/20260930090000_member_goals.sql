-- 07-36章「自分で目標を決める」（member_goals、新規テーブル、2026-09-21追加）
-- 設計部/成果物/スキーマ設計.sql 71章のDDLをそのまま写したもの（開発部/成果物/
-- 実装メモ.md 参照）。
--
-- [要件の要点の再確認]
-- (1) 子ども1人につき進行中の目標は常に1件まで。
-- (2) 達成・未達成を表す列を持たせない（Finch型）。期限も持たせない。
-- (3) 目標の入力・編集は保護者のみ。子どもは自分の目標を読めるが書けない。
--     みまもりメンバーは対象外。
-- (4) 過去の目標は削除せず履歴として残す。
-- (5) 既存クエストへの紐づけ（linked_chore_id）は任意。
--
-- [本タスクの厳守事項の反映]
-- - `families`からのON DELETE CASCADEを持つ（member_id側のON DELETE RESTRICT
--   と対になるため必須。実装メモ273.3節・本タスクの厳守事項(3)）。
-- - 新設する関数・トリガー関数には`SET search_path = public`を付ける
--   （本タスクの厳守事項(1)）。
--
-- [本部長指示によりDB接続は行わない・マイグレーション作成のみ]
-- ローカル検証（`npx supabase db reset`等）は開発部の担当範囲。本番適用
-- （`npx supabase db push`）は行わない。実行前記録は実装メモ参照。

-- ------------------------------------------------------------
-- member_goals テーブル
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  goal_text TEXT NOT NULL CHECK (char_length(trim(goal_text)) BETWEEN 1 AND 200),
  -- [達成・未達成を表す列は存在しない。要件定義書07-36章3節「Finch型」の
  -- 必須要件。将来この表に列を追加する人へ: is_achieved・status・
  -- due_date・deadlineのような列は、この機能の設計の前提そのものと
  -- 矛盾する。追加したくなったら、まず07-36章3節を読み、企画部・本部長の
  -- 判断を仰ぐこと。]
  linked_chore_id UUID NULL REFERENCES chores(id) ON DELETE SET NULL,
  created_by UUID NULL REFERENCES family_members(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (retired_at IS NULL OR retired_at >= started_at)
);

-- 「1人につき進行中の目標は常に1件まで」を、habit_cards（55.2章
-- uq_habit_cards_active_per_chore_member）と同じ部分UNIQUEインデックスで
-- 強制する。
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_goals_active_per_member
  ON member_goals (member_id) WHERE retired_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_member_goals_family_id ON member_goals(family_id);
CREATE INDEX IF NOT EXISTS idx_member_goals_member_id ON member_goals(member_id);
CREATE INDEX IF NOT EXISTS idx_member_goals_linked_chore_id ON member_goals(linked_chore_id);

DROP TRIGGER IF EXISTS trg_member_goals_updated_at ON member_goals;
CREATE TRIGGER trg_member_goals_updated_at
  BEFORE UPDATE ON member_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE member_goals ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE member_goals IS
  '要件定義書07-36章「自分で目標を決める」。子ども1人につき進行中の目標を常に1件まで保持する（部分UNIQUEインデックスuq_member_goals_active_per_memberで強制）。達成・未達成を表す列・期限の列はいずれも存在しない（3章Finch型の必須要件）。過去の目標はretired_atが入るだけで物理削除されず、履歴として残る（9章）。新規登録（差し替え）はset_member_goal()経由、進行中の目標本文の軽微な編集は本テーブルへの直接UPDATEを許す。';

-- ------------------------------------------------------------
-- member_goals_before_write()（家族整合性の検証・不変列の保護）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.member_goals_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = NEW.member_id AND fm.family_id = NEW.family_id AND fm.role <> 'supporter'
    ) THEN
      RAISE EXCEPTION 'member_idは同じ家族の対象メンバー（保護者・子ども）である必要があります' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NEW.linked_chore_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM chores c WHERE c.id = NEW.linked_chore_id AND c.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'linked_chore_idは同じ家族のクエストである必要があります' USING ERRCODE = 'foreign_key_violation';
    END IF;
    -- 作成者・開始日時・引退日時は、呼び出し元が何を送ってきても常に
    -- サーバー側の値で上書きする（37.2章created_byと同じ改ざん防止
    -- パターン）。
    NEW.created_by := current_family_member_id();
    NEW.started_at := now();
    NEW.retired_at := NULL;
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  IF OLD.retired_at IS NOT NULL THEN
    RAISE EXCEPTION '引退済みの目標（履歴）は変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 不変列（作成後は誰も変更できない）。RLS(UPDATEポリシー)は「どの行を
  -- 触れるか」までしか絞れないため、「どの列を触れるか」はここで担保する
  -- （37.2章created_by・2章family_membersの既存パターンと同じ役割分担）。
  NEW.family_id  := OLD.family_id;
  NEW.member_id  := OLD.member_id;
  NEW.created_by := OLD.created_by;
  NEW.started_at := OLD.started_at;

  IF NEW.linked_chore_id IS DISTINCT FROM OLD.linked_chore_id AND NEW.linked_chore_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM chores c WHERE c.id = NEW.linked_chore_id AND c.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'linked_chore_idは同じ家族のクエストである必要があります' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- retired_atは「まだ引退していない行」からしか変更できない（直前の
  -- ガードで保証済み）ため、ここに来る時点でOLD.retired_atは必ずNULL。
  -- NULLから値を入れる（＝手動で「この目標をやめる」）操作のみを許し、
  -- 任意の時刻をクライアントに送らせず常にnow()で上書きする。
  IF NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
    NEW.retired_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_goals_before_write ON member_goals;
CREATE TRIGGER trg_member_goals_before_write
  BEFORE INSERT OR UPDATE ON member_goals
  FOR EACH ROW EXECUTE FUNCTION public.member_goals_before_write();

-- ------------------------------------------------------------
-- RLSポリシー
-- ------------------------------------------------------------
-- [SELECT] 家族の誰でも読める（habit_cards決定12・chore_completion_
-- totals等の既存パターンを踏襲。71.4章参照）。
DROP POLICY IF EXISTS "member_goals_select_same_family" ON member_goals;
CREATE POLICY "member_goals_select_same_family" ON member_goals
  FOR SELECT
  USING (family_id = current_family_id());

-- [INSERT] 直接のINSERTポリシーは定義しない。新規登録（＝進行中の目標の
-- 差し替え）はset_member_goal()（SECURITY DEFINER）経由に限定する
-- （47.1章sticker_catalog・53.3章family_sticker_pricesと同じ「デフォルト
-- 拒否＋関数のみが書き込む」方針）。

-- [UPDATE] 保護者のみ、かつ「まだ引退していない（進行中の）行」のみを
-- 対象にする。
DROP POLICY IF EXISTS "member_goals_update_active_by_parent" ON member_goals;
CREATE POLICY "member_goals_update_active_by_parent" ON member_goals
  FOR UPDATE
  USING (family_id = current_family_id() AND is_current_user_parent() AND retired_at IS NULL)
  WITH CHECK (family_id = current_family_id() AND is_current_user_parent());

-- [DELETE] ポリシーを一切定義しない（デフォルト拒否）。要件定義書07-36章
-- 5節・9節「過去の目標は削除せず履歴として残す」の必須要件を、物理削除
-- そのものを経路として持たないことで担保する。

-- ------------------------------------------------------------
-- set_member_goal()（新規登録＝差し替え、SECURITY DEFINER RPC）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_member_goal(
  p_member_id UUID,
  p_goal_text TEXT,
  p_linked_chore_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_new_id UUID;
BEGIN
  v_family_id := current_family_id();
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION '家族に所属していません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT is_current_user_parent() THEN
    RAISE EXCEPTION '目標の登録は保護者のみ実行できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM family_members fm
    WHERE fm.id = p_member_id AND fm.family_id = v_family_id AND fm.role <> 'supporter'
  ) THEN
    RAISE EXCEPTION 'member_idは同じ家族の対象メンバー（保護者・子ども）である必要があります' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF p_linked_chore_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM chores c WHERE c.id = p_linked_chore_id AND c.family_id = v_family_id
  ) THEN
    RAISE EXCEPTION 'linked_chore_idは同じ家族のクエストである必要があります' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 進行中の目標があれば引退させる（部分UNIQUEインデックスを満たすため、
  -- 新しい行をINSERTする前に必ず終える）。
  UPDATE member_goals
  SET retired_at = now()
  WHERE member_id = p_member_id AND retired_at IS NULL;

  INSERT INTO member_goals (family_id, member_id, goal_text, linked_chore_id, created_by, started_at)
  VALUES (v_family_id, p_member_id, p_goal_text, p_linked_chore_id, current_family_member_id(), now())
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.set_member_goal(UUID, TEXT, UUID) IS
  '要件定義書07-36章。子どもの新しい目標を登録する。進行中（retired_at IS NULL）の既存の目標があれば同じトランザクション内で引退させてから新しい行を1件挿入する（5節「1人1件まで」・9節「履歴は残す」）。保護者のみ実行可能（4節）。goal_textの長さ検証はCHECK制約に委ねる。取消経路は無い（UPDATEポリシーで進行中の目標の本文を訂正することはできるが、新しい目標として差し替える操作自体を取り消すことはできない）。';

REVOKE ALL ON FUNCTION public.set_member_goal(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_goal(UUID, TEXT, UUID) TO authenticated;
