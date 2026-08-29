-- ============================================================
-- クエスト・ごほうびの登録者と最終編集者の記録
-- ============================================================
-- 要件定義書.md 07-15章、設計部/成果物/スキーマ設計.sql 37章に対応する。
--
-- [依存関係順に書く理由・開発部CLAUDE.md/本部長指示] スキーマ設計.sql 37章は
-- 読み物として「37.1現状整理→37.2判断1→...→37.7 DDL本体」の順に構成されているが、
-- 本マイグレーションは37.7 DDL本体のみを、それ自体が持つ依存関係順（ALTER TABLEで
-- updated_by列を追加 → その列を参照するCREATE OR REPLACE FUNCTIONを実行 → GRANT）で
-- そのまま適用する。37.7内の記述順は既にこの依存関係順になっているため、
-- 章番号の並べ替えは発生しない（実装メモ.md 80.2章の教訓＝関数が先でテーブルが
-- 後だと本番適用が失敗する、を踏まえて依存関係を確認済み）。
--
-- [CREATE OR REPLACE FUNCTIONの引数名について] chores_before_write()/
-- rewards_before_write()はいずれも引数を取らないトリガー関数（TG_OP/NEW/OLDを
-- 暗黙に受け取るのみ）のため、開発部CLAUDE.mdが警告する「引数名を変更すると
-- SQLSTATE 42P13で失敗する」問題は発生しない。
--
-- [オーバーロードの有無] `chores_before_write`/`rewards_before_write`という名前の
-- 関数は本番に1つずつしか存在しない（いずれも引数なしのトリガー関数であり、
-- 20260822153000_supporter_role.sqlで最後に置き換えられたのがこの2つのみ）。
-- 34.3章のEXECUTE権限も、剥がす変更は一切行わない（GRANTを1本追加するのみ）。

-- ------------------------------------------------------------
-- 1. 列追加（chores.updated_by / rewards.updated_by）
-- ------------------------------------------------------------
ALTER TABLE chores
  ADD COLUMN IF NOT EXISTS updated_by UUID NULL REFERENCES family_members(id) ON DELETE SET NULL;

ALTER TABLE rewards
  ADD COLUMN IF NOT EXISTS updated_by UUID NULL REFERENCES family_members(id) ON DELETE SET NULL;

-- [設計判断・スキーマ設計.sql 37.4章] NOT NULL・CHECK制約はいずれも追加しない。
-- 既存行は登録者不明のままでよい（要件定義書07-15章3章「既存行は遡って埋めない」）。
-- [設計判断・スキーマ設計.sql 6167行目付近] updated_byにインデックスは作らない
-- （WHERE句の絞り込み条件として使う想定が無いため）。

-- ------------------------------------------------------------
-- 2. chores_before_write() の置き換え
-- ------------------------------------------------------------
-- 既存ロジック（scope不変チェック・assigned_to/category_idの家族一致チェック・
-- is_repeatableのdaily_limitデフォルト補完）はすべてそのまま残す。追加するのは
-- (a) created_byをscope='family'のINSERTでも常にサーバー側で強制し、UPDATE時は
--     作成時点の値に固定する（37.2章）
-- (b) 07-15章2章が定める「編集可能な属性」のいずれかが変化したUPDATEのときのみ
--     updated_byを記録する許可リスト方式（37.3章。is_active単独の変更では発火しない）
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

  -- [37章・変更] created_byの補完ロジックを、scope='family'のINSERTでも
  -- 常にサーバー側で強制する形へ変更する（37.2章）。UPDATE時はscopeを問わず
  -- 作成時点の値に固定する（created_byは作成後不変）。
  IF NEW.scope = 'personal' THEN
    NEW.created_by := current_family_member_id();
    NEW.assigned_to := NEW.created_by;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.created_by := current_family_member_id();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
  END IF;

  -- [37章・新設] updated_byの記録（37.3章）。許可リスト方式。
  -- is_active（論理削除→現在は完全削除に統一済みだが列自体は残置）のみの変更や、
  -- 上記created_by強制によるNEW.assigned_to := NEW.created_by（scope='personal'で
  -- 値が変化しない代入）では発火しない。
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
-- 3. rewards_before_write() の置き換え
-- ------------------------------------------------------------
-- 既存ロジック（scope不変チェック）はそのまま残す。chores側と対称的にcreated_by・
-- updated_byのロジックを追加する（rewardsのemoji列の変更もupdated_byの対象に含める。
-- 37.3章「rewardsのemoji列の扱い」参照）。
CREATE OR REPLACE FUNCTION public.rewards_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.scope IS DISTINCT FROM OLD.scope THEN
    RAISE EXCEPTION '公開範囲（scope）は作成後に変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [37章・変更] chores（上記）と対称的に、created_byをscopeを問わず常に
  -- サーバー側で強制する（37.2章）。
  IF NEW.scope = 'personal' OR TG_OP = 'INSERT' THEN
    NEW.created_by := current_family_member_id();
  ELSE
    -- TG_OP = 'UPDATE' AND NEW.scope = 'family'
    NEW.created_by := OLD.created_by;
  END IF;

  -- [37章・新設] updated_byの記録（37.3章）。
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
-- トリガー本体（trg_rewards_before_write）は20260822153000_supporter_role.sqlで
-- 作成済みのため再作成不要。

-- ------------------------------------------------------------
-- 4. 防御的なGRANT（開発部CLAUDE.md D. / スキーマ設計.sql 37.6章）
-- ------------------------------------------------------------
-- current_family_member_id()は0章（初回マイグレーション）で定義済みの既存関数で
-- あり、本マイグレーションでは一切変更しない。この関数は19章導入時点から既に
-- 非SECURITY DEFINERのトリガー関数（chores_before_write/rewards_before_write）内
-- から呼ばれ本番で動作実績があるため、EXECUTE権限が不足して失敗する事故は
-- 原理的に起こらない。念のため、将来の誤ったREVOKE事故を防ぐ防御線として
-- 現状のACLに対して冪等なGRANTを明示しておく（権限は変化しない想定）。
-- REVOKEは一切行わない（開発部CLAUDE.md「D. 権限を安易に絞らない」）。
GRANT EXECUTE ON FUNCTION public.current_family_member_id() TO authenticated;
