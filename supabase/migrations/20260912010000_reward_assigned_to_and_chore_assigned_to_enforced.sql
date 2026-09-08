-- ============================================================
-- ごほうびにも担当者を新設（rewards.assigned_to）し、クエストの担当者も
-- DBで実際に効かせる（2026-09-12）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-22章「ごほうびにもクエストと同じ
--     『担当者』を持たせる」（決定1〜9）。
--   設計部/成果物/スキーマ設計.sql 50章（rewards.assigned_to新設）・
--     51章（chores.assigned_toをDBでも効かせる）。
--   開発部/成果物/実装メモ.md 163章。
--
-- 本部長からの業務指示により、統括が提示された3案（A: ごほうびも画面だけに
-- する／B: クエストもDBで止める／C: 非対称のまま進める）のうち **B** で
-- 確定している（クエスト・ごほうびの両方をDBレベルで実際に止める）。
--
-- [全体構成]
--   1. rewards.assigned_to 列の新設（スキーマ設計.sql 50.3章）
--   2. rewards_before_write() 改訂（50.4章。assigned_toの家族一致検証、
--      personal固定・supporter_shared固定、updated_by許可リストへの追加）
--   3. RLS改訂: reward_redemptions_insert_scoped（50.5章。scope='family'
--      分岐にのみ担当者条件を追加）
--   4. 既存の scope='personal' 行への assigned_to backfill
--      （50.9章。トリガー無効化のうえでUPDATE。本番は対象0件の見込みだが、
--      0件でも安全に実行できるガード付きUPDATEとして常に実行する）
--   5. CHECK制約 chk_rewards_personal_self_assigned の追加
--      （50.9章。backfillの**あと**に追加する。順序を守る）
--   6. RLS改訂: chore_completions_insert_self（51.3章。scope='family'
--      分岐にのみ担当者条件を追加）
--   7. chore_completions_before_insert() 改訂（51.4章。NFCタグ経由の
--      代理報告RPCはRLSをバイパスするため、トリガー側でも同じ検査を行う。
--      ここが今回の要）
--
-- [関数のシグネチャ] rewards_before_write()・chore_completions_before_insert()
-- はいずれも引数無しのトリガー関数のままCREATE OR REPLACEする。引数・戻り値の
-- 型を変更していないため、83.2章が警告する「旧シグネチャの明示DROPが必要」
-- という問題には該当しない（新しいCREATE FUNCTIONを追加していない）。
--
-- [破壊性] 新規INSERTに対するWITH CHECK・トリガー例外の追加が中心であり、
-- 既存行を書き換えるUPDATEは4.のbackfill（scope='personal'かつassigned_to
-- IS NULLの行のみ対象。本番は対象0件を本部長が確認済み、開発部/成果物/
-- 実装メモ.md 163章参照）のみ。既存の chore_completions・reward_redemptions
-- 行は一切書き換えない。
--
-- 本ファイルはDDLのみで本番へは適用しない（本部長の担当。全社共通ルール
-- 「破壊的なDB操作は実行前に成果物に記録する」）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. rewards.assigned_to 列の新設（スキーマ設計.sql 50.3章）
-- ------------------------------------------------------------
-- chores.assigned_to（20260815093520_initial_schema.sql）と型・NULL許容・
-- FK参照先・ON DELETE挙動のすべてを一致させる。CHECK制約は本節では追加
-- しない（5.節で、backfillの後に追加する）。
ALTER TABLE rewards
  ADD COLUMN IF NOT EXISTS assigned_to UUID NULL REFERENCES family_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rewards_assigned_to ON rewards(assigned_to);

