-- ============================================================
-- RLS・権限の照査（B層＝家族内のロール境界／C層＝定義のスナップショット）
--
-- [2026-08-31作成・本部長]
--
-- [2026-09-01更新・開発部] 家族の書き込みボードへのリアクション（スタンプ）新設
-- （supabase/migrations/20260901160000_family_board_reactions.sql、開発部/成果物/
-- 実装メモ.md 103章）に伴い、S1（21→22）・S3（41→43本、family_board_reactionsの
-- SELECT/INSERT各1本を追加）・S4（43→44件、family_board_reactions_before_insertを
-- 追加）のスナップショットを更新した。上記マイグレーションは103章時点では**未適用**
-- （96.5章のとおりFAILを消すための更新ではなく、意図した変更を先取りして記録した
-- ものであり、適用後に本ファイルを実際に実行して差分が0件であることを別途確認する
-- 必要がある。103章参照）。他の項目（S2・S4の他関数・B層）には変更を加えていない。
--
-- ■ なぜ作ったか
-- 43本のRLSポリシー（2026-09-01時点。作成当初は41本）は、子どものデータを守っている
-- 唯一の壁である。
-- そしてRLSの不備は**エラーを出さない**。厳しすぎれば画面が空になって気づくが、
-- 緩すぎれば「見えてはいけないものが、ただ見える」だけで無症状のまま残る。
-- 目視・手動操作では原理的に発見できないため、機械で照査する。
--
-- ■ 実際に起きた事故（このテストが守ろうとしているもの）
-- 実装メモ.md 84章: gratitude_daily_allowance() のEXECUTE権限を剥奪し、
--                    感謝ポイント機能が本番で全滅した（→ C層のS4が検出する）
-- 実装メモ.md 95章: gratitude_points のRLSを絞ろうとして、member_points
--                    （security_invoker=true）経由で他人の残高が静かに狂う
--                    ことが実行前に判明した（→ C層のS3が変更を検出する）
-- 削除が0行になった件・論理削除が失敗した件も、いずれも家族内の境界（B層）。
--
-- ■ このテストの範囲と限界（正直に書く）
-- 【やること】
--   - SELECT系ポリシーを、実際に別人になりすまして読んで確認する
--   - ポリシー定義と関数のEXECUTE権限を、承認済みスナップショットと照合する
-- 【やらないこと】
--   - **書き込み（INSERT/UPDATE/DELETE）を一切実行しない。** 本番に対して
--     実行するため、ROLLBACK漏れの危険をそもそも作らない方針とした。
--     書き込み系ポリシーは「定義が変わっていないこと」の照合で代替している。
--     挙動そのものの検証ではないため、**書き込みの正しさは保証しない**。
--   - **家族間（A層）の分離は検査していない。** 2つ目の家族が必要だが、
--     本番には家族が1つしかなく、テスト用の家族を本番に作らない方針のため。
--     Docker導入後にローカルDBで追加する。
--   - **書いた検査しか通らない。** 「全部PASS＝安全」ではない。
--
-- ■ 実行方法（本番に対して読み取りのみ。最後にROLLBACKする）
--   cd oyakopoint-app
--   npx supabase db query --linked "$(cat supabase/tests/rls_checks.sql)"
--
-- ■ FAILしたときの対応
--   S3/S4がFAILしたら、それは「意図した変更」か「事故」かを必ず判断すること。
--   意図した変更なら、このファイルのスナップショットを更新する（＝レビューの機会）。
--   **FAILを消すためにスナップショットを更新するのは禁止。** それをやると、
--   テストは「通すことが目的の形骸化した記録」に変わり、無いより悪くなる。
-- ============================================================

BEGIN;

CREATE TEMP TABLE _r(layer text, name text, expected text, actual text, ok boolean);
GRANT INSERT ON _r TO authenticated;


-- ============================================================
-- C層: 定義のスナップショット照合（管理者権限で実行）
-- ============================================================

-- S1. RLSが有効なテーブル数。新しいテーブルを追加してRLSを付け忘れると減る。
-- [2026-09-01更新] family_board_reactions（開発部/成果物/実装メモ.md 103章）の
-- 追加により21→22。他のテーブルには変更が無い（下記S3差分確認と同じ103章参照）。
INSERT INTO _r
SELECT 'C層', 'S1 RLSが有効なテーブル数', '22', count(*)::text, count(*) = 22
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;

