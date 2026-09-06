-- ============================================================
-- みまもりメンバー同士でのクエスト共同実施・ごほうび共同交換
-- （chores/rewards.scope に `supporter_shared` 新設）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-18章（決定1・決定1b・決定2・決定3・決定4'・
--     決定6'・決定6'-1〜6'-4・決定7）
--   設計部/成果物/スキーマ設計.sql 45章（45.1〜45.17。本部長採点100点）
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 30章
--   設計部/成果物/API仕様.md 3b-2・4c-2・7b-2節
--   開発部/成果物/実装メモ.md 133章（本マイグレーション対応章）
--
-- [概要] `chores.scope`・`rewards.scope`に第3の値`supporter_shared`（みまもり共通）を
-- 新設する。新規登録は常に`supporter_shared`になり、作成者を問わず家族内の
-- みまもりメンバー全員が実施（完了報告）・交換できる。編集・削除は作成者本人のみ。
-- 閲覧・リアクションは家族全員（既存の`personal`公開路線をそのまま踏襲、変更不要）。
-- 子ども・保護者は実施・交換の対象外。既存の`scope='personal'`行の規則
-- （作成者本人のみ実施・編集できる）は一切変更しない。
--
-- [重要・スキーマ設計45.12章] `cancel_chore_completion()`の権限判定を同時に修正する。
-- 43章で新設した当初の判定は「personalなら本人のみ、それ以外はすべて本人または
-- 保護者」という2分岐しか無く、`supporter_shared`を単にCHECK制約へ追加しただけでは
-- 自動的に「それ以外」に分類され、**保護者がみまもりメンバーの完了報告を
-- 取り消せてしまう**回帰バグになる。CHECK制約の改訂と本関数の改訂は
-- 同一マイグレーション（同一デプロイ）に含める（分割適用すると、両者の適用の間に
-- 回帰バグが有効な期間が生じるため）。
--
-- 破壊性の評価（非破壊的と判断した理由）:
--   - CHECK制約の改訂（DROP → ADD）は許容値を1つ追加するだけで、既存の
--     'family'/'personal'行はいずれも新しい制約を満たし続ける
--   - `chk_chores_personal_self_assigned`の対象を`personal`のみに絞る変更は、
--     既存の`personal`行の挙動（assigned_to = created_byを要求）を変えない。
--     `family`行はそもそも対象外だったため変更なし。新設される`supporter_shared`
--     行のみ、この制約の対象外になる（トリガーが常にassigned_to=NULLへ強制するため
--     矛盾は生じない）
--   - トリガー関数（chores_before_write/rewards_before_write/
--     chore_completions_before_insert/reward_redemptions_before_insert/
--     cancel_chore_completion）はいずれもCREATE OR REPLACEによる本体差し替えのみ。
--     シグネチャ（引数・戻り値の型）は不変のため、開発部CLAUDE.md・実装メモ83.2章・
--     40.7章・111章・118章が警告する「引数を増やすと別関数が増える」オーバーロード
--     問題には該当しない（DROP FUNCTIONは不要）
--   - 新規ポリシー2本（chores_write_supporter_shared_by_creator・
--     rewards_write_supporter_shared_by_creator）はいずれも`scope = 'supporter_shared'`
--     条件を持ち、既存行（family/personal）にはマッチしない
--   - `chore_completions_insert_self`・`reward_redemptions_insert_scoped`は
--     既存のfamily/personal分岐をそのまま残し、supporter_shared分岐をORで追加する
--     のみ。既存分岐の条件式は1文字も変更していない
--   - `chores_select_scoped`・`chore_completions_select_scoped`・
--     `rewards_select_scoped`・`chore_reactions_insert_scoped`・`member_points`・
--     `chore_daily_flags`・`chores_write_family_by_parent`・
--     `chores_write_personal_by_creator`・`rewards_write_family_by_parent`・
--     `rewards_write_personal_by_creator`はいずれも変更しない
--     （スキーマ設計.sql 45.10章の確認のとおり。本ファイルでは一切触れない）
--
-- [重要] 本マイグレーションはまだ本番に適用していない（作成・ローカル検証のみ）。
-- 適用は本部長の操作を待つ。既存の scope='personal' 行の一括移行（決定4'・
-- 決定6'-3、スキーマ設計.sql 45.13章）は本ファイルには含めない（別途、本部長の
-- 判断で1回限りの手動運用として実施する）。
-- ============================================================

