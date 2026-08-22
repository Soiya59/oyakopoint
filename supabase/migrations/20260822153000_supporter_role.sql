-- ============================================================
-- みまもりメンバー（supporter）ロール新設
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 05章「設計判断（みまもりメンバー・第三ロールの追加）」・
--     06章「みまもりメンバー（祖父母等）の認証」・07-7章「みまもりメンバー」
--   設計部/成果物/スキーマ設計.sql 18〜26章（本ファイルは同ドキュメントの
--     18〜26章をそのままマイグレーションとして適用したものである。16〜17章は
--     すでに 20260820045200_bidirectional_reactions.sql / 20260822082002_chore_daily_flags.sql
--     として本番デプロイ済みのため、本ファイルでは再適用しない）
--   設計部/成果物/認証・データ管理設計書.md 8章
--   設計部/成果物/API仕様.md 2d・3b・4c・7b章
--
-- 破壊性: 非破壊的な変更のみ（開発部/成果物/実装メモ.md 59章に事前記録済み）。
--   - family_members.role のCHECK制約に 'supporter' を追加（既存値には影響なし）
--   - chores/rewards に created_by・scope（デフォルト'family'）・
--     is_shared_with_family（chores のみ、デフォルトtrue）列を追加
--     （DEFAULT付きADD COLUMNのため既存行は自動的に'family'/trueとして
--     バックフィルされ、既存の挙動に変更は無い）
--   - chore_completions に chore_scope（デフォルト'family'）・
--     is_shared_with_family（デフォルトtrue）を追加（同上、既存行に影響なし）
--   - 各種RLSポリシーの置き換え（DROP POLICY IF EXISTS → CREATE POLICY）。
--     いずれも「supporterロールに関する条件を追加する」変更であり、
--     既存のparent/childの挙動は変わらないことをコード上のロジックで確認済み
--     （本ファイル各章のコメント、および実装メモ.md 59章の検証記録を参照）
--   - family_invites テーブル・関連RPC2種の新規追加
-- ============================================================


-- ============================================================
-- 18. family_members.role 拡張
-- ============================================================
ALTER TABLE family_members DROP CONSTRAINT IF EXISTS family_members_role_check;
ALTER TABLE family_members
  ADD CONSTRAINT family_members_role_check CHECK (role IN ('parent', 'child', 'supporter'));

ALTER TABLE family_members DROP CONSTRAINT IF EXISTS chk_child_has_no_auth_user;
ALTER TABLE family_members
  ADD CONSTRAINT chk_child_has_no_auth_user CHECK (role IN ('parent', 'supporter') OR auth_user_id IS NULL);

ALTER TABLE family_members DROP CONSTRAINT IF EXISTS chk_owner_is_parent;
ALTER TABLE family_members
  ADD CONSTRAINT chk_owner_is_parent CHECK (NOT is_owner OR role = 'parent');

COMMENT ON CONSTRAINT family_members_role_check ON family_members IS
  '2026-08-22追加: supporter（みまもりメンバー）を許容する第三の値として追加。要件定義書07-7章。';

-- 既存ポリシー（family_members_select_same_family / family_members_insert_by_parent /
-- family_members_update_scoped / trg_family_members_before_update）はいずれも
-- role非依存またはis_current_user_parent()判定のみで、supporterの参加は
-- accept_family_invite（25c章、SECURITY DEFINER）経由でのみ行われるため変更不要
-- （スキーマ設計.sql 18章「既存ポリシーへの影響確認」参照）。


-- ============================================================
-- 19. chores — created_by・scope・is_shared_with_family
-- ============================================================
ALTER TABLE chores
  ADD COLUMN IF NOT EXISTS created_by UUID NULL REFERENCES family_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'family',
  ADD COLUMN IF NOT EXISTS is_shared_with_family BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_scope;
ALTER TABLE chores ADD CONSTRAINT chk_chores_scope CHECK (scope IN ('family', 'personal'));

ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_personal_has_creator;
ALTER TABLE chores ADD CONSTRAINT chk_chores_personal_has_creator
  CHECK (scope = 'family' OR created_by IS NOT NULL);

ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_personal_self_assigned;
ALTER TABLE chores ADD CONSTRAINT chk_chores_personal_self_assigned
  CHECK (scope = 'family' OR assigned_to = created_by);

ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_family_always_shared;
ALTER TABLE chores ADD CONSTRAINT chk_chores_family_always_shared
  CHECK (scope = 'personal' OR is_shared_with_family = true);