-- S2. family_member_pins（子どものPIN）は、RLSが有効でポリシーが1本も無い状態が正しい。
--     ポリシーゼロ＝誰も読めない・書けない。触れるのはservice_roleのEdge Functionのみ。
--     将来うっかりポリシーを1本足すと、PINハッシュが読める状態に変わる。無症状で。
INSERT INTO _r
SELECT 'C層', 'S2 PINテーブルのポリシー数（0が正しい）', '0', count(*)::text, count(*) = 0
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'family_member_pins';

-- S3. ポリシー43本の一覧と中身の照合（2026-09-01更新、family_board_reactions追加分含む）。
--     追加・削除・改名・条件式の書き換えのいずれも検出する。
--     ハッシュは USING と WITH CHECK を連結したもののmd5。
WITH expected(t, p, c, h) AS (VALUES
  ('categories','categories_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('categories','categories_write_by_parent','ALL','a9c21f23a1a0b9627d69fdb5a4d29425'),
  ('chore_completions','chore_completions_insert_self','INSERT','a53bedf571e4b0a3ac25020510e22ebb'),
  ('chore_completions','chore_completions_select_scoped','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('chore_daily_flags','chore_daily_flags_own_rows','ALL','00e6fbca582d21a92747412aa943e2c2'),
  ('chore_reactions','chore_reactions_insert_scoped','INSERT','64b4f4d34c91a08ed214c412011c2725'),
  ('chore_reactions','chore_reactions_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('chores','chores_select_scoped','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('chores','chores_write_family_by_parent','ALL','db358d8f020247f149283dbae29932a2'),
  ('chores','chores_write_personal_by_creator','ALL','c6135ee6661c1603743441b1049cb23f'),
  ('families','families_select_own','SELECT','722858ebf783bd99a2a4163f56dd1634'),
  ('families','families_update_by_parent','UPDATE','e5f50b299119f3b60ec261510beff957'),
  ('family_board_posts','family_board_posts_insert_self','INSERT','28574b1aee58588a3134af369c0c701a'),
  ('family_board_posts','family_board_posts_select_same_family','SELECT','a5197b0b086df242e18aa62005bacd00'),
  -- [2026-09-01追加] family_board_reactions（開発部/成果物/実装メモ.md 103章）。
  -- SELECTはfamily_board_posts_insert_selfと同型（family_id一致＋本人一致）だが、
  -- 列名がreactor_member_idである点が異なるためハッシュも異なる。
  ('family_board_reactions','family_board_reactions_insert_self','INSERT','b92ec48c10ddb918af378dc16afcfb45'),
  ('family_board_reactions','family_board_reactions_select_own','SELECT','8b9c6df1d1c4b6d84e81fc62ebae3800'),
  ('family_drawings','family_drawings_delete_own_unpublished','DELETE','b288307c791de3293dbe0464121e47b2'),
  ('family_drawings','family_drawings_insert_self','INSERT','d5df22021847ff4c6881807027f61ff4'),
  ('family_drawings','family_drawings_select_scoped','SELECT','10deb005fa63c8ea72d3cc971d7f672d'),
  ('family_invites','family_invites_insert_by_parent','INSERT','111d46a4a91a73e658bd8dec8250e658'),
  ('family_invites','family_invites_select_by_parent','SELECT','a64bcea5635a1759018a24e6bf16edc5'),
  ('family_invites','family_invites_update_revoke_by_parent','UPDATE','a9c21f23a1a0b9627d69fdb5a4d29425'),
  ('family_members','family_members_insert_by_parent','INSERT','ee67a7d134e4edcb37570a091be74c85'),
  ('family_members','family_members_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('family_members','family_members_update_scoped','UPDATE','7b019048dc03cf0c2a1674a9664b4b3c'),
  ('family_tree_decorations','family_tree_decorations_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('family_tree_seasons','family_tree_seasons_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('gacha_draws','gacha_draws_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('gacha_member_progress','gacha_member_progress_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('gacha_preset_ornaments','gacha_preset_ornaments_select_authenticated','SELECT','eb28d87532d6edd9b635727493ef89f7'),
  ('gratitude_points','gratitude_points_insert_self','INSERT','dbc7880686f5a4383314d24a9ba591ab'),
  ('gratitude_points','gratitude_points_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('gratitude_points','gratitude_points_update_revoke_by_sender','UPDATE','5cc6c5f5c30e0d1ecae492e233a49ac1'),
  ('push_tokens','push_tokens_delete_self','DELETE','d2d83fd3535d0c4e22eba82950957a4e'),
  ('push_tokens','push_tokens_insert_self','INSERT','bf39c4ff3a8b4f2b96611ea9d852daae'),
  ('push_tokens','push_tokens_select_self','SELECT','d2d83fd3535d0c4e22eba82950957a4e'),
  ('push_tokens','push_tokens_update_self','UPDATE','606756f6b2c2e03c671c60f4c0ddecca'),
  ('reward_redemptions','reward_redemptions_insert_scoped','INSERT','caf8d20b2455e06e18c4acb188f54cd7'),
  ('reward_redemptions','reward_redemptions_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('rewards','rewards_select_scoped','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('rewards','rewards_write_family_by_parent','ALL','db358d8f020247f149283dbae29932a2'),
  ('rewards','rewards_write_personal_by_creator','ALL','c6135ee6661c1603743441b1049cb23f'),
  ('weekly_family_digests','weekly_family_digests_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47')
),
actual_p AS (
  SELECT tablename t, policyname p, cmd::text c,
         md5(coalesce(qual,'') || '|' || coalesce(with_check,'')) h
  FROM pg_policies WHERE schemaname = 'public'
),
diff AS (
  SELECT coalesce(e.t, a.t) || '.' || coalesce(e.p, a.p) ||
         CASE WHEN e.p IS NULL THEN '（承認されていないポリシーが増えている）'
              WHEN a.p IS NULL THEN '（ポリシーが消えている）'
              ELSE '（条件式が書き換わっている）' END AS msg
  FROM expected e FULL OUTER JOIN actual_p a ON a.t = e.t AND a.p = e.p
  WHERE e.p IS NULL OR a.p IS NULL OR e.c <> a.c OR e.h <> a.h
)
INSERT INTO _r
SELECT 'C層', 'S3 ポリシー43本の定義が承認済みと一致',
       'ずれ0件',
       coalesce((SELECT string_agg(msg, ' / ') FROM diff), 'ずれ0件'),
       NOT EXISTS (SELECT 1 FROM diff);

-- S4. authenticated（ログイン済み利用者）が実行できる関数の一覧。
--     84章の事故は、ここから1つ消えたことで起きた。増えるほうも危険。
WITH expected(f) AS (VALUES
  ('accept_family_invite'),('chore_completions_before_insert'),('chore_reactions_before_insert'),
  ('chores_before_write'),('create_family_with_owner'),('current_family_id'),
  ('current_family_member_id'),('current_family_role'),('decorate_tree_with_gacha_prize'),
  ('delete_family_board_post'),('draw_gacha'),('edit_unpublished_drawing'),
  ('family_board_posts_before_insert'),
  ('family_board_posts_before_update'),('family_board_posts_daily_limit'),
  ('family_board_posts_daily_used'),
  -- [2026-09-01追加] family_board_reactions_before_insert（開発部/成果物/実装メモ.md
  -- 103章）。他のBEFORE INSERTトリガー関数（chore_reactions_before_insert等）と同じく
  -- SECURITY DEFINERではないため、本プロジェクトの既知の挙動（34.5章）により新規関数
  -- 作成時にauthenticatedへEXECUTE権限が自動付与される。明示的なREVOKEは行っていない
  -- （既存の同種トリガー関数と同じ扱い）ため、この一覧にも追加する。
  ('family_board_reactions_before_insert'),
  ('family_drawings_before_insert'),('family_invite_lookup'),
  ('family_invites_before_insert'),('family_invites_before_update'),
  ('family_member_pins_before_write'),('family_members_before_update'),('family_tree_seasons_bump'),
  ('family_tree_stage_for_count'),('gacha_drawing_weight'),('gacha_member_progress_bump'),
  ('gacha_preset_ornaments_before_update'),('generate_invite_code'),
  ('generate_weekly_family_digest'),('gratitude_daily_allowance'),('gratitude_points_before_insert'),
  ('gratitude_points_before_update'),('gratitude_points_daily_used'),('is_current_user_parent'),
  ('is_valid_drawing_line_data'),('join_family_with_invite_code'),('jst_week_start_date'),
  ('max_unpublished_drawings_per_member'),('my_family_board_posts_remaining_today'),
  ('my_gratitude_giveable_balance'),('reward_redemptions_before_insert'),('rewards_before_write'),
  ('set_updated_at')
),
actual_f AS (
  SELECT DISTINCT p.proname f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
),
fdiff AS (
  SELECT coalesce(e.f, a.f) || CASE WHEN e.f IS NULL THEN '（権限が増えている）'
                                    ELSE '（権限が消えている）' END AS msg
  FROM expected e FULL OUTER JOIN actual_f a ON a.f = e.f
  WHERE e.f IS NULL OR a.f IS NULL
)
INSERT INTO _r
SELECT 'C層', 'S4 authenticatedが実行できる関数44件が承認済みと一致',
       'ずれ0件',
       coalesce((SELECT string_agg(msg, ' / ') FROM fdiff), 'ずれ0件'),
       NOT EXISTS (SELECT 1 FROM fdiff);


-- ============================================================
-- B層: 家族内のロール境界（実際になりすまして読む）
--
-- 対象者はIDを直書きせず、実行時にロールで選ぶ。メンバーが入れ替わっても
-- テストが陳腐化しないようにするため。
-- ============================================================

SELECT set_config('t.child',     (SELECT id::text FROM family_members WHERE role = 'child'     AND is_active ORDER BY created_at LIMIT 1), true);
SELECT set_config('t.parent',    (SELECT id::text FROM family_members WHERE role = 'parent'    AND is_active ORDER BY created_at LIMIT 1), true);
SELECT set_config('t.supporter', (SELECT id::text FROM family_members WHERE role = 'supporter' AND is_active ORDER BY created_at LIMIT 1), true);


-- ---------- 子どもの視点 ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', current_setting('t.child'))::text, true);

-- B1. 他人の未公開のお絵かきが見えないこと。
--     このアプリで最も機微な秘匿。「ガチャで当たるまで本人以外に見えない」が
--     壊れると、子どもにとっての意味そのものが失われる。しかも無症状。
INSERT INTO _r SELECT 'B層', 'B1 子ども: 他人の未公開の絵が見えない', '0',
  count(*)::text, count(*) = 0
FROM family_drawings WHERE NOT is_published AND artist_member_id <> current_family_member_id();

-- B2. PINハッシュが読めないこと。
INSERT INTO _r SELECT 'B層', 'B2 子ども: PINテーブルが読めない', '0',
  count(*)::text, count(*) = 0 FROM family_member_pins;

-- B3. 逆に厳しすぎないことの確認。家族のメンバーは見えなければ画面が壊れる。
INSERT INTO _r SELECT 'B層', 'B3 子ども: 家族のメンバーは見える（過剰遮断でない）', '1件以上',
  count(*)::text, count(*) > 0 FROM family_members;

-- B4. 完了報告が見えること（同上）。
INSERT INTO _r SELECT 'B層', 'B4 子ども: 家族の完了報告は見える（過剰遮断でない）', '1件以上',
  count(*)::text, count(*) > 0 FROM chore_completions;

RESET ROLE;


-- ---------- 保護者の視点 ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', current_setting('t.parent'))::text, true);

-- B5. 保護者であっても、他人の未公開の絵は見えてはいけない。
--     「保護者だから何でも見える」は、この機能に限っては誤り。
INSERT INTO _r SELECT 'B層', 'B5 保護者: 他人の未公開の絵が見えない', '0',
  count(*)::text, count(*) = 0
FROM family_drawings WHERE NOT is_published AND artist_member_id <> current_family_member_id();

-- B6. 保護者でもPINハッシュは読めない（PIN再設定はEdge Function経由のみ）。
INSERT INTO _r SELECT 'B層', 'B6 保護者: PINテーブルが読めない', '0',
  count(*)::text, count(*) = 0 FROM family_member_pins;

-- B7. 保護者としての役割判定が正しく効いていること。
INSERT INTO _r SELECT 'B層', 'B7 保護者: 保護者として判定される', 'true',
  is_current_user_parent()::text, is_current_user_parent();

RESET ROLE;


-- ---------- みまもりメンバーの視点 ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', current_setting('t.supporter'))::text, true);

-- B8. みまもりも他人の未公開の絵は見えない。
INSERT INTO _r SELECT 'B層', 'B8 みまもり: 他人の未公開の絵が見えない', '0',
  count(*)::text, count(*) = 0
FROM family_drawings WHERE NOT is_published AND artist_member_id <> current_family_member_id();

-- B9. みまもりはPINハッシュを読めない。
INSERT INTO _r SELECT 'B層', 'B9 みまもり: PINテーブルが読めない', '0',
  count(*)::text, count(*) = 0 FROM family_member_pins;

-- B10. みまもりは保護者ではない。ここがtrueになると、家族用クエスト・ごほうびの
--      編集権限（rewards_write_family_by_parent 等）が丸ごと開いてしまう。
INSERT INTO _r SELECT 'B層', 'B10 みまもり: 保護者として判定されない', 'false',
  is_current_user_parent()::text, NOT is_current_user_parent();

RESET ROLE;


-- ============================================================
-- 結果
-- ============================================================
SELECT layer, name, expected, actual, CASE WHEN ok THEN 'PASS' ELSE '*** FAIL ***' END AS result
FROM _r ORDER BY layer, name;

ROLLBACK;