-- ------------------------------------------------------------
-- 45.2 chores.scope / rewards.scope CHECK制約の改訂
-- ------------------------------------------------------------
ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_scope;
ALTER TABLE chores ADD CONSTRAINT chk_chores_scope
  CHECK (scope IN ('family', 'personal', 'supporter_shared'));

ALTER TABLE rewards DROP CONSTRAINT IF EXISTS chk_rewards_scope;
ALTER TABLE rewards ADD CONSTRAINT chk_rewards_scope
  CHECK (scope IN ('family', 'personal', 'supporter_shared'));

-- [変更不要の確認] chk_chores_personal_has_creator（scope = 'family' OR
-- created_by IS NOT NULL）・chk_rewards_personal_has_creator（同型）は
-- supporter_sharedにもそのまま「created_by必須」として効くため変更しない。

-- ------------------------------------------------------------
-- 45.3 chores — chk_chores_personal_self_assignedの改訂
-- ------------------------------------------------------------
-- [設計判断] supporter_sharedのassigned_toは常にNULLへ強制する（45.4章の
-- トリガー）。「みまもりメンバー全員が実施できる」という要件は、assigned_toという
-- 「1列=1人分の値しか持てない」列では表現できないため、実施可否の判定は
-- role='supporter'という別の条件（45.7章のRLS・トリガー）だけで行う。
-- 既存のchk_chores_personal_self_assigned（scope = 'family' OR
-- assigned_to = created_by）はこのままではsupporter_sharedにも
-- 「assigned_to = created_by」を要求しNULL強制と衝突するため、対象をpersonalのみに
-- 絞る。personal行の挙動は一切変わらない。
ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_personal_self_assigned;
ALTER TABLE chores ADD CONSTRAINT chk_chores_personal_self_assigned
  CHECK (scope <> 'personal' OR assigned_to = created_by);

-- ------------------------------------------------------------
-- 45.4 chores_before_write() 改訂
-- ------------------------------------------------------------
-- [ベース] 20260830010000_chore_reward_created_by_updated_by.sqlの版
-- （created_by/updated_byの記録ロジックを含む最新版）に、personal分岐と対称な
-- supporter_shared分岐を追加する。既存のfamily/personal分岐・
-- category_id/assigned_toの家族一致チェック・daily_limitのデフォルト補完・
-- updated_byの記録（37章）はすべて無変更のまま残す。
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
  ELSIF NEW.scope = 'supporter_shared' THEN
    -- [45.3章] 実施者を単一人に固定する概念を持たないため常にNULLへ強制する。
    NEW.assigned_to := NULL;
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := current_family_member_id();
    ELSE
      NEW.created_by := OLD.created_by;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.created_by := current_family_member_id();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
  END IF;

  -- [37章・変更なし] updated_byの記録（許可リスト方式）。
  IF TG_OP = 'UPDATE' AND (
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.emoji IS DISTINCT FROM OLD.emoji OR
    NEW.points IS DISTINCT FROM OLD.points OR
    NEW.category_id IS DISTINCT FROM OLD.category_id OR
    NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR
    NEW.is_repeatable IS DISTINCT FROM OLD.is_repeatable OR
    NEW.daily_limit IS DISTINCT FROM OLD.daily_limit OR
    NEW.nfc_tag_id IS DISTINCT FROM OLD.nfc_tag_id
  ) THEN
    NEW.updated_by := current_family_member_id();
  END IF;

  IF TG_OP = 'INSERT' AND NEW.is_repeatable AND NEW.daily_limit IS NULL THEN
    NEW.daily_limit := 1;
  END IF;
  RETURN NEW;
