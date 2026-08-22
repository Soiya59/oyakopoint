-- ============================================================
-- 20260823023227_fix_inactive_member_rejoin.sql の続き。
--
-- RPCのガード（auth_user_id = auth.uid() AND is_active）を直しただけでは
-- 不十分だった。uq_family_members_auth_user_id（WHERE auth_user_id IS NOT NULL
-- のみ）はis_activeを見ておらず、退会済みの行が既に同じauth_user_idを
-- 使っているため、ガードを通過した後のINSERT自体が
-- 「duplicate key value violates unique constraint」で失敗することを、
-- ロールバック付きのトランザクションで検証して発見した（先の
-- 20260823023227マイグレーションを適用済み・db push対象外のため、
-- 追加のマイグレーションファイルとして切り出す）。
--
-- is_activeな行のみを対象にした部分ユニークインデックスに置き換える
-- （退会済みの古い行はそのまま残しつつ、同じauth_user_idで新しい行を
-- 1件だけ持てるようにする）。
-- ============================================================
DROP INDEX IF EXISTS uq_family_members_auth_user_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_family_members_auth_user_id
  ON family_members(auth_user_id) WHERE auth_user_id IS NOT NULL AND is_active;
