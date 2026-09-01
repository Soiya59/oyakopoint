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
-- [2026-09-01再更新・開発部] 統括フィードバック（掲示板リアクションをLINE風の
-- 個数表示へ作り直す）を受け、supabase/migrations/
-- 20260901180000_family_board_reactions_line_style.sql（開発部/成果物/実装メモ.md
-- 104章）でSELECTポリシーを「閲覧者自身の行のみ」→「家族全員が読める」へ置き換えた
-- （ポリシー名も`family_board_reactions_select_own`→
-- `family_board_reactions_select_same_family`に改名。理由は104章・上記マイグレーション
-- 本体のコメント参照）。これに伴いS3の該当1行のみを更新した。S1（22のまま。テーブル
-- の追加・削除は無い）・S4（44のまま。関数の追加・削除は無い）は変更していない。
-- 一意制約の張り替え（(post_id, reactor_member_id) →
-- (post_id, reactor_member_id, stamp_key)）はRLS・関数のいずれにも影響しないため
-- 本ファイルのスナップショットには現れない。104章時点では上記マイグレーションは
-- **未適用**であり、S3の新ハッシュは推定値である（104章参照。適用後に本部長が
-- 実測して確認する）。
--
-- ■ なぜ作ったか
-- 48本のRLSポリシー（2026-09-01時点。作成当初は41本）は、子どものデータを守っている
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
--   - **書いた検査しか通らない。** 「全部PASS＝安全」ではない。
--
-- [2026-09-01追加・開発部] A層（家族間の分離）を追加した（開発部/成果物/
-- 実装メモ.md 105章）。96.5章で「家族が2つ以上ないと検査できない。本番には
-- 家族が1つしかなく、テスト用の家族を本番に作らない方針のためDocker導入後に
-- ローカルDBで追加する」と先送りしていたものの本実装。
--   - ローカル（`supabase/seed.sql` を読み込んだ状態。`supabase db reset` /
--     `supabase start` でのみ投入される）では、テスト家族が2つ存在するため
--     A層が実際に実行される。
--   - 本番（家族が1つしかない）では「家族が2つ以上あるか」を実行時に判定し、
--     該当しないためA層は**SKIP**と表示される（FAILではない。正常な挙動）。
--     判定方法・SKIPの実装はB層の直前のコメント、および各A層チェックの
--     コメントを参照。
--   - B層についても、対象ロールのメンバーが1人も存在しない環境（ローカルの
--     空DB等）で `set_config` に空文字を渡してクラッシュしていた不具合を
--     本改訂であわせて修正した（B層直前のコメント参照）。B層の各チェックの
--     検査内容・期待値そのものは一切変更していない。
--
-- [2026-09-01再追加・開発部] NFCタグの人ごと化（新規テーブル`chore_nfc_tags`、
-- 設計部/成果物/スキーマ設計.sql 39章・開発部/成果物/実装メモ.md 108章）に伴い、
-- S1（22→23）・S3（43→48本、chore_nfc_tagsの5ポリシーを追加）・
-- S4（44→47件、chore_nfc_tags_before_write・max_nfc_tags_per_chore_member・
-- report_chore_completion_by_nfc_tagを追加）、A層にA22（保護者:
-- chore_nfc_tagsに他家族の行が見えない）を追加した。既存の`chore_completions_
-- insert_self`を含む既存ポリシー・関数は1本も変更していない（39.5章の設計判断
-- どおり、代理報告はRLS緩和ではなく別RPCで実現したため）。マイグレーション
-- `20260901200000_chore_nfc_tags_per_member.sql`は108章時点で**未適用**であり、
-- 本ファイルの新規ハッシュはローカルDocker環境で実測済み（108章参照。96.5章
-- 「FAILを消すためにスナップショットを更新してはならない」の遵守として、実測
-- した上で記録している）。
--
-- [2026-09-02追加・開発部] 招待受諾フローにおける可視範囲の説明と同意取得
-- （新規テーブル`join_consents`、設計部/成果物/スキーマ設計.sql 40章・開発部/
-- 成果物/実装メモ.md 111章）に伴い、S1（23→24）・S3（48→50本、join_consents
-- のSELECT2本を追加）・S4（47→48件、current_join_consent_versionを追加。
-- join_family_with_invite_code/accept_family_inviteは3引数の新シグネチャに
-- 差し替わったが、S4は関数名のみを見る照合のため件数上は動かない）、A層に
-- A23（保護者: join_consentsに他家族の行が見えない）を追加した。
-- `join_family_with_invite_code(text, text)`・`accept_family_invite(text, text)`
-- の旧2引数シグネチャは本マイグレーションでDROP FUNCTIONされ、
-- `pg_get_function_identity_arguments`で3引数の新シグネチャのみが残って
-- いることをローカルで確認済み（実装メモ.md 111章）。マイグレーション
-- `20260902010000_join_visibility_consent.sql`は111章時点で**未適用**であり、
-- 本ファイルの新規ハッシュはローカルDocker環境で実測済み（96.5章の遵守として、
-- 実測した上で記録している）。
--
-- ■ 実行方法（本番に対して読み取りのみ。最後にROLLBACKする）
--   cd oyakopoint-app
--   npx supabase db query --linked -f supabase/tests/rls_checks.sql
--
-- ■ ローカルでの実行方法（A層も含めて全件検査する場合）
--   1. `supabase start` または `supabase db reset` でローカルDBに
--      `supabase/seed.sql`（テスト家族2件）を投入しておく。
--   2. `docker exec -i supabase_db_<project>-app psql -U postgres -d postgres -q -f - < supabase/tests/rls_checks.sql`
--      （`npx supabase db query` はローカル対象だと挙動が異なるため使わない。
--      開発部/成果物/実装メモ.md 105章参照）
--
-- ■ FAILしたときの対応
--   S3/S4がFAILしたら、それは「意図した変更」か「事故」かを必ず判断すること。
--   意図した変更なら、このファイルのスナップショットを更新する（＝レビューの機会）。
--   **FAILを消すためにスナップショットを更新するのは禁止。** それをやると、
--   テストは「通すことが目的の形骸化した記録」に変わり、無いより悪くなる。
--   SKIPはFAILではない（本番のA層など、検査対象がそもそも存在しない場合の
--   正常な表示）。SKIPが出るべきでない環境（ローカルの全層検査時）でSKIPが
--   出た場合は、ガード条件の判定ミスを疑うこと。
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
-- [2026-09-01再更新] chore_nfc_tags（開発部/成果物/実装メモ.md 108章）の追加に
-- より22→23。
-- [2026-09-02再更新] join_consents（開発部/成果物/実装メモ.md 111章）の追加に
-- より23→24。
INSERT INTO _r
SELECT 'C層', 'S1 RLSが有効なテーブル数', '24', count(*)::text, count(*) = 24
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;