END;
$$;
-- トリガー本体（trg_chores_before_write）は初回マイグレーションで作成済みのため
-- 再作成不要（CREATE OR REPLACE FUNCTIONのみで動作が更新される）。

-- ------------------------------------------------------------
-- 45.5 rewards_before_write() 改訂
-- ------------------------------------------------------------
-- [ベース] 20260830010000の版。created_byを強制する条件にsupporter_sharedを
-- 追加する（rewardsにはassigned_toが無いためchoresより変更点は少ない）。
CREATE OR REPLACE FUNCTION public.rewards_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.scope IS DISTINCT FROM OLD.scope THEN
    RAISE EXCEPTION '公開範囲（scope）は作成後に変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [45.5章・変更] 対象をpersonal単独からpersonal/supporter_sharedへ拡張。
  IF NEW.scope IN ('personal', 'supporter_shared') OR TG_OP = 'INSERT' THEN
    NEW.created_by := current_family_member_id();
  ELSE
    -- TG_OP = 'UPDATE' AND NEW.scope = 'family'
    NEW.created_by := OLD.created_by;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.name IS DISTINCT FROM OLD.name OR
    NEW.emoji IS DISTINCT FROM OLD.emoji OR
    NEW.cost IS DISTINCT FROM OLD.cost OR
    NEW.description IS DISTINCT FROM OLD.description
  ) THEN
    NEW.updated_by := current_family_member_id();
  END IF;

  RETURN NEW;
END;
$$;
-- トリガー本体（trg_rewards_before_write）は既存のものを再利用（再作成不要）。

-- ------------------------------------------------------------
-- 45.6 RLS新設: chores_write_supporter_shared_by_creator
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chores_write_supporter_shared_by_creator" ON chores;
CREATE POLICY "chores_write_supporter_shared_by_creator" ON chores
  FOR ALL
  USING (
    family_id = current_family_id()
    AND scope = 'supporter_shared'
    AND current_family_role() = 'supporter'
    AND created_by = current_family_member_id()
  )
  WITH CHECK (
    family_id = current_family_id()
    AND scope = 'supporter_shared'
    AND current_family_role() = 'supporter'
    AND created_by = current_family_member_id()
  );

-- ------------------------------------------------------------
-- 45.7 RLS改訂: chore_completions_insert_self・chore_completions_before_insert()
-- ------------------------------------------------------------
-- [変更] chore_completions_insert_selfにsupporter_shared用の分岐を追加する。
-- 既存のfamily分岐・personal分岐はいずれも無変更。
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
          -- [45.7章・新設] 作成者を問わず、role='supporter'なら誰でも報告できる
          -- （決定2）。トップレベルのreported_by = current_family_member_id()と
          -- 組み合わさるため、代理報告（他人になりすます）は成立しない。
          OR (c.scope = 'supporter_shared' AND current_family_role() = 'supporter')
        )
    )
  );

-- [ベース] 20260823060000の版に、2026-08-29の呼称変更（お手伝い→クエスト、
-- 20260829120000_rename_chore_to_quest_in_messages.sql）で置き換わった現行の
-- 日本語文言をそのまま踏襲し（開発部CLAUDE.md/CLAUDE.md全社共通ルール
-- 「実装済みの仕様は実装が正」）、supporter_shared分岐を追加する。
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

  IF v_scope = 'personal' AND NEW.reported_by <> v_created_by THEN
    RAISE EXCEPTION '自分専用のクエストは作成者本人のみ完了報告できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [45.7章・新設] みまもり共通は作成者を問わないが、実施できるのは
  -- role='supporter'のメンバーに限る（決定2）。RLS（上記
  -- chore_completions_insert_self）の多層防御として、対象の身元
  -- （NEW.reported_by）を独立に検証する。
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
-- [挙動確認・決定7] 一度きり（is_repeatable=false）のsupporter_sharedクエストは、
-- 誰か1人のみまもりメンバーが完了報告すると、他のみまもりメンバーはもう
-- 報告できなくなる（WHERE chore_id = NEW.chore_idにreported_by条件が無いため、
-- 家族共有choreと全く同じ「早い者勝ち」の挙動。統括判断・企画部要件定義書07-18章
-- 決定7で確定済み）。

