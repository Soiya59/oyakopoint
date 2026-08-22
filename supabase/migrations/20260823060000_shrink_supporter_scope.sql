-- ============================================================
-- みまもりメンバー機能の縮小（「一緒にやることリスト」全面撤回・
-- 自分専用choreの可視性トグル撤回）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-7章「（2026-08-22 スコープ変更・4回目・最新）」
--     以降の本文（家族共有choreへのみまもりメンバー参加機能の全面撤回、
--     自分専用choreの可視性トグル撤回、リアクションは送る側専用への回帰）
--   設計部/成果物/スキーマ設計.sql 19〜22章（4回目改訂で単純化済み）
--
-- 本ファイルは開発部/成果物/実装メモ.md 63章として、適用前に事前記録した内容を
-- そのまま反映したものである。
--
-- 破壊性の評価（非破壊的と判断した理由）:
--   - `chores.is_shared_with_family`・`chore_completions.chore_scope`・
--     `chore_completions.is_shared_with_family`はいずれも59章のマイグレーションで
--     追加された列であり、既存のparent/child向けデータには意味を持たない
--     付随情報（59章時点で全既存行はtrue/'family'にバックフィルされたのみ）。
--     列を削除しても、既存のchores/chore_completionsの他の列（title/points/
--     reported_by等）には一切影響しない
--   - 現時点でこれらの列を書き込むのはみまもりメンバーの自分専用chore関連の
--     コードパスのみであり、59〜62章の時点でみまもりメンバーの実ログイン・
--     実際の書き込みは未検証（実装メモ.md 59.5.5節）だったため、削除対象の列に
--     実データが入っている可能性はないと判断した（`curl`による事前確認は
--     本節の直前に非破壊的に実施し、実装メモ.md 63章に記録する）
--   - RLSポリシーの置き換え（DROP POLICY IF EXISTS → CREATE POLICY）は、
--     いずれも「みまもりメンバーが家族共有choreの完了報告を行う経路・
--     みまもりメンバーの完了報告をリアクションの対象にする経路」を塞ぐ
--     制限の追加、および可視性判定をスナップショット列参照からchoresへの
--     都度JOINへ置き換えるものであり、既存のparent/childの正常系
--     （21b章コメント「既存の全chore行はscope='family'のため、この
--     EXISTS条件は既存の完了報告について常に真になり、動作は変わらない」と
--     同じ理由）には一切影響しない
-- ============================================================


-- ============================================================
-- 19. chores — 可視性トグル（is_shared_with_family）の撤回
-- ============================================================
ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_family_always_shared;
ALTER TABLE chores DROP COLUMN IF EXISTS is_shared_with_family;


-- ============================================================
-- 21a. chore_completions_before_insert() — スナップショット代入の撤回
-- ============================================================
-- [変更] 5a章の既存トリガーに戻す。family_id/chore_title/chore_emoji/points自動補完・
-- 実行回数上限チェック・自分専用choreの作成者以外拒否チェックは一切変更しない。
-- 59章で追加したchore_scope/is_shared_with_familyへの代入のみを取り除く。
CREATE OR REPLACE FUNCTION public.chore_completions_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_family_id UUID;
  v_title TEXT;
  v_emoji TEXT;
  v_points INT;
  v_is_repeatable BOOLEAN;
  v_daily_limit INT;
  v_scope TEXT;
  v_created_by UUID;
  v_count INT;
  v_today DATE;