CREATE INDEX IF NOT EXISTS idx_chores_scope ON chores(family_id, scope);
CREATE INDEX IF NOT EXISTS idx_chores_created_by ON chores(created_by);

-- [変更] chores_before_write() を置き換える。既存のassigned_to/category_idの
-- 家族一致チェック・is_repeatableのdaily_limitデフォルト補完ロジックはそのまま残し、
-- scope関連の分岐を追加する（トリガー本体 trg_chores_before_write は
-- 初回マイグレーションで作成済みのため再作成不要）。
CREATE OR REPLACE FUNCTION public.chores_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.scope IS DISTINCT FROM OLD.scope THEN
    RAISE EXCEPTION '公開範囲（scope）は作成後に変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.assigned_to IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = NEW.assigned_to AND fm.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'assigned_toは同じ家族のメンバーである必要があります' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF NEW.category_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM categories c WHERE c.id = NEW.category_id AND c.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'category_idは同じ家族のカテゴリーである必要があります' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  IF NEW.scope = 'personal' THEN
    NEW.created_by := current_family_member_id();
    NEW.assigned_to := NEW.created_by;
  ELSIF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN
    NEW.created_by := current_family_member_id();
  END IF;

  IF TG_OP = 'INSERT' AND NEW.is_repeatable AND NEW.daily_limit IS NULL THEN
    NEW.daily_limit := 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "chores_select_same_family" ON chores;
DROP POLICY IF EXISTS "chores_select_scoped" ON chores;
CREATE POLICY "chores_select_scoped" ON chores
  FOR SELECT
  USING (
    family_id = current_family_id()
    AND (scope = 'family' OR created_by = current_family_member_id())
  );

DROP POLICY IF EXISTS "chores_write_by_parent" ON chores;
DROP POLICY IF EXISTS "chores_write_family_by_parent" ON chores;
CREATE POLICY "chores_write_family_by_parent" ON chores
  FOR ALL
  USING (family_id = current_family_id() AND scope = 'family' AND is_current_user_parent())
  WITH CHECK (family_id = current_family_id() AND scope = 'family' AND is_current_user_parent());

DROP POLICY IF EXISTS "chores_write_personal_by_creator" ON chores;
CREATE POLICY "chores_write_personal_by_creator" ON chores
  FOR ALL
  USING (
    family_id = current_family_id()
    AND scope = 'personal'
    AND current_family_role() = 'supporter'
    AND created_by = current_family_member_id()
  )
  WITH CHECK (
    family_id = current_family_id()
    AND scope = 'personal'
    AND current_family_role() = 'supporter'
    AND created_by = current_family_member_id()
  );


-- ============================================================
-- 20. rewards — created_by・scope
-- ============================================================
ALTER TABLE rewards
  ADD COLUMN IF NOT EXISTS created_by UUID NULL REFERENCES family_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'family';

ALTER TABLE rewards DROP CONSTRAINT IF EXISTS chk_rewards_scope;
ALTER TABLE rewards ADD CONSTRAINT chk_rewards_scope CHECK (scope IN ('family', 'personal'));