-- ------------------------------------------------------------
-- 45.8 RLS新設: rewards_write_supporter_shared_by_creator
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "rewards_write_supporter_shared_by_creator" ON rewards;
CREATE POLICY "rewards_write_supporter_shared_by_creator" ON rewards
  FOR ALL
  USING (
    family_id = current_family_id()
    AND scope = 'supporter_shared'
    AND current_family_role() = 'supporter'
    AND created_by = current_family_member_id()
  )
  WITH CHECK (
    family_id = current_family_id()
    AND scope = 'supporter_shared'
    AND current_family_role() = 'supporter'
    AND created_by = current_family_member_id()
  );

-- ------------------------------------------------------------
-- 45.9 RLS改訂: reward_redemptions_insert_scoped・reward_redemptions_before_insert()
-- ------------------------------------------------------------
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
          -- [45.9章・新設] 作成者を問わず、role='supporter'本人の交換のみ許可する
          -- （決定6'-2）。member_id = current_family_member_id()により、family分岐と
          -- 異なりis_current_user_parent()による代理は一切含まれない（45.11章）。
          OR (
            r.scope = 'supporter_shared'
            AND member_id = current_family_member_id()
            AND current_family_role() = 'supporter'
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

  -- [45.9章・新設] みまもり共通は作成者を問わないが、交換できるのは
  -- role='supporter'の本人に限る（決定6'-2）。
  IF v_scope = 'supporter_shared' THEN
    IF NOT EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = NEW.member_id AND fm.family_id = v_family_id AND fm.role = 'supporter'
    ) THEN
      RAISE EXCEPTION 'みまもり共通のごほうびは、みまもりメンバーのみ交換できます' USING ERRCODE = 'insufficient_privilege';
    END IF;
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

