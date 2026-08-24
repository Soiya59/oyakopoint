-- 開発部/成果物/実装メモ.md 67章、設計部/成果物/スキーマ設計.sql 32章。
--
-- 背景: current_family_id()/current_family_member_id()/current_family_role()は
-- JWTのカスタムクレーム（family_id/family_member_id/app_role）が存在する場合、
-- それを無条件に信用していた。子ども用JWTはこれらのクレームを常に含むため、
-- remove-member(soft_remove)でis_active=falseにしても、退会前に発行された
-- 子どものJWTが有効期限内であれば、is_activeチェックを一切経由せずに
-- 従来どおり家族の全データへアクセスできてしまっていた（本部長の粗探しで発見）。
--
-- 修正方針: family_member_idクレームが存在する場合も、そのidのfamily_members行を
-- 都度引き、is_active=trueであることを確認してから値を返すようにする（単純な
-- 主キー検索なので負荷増は軽微）。is_active=falseなら NULL を返し、以降の
-- RLSはすべて「家族に属さない」ものとして扱われ、即座にアクセス不能になる。

CREATE OR REPLACE FUNCTION public.current_family_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id_claim text;
BEGIN
  v_member_id_claim := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'family_member_id';
  IF v_member_id_claim IS NOT NULL THEN
    RETURN (SELECT fm.family_id FROM family_members fm WHERE fm.id = v_member_id_claim::uuid AND fm.is_active);
  END IF;
  RETURN COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'family_id',
    (SELECT fm.family_id::text FROM family_members fm WHERE fm.auth_user_id = auth.uid() AND fm.is_active)
  )::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_family_member_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id_claim text;
BEGIN
  v_member_id_claim := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'family_member_id';
  IF v_member_id_claim IS NOT NULL THEN
    RETURN (SELECT fm.id FROM family_members fm WHERE fm.id = v_member_id_claim::uuid AND fm.is_active);
  END IF;
  RETURN COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'family_member_id',
    (SELECT fm.id::text FROM family_members fm WHERE fm.auth_user_id = auth.uid() AND fm.is_active)
  )::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_family_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id_claim text;
BEGIN
  v_member_id_claim := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'family_member_id';
  IF v_member_id_claim IS NOT NULL THEN
    RETURN (SELECT fm.role FROM family_members fm WHERE fm.id = v_member_id_claim::uuid AND fm.is_active);
  END IF;
  RETURN COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'app_role',
    (SELECT fm.role FROM family_members fm WHERE fm.auth_user_id = auth.uid() AND fm.is_active)
  );
END;
$$;

COMMENT ON FUNCTION public.current_family_id() IS
  'RLS判定の中核。family_member_idクレームが有るときも都度is_activeを確認するため、退会(soft_remove)は既発行トークンにも即座に反映される。';
COMMENT ON FUNCTION public.current_family_member_id() IS
  'RLS判定の中核。family_member_idクレームが有るときも都度is_activeを確認するため、退会(soft_remove)は既発行トークンにも即座に反映される。';
COMMENT ON FUNCTION public.current_family_role() IS
  'RLS判定の中核。family_member_idクレームが有るときも都度is_activeを確認し、DB上の最新roleを返す（app_roleクレームは無視する）。';