ALTER TABLE rewards DROP CONSTRAINT IF EXISTS chk_rewards_personal_has_creator;
ALTER TABLE rewards ADD CONSTRAINT chk_rewards_personal_has_creator
  CHECK (scope = 'family' OR created_by IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_rewards_scope ON rewards(family_id, scope);
CREATE INDEX IF NOT EXISTS idx_rewards_created_by ON rewards(created_by);

CREATE OR REPLACE FUNCTION public.rewards_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.scope IS DISTINCT FROM OLD.scope THEN
    RAISE EXCEPTION '公開範囲（scope）は作成後に変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.scope = 'personal' THEN
    NEW.created_by := current_family_member_id();
  ELSIF TG_OP = 'INSERT' AND NEW.created_by IS NULL THEN
    NEW.created_by := current_family_member_id();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rewards_before_write ON rewards;
CREATE TRIGGER trg_rewards_before_write
  BEFORE INSERT OR UPDATE ON rewards
  FOR EACH ROW EXECUTE FUNCTION public.rewards_before_write();

DROP POLICY IF EXISTS "rewards_select_same_family" ON rewards;
DROP POLICY IF EXISTS "rewards_select_scoped" ON rewards;
CREATE POLICY "rewards_select_scoped" ON rewards
  FOR SELECT
  USING (
    family_id = current_family_id()
    AND (scope = 'family' OR created_by = current_family_member_id())
  );

DROP POLICY IF EXISTS "rewards_write_by_parent" ON rewards;
DROP POLICY IF EXISTS "rewards_write_family_by_parent" ON rewards;
CREATE POLICY "rewards_write_family_by_parent" ON rewards
  FOR ALL
  USING (family_id = current_family_id() AND scope = 'family' AND is_current_user_parent())
  WITH CHECK (family_id = current_family_id() AND scope = 'family' AND is_current_user_parent());

DROP POLICY IF EXISTS "rewards_write_personal_by_creator" ON rewards;
CREATE POLICY "rewards_write_personal_by_creator" ON rewards
  FOR ALL
  USING (
    family_id = current_family_id()
    AND scope = 'personal'
    AND current_family_role() = 'supporter'
    AND created_by = current_family_member_id()
  )
  WITH CHECK (
    family_id = current_family_id()
    AND scope = 'personal'
    AND current_family_role() = 'supporter'
    AND created_by = current_family_member_id()
  );


-- ============================================================
-- 21. chore_completions — chore_scope/is_shared_with_familyスナップショット・
--     非公開分のSELECT制限
-- ============================================================
ALTER TABLE chore_completions
  ADD COLUMN IF NOT EXISTS chore_scope TEXT NOT NULL DEFAULT 'family',
  ADD COLUMN IF NOT EXISTS is_shared_with_family BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE chore_completions DROP CONSTRAINT IF EXISTS chk_chore_completions_scope;
ALTER TABLE chore_completions ADD CONSTRAINT chk_chore_completions_scope
  CHECK (chore_scope IN ('family', 'personal'));

CREATE INDEX IF NOT EXISTS idx_chore_completions_scope_visibility
  ON chore_completions(family_id, chore_scope, is_shared_with_family);

-- [変更] chore_completions_before_insert() を置き換える。既存のfamily_id/points/
-- chore_title/chore_emojiの自動補完・実行回数上限チェックはそのまま残す。
-- points算出には一切分岐を設けない（要件定義書07-7章「ポイントの扱い（3回目の
-- 方針修正）」により、みまもりメンバーも他メンバーと全く同じロジックで
-- 対象choreのpoints値をそのまま受け取る）。
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
  v_is_shared BOOLEAN;
  v_count INT;
  v_today DATE;
BEGIN
  SELECT family_id, title, emoji, points, is_repeatable, daily_limit, scope, created_by, is_shared_with_family
    INTO v_family_id, v_title, v_emoji, v_points, v_is_repeatable, v_daily_limit, v_scope, v_created_by, v_is_shared
  FROM chores
  WHERE id = NEW.chore_id AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION '指定されたchoreが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_scope = 'personal' AND NEW.reported_by <> v_created_by THEN
    RAISE EXCEPTION '自分専用のお手伝いは作成者本人のみ完了報告できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.family_id := v_family_id;
  NEW.chore_title := v_title;
  NEW.chore_emoji := v_emoji;
  NEW.chore_scope := v_scope;
  NEW.is_shared_with_family := v_is_shared;

  NEW.points := v_points;

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

DROP POLICY IF EXISTS "chore_completions_select_same_family" ON chore_completions;
DROP POLICY IF EXISTS "chore_completions_select_scoped" ON chore_completions;
CREATE POLICY "chore_completions_select_scoped" ON chore_completions
  FOR SELECT
  USING (
    family_id = current_family_id()
    AND (
      chore_scope = 'family'
      OR is_shared_with_family = true
      OR reported_by = current_family_member_id()
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
        AND (c.scope = 'family' OR c.created_by = current_family_member_id())
    )
  );


-- ============================================================
-- 22. chore_reactions — みまもりメンバーが送る/受け取る双方向のリアクション
-- ============================================================
DROP POLICY IF EXISTS "chore_reactions_insert_by_parent" ON chore_reactions;
DROP POLICY IF EXISTS "chore_reactions_insert_scoped" ON chore_reactions;

CREATE POLICY "chore_reactions_insert_scoped" ON chore_reactions
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND reacted_by = current_family_member_id()
    AND EXISTS (
      SELECT 1
      FROM chore_completions cc
      JOIN family_members reporter ON reporter.id = cc.reported_by
      WHERE cc.id = chore_reactions.completion_id
        AND (
          cc.chore_scope = 'family'
          OR cc.is_shared_with_family = true
          OR cc.reported_by = current_family_member_id()
        )
        AND (
          current_family_role() IN ('parent', 'supporter')
          OR reporter.role IN ('parent', 'supporter')
        )
    )
  );