BEGIN
  SELECT family_id, title, emoji, points, is_repeatable, daily_limit, scope, created_by
    INTO v_family_id, v_title, v_emoji, v_points, v_is_repeatable, v_daily_limit, v_scope, v_created_by
  FROM chores
  WHERE id = NEW.chore_id AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION '指定されたchoreが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 自分専用choreは作成者本人以外は完了報告できない（21b章chore_completions_insert_scopedと
  -- 同じ条件をトリガー側でも強制する、二重防御。変更なし）。
  IF v_scope = 'personal' AND NEW.reported_by <> v_created_by THEN
    RAISE EXCEPTION '自分専用のお手伝いは作成者本人のみ完了報告できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- クライアントが送ってきた値は信用せず、常にDB側の最新値で上書きする
  -- （ポイント値の改ざん・他家族へのなりすまし報告を防ぐ）
  NEW.family_id := v_family_id;
  NEW.chore_title := v_title;
  NEW.chore_emoji := v_emoji;
  NEW.points := v_points;

  -- 実行回数上限チェック（変更なし）
  v_today := (now() AT TIME ZONE 'Asia/Tokyo')::date;

  IF NOT v_is_repeatable THEN
    IF EXISTS (
      SELECT 1 FROM chore_completions
      WHERE chore_id = NEW.chore_id
    ) THEN
      RAISE EXCEPTION 'このお手伝いはすでに完了報告済みです' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_daily_limit IS NOT NULL THEN
    SELECT count(*) INTO v_count
    FROM chore_completions
    WHERE chore_id = NEW.chore_id
      AND reported_by = NEW.reported_by
      AND (reported_at AT TIME ZONE 'Asia/Tokyo')::date = v_today;

    IF v_count >= v_daily_limit THEN
      RAISE EXCEPTION '本日の実行回数上限（%回）に達しています', v_daily_limit
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 21b. chore_completions のRLS — 都度JOINへの置き換え・
--      role='supporter'による家族共有chore完了報告の禁止
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chore_completions_select_same_family" ON chore_completions;
DROP POLICY IF EXISTS "chore_completions_select_scoped" ON chore_completions;
CREATE POLICY "chore_completions_select_scoped" ON chore_completions
  FOR SELECT
  USING (
    family_id = current_family_id()
    AND (
      reported_by = current_family_member_id()
      OR EXISTS (
        SELECT 1 FROM chores c
        WHERE c.id = chore_completions.chore_id AND c.scope = 'family'
      )
    )
  );

DROP POLICY IF EXISTS "chore_completions_insert_self" ON chore_completions;
CREATE POLICY "chore_completions_insert_self" ON chore_completions
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND reported_by = current_family_member_id()
    AND EXISTS (
      SELECT 1 FROM chores c
      WHERE c.id = chore_completions.chore_id
        AND (
          (c.scope = 'family' AND current_family_role() <> 'supporter')
          OR (c.scope = 'personal' AND c.created_by = current_family_member_id())
        )
    )
  );

-- ============================================================
-- 22. chore_reactions — 「みまもりメンバーが送る側になれる」の1点に単純化
-- ============================================================
-- [2026-08-23改訂で単純化] 59章では(a)みまもりメンバーが送る側になれる拡張に
-- 加え、(b)子どもがみまもりメンバーの完了報告にもリアクションを送れる拡張、
-- (c)非公開設定の自分専用choreを露出させない可視性条件、の3点があった。
-- 07-7章の4回目のスコープ変更により、みまもりメンバーは完了報告の「もらう」側に
-- 一切ならない（送る側専用）ことが確定したため、(b)は前提自体が無くなり不要に
-- なった。また、みまもりメンバーの完了報告は常に自分専用choreであり、
-- 21b章のRLSにより本人以外には最初から見えないため、(c)の可視性条件を
-- 明示的に重ねる必要も無い（見えない完了報告に対してリアクションを試みても
-- chore_reactions_before_insertが対象completionをSELECTする際に21b章のRLSで
-- 弾かれる、既存の多層防御がそのまま機能する）。
--
-- [適用順序上の注意] 旧chore_reactions_insert_scopedポリシー（59章版）は
-- chore_completions.chore_scope列を参照しているため、下記の置き換えは
-- chore_completions側のchore_scope/is_shared_with_family列を削除するより前に
-- 実行する必要がある（依存関係違反 SQLSTATE 2BP01 を避けるため）。
DROP POLICY IF EXISTS "chore_reactions_insert_by_parent" ON chore_reactions;
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
          AND fm.role = 'parent'
      )
    )
  );

-- 可視性スナップショット列（59章で追加）自体は、上記ポリシー・トリガーの置き換え後は
-- どこからも参照されなくなるため、あわせて削除する。
ALTER TABLE chore_completions DROP CONSTRAINT IF EXISTS chk_chore_completions_scope;
DROP INDEX IF EXISTS idx_chore_completions_scope_visibility;
ALTER TABLE chore_completions DROP COLUMN IF EXISTS chore_scope;
ALTER TABLE chore_completions DROP COLUMN IF EXISTS is_shared_with_family;
