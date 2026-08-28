-- 家族の書き込みボード: 論理削除をSECURITY DEFINERのRPC経由に変更する（修正）
--
-- [2026-08-29・本部長／軽微変更ルート]
--
-- ■ 何が壊れていたか
--   20260828090000 で作った構成では、**論理削除が原理的に成立しなかった**。
--   本人が5分以内に取り消そうとしても、保護者が是正削除しようとしても、
--   UPDATEが必ず次のエラーで拒否される:
--     ERROR: 42501: new row violates row-level security policy for table "family_board_posts"
--
--   原因はSELECTポリシーである。
--     family_board_posts_select_same_family:
--       USING (family_id = current_family_id() AND deleted_at IS NULL)
--   RLS有効時、UPDATEは「更新後の行」がポリシーを満たすことを要求する。論理削除は
--   `deleted_at`にNULL以外を入れる操作なので、更新後の行は上記SELECTポリシーを
--   満たさなくなり、WITH CHECK違反として弾かれる。
--   **「削除済みを隠すSELECTポリシー」と「クライアントからの直接UPDATEによる論理削除」は
--   両立しない。**
--
--   本番でトランザクション内からSELECTポリシーの`deleted_at IS NULL`だけを一時的に外して
--   同じUPDATEを実行したところ1行成功し（ROLLBACK済み）、原因はこれで確定した。
--
-- ■ 採った対処（案B。ユーザー判断）
--   削除を **SECURITY DEFINERのRPC** に移す。
--   - SELECTポリシーの`deleted_at IS NULL`はそのまま維持できる
--     → 削除済み投稿はクライアントから**完全に見えなくなる**。保護者の是正削除
--       （不適切な内容を家族の目から取り除く）の趣旨に沿う
--   - もう一方の案（SELECTポリシーから`deleted_at IS NULL`を外し、View・クエリ側でのみ
--     除外する）は単純だが、削除済み投稿がPostgRESTを直接叩けば読めてしまい、
--     是正削除の意味が薄れるため採らなかった
--
-- ■ 権限判定はどこが担保するか（変更なし）
--   35c章のBEFORE UPDATEトリガー family_board_posts_before_update() が、引き続き
--   唯一の判定点である。「本人は5分以内」「保護者は時間制限なし」「それ以外は拒否」
--   「削除以外の列変更は拒否」はすべてトリガー側に実装済みで、本マイグレーションでは
--   一切変更していない。
--
--   **SECURITY DEFINERでも判定は正しく働く。** `current_family_member_id()`・
--   `is_current_user_parent()`は`request.jwt.claims`というGUCを読むものであり、
--   GUCは実行ロールの切り替えに影響されないため、RPC内部でも「呼び出した人」を
--   正しく返す。SECURITY DEFINERが変えるのは**RLSを迂回できること**だけである。
--
-- ■ クライアントからの直接UPDATEは塞ぐ
--   RPCが唯一の削除経路になるため、UPDATEポリシーは削除する。残しておいても
--   上記の理由で必ず失敗するので、動かない経路を残さない。

-- 1) 直接UPDATEの経路を塞ぐ（このポリシーがあっても論理削除は成功しない）
DROP POLICY IF EXISTS "family_board_posts_update_soft_delete" ON family_board_posts;

-- 2) 削除RPC
CREATE OR REPLACE FUNCTION public.delete_family_board_post(p_post_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  -- 呼び出し元の家族。SECURITY DEFINERでもJWTクレームは呼び出し元のものが読める。
  v_family_id := public.current_family_id();
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION '家族を特定できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 家族の壁はここで担保する（SECURITY DEFINERによりRLSは効かないため、
  -- 他家族の投稿IDを渡されても対象にならないよう明示的に絞る）。
  -- 本人か保護者かの判定・5分の時間窓は、この UPDATE が発火させる
  -- 35c章のBEFORE UPDATEトリガーが行う（RAISE EXCEPTIONで拒否される）。
  -- deleted_at / deleted_by_member_id の実際の値もトリガーがサーバ側で確定するため、
  -- ここで渡す now() は「削除操作である」という合図にすぎない。
  UPDATE family_board_posts
     SET deleted_at = now()
   WHERE id = p_post_id
     AND family_id = v_family_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の投稿が見つからないか、すでに削除されています'
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.delete_family_board_post(UUID) IS
  '要件定義書07-14章「誰が消せるか」。家族の書き込みの論理削除（本人は投稿から5分以内／保護者は時間制限なし）。権限判定と値の確定は35c章のBEFORE UPDATEトリガーが行い、本関数はRLS（削除済みを隠すSELECTポリシー）を迂回して同じ行に到達するためだけのSECURITY DEFINERラッパーである。クライアントからの直接UPDATEは経路自体を塞いでいる。';

-- 3) 実行権限。34.3章の教訓のとおり、必要な権限は明示的に付ける。
GRANT EXECUTE ON FUNCTION public.delete_family_board_post(UUID) TO authenticated;