-- ============================================================
-- 23. reward_redemptions — 自分専用rewardの交換を作成者本人に限定
-- ============================================================
DROP POLICY IF EXISTS "reward_redemptions_insert_self_or_parent" ON reward_redemptions;
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
          )
          OR (
            r.scope = 'personal'
            AND r.created_by = current_family_member_id()
            AND member_id = current_family_member_id()
          )
        )
    )
  );

CREATE OR REPLACE FUNCTION public.reward_redemptions_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_family_id UUID;
  v_name TEXT;
  v_cost INT;
  v_scope TEXT;
  v_created_by UUID;
  v_member_family_id UUID;
  v_available INT;
BEGIN
  SELECT family_id, name, cost, scope, created_by
    INTO v_family_id, v_name, v_cost, v_scope, v_created_by
  FROM rewards
  WHERE id = NEW.reward_id AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION '指定されたごほうびが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_scope = 'personal' AND NEW.member_id <> v_created_by THEN
    RAISE EXCEPTION '自分専用のごほうびは作成者本人のみ交換できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT family_id INTO v_member_family_id FROM family_members WHERE id = NEW.member_id;
  IF v_member_family_id IS DISTINCT FROM v_family_id THEN
    RAISE EXCEPTION 'ごほうびと交換対象メンバーの家族が一致しません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.family_id := v_family_id;
  NEW.reward_name := v_name;
  NEW.cost := v_cost;
  NEW.status := 'approved';

  SELECT current_points INTO v_available
  FROM member_points
  WHERE member_id = NEW.member_id;

  v_available := COALESCE(v_available, 0);

  IF v_available < NEW.cost THEN
    RAISE EXCEPTION 'ポイントが不足しています。member_id: %, 必要: %, 保有: %',
      NEW.member_id, NEW.cost, v_available
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;


-- ============================================================
-- 24. gratitude_points — みまもりメンバーを送受信の対象から除外
-- ============================================================
DROP POLICY IF EXISTS "gratitude_points_insert_self" ON gratitude_points;
CREATE POLICY "gratitude_points_insert_self" ON gratitude_points
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND sender_id = current_family_member_id()
    AND current_family_role() <> 'supporter'
    AND NOT EXISTS (
      SELECT 1 FROM family_members fm WHERE fm.id = recipient_id AND fm.role = 'supporter'
    )
  );


-- ============================================================
-- 25. family_invites（新規）— 招待発行側（保護者）が対象ロールを
--     指定できる招待の仕組み
-- ============================================================
CREATE TABLE IF NOT EXISTS family_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'supporter' CHECK (role = 'supporter'),
  invited_email TEXT NOT NULL CHECK (invited_email = lower(trim(invited_email)) AND invited_email LIKE '%@%'),
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_by UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  accepted_by UUID NULL REFERENCES family_members(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_family_invites_token ON family_invites(token);
CREATE INDEX IF NOT EXISTS idx_family_invites_family_id ON family_invites(family_id);
CREATE INDEX IF NOT EXISTS idx_family_invites_status ON family_invites(family_id, status);

ALTER TABLE family_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_invites_select_by_parent" ON family_invites;
CREATE POLICY "family_invites_select_by_parent" ON family_invites
  FOR SELECT
  USING (family_id = current_family_id() AND is_current_user_parent());

DROP POLICY IF EXISTS "family_invites_insert_by_parent" ON family_invites;
CREATE POLICY "family_invites_insert_by_parent" ON family_invites
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND is_current_user_parent()
    AND role = 'supporter'
    AND created_by = current_family_member_id()
  );