-- ------------------------------------------------------------
-- 2. rewards_before_write() 改訂（スキーマ設計.sql 50.4章）
-- ------------------------------------------------------------
-- [ベース] 20260906010000_supporter_shared_scope.sql版。created_by決定
-- ロジック本体は一切変更しない。追加するのは
--   (a) assigned_toの家族一致チェック（chores_before_write()と同型）
--   (b) scope='personal'のときassigned_to := created_byへ固定
--   (c) scope='supporter_shared'のときassigned_to := NULLへ固定
--   (d) updated_byの許可リストにassigned_toを追加
CREATE OR REPLACE FUNCTION public.rewards_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.scope IS DISTINCT FROM OLD.scope THEN
    RAISE EXCEPTION '公開範囲（scope）は作成後に変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [新設] assigned_toの家族一致チェック。chores_before_write()と同型。
  IF NEW.assigned_to IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = NEW.assigned_to AND fm.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'assigned_toは同じ家族のメンバーである必要があります' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- [変更なし] created_byの決定ロジック本体（20260906010000版から継続）。
  IF NEW.scope IN ('personal', 'supporter_shared') OR TG_OP = 'INSERT' THEN
    NEW.created_by := current_family_member_id();
  ELSE
    -- TG_OP = 'UPDATE' AND NEW.scope = 'family'
    NEW.created_by := OLD.created_by;
  END IF;

  -- [新設] personalはassigned_to=created_byに固定する
  -- （chk_rewards_personal_self_assignedと同じ意味を、トリガーとCHECK制約の
  -- 両方で担保する。chores側と同じ二重の担保構成）。
  IF NEW.scope = 'personal' THEN
    NEW.assigned_to := NEW.created_by;
  ELSIF NEW.scope = 'supporter_shared' THEN
    -- [新設] 「みまもり全員が交換できる」という要件は1列=1人分の値では
    -- 表現できないため常にNULLへ強制する（chores_before_write()と同型）。
    NEW.assigned_to := NULL;
  END IF;

  -- [変更] updated_byの許可リストにassigned_toを追加。
  IF TG_OP = 'UPDATE' AND (
    NEW.name IS DISTINCT FROM OLD.name OR
    NEW.emoji IS DISTINCT FROM OLD.emoji OR
    NEW.cost IS DISTINCT FROM OLD.cost OR
    NEW.description IS DISTINCT FROM OLD.description OR
    NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
  ) THEN
    NEW.updated_by := current_family_member_id();
  END IF;

  RETURN NEW;
END;
$$;
-- トリガー本体（trg_rewards_before_write）は既存のものを再利用（再作成不要）。

-- ------------------------------------------------------------
-- 3. RLS改訂: reward_redemptions_insert_scoped（スキーマ設計.sql 50.5章）
-- ------------------------------------------------------------
-- [変更] scope='family'分岐にのみ、担当者条件をAND追加する。判定対象は
-- 交換操作を行った人ではなく、交換の対象になるmember_id（代理交換のときは
-- 代理される子ども本人）。personal分岐・supporter_shared分岐は1文字も
-- 変更しない。
DROP POLICY IF EXISTS "reward_redemptions_insert_scoped" ON reward_redemptions;
CREATE POLICY "reward_redemptions_insert_scoped" ON reward_redemptions
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND EXISTS (
      SELECT 1 FROM rewards r
      WHERE r.id = reward_redemptions.reward_id
        AND (
          (
            r.scope = 'family'
            AND (member_id = current_family_member_id() OR is_current_user_parent())
            AND (SELECT role FROM family_members fm WHERE fm.id = reward_redemptions.member_id) IN ('parent', 'child')
            -- [新設] 担当者条件。判定対象は交換操作を行った人ではなく、
            -- 交換の対象になるmember_id（代理交換との整合）。
            AND (r.assigned_to IS NULL OR r.assigned_to = member_id)
          )
          OR (
            r.scope = 'personal'
            AND r.created_by = current_family_member_id()
            AND member_id = current_family_member_id()
          )
          OR (
            r.scope = 'supporter_shared'
            AND member_id = current_family_member_id()
            AND current_family_role() = 'supporter'
          )
        )
    )
  );
-- reward_redemptions_before_insert()は変更しない（personal/supporter_shared
-- 分岐の身元検証は目的が異なる多層防御であり、担当者条件はRLS単独で
-- 表現できるため、トリガー側への重複実装は追加しない。50.12章参照）。

-- ------------------------------------------------------------
-- 4. 既存の scope='personal' 行への assigned_to backfill
--    （スキーマ設計.sql 50.9章。CHECK制約より先に実行すること）
-- ------------------------------------------------------------
-- [注意・破壊的操作] `rewards_before_write()`はUPDATE時、scope IN
-- ('personal','supporter_shared')の行に対してcreated_byを呼び出し実行者の
-- IDで強制上書きする。トリガーを無効化せずにUPDATEすると、この一括更新を
-- 実行した操作者（本マイグレーション適用者＝管理者/service_role）のIDで
-- created_byが書き換わってしまうため、トリガーを一時的に無効化する
-- （45.13章がchores/rewardsのpersonal→supporter_shared移行で
-- DISABLE TRIGGERを用いた理由と全く同じ問題への対処）。
-- WHERE句が対象0件でも安全（UPDATE 0 rowsとして正常終了する）ため、
-- 件数確認を待たずに常に実行してよい形にしている。
-- 本番のrewards.scope='personal'行は0件であることを本部長が確認済み
-- （開発部/成果物/実装メモ.md 163章）。
ALTER TABLE rewards DISABLE TRIGGER trg_rewards_before_write;
UPDATE rewards
SET assigned_to = created_by
WHERE scope = 'personal' AND assigned_to IS NULL;
ALTER TABLE rewards ENABLE TRIGGER trg_rewards_before_write;