-- ------------------------------------------------------------
-- 45.12 cancel_chore_completion() の改訂【重要・回帰バグ修正】
-- ------------------------------------------------------------
-- [ベース] 20260903010000_cancel_chore_completion.sqlの版。権限判定
-- （2.の分岐）のみを、personal/supporter_sharedをまとめて「本人のみ」に
-- 統一する形へ改訂する。それ以外のロジック（時間窓・ガチャ判定・木への
-- 飾り付け判定・残高判定・シーズン/ガチャ進捗の巻き戻し・削除）は無変更。
CREATE OR REPLACE FUNCTION public.cancel_chore_completion(p_completion_id UUID)
RETURNS TABLE (
  completion_id UUID,
  chore_id UUID,
  chore_title TEXT,
  reported_by UUID,
  points INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_family_id UUID := current_family_id();
  v_caller_member_id UUID := current_family_member_id();
  v_completion RECORD;
  v_scope TEXT;
  v_month_start DATE;
  v_season_id UUID;
  v_progress RECORD;
  v_new_lifetime INT;
  v_balance INT;
BEGIN
  IF v_caller_family_id IS NULL OR v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT cc.*, COALESCE(c.scope, 'family') AS chore_scope
    INTO v_completion
  FROM chore_completions cc
  LEFT JOIN chores c ON c.id = cc.chore_id
  WHERE cc.id = p_completion_id
    AND cc.family_id = v_caller_family_id
  FOR UPDATE OF cc;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の完了報告が見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  v_scope := v_completion.chore_scope;

  -- [45.12章・改訂] personal と supporter_shared をまとめて「本人のみ」に
  -- 統一する。family のみが「本人または保護者」に残る。
  -- [発見した回帰バグ] 改訂前は`IF v_scope = 'personal' THEN ... ELSE ...`の
  -- 2分岐しか無く、supporter_sharedはELSE（本人または保護者）に落ちていた。
  -- これを放置すると、保護者がみまもりメンバーの完了報告を取り消せてしまう
  -- （要件定義書07-18章決定2・決定3、07-7章「みまもり運営には保護者は
  -- 一切関与しない」という一貫方針に反する）。
  IF v_scope IN ('personal', 'supporter_shared') THEN
    IF v_completion.reported_by <> v_caller_member_id THEN
      RAISE EXCEPTION 'この完了報告は本人のみ取り消せます' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF v_completion.reported_by <> v_caller_member_id AND NOT public.is_current_user_parent() THEN
      RAISE EXCEPTION 'この完了報告を取り消す権限がありません' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF now() - v_completion.reported_at > INTERVAL '1 minute' THEN
    RAISE EXCEPTION '報告から1分を過ぎているため取消できません' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM gacha_draws
    WHERE member_id = v_completion.reported_by
      AND drawn_at > v_completion.reported_at
  ) THEN
    RAISE EXCEPTION 'この報告のあとにガチャを引いているため取消できません' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM family_tree_decorations ftd WHERE ftd.completion_id = p_completion_id
  ) THEN
    RAISE EXCEPTION 'この完了報告はすでに木の色丸として景品と交換されているため取消できません' USING ERRCODE = 'check_violation';
  END IF;

  SELECT current_points INTO v_balance
  FROM member_points
  WHERE member_id = v_completion.reported_by;

  IF COALESCE(v_balance, 0) - v_completion.points < 0 THEN
    RAISE EXCEPTION '取消するとポイント残高がマイナスになるため取消できません' USING ERRCODE = 'check_violation';
  END IF;

  v_month_start := date_trunc('month', (v_completion.reported_at AT TIME ZONE 'Asia/Tokyo'))::date;

  UPDATE family_tree_seasons
  SET completion_count = GREATEST(completion_count - 1, 0),
      current_stage = public.family_tree_stage_for_count(GREATEST(completion_count - 1, 0)),
      updated_at = now()
  WHERE family_id = v_caller_family_id
    AND season_start = v_month_start
  RETURNING id INTO v_season_id;

  IF v_season_id IS NULL THEN
    RAISE EXCEPTION '内部エラー: 対象シーズンが見つかりません（family_id=%, season_start=%）', v_caller_family_id, v_month_start
      USING ERRCODE = 'internal_error';
  END IF;

  SELECT * INTO v_progress
  FROM gacha_member_progress
  WHERE member_id = v_completion.reported_by
  FOR UPDATE;

  IF FOUND THEN
    v_new_lifetime := GREATEST(v_progress.lifetime_completion_count - 1, 0);

    IF v_progress.draw_count * 5 > v_new_lifetime THEN
      RAISE EXCEPTION 'ガチャの抽選条件を満たさなくなるため取消できません' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE gacha_member_progress
    SET lifetime_completion_count = v_new_lifetime,
        updated_at = now()
    WHERE member_id = v_completion.reported_by;
  END IF;

  DELETE FROM chore_completions WHERE id = p_completion_id;

  RETURN QUERY SELECT
    v_completion.id, v_completion.chore_id, v_completion.chore_title,
    v_completion.reported_by, v_completion.points;
END;
$$;

COMMENT ON FUNCTION public.cancel_chore_completion(UUID) IS
  '要件定義書07-17章「完了報告の直後の取消」・07-18章決定2/決定3。報告から1分以内に限り、報告者本人（家族共有choreは保護者も。ただしみまもり共通chore=supporter_sharedは本人のみで保護者不可、45.12章）が完了報告を物理削除する。ガチャ未消費・木への飾り付け未消費・残高非マイナス化を確認したうえで、family_tree_seasons.completion_count/current_stage・gacha_member_progress.lifetime_completion_countを明示的に1つ戻す。chore_completionsへの新しいDELETEポリシーは追加せず、削除経路を本RPCに集約する。EXECUTE権限は43.7章から変更なし（シグネチャ不変のためCREATE OR REPLACEでも失われない）。';

-- [シグネチャ・権限への影響] 引数・戻り値の型はいずれも43章から不変
-- （CREATE OR REPLACEのみで足り、DROP FUNCTIONは不要）。
-- REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;
-- はCREATE OR REPLACEでは失われないため、本ファイルでの再GRANT/REVOKEは不要。