DROP POLICY IF EXISTS "family_invites_update_revoke_by_parent" ON family_invites;
CREATE POLICY "family_invites_update_revoke_by_parent" ON family_invites
  FOR UPDATE
  USING (family_id = current_family_id() AND is_current_user_parent())
  WITH CHECK (family_id = current_family_id() AND is_current_user_parent());

-- ------------------------------------------------------------
-- 25a. トリガー: family_id/created_by/statusの自動補完（改ざん防止）・
--      invited_emailの正規化・UPDATE時の不変条件強制
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.family_invites_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.family_id := current_family_id();
  NEW.created_by := current_family_member_id();
  NEW.role := 'supporter';
  NEW.status := 'pending';
  NEW.accepted_by := NULL;
  NEW.accepted_at := NULL;
  NEW.invited_email := lower(trim(NEW.invited_email));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_invites_before_insert ON family_invites;
CREATE TRIGGER trg_family_invites_before_insert
  BEFORE INSERT ON family_invites
  FOR EACH ROW EXECUTE FUNCTION public.family_invites_before_insert();

CREATE OR REPLACE FUNCTION public.family_invites_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.invited_email IS DISTINCT FROM OLD.invited_email
     OR NEW.token IS DISTINCT FROM OLD.token
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'status以外の項目は変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'この招待はすでに確定（承認済みまたは取消済み）です' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'この経路ではrevoked（取消）以外への変更はできません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_invites_before_update ON family_invites;
CREATE TRIGGER trg_family_invites_before_update
  BEFORE UPDATE ON family_invites
  FOR EACH ROW EXECUTE FUNCTION public.family_invites_before_update();

-- ------------------------------------------------------------
-- 25b. family_invite_lookup(p_token) — 未参加ユーザー向けプレビューRPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.family_invite_lookup(p_token TEXT)
RETURNS TABLE (family_name TEXT, role TEXT, status TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT f.name, fi.role, fi.status, fi.expires_at
  FROM family_invites fi
  JOIN families f ON f.id = fi.family_id
  WHERE fi.token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.family_invite_lookup(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 25c. accept_family_invite(p_token, p_display_name) — 招待の承認・参加確定
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_family_invite(p_token TEXT, p_display_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite family_invites%ROWTYPE;
  v_caller_email TEXT;
  v_member_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM family_members WHERE auth_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'このアカウントはすでにいずれかの家族に所属しています' USING ERRCODE = 'unique_violation';
  END IF;

  SELECT * INTO v_invite FROM family_invites WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION '招待が見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_invite.status <> 'pending' THEN
    RAISE EXCEPTION 'この招待はすでに確定（承認済みまたは取消済み）です' USING ERRCODE = 'check_violation';
  END IF;

  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'この招待は有効期限が切れています' USING ERRCODE = 'check_violation';
  END IF;

  v_caller_email := lower(COALESCE(auth.jwt() ->> 'email', ''));
  IF v_caller_email = '' OR v_caller_email <> v_invite.invited_email THEN
    RAISE EXCEPTION 'この招待は別のメールアドレス宛てです' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO family_members (family_id, display_name, role, auth_user_id, is_owner)
  VALUES (v_invite.family_id, p_display_name, v_invite.role, auth.uid(), false)
  RETURNING id INTO v_member_id;

  UPDATE family_invites
  SET status = 'accepted', accepted_by = v_member_id, accepted_at = now()
  WHERE id = v_invite.id;

  RETURN v_invite.family_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_family_invite(TEXT, TEXT) TO authenticated;

-- ============================================================
-- 26. 確認メモ: member_points View / chore_daily_flags は変更不要
-- （設計部/成果物/スキーマ設計.sql 26章のとおり。既存のView定義・テーブル定義に
-- 対する変更は本ファイルには含まれていない）
-- ============================================================