-- S2. family_member_pins（子どものPIN）は、RLSが有効でポリシーが1本も無い状態が正しい。
--     ポリシーゼロ＝誰も読めない・書けない。触れるのはservice_roleのEdge Functionのみ。
--     将来うっかりポリシーを1本足すと、PINハッシュが読める状態に変わる。無症状で。
INSERT INTO _r
SELECT 'C層', 'S2 PINテーブルのポリシー数（0が正しい）', '0', count(*)::text, count(*) = 0
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'family_member_pins';

-- S3. ポリシー50本の一覧と中身の照合（2026-09-01更新、family_board_reactions追加分含む。
--     2026-09-01再更新、family_board_reactionsのSELECTをLINE風個数表示対応で改名・
--     条件式変更。実装メモ.md 104章。2026-09-01再々更新、chore_nfc_tags
--     （NFCタグの人ごと化、実装メモ.md 108章）の5ポリシーを追加。43→48本）。
--     2026-09-02再々々更新、join_consents（招待受諾フローの可視範囲説明と同意
--     取得、設計部/成果物/スキーマ設計.sql 40章・実装メモ.md 111章）のSELECT
--     2本を追加。48→50本。
--     追加・削除・改名・条件式の書き換えのいずれも検出する。
--     ハッシュは USING と WITH CHECK を連結したもののmd5。
WITH expected(t, p, c, h) AS (VALUES
  ('categories','categories_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('categories','categories_write_by_parent','ALL','a9c21f23a1a0b9627d69fdb5a4d29425'),
  ('chore_completions','chore_completions_insert_self','INSERT','a53bedf571e4b0a3ac25020510e22ebb'),
  ('chore_completions','chore_completions_select_scoped','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('chore_daily_flags','chore_daily_flags_own_rows','ALL','00e6fbca582d21a92747412aa943e2c2'),
  -- [2026-09-01追加] chore_nfc_tags（NFCタグの人ごと化、設計部/成果物/スキーマ設計.sql
  -- 39.4章、開発部/成果物/実装メモ.md 108章）。SELECTの条件式は
  -- `(family_id = current_family_id())`のみであり、既存の多数のSELECTポリシー
  -- （categories_select_same_family等）と文字通り同一のため、承認済み一覧から
  -- ハッシュを引き写せる（104章の教訓）。INSERT/UPDATEの4本はいずれもEXISTSで
  -- choresテーブルのscope・created_byを参照する新しい形の条件式であり、承認済み
  -- 一覧に文字通り同一のものが無いため、ローカルDockerで実測した（108章参照）。
  ('chore_nfc_tags','chore_nfc_tags_insert_family_by_parent','INSERT','c65f6bcf088e0509ebc68287eb3a2697'),
  ('chore_nfc_tags','chore_nfc_tags_insert_personal_by_creator','INSERT','6573bb8d8e4ba72fe84636642dbc942b'),
  ('chore_nfc_tags','chore_nfc_tags_revoke_family_by_parent','UPDATE','4363f0549d157159f7553c9de572d3f4'),
  ('chore_nfc_tags','chore_nfc_tags_revoke_personal_by_creator','UPDATE','a299667c176e888b5d809f234cf7c088'),
  ('chore_nfc_tags','chore_nfc_tags_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
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
  -- INSERTはfamily_board_posts_insert_selfと同型（family_id一致＋本人一致）だが、
  -- 列名がreactor_member_idである点が異なるためハッシュも異なる。
  ('family_board_reactions','family_board_reactions_insert_self','INSERT','b92ec48c10ddb918af378dc16afcfb45'),
  -- [2026-09-01再改訂] SELECTを「閲覧者自身の行のみ」→「家族全員が読める」へ変更した
  -- ことに伴い、ポリシー名を`family_board_reactions_select_own`→
  -- `family_board_reactions_select_same_family`に改名（実装メモ.md 104章）。
  -- 条件式が`family_id = current_family_id()`のみになったため、同じ条件式を持つ
  -- 他の多数のSELECTポリシー（例: chores_select_scoped・chore_completions_select_scoped
  -- 等）と全く同じハッシュ`ba5f17c68a4ed3412761e44aff4d2f47`になる（実装メモ.md 104章、
  -- 手計算の根拠として明記。この値は既存の複数の承認済みハッシュと文字通り同一の
  -- SQL文から導かれるため、103章時点の逆算よりも確度が高い推定値ではあるが、
  -- あくまで推定であり実測ではない）。
  ('family_board_reactions','family_board_reactions_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
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
  -- [2026-09-02追加] join_consents（招待受諾フローにおける可視範囲の説明と同意
  -- 取得、設計部/成果物/スキーマ設計.sql 40.4章、開発部/成果物/実装メモ.md
  -- 111章）。INSERT/UPDATE/DELETEポリシーは1本も定義しない設計（40.4章、書込みは
  -- SECURITY DEFINER関数のみに閉じる）。join_consents_select_by_parentの条件式
  -- `(family_id = current_family_id()) AND is_current_user_parent()`は
  -- family_invites_select_by_parentと文字通り同一のため、ハッシュも同一の値を
  -- 引き写せる（104章の教訓）。join_consents_select_ownの条件式
  -- `family_member_id = current_family_member_id()`は承認済み一覧に文字通り
  -- 同一のものが無い新しい形であり、ローカルDockerで実測した（111章参照）。
  ('join_consents','join_consents_select_by_parent','SELECT','a64bcea5635a1759018a24e6bf16edc5'),
  ('join_consents','join_consents_select_own','SELECT','a81cabc4ac6fc746a840a3457e019f8e'),
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
SELECT 'C層', 'S3 ポリシー50本の定義が承認済みと一致',
       'ずれ0件',
       coalesce((SELECT string_agg(msg, ' / ') FROM diff), 'ずれ0件'),
       NOT EXISTS (SELECT 1 FROM diff);

-- S4. authenticated（ログイン済み利用者）が実行できる関数の一覧。
--     84章の事故は、ここから1つ消えたことで起きた。増えるほうも危険。
WITH expected(f) AS (VALUES
  ('accept_family_invite'),('chore_completions_before_insert'),
  -- [2026-09-01追加] chore_nfc_tags_before_write（NFCタグの人ごと化、設計部/成果物/
  -- スキーマ設計.sql 39.3章、開発部/成果物/実装メモ.md 108章）。他のBEFORE INSERT/
  -- UPDATEトリガー関数（chores_before_write等）と同じくSECURITY DEFINERではないため、
  -- 新規関数作成時にauthenticatedへEXECUTE権限が自動付与される（34.5章の既知の挙動）。
  ('chore_nfc_tags_before_write'),
  ('chore_reactions_before_insert'),
  ('chores_before_write'),('create_family_with_owner'),('current_family_id'),
  ('current_family_member_id'),('current_family_role'),
  -- [2026-09-02追加] current_join_consent_version（招待受諾フローにおける可視範囲の
  -- 説明と同意取得、設計部/成果物/スキーマ設計.sql 40.5章、開発部/成果物/実装メモ.md
  -- 111章）。max_unpublished_drawings_per_member等の既存の定数取得用ヘルパー関数と
  -- 同じくLANGUAGE SQLでSECURITY DEFINERではないため、新規関数作成時にauthenticatedへ
  -- のEXECUTE権限が自動付与される（34.5章の既知の挙動）。明示的なREVOKEは行っていない。
  ('current_join_consent_version'),
  ('decorate_tree_with_gacha_prize'),
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
  -- [2026-09-01追加] max_nfc_tags_per_chore_member（NFCタグの人ごと化、設計部/成果物/
  -- スキーマ設計.sql 39.3章、開発部/成果物/実装メモ.md 108章）。SECURITY DEFINERでは
  -- ないLANGUAGE SQL関数のため、他の同種ヘルパー関数（max_unpublished_drawings_
  -- per_member等）と同じくauthenticatedへEXECUTE権限が自動付与される。
  ('max_nfc_tags_per_chore_member'),
  ('max_unpublished_drawings_per_member'),('my_family_board_posts_remaining_today'),
  ('my_gratitude_giveable_balance'),
  -- [2026-09-01追加] report_chore_completion_by_nfc_tag（NFCタグの人ごと化・代理報告
  -- RPC、設計部/成果物/スキーマ設計.sql 39.6〜39.7章、開発部/成果物/実装メモ.md 108章）。
  -- draw_gacha()等と同じくSECURITY DEFINERであり、39.7章の方針どおりPUBLIC/anonから
  -- 明示的にREVOKEしたうえでauthenticatedへ明示的にGRANTしている。
  ('report_chore_completion_by_nfc_tag'),
  ('reward_redemptions_before_insert'),('rewards_before_write'),
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
SELECT 'C層', 'S4 authenticatedが実行できる関数48件が承認済みと一致',
       'ずれ0件',
       coalesce((SELECT string_agg(msg, ' / ') FROM fdiff), 'ずれ0件'),
       NOT EXISTS (SELECT 1 FROM fdiff);


-- ============================================================
-- B層: 家族内のロール境界（実際になりすまして読む）
--
-- 対象者はIDを直書きせず、実行時にロールで選ぶ。メンバーが入れ替わっても
-- テストが陳腐化しないようにするため。
--
-- [2026-09-01改訂・開発部・実装メモ.md 105章] メンバーが1人もいない環境
-- （ローカルの空DB等）でのガード追加。
-- 従来は `SELECT set_config('t.child', (SELECT id::text FROM family_members
-- WHERE role='child' ...), true)` を無条件に実行しており、対象ロールの
-- メンバーが0人だと内側のSELECTがNULLを返し、`set_config('t.child', NULL,
-- true)` の結果 `current_setting('t.child')` が**空文字列 ''**になる
-- （NULLにはならない。実機で確認済み）。この空文字列がその後
-- `json_build_object('family_member_id', '')` 経由で
-- `current_family_member_id()` 内の `v_member_id_claim::uuid` キャストに渡り
-- `invalid input syntax for type uuid: ""` でクラッシュしていた。
-- 対策: `set_config` 自体を `WHERE EXISTS (...)` で対象ロールが実在する
-- ときだけ実行するよう改める。存在しない場合は `t.child` 等のGUCが
-- 一度も設定されず、`current_setting(..., true)` は（空文字列ではなく）
-- 正真正銘の SQL NULL を返すため、`json_build_object` はJSONの null を
-- 生成し、`current_family_member_id()` はクラッシュせずNULLを返す
-- （キャストするNULLは常に安全。危険なのは空文字列のキャストだけ）。
-- その上で、各チェックの期待値・実際の判定ロジック自体
-- （「他人の未公開の絵が見えない」等）は一切変更せず、対象ロールが
-- 存在しない場合にのみ結果を『SKIP』表示に切り替える分岐を追加した。
-- ============================================================

SELECT set_config('t.child', (SELECT id::text FROM family_members WHERE role = 'child' AND is_active ORDER BY created_at LIMIT 1), true)
  WHERE EXISTS (SELECT 1 FROM family_members WHERE role = 'child' AND is_active);
SELECT set_config('t.parent', (SELECT id::text FROM family_members WHERE role = 'parent' AND is_active ORDER BY created_at LIMIT 1), true)
  WHERE EXISTS (SELECT 1 FROM family_members WHERE role = 'parent' AND is_active);
SELECT set_config('t.supporter', (SELECT id::text FROM family_members WHERE role = 'supporter' AND is_active ORDER BY created_at LIMIT 1), true)
  WHERE EXISTS (SELECT 1 FROM family_members WHERE role = 'supporter' AND is_active);

-- [A層のガード用] 家族が2つ以上あるかを、まだ`SET LOCAL ROLE authenticated`に
-- 切り替える前（＝管理者権限のこの時点）で1回だけ判定し、GUCへ結果を
-- キャッシュしておく。**ここを`SET LOCAL ROLE authenticated`後に
-- `(SELECT count(*) FROM families)`という形で毎回問い合わせる実装にすると、
-- families テーブルのSELECTポリシー（families_select_own、
-- `id = current_family_id()`）がなりすまし中の本人にも適用され、
-- 常に「自分の家族1件」しか数えられず、ローカルでも家族が2つ以上あるのに
-- 誤ってfalse（＝A層が常にSKIP）になってしまう（実際にこの実装ミスを
-- ローカルで踏んでから気づき、修正した。開発部/成果物/実装メモ.md 105章）。
SELECT set_config('t.multi_family', ((SELECT count(*) FROM families) >= 2)::text, true);


-- ---------- 子どもの視点 ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', current_setting('t.child', true))::text, true);

-- B1. 他人の未公開のお絵かきが見えないこと。
--     このアプリで最も機微な秘匿。「ガチャで当たるまで本人以外に見えない」が
--     壊れると、子どもにとっての意味そのものが失われる。しかも無症状。
INSERT INTO _r SELECT 'B層', 'B1 子ども: 他人の未公開の絵が見えない', '0',
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにchildロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*) = 0 ELSE NULL END
FROM family_drawings WHERE NOT is_published AND artist_member_id <> current_family_member_id();

-- B2. PINハッシュが読めないこと。
INSERT INTO _r SELECT 'B層', 'B2 子ども: PINテーブルが読めない', '0',
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにchildロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*) = 0 ELSE NULL END
FROM family_member_pins;

-- B3. 逆に厳しすぎないことの確認。家族のメンバーは見えなければ画面が壊れる。
INSERT INTO _r SELECT 'B層', 'B3 子ども: 家族のメンバーは見える（過剰遮断でない）', '1件以上',
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにchildロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*) > 0 ELSE NULL END
FROM family_members;

-- B4. 完了報告が見えること（同上）。
INSERT INTO _r SELECT 'B層', 'B4 子ども: 家族の完了報告は見える（過剰遮断でない）', '1件以上',
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにchildロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*) > 0 ELSE NULL END
FROM chore_completions;

-- ------------------------------------------------------------
-- A層（子どもロール分）: family_drawings / chore_completions / family_members は
-- 「特に重要なテーブル」として3ロールすべてで検査する（絞り方の理由は
-- 保護者の視点ブロック冒頭のA層コメントを参照。ここでは子ども分のみ追加）。
-- ------------------------------------------------------------
INSERT INTO _r SELECT 'A層', 'A-child family_drawings: 他家族の行が見えない', '0',
  CASE WHEN current_setting('t.child', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) = 0 ELSE NULL END
FROM family_drawings WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A-child chore_completions: 他家族の行が見えない', '0',
  CASE WHEN current_setting('t.child', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) = 0 ELSE NULL END
FROM chore_completions WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A-child family_members: 他家族の行が見えない', '0',
  CASE WHEN current_setting('t.child', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) = 0 ELSE NULL END
FROM family_members WHERE family_id <> current_family_id();

RESET ROLE;


-- ---------- 保護者の視点 ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', current_setting('t.parent', true))::text, true);

-- B5. 保護者であっても、他人の未公開の絵は見えてはいけない。
--     「保護者だから何でも見える」は、この機能に限っては誤り。
INSERT INTO _r SELECT 'B層', 'B5 保護者: 他人の未公開の絵が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにparentロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL THEN count(*) = 0 ELSE NULL END
FROM family_drawings WHERE NOT is_published AND artist_member_id <> current_family_member_id();

-- B6. 保護者でもPINハッシュは読めない（PIN再設定はEdge Function経由のみ）。
INSERT INTO _r SELECT 'B層', 'B6 保護者: PINテーブルが読めない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにparentロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL THEN count(*) = 0 ELSE NULL END
FROM family_member_pins;

-- B7. 保護者としての役割判定が正しく効いていること。
INSERT INTO _r SELECT 'B層', 'B7 保護者: 保護者として判定される', 'true',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL THEN is_current_user_parent()::text ELSE 'SKIP（ローカルにparentロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL THEN is_current_user_parent() ELSE NULL END;

-- ============================================================
-- A層（保護者ロール分・代表ロール）: 家族間の分離
--
-- [2026-09-01新設・開発部・実装メモ.md 105章]
-- 検査内容: 家族Aのメンバーとしてなりすました状態で、家族Bのデータが
-- 1件も見えないこと。対象IDは直書きせず、「自分の家族以外
-- （family_id <> current_family_id()）のデータが0件であること」という
-- 形で実行時に判定する（B層と同じ「実在するデータを実行時に選ぶ」方針を
-- 踏襲。テスト家族2件は `supabase/seed.sql` がローカルのみに投入する）。
--
-- [絞り方とその理由]
--   RLSが有効な22テーブルのうち、gacha_preset_ornaments
--   （全家族共通のグローバルカタログ。family_id列を持たず、両家族が
--   同じ行を見えるのが正しい設計のため「他家族のデータが見えない」という
--   検査自体が意味を持たない）を除いた21テーブルを対象にする。
--   21テーブル全部を3ロール（保護者・こども・みまもり）でそれぞれ検査すると
--   63件になり検査項目が肥大化するため、以下のように絞った。
--     - 代表ロール（保護者）1つで21テーブルすべてを検査する
--       （このブロック）。RLSポリシーの条件式自体はロールに関わらず
--       同じ形（family_id = current_family_id()）で書かれているものが
--       大半であり、代表1ロールでの検査でも「family_idによる分離が
--       構造的に効いているか」は十分に確認できる。
--     - 「特に重要な3テーブル」（family_drawings=秘匿性が最も高い、
--       chore_completions=ポイントの原資となる会計データ、
--       family_members=氏名等の個人識別情報）だけは、こども・みまもりの
--       2ロールでも重ねて検査する（子どもの視点ブロック・みまもりの視点
--       ブロックにそれぞれ追加）。理由: この3テーブルは、role別に条件式が
--       枝分かれしているポリシーが実際に存在する
--       （family_members_update_scoped等）ため、ロールによって挙動が
--       異なる可能性を排除しきれない。
--   （合計 21 + 3テーブル×2ロール + 過剰遮断でない確認1件 = 28件）
--
-- [「過剰に厳しくない」側の確認（96.3(3)の方針）]
--   家族Aの保護者から、家族A自身のfamily_membersが見えることを確認する
--   （A-guard-not-too-strict）。「他家族が見えない」だけを検査すると、
--   仮にRLSが誤って自分の家族まで含めて全部隠す設定になっていても
--   0件のままPASSしてしまい、検査として無意味になる（B3・B4と同じ発想）。
--
-- [ローカル/本番の分岐方法]
--   `current_setting('t.multi_family', true) = 'true'` を都度の副問い合わせで判定する。
--   本番は家族が1つしかないため常にfalseとなり、A層はすべてSKIP表示になる
--   （FAILではない）。ローカルは `supabase/seed.sql` が2家族を投入するため
--   trueになり、実際にチェックが走る。対象ロールのメンバー自体が
--   存在しない場合（`current_setting('t.parent', true) IS NOT NULL` 等）も
--   あわせてガードしている（B層と同じ理由）。
-- ============================================================

-- A-guard-not-too-strict. 家族Aの保護者から、自分の家族のメンバーは見える
-- （他家族を隠すあまり自分の家族まで消えていないかの確認、96.3(3)の方針）。
INSERT INTO _r SELECT 'A層', 'A-guard 保護者: 自分の家族のfamily_membersは見える（過剰遮断でない）', '1件以上',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) > 0 ELSE NULL END
FROM family_members WHERE family_id = current_family_id();

-- 以下21件、代表ロール（保護者）で「他家族の行が0件であること」を検査する。
-- families のみ主キー列が `id`（他は `family_id`）であることに注意。
-- family_member_pins / push_tokens は family_id 列を持たないため、
-- family_members への JOIN 経由で他家族のメンバーの行かどうかを判定する。
INSERT INTO _r SELECT 'A層', 'A01 保護者: categoriesに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM categories WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A02 保護者: chore_completionsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM chore_completions WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A03 保護者: chore_daily_flagsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM chore_daily_flags WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A04 保護者: chore_reactionsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM chore_reactions WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A05 保護者: choresに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM chores WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A06 保護者: familiesに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM families WHERE id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A07 保護者: family_board_postsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_board_posts WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A08 保護者: family_board_reactionsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_board_reactions WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A09 保護者: family_drawingsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_drawings WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A10 保護者: family_invitesに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_invites WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A11 保護者: family_member_pinsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_member_pins fmp JOIN family_members fm ON fm.id = fmp.member_id WHERE fm.family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A12 保護者: family_membersに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_members WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A13 保護者: family_tree_decorationsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_tree_decorations WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A14 保護者: family_tree_seasonsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_tree_seasons WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A15 保護者: gacha_drawsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM gacha_draws WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A16 保護者: gacha_member_progressに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM gacha_member_progress WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A17 保護者: gratitude_pointsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM gratitude_points WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A18 保護者: push_tokensに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM push_tokens pt JOIN family_members fm ON fm.id = pt.member_id WHERE fm.family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A19 保護者: reward_redemptionsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM reward_redemptions WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A20 保護者: rewardsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM rewards WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A21 保護者: weekly_family_digestsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM weekly_family_digests WHERE family_id <> current_family_id();

-- [2026-09-01追加] A22 chore_nfc_tags（NFCタグの人ごと化、開発部/成果物/実装メモ.md
-- 108章）。家族間で分離されるべき新規テーブルのため、既存のA01〜A21と同じ形で追加する。
INSERT INTO _r SELECT 'A層', 'A22 保護者: chore_nfc_tagsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM chore_nfc_tags WHERE family_id <> current_family_id();

-- [2026-09-02追加] A23 join_consents（招待受諾フローにおける可視範囲の説明と
-- 同意取得、設計部/成果物/スキーマ設計.sql 40.10章・開発部/成果物/実装メモ.md
-- 111章）。家族間で分離されるべき新規テーブルのため、既存のA01〜A22と同じ形で
-- 追加する。子ども・みまもりロール分の代表チェック（family_drawings/
-- chore_completions/family_membersの3テーブル）への追加は不要（40.10章の判断。
-- 子どもはjoin_family_with_invite_code/accept_family_inviteのいずれも呼び出せ
-- ないため本テーブルへのアクセスパターンを検査する意味が無く、みまもりの
-- 「自分の行しか見えない」懸念はjoin_consents_select_ownの存在だけで自明に
-- 満たされ、他家族分離の懸念とは性質が異なるため）。
INSERT INTO _r SELECT 'A層', 'A23 保護者: join_consentsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM join_consents WHERE family_id <> current_family_id();

-- [注記] 「特に重要な3テーブル」（family_drawings/chore_completions/
-- family_members）の保護者ロール分は、上のA09・A02・A12がそのまま該当する
-- （代表ロールが保護者のため）。二重に記録すると同じ検査が名前だけ変えて
-- 増えるだけなので、ここでは追加しない。

RESET ROLE;


-- ---------- みまもりメンバーの視点 ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', current_setting('t.supporter', true))::text, true);

-- B8. みまもりも他人の未公開の絵は見えない。
INSERT INTO _r SELECT 'B層', 'B8 みまもり: 他人の未公開の絵が見えない', '0',
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにsupporterロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL THEN count(*) = 0 ELSE NULL END
FROM family_drawings WHERE NOT is_published AND artist_member_id <> current_family_member_id();

-- B9. みまもりはPINハッシュを読めない。
INSERT INTO _r SELECT 'B層', 'B9 みまもり: PINテーブルが読めない', '0',
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにsupporterロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL THEN count(*) = 0 ELSE NULL END
FROM family_member_pins;

-- B10. みまもりは保護者ではない。ここがtrueになると、家族用クエスト・ごほうびの
--      編集権限（rewards_write_family_by_parent 等）が丸ごと開いてしまう。
INSERT INTO _r SELECT 'B層', 'B10 みまもり: 保護者として判定されない', 'false',
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL THEN is_current_user_parent()::text ELSE 'SKIP（ローカルにsupporterロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL THEN NOT is_current_user_parent() ELSE NULL END;

-- ------------------------------------------------------------
-- A層（みまもりロール分）: 「特に重要な3テーブル」を重ねて検査する
-- （絞り方の理由は保護者の視点ブロック冒頭のA層コメントを参照）。
-- ------------------------------------------------------------
INSERT INTO _r SELECT 'A層', 'A-supporter family_drawings: 他家族の行が見えない', '0',
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) = 0 ELSE NULL END
FROM family_drawings WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A-supporter chore_completions: 他家族の行が見えない', '0',
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) = 0 ELSE NULL END
FROM chore_completions WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A-supporter family_members: 他家族の行が見えない', '0',
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) = 0 ELSE NULL END
FROM family_members WHERE family_id <> current_family_id();

RESET ROLE;


-- ============================================================
-- 結果
-- ============================================================
SELECT layer, name, expected, actual,
  CASE WHEN ok IS NULL THEN 'SKIP' WHEN ok THEN 'PASS' ELSE '*** FAIL ***' END AS result
FROM _r ORDER BY layer, name;

ROLLBACK;
