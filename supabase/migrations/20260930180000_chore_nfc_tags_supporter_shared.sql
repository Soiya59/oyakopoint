-- ============================================================
-- chore_nfc_tags のRLSを supporter_shared に対応させる
-- （やること.md 4-10、本部長依頼・部門の手順・統括承認済み、2026-09-26）
-- ============================================================
-- 参照:
--   設計部/成果物/スキーマ設計.sql 78章（78.1〜78.11。DDLは78.3〜78.5章から
--     一字一句そのまま写している。78.11節に統括の回答を記録済み）
--   設計部/成果物/API仕様.md 3a-2章（2026-09-26追記）
--   開発部/成果物/実装メモ.md 307章（本マイグレーション対応章）
--
-- [背景] chore_nfc_tagsのRLS（39.4章、2026-09-01新設時点）は
-- chores.scope IN ('family','personal')のみを想定しており、同月2026-09-06に
-- 45章で新設されたscope='supporter_shared'（みまもり共通）には対応して
-- いなかった（45.17章(2)「本タスクの依頼範囲外」として申し送り済み）。この
-- ため、みまもり共通クエストへのNFCタグ発行は常にRLS違反（0件INSERT）で
-- 失敗しており、app/supporter/chore-edit.tsxはこれを隠すためNFC管理ブロック
-- 自体をscope='personal'の行にしか表示していなかった。本migrationはこの
-- 未対応を解消する。
--
-- [設計判断の要約・78.2章] 発行(INSERT)・解除(UPDATE)できる人は、対象
-- クエストの作成者本人（みまもりメンバー）のみに限定する（45.6章
-- chores_write_supporter_shared_by_creatorの「chore自体の管理は作成者1人に
-- 絞る」という信頼境界〈決定3〉と揃える）。一方、タグの持ち主（member_id）は
-- 作成者本人に固定せず、同じ家族のrole='supporter'のメンバーなら誰でも
-- 指定できる（45.1章決定2「実施は作成者を問わずみまもりメンバー全員」の
-- 趣旨、要件定義書07-18章「じいじとばあばがそれぞれ自分の実績として記録
-- したい」という要望原文を満たすため）。統括の回答（78.11節、2026-09-26
-- 「おすすめで！」）でこの管理モデルを確定した。
--
-- 破壊性: 非破壊的。新規RLSポリシー2本（chore_nfc_tags_insert_supporter_
-- shared_by_creator・chore_nfc_tags_revoke_supporter_shared_by_creator）の
-- 追加と、既存トリガー関数chore_nfc_tags_before_write()へのsupporter_shared
-- 分岐の追加（CREATE OR REPLACE、既存のpersonal分岐・上限枚数チェック・
-- UPDATE分岐・family一致チェックは無変更のまま残す）のみ。既存テーブル・
-- 既存データには一切触れない。
--
-- 本部長の確認（2026-09-26、本番を読み取りで確認済み・78.11節確認事項3）:
-- chore_nfc_tagsは本番25行で、すべてscope='family'のクエストのもの。
-- supporter_shared・personalの行は0件のため、既存行への遡及的な影響は無い。
--
-- 権限影響: RLS照査スイート（oyakopoint-app/supabase/tests/rls_checks.sql）
-- のS3（ポリシーの一覧と中身の照合）の期待値が76本→78本になる（新規
-- ポリシー2本を追加するため）。S1（RLS有効テーブル数）・S4（authenticatedが
-- 実行できる関数の件数）はいずれも±0（chore_nfc_tags_before_writeは
-- 既存の名前・シグネチャのままCREATE OR REPLACEするのみで、新規テーブル・
-- 新規関数の追加は無い。78.7章の見積りどおり）。適用後、実装メモ.md 307章の
-- 手順に従いS1/S3/S4を実測し、FAILが本ファイルの意図した変更によるもので
-- あることを確認したうえでスナップショットを更新すること（96章の運用手順）。
--
-- [重要] 本マイグレーションはまだ本番に適用していない（作成のみ）。
-- 適用は本部長の操作を待つ（開発部/成果物/実装メモ.md 307章参照）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. RLS新設: chore_nfc_tags_insert_supporter_shared_by_creator
--    （スキーマ設計.sql 78.3章から一字一句そのまま）
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chore_nfc_tags_insert_supporter_shared_by_creator" ON chore_nfc_tags;
CREATE POLICY "chore_nfc_tags_insert_supporter_shared_by_creator" ON chore_nfc_tags
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND current_family_role() = 'supporter'
    AND EXISTS (
      SELECT 1 FROM chores c
      WHERE c.id = chore_nfc_tags.chore_id AND c.scope = 'supporter_shared' AND c.created_by = current_family_member_id()
    )
  );