-- ------------------------------------------------------------
-- 5. CHECK制約 chk_rewards_personal_self_assigned の追加
--    （スキーマ設計.sql 50.9章。4.のbackfillの**あと**に実行すること）
-- ------------------------------------------------------------
ALTER TABLE rewards DROP CONSTRAINT IF EXISTS chk_rewards_personal_self_assigned;
ALTER TABLE rewards ADD CONSTRAINT chk_rewards_personal_self_assigned
  CHECK (scope <> 'personal' OR assigned_to = created_by);

-- ------------------------------------------------------------
-- 6. RLS改訂: chore_completions_insert_self（スキーマ設計.sql 51.3章）
-- ------------------------------------------------------------
-- [変更] scope='family'分岐にのみ、担当者条件をAND追加する。トップレベルの
-- reported_by = current_family_member_id()（自分自身のみ報告可）は変更
-- しない。personal分岐・supporter_shared分岐も条件式を1文字も変更しない。
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
          (
            c.scope = 'family'
            AND current_family_role() <> 'supporter'
            -- [新設] 担当者条件。reward_redemptions_insert_scopedと同型。
            -- 判定対象はreported_by（トップレベル条件により常に
            -- current_family_member_id()と同値。RLS経由の直接INSERTでは
            -- 代理報告が成立しないため、rewardsのように「操作者」と
            -- 「対象」が分かれる余地が無い）。
            AND (c.assigned_to IS NULL OR c.assigned_to = reported_by)
          )
          OR (c.scope = 'personal' AND c.created_by = current_family_member_id())
          OR (c.scope = 'supporter_shared' AND current_family_role() = 'supporter')
        )
    )
  );

-- ------------------------------------------------------------
-- 7. chore_completions_before_insert() 改訂（スキーマ設計.sql 51.4章）
--    NFCタグ経由の代理報告RPC（report_chore_completion_by_nfc_tag、
--    SECURITY DEFINER）がRLSを一切評価しないため、6.のRLS改訂だけでは
--    NFC経由の代理報告に対して担当者の検査が一切効かない。このトリガーは
--    RLSバイパスの影響を受けず常に発火するため、家族共有choreの担当者を
--    実際に守る唯一の経路になる（ここが今回の要）。
-- ------------------------------------------------------------
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
  v_assigned_to UUID;
  v_count INT;
  v_today DATE;
BEGIN
  SELECT family_id, title, emoji, points, is_repeatable, daily_limit, scope, created_by, assigned_to
    INTO v_family_id, v_title, v_emoji, v_points, v_is_repeatable, v_daily_limit, v_scope, v_created_by, v_assigned_to
  FROM chores
  WHERE id = NEW.chore_id AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION '指定されたchoreが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_scope = 'personal' AND NEW.reported_by <> v_created_by THEN
    RAISE EXCEPTION '自分専用のクエストは作成者本人のみ完了報告できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [新設] 担当者（assigned_to）が設定された家族共有choreは、担当者本人
  -- のみ完了報告できる。通常のRLS経由の直接INSERTでは6.のRLSと重複する
  -- 多層防御だが、NFCタグ経由の代理報告RPC（SECURITY DEFINER）はRLSを
  -- 一切評価しないため、この経路での担当者強制は本トリガーでしか実現
  -- できない。
  IF v_scope = 'family' AND v_assigned_to IS NOT NULL AND NEW.reported_by <> v_assigned_to THEN
    RAISE EXCEPTION 'このお手伝いは担当者のみ完了報告できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [変更なし] みまもり共通は作成者を問わないが、実施できるのは
  -- role='supporter'のメンバーに限る（決定2）。RLS（chore_completions_
  -- insert_self）の多層防御として、対象の身元（NEW.reported_by）を独立に
  -- 検証する。
  IF v_scope = 'supporter_shared' THEN
    IF NOT EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = NEW.reported_by AND fm.family_id = v_family_id AND fm.role = 'supporter'
    ) THEN
      RAISE EXCEPTION 'みまもり共通のクエストは、みまもりメンバーのみ完了報告できます' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  NEW.family_id := v_family_id;
  NEW.chore_title := v_title;
  NEW.chore_emoji := v_emoji;
  NEW.points := v_points;

  v_today := (now() AT TIME ZONE 'Asia/Tokyo')::date;

  IF NOT v_is_repeatable THEN
    IF EXISTS (
      SELECT 1 FROM chore_completions
      WHERE chore_id = NEW.chore_id
    ) THEN
      RAISE EXCEPTION 'このクエストはすでに完了報告済みです' USING ERRCODE = 'check_violation';
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
-- トリガー本体（trg_chore_completions_before_insert）は既存のものを
-- 再利用（再作成不要）。