-- ------------------------------------------------------------
-- 2. RLS新設: chore_nfc_tags_revoke_supporter_shared_by_creator
--    （スキーマ設計.sql 78.4章から一字一句そのまま）
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chore_nfc_tags_revoke_supporter_shared_by_creator" ON chore_nfc_tags;
CREATE POLICY "chore_nfc_tags_revoke_supporter_shared_by_creator" ON chore_nfc_tags
  FOR UPDATE
  USING (
    family_id = current_family_id()
    AND current_family_role() = 'supporter'
    AND EXISTS (
      SELECT 1 FROM chores c
      WHERE c.id = chore_nfc_tags.chore_id AND c.scope = 'supporter_shared' AND c.created_by = current_family_member_id()
    )
  )
  WITH CHECK (
    family_id = current_family_id()
    AND current_family_role() = 'supporter'
    AND EXISTS (
      SELECT 1 FROM chores c
      WHERE c.id = chore_nfc_tags.chore_id AND c.scope = 'supporter_shared' AND c.created_by = current_family_member_id()
    )
  );
-- SELECT・DELETEは変更不要（78.4章の確認のとおり）。
-- chore_nfc_tags_select_same_family（39.4章、family_id = current_family_id()
-- のみ）はsupporter_sharedのタグも既に家族全員へ公開しており無変更でよい。
-- DELETEポリシーは39.4章のとおり定義しない（物理削除の経路を持たない設計を
-- 継続、default-denyで常に拒否）。

-- ------------------------------------------------------------
-- 3. chore_nfc_tags_before_write() 改訂（supporter_shared分岐追加）
--    （スキーマ設計.sql 78.5章から一字一句そのまま。personal分岐・上限枚数
--    チェック・UPDATE〈解除〉分岐・family一致チェックは無変更）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chore_nfc_tags_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_chore_family_id UUID;
  v_chore_scope TEXT;
  v_chore_created_by UUID;
  v_chore_is_active BOOLEAN;
  v_member_family_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- [39.3章から無変更] 「解除」（revoked_atをNULLから非NULLへ変える）
    -- 以外のUPDATEを一切禁止する。
    IF NEW.family_id IS DISTINCT FROM OLD.family_id
       OR NEW.chore_id IS DISTINCT FROM OLD.chore_id
       OR NEW.member_id IS DISTINCT FROM OLD.member_id
       OR NEW.tag_value IS DISTINCT FROM OLD.tag_value
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'タグの発行内容（クエスト・持ち主・タグ値）は変更できません。解除してから新しく発行し直してください' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'このタグはすでに解除されています' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.revoked_at IS NULL THEN
      RAISE EXCEPTION '解除操作（revoked_atの設定）以外のUPDATEはできません' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.revoked_at := now();
    RETURN NEW;
  END IF;

  -- ここから TG_OP = 'INSERT'（39.3章から無変更）
  SELECT family_id, scope, created_by, is_active
    INTO v_chore_family_id, v_chore_scope, v_chore_created_by, v_chore_is_active
  FROM chores
  WHERE id = NEW.chore_id;

  IF NOT FOUND OR NOT v_chore_is_active THEN
    RAISE EXCEPTION '指定されたクエストが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT family_id INTO v_member_family_id FROM family_members fm WHERE fm.id = NEW.member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '指定されたメンバーが存在しません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_chore_family_id <> v_member_family_id THEN
    RAISE EXCEPTION 'クエストとメンバーが同じ家族に属していません' USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.family_id := v_chore_family_id;

  -- [39.3章から無変更] 自分専用クエスト（scope='personal'）の持ち主は
  -- 常に作成者本人のみ。
  IF v_chore_scope = 'personal' AND NEW.member_id <> v_chore_created_by THEN
    RAISE EXCEPTION '自分専用クエストのタグは作成者本人の分のみ発行できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [78.5章・新設] みまもり共通クエストの持ち主は、作成者を問わず
  -- role='supporter'のメンバーなら誰でもよい（78.2章の結論）。発行できる人
  -- 自体は上記1.のRLSが「作成者本人のみ」に絞っているため、ここでは持ち主が
  -- 「みまもりメンバーであること」だけを検証する（45.7章
  -- chore_completions_before_insert()のv_scope = 'supporter_shared'分岐と
  -- 同じ形の多層防御。RLS側のcurrent_family_role()を信頼しきらない設計）。
  IF v_chore_scope = 'supporter_shared' THEN
    IF NOT EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = NEW.member_id AND fm.family_id = v_chore_family_id AND fm.role = 'supporter'
    ) THEN
      RAISE EXCEPTION 'みまもり共通のクエストのタグは、みまもりメンバーの分のみ発行できます' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- [39.3章から無変更] 1人×1クエストにつき最大5枚。
  IF (
    SELECT count(*) FROM chore_nfc_tags
    WHERE chore_id = NEW.chore_id AND member_id = NEW.member_id AND revoked_at IS NULL
  ) >= public.max_nfc_tags_per_chore_member() THEN
    RAISE EXCEPTION 'このクエスト・このメンバーにはすでにタグが上限枚数（%枚）発行されています', public.max_nfc_tags_per_chore_member()
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.revoked_at := NULL;
  RETURN NEW;
END;
$$;
-- トリガー本体（trg_chore_nfc_tags_before_write）は39.3章で作成済みのため
-- 再作成不要（CREATE OR REPLACE FUNCTIONのみで動作が更新される）。
