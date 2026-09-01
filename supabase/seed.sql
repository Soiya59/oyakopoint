-- ============================================================
-- ローカル専用テストデータ（seed.sql）
-- ============================================================
-- 【最重要・繰り返し警告】本ファイルは絶対に本番へ流してはならない。
--
--   - 本ファイルが読まれるのは `supabase start` と `supabase db reset` を
--     ローカル環境に対して実行したときだけである（Supabase CLIの標準仕様）。
--     通常の `supabase db push`（本番マイグレーション適用）はこのファイルを
--     一切読まない。
--   - **ただし `supabase db push --include-seed` を付けると、本番にも
--     このファイルの内容がそのまま流れてしまう。このオプションは
--     本プロジェクトでは絶対に使用しないこと。** 誤って使うと、以下の
--     テスト専用データ（テスト家族2件・auth.usersのダミーアカウント含む）が
--     本番DBに書き込まれる。
--   - 開発部/成果物/実装メモ.md 105章に、この方針と作成経緯を記録している。
--
-- 目的:
--   実装メモ.md 96.5章で「Docker導入後にローカルDBで追加する」と先送りしていた
--   A層（家族間分離）のRLSテストを実施するため、ローカルにのみ存在する
--   「テスト家族」を2つ作り、RLSが有効な22テーブルのうち実データを入れられる
--   ものすべてに一通りのデータを投入する。supabase/tests/rls_checks.sql の
--   A層はこのデータの存在を前提に「家族が2つ以上あるか」で実行可否を判定する。
--
-- 命名規則:
--   - 実在の家族の名前（せいや・ちひろ・みどり 等）は一切使わない。
--   - メンバーの表示名はすべて "TEST-A-" "TEST-B-" で始まる、
--     一目でテストデータとわかる名前にする。
--   - メールアドレスはすべて実在しない予約ドメイン "@example.test"
--     （RFC 2606）を使う。
--
-- 実装方針（トリガーとの付き合い方）:
--   本ファイルは postgres（スーパーユーザー）権限で実行されるため、RLSポリシー
--   はすべてバイパスされる。一方で、chores/rewards/family_invites/
--   family_drawingsの4テーブルはBEFORE INSERTトリガーが
--   `current_family_member_id()`（request.jwt.claimsのfamily_member_idクレーム
--   を読む関数）を使って created_by / artist_member_id / family_id を
--   **常にサーバー側で強制上書き**する実装になっている（実装メモ.md 105章に
--   詳細）。そのため、これらのテーブルへ書き込む直前に
--   `SELECT set_config('request.jwt.claims', ...)` でなりすまし対象の
--   family_member_id を設定してから INSERT する（本物のログインを介さずに
--   本番と同じトリガー経路を通す）。**トリガーの無効化（DISABLE TRIGGER）は
--   一切行っていない。** それ以外のテーブルはトリガーがJWTクレームに依存しない
--   ため、素のINSERTで直接値を渡している（詳細はテーブルごとのコメント参照）。
-- ============================================================

-- INSERT ... RETURNING した各行のIDを、後続のINSERTから名前で参照するための
-- 作業用テーブル（このセッション限りのTEMP。本番相当のテーブルには一切影響しない）。
CREATE TEMP TABLE _seed_ids (key TEXT PRIMARY KEY, id UUID NOT NULL);


-- ============================================================
-- 0. families（テスト家族A・B）
-- ============================================================
WITH ins AS (
  INSERT INTO families (name, created_at, updated_at)
  VALUES ('RLS検査用テスト家族A', now() - interval '2 days', now() - interval '2 days')
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'fam_a', id FROM ins;

WITH ins AS (
  INSERT INTO families (name, created_at, updated_at)
  VALUES ('RLS検査用テスト家族B', now() - interval '1 day', now() - interval '1 day')
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'fam_b', id FROM ins;

-- [重要・rls_checks.sql A層との関係] B層（既存）は「role='child'/'parent'/'supporter'の
-- うちcreated_atが最も古いメンバー」を実行時に選ぶ設計になっている（96章由来）。
-- A層はこの選ばれたメンバーを「家族Aの代表」としてそのまま再利用するため、
-- 家族Aの全メンバーのcreated_atを家族Bより必ず早くする（本ファイルの
-- 挿入順どおりで自然に満たされるが、created_atを明示指定して確実にしている）。


-- ============================================================
-- 1. auth.users（保護者・みまもりメンバー用のダミーログインアカウント）
-- ============================================================
-- 子ども(role='child')はauth.usersを持たない設計（招待コード+PIN、
-- 設計部/成果物/認証・データ管理設計書.md）のため作成しない。
-- encrypted_passwordはダミー文字列（実際のログイン試行は行わないため、
-- 有効なbcryptハッシュである必要はない）。service_role等の秘密情報は
-- 一切含まない。
WITH ins AS (
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    'rls-test-a-parent1@example.test', 'not-a-real-hash-local-seed-only',
    now() - interval '2 days', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now() - interval '2 days', now() - interval '2 days', '', '', '', '', false, false
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_parent_auth', id FROM ins;

WITH ins AS (
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    'rls-test-a-supporter1@example.test', 'not-a-real-hash-local-seed-only',
    now() - interval '2 days', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now() - interval '2 days', now() - interval '2 days', '', '', '', '', false, false
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_supporter_auth', id FROM ins;

WITH ins AS (
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    'rls-test-b-parent1@example.test', 'not-a-real-hash-local-seed-only',
    now() - interval '1 day', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now() - interval '1 day', now() - interval '1 day', '', '', '', '', false, false
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_parent_auth', id FROM ins;

WITH ins AS (
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    'rls-test-b-supporter1@example.test', 'not-a-real-hash-local-seed-only',
    now() - interval '1 day', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now() - interval '1 day', now() - interval '1 day', '', '', '', '', false, false
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_supporter_auth', id FROM ins;


-- ============================================================
-- 2. family_members（各家族: 保護者1・こども1・みまもり1）
-- ============================================================
-- avatar_colorは本番と同じ採番関数 public.next_member_avatar_color() を使う
-- （実装メモ.md 100章のパレット10色から、家族内で未使用の色を選ぶ）。
WITH ins AS (
  INSERT INTO family_members (family_id, display_name, role, avatar_color, auth_user_id, is_owner, is_active, created_at, updated_at)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_a'), 'TEST-A-Parent1', 'parent',
    public.next_member_avatar_color((SELECT id FROM _seed_ids WHERE key = 'fam_a')),
    (SELECT id FROM _seed_ids WHERE key = 'a_parent_auth'), true, true,
    now() - interval '2 days', now() - interval '2 days'
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_parent', id FROM ins;

WITH ins AS (
  INSERT INTO family_members (family_id, display_name, role, avatar_color, is_active, created_at, updated_at)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_a'), 'TEST-A-Child1', 'child',
    public.next_member_avatar_color((SELECT id FROM _seed_ids WHERE key = 'fam_a')),
    true, now() - interval '2 days' + interval '1 minute', now() - interval '2 days' + interval '1 minute'
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_child', id FROM ins;

WITH ins AS (
  INSERT INTO family_members (family_id, display_name, role, avatar_color, auth_user_id, is_active, created_at, updated_at)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_a'), 'TEST-A-Supporter1', 'supporter',
    public.next_member_avatar_color((SELECT id FROM _seed_ids WHERE key = 'fam_a')),
    (SELECT id FROM _seed_ids WHERE key = 'a_supporter_auth'), true,
    now() - interval '2 days' + interval '2 minutes', now() - interval '2 days' + interval '2 minutes'
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_supporter', id FROM ins;

WITH ins AS (
  INSERT INTO family_members (family_id, display_name, role, avatar_color, auth_user_id, is_owner, is_active, created_at, updated_at)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_b'), 'TEST-B-Parent1', 'parent',
    public.next_member_avatar_color((SELECT id FROM _seed_ids WHERE key = 'fam_b')),
    (SELECT id FROM _seed_ids WHERE key = 'b_parent_auth'), true, true,
    now() - interval '1 day', now() - interval '1 day'
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_parent', id FROM ins;

WITH ins AS (
  INSERT INTO family_members (family_id, display_name, role, avatar_color, is_active, created_at, updated_at)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_b'), 'TEST-B-Child1', 'child',
    public.next_member_avatar_color((SELECT id FROM _seed_ids WHERE key = 'fam_b')),
    true, now() - interval '1 day' + interval '1 minute', now() - interval '1 day' + interval '1 minute'
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_child', id FROM ins;

WITH ins AS (
  INSERT INTO family_members (family_id, display_name, role, avatar_color, auth_user_id, is_active, created_at, updated_at)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_b'), 'TEST-B-Supporter1', 'supporter',
    public.next_member_avatar_color((SELECT id FROM _seed_ids WHERE key = 'fam_b')),
    (SELECT id FROM _seed_ids WHERE key = 'b_supporter_auth'), true,
    now() - interval '1 day' + interval '2 minutes', now() - interval '1 day' + interval '2 minutes'
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_supporter', id FROM ins;


-- ============================================================
-- 3. family_member_pins（こどものPIN。role='child'のみ許可、トリガーで検証済み）
-- ============================================================
INSERT INTO family_member_pins (member_id, pin_hash) VALUES
  ((SELECT id FROM _seed_ids WHERE key = 'a_child'), 'test-pin-hash-not-a-real-hash-a'),
  ((SELECT id FROM _seed_ids WHERE key = 'b_child'), 'test-pin-hash-not-a-real-hash-b');


-- ============================================================
-- 4. categories
-- ============================================================
WITH ins AS (
  INSERT INTO categories (family_id, name, color, sort_order)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'fam_a'), 'テストカテゴリA', '#3FA34D', 0)
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_cat', id FROM ins;

WITH ins AS (
  INSERT INTO categories (family_id, name, color, sort_order)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'fam_b'), 'テストカテゴリB', '#2F80ED', 0)
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_cat', id FROM ins;


-- ============================================================
-- 5. chores（family scope・personal scope）
-- ============================================================
-- [トリガー注意] chores_before_write() は INSERT のたびに created_by を
-- current_family_member_id() で強制上書きする（実装メモ.md 105章参照）。
-- そのため INSERT の直前に request.jwt.claims を「作成者になりすます」形で
-- 設定する。scope='personal' の場合は assigned_to も created_by に強制される。

-- --- 家族A: 保護者になりすまして family scope のchoreを2件作成 ---
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'a_parent'))::text, false);

WITH ins AS (
  INSERT INTO chores (family_id, category_id, title, emoji, points, is_repeatable, daily_limit, scope, is_active)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_a'), (SELECT id FROM _seed_ids WHERE key = 'a_cat'),
    'テストお手伝いA1(おさらあらい)', '🍽️', 50, true, 10, 'family', true
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_chore1', id FROM ins;

WITH ins AS (
  INSERT INTO chores (family_id, category_id, title, emoji, points, is_repeatable, scope, is_active)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_a'), (SELECT id FROM _seed_ids WHERE key = 'a_cat'),
    'テストお手伝いA2(にわそうじ)', '🌳', 80, false, 'family', true
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_chore2', id FROM ins;

-- --- 家族A: みまもりメンバーになりすまして personal scope のchoreを1件作成 ---
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'a_supporter'))::text, false);

WITH ins AS (
  INSERT INTO chores (family_id, title, emoji, points, is_repeatable, daily_limit, scope, is_active)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_a'),
    'テストみまもり専用お手伝いA', '🧹', 30, true, 5, 'personal', true
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_chore_personal', id FROM ins;

-- --- 家族B: 同じパターンを再現 ---
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'b_parent'))::text, false);

WITH ins AS (
  INSERT INTO chores (family_id, category_id, title, emoji, points, is_repeatable, daily_limit, scope, is_active)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_b'), (SELECT id FROM _seed_ids WHERE key = 'b_cat'),
    'テストお手伝いB1(せんたく)', '🧺', 40, true, 10, 'family', true
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_chore1', id FROM ins;

WITH ins AS (
  INSERT INTO chores (family_id, category_id, title, emoji, points, is_repeatable, scope, is_active)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_b'), (SELECT id FROM _seed_ids WHERE key = 'b_cat'),
    'テストお手伝いB2(くつならべ)', '👟', 60, false, 'family', true
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_chore2', id FROM ins;

SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'b_supporter'))::text, false);

WITH ins AS (
  INSERT INTO chores (family_id, title, emoji, points, is_repeatable, daily_limit, scope, is_active)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_b'),
    'テストみまもり専用お手伝いB', '🧹', 25, true, 5, 'personal', true
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_chore_personal', id FROM ins;


-- ============================================================
-- 6. chore_completions
-- ============================================================
-- [トリガー注意] chore_completions_before_insert() は family_id/chore_title/
-- chore_emoji/points をchoreの現在値から自動補完する（JWTクレームには依存
-- しない）。reported_by は改ざん防止の対象外（そのまま使われる）なので、
-- request.jwt.claims を設定し直す必要はない。

-- --- 家族A ---
WITH ins AS (
  INSERT INTO chore_completions (chore_id, reported_by, note)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'a_chore1'), (SELECT id FROM _seed_ids WHERE key = 'a_child'), 'テスト完了A-1')
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_comp1', id FROM ins;

INSERT INTO chore_completions (chore_id, reported_by, note)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'a_chore1'), (SELECT id FROM _seed_ids WHERE key = 'a_child'), 'テスト完了A-2');

WITH ins AS (
  INSERT INTO chore_completions (chore_id, reported_by, note)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'a_chore2'), (SELECT id FROM _seed_ids WHERE key = 'a_child'), 'テスト完了A-3(にわそうじ)')
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_comp_child_chore2', id FROM ins;

-- 保護者自身の完了報告（要件定義書07-4章「親の完了報告」の実データ）
WITH ins AS (
  INSERT INTO chore_completions (chore_id, reported_by, note)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'a_chore1'), (SELECT id FROM _seed_ids WHERE key = 'a_parent'), 'テスト完了A-4(親の完了報告)')
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_comp_parent', id FROM ins;

INSERT INTO chore_completions (chore_id, reported_by, note)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'a_chore_personal'), (SELECT id FROM _seed_ids WHERE key = 'a_supporter'), 'テスト完了A-5(みまもり専用)');

-- --- 家族B ---
WITH ins AS (
  INSERT INTO chore_completions (chore_id, reported_by, note)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'b_chore1'), (SELECT id FROM _seed_ids WHERE key = 'b_child'), 'テスト完了B-1')
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_comp1', id FROM ins;

INSERT INTO chore_completions (chore_id, reported_by, note)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'b_chore1'), (SELECT id FROM _seed_ids WHERE key = 'b_child'), 'テスト完了B-2');

WITH ins AS (
  INSERT INTO chore_completions (chore_id, reported_by, note)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'b_chore2'), (SELECT id FROM _seed_ids WHERE key = 'b_child'), 'テスト完了B-3(くつならべ)')
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_comp_child_chore2', id FROM ins;

WITH ins AS (
  INSERT INTO chore_completions (chore_id, reported_by, note)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'b_chore1'), (SELECT id FROM _seed_ids WHERE key = 'b_parent'), 'テスト完了B-4(親の完了報告)')
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_comp_parent', id FROM ins;

INSERT INTO chore_completions (chore_id, reported_by, note)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'b_chore_personal'), (SELECT id FROM _seed_ids WHERE key = 'b_supporter'), 'テスト完了B-5(みまもり専用)');

-- [自動] chore_completionsへのINSERTのたびに以下がAFTER INSERTトリガーで
-- 自動的に作られる（本ファイルでの手動INSERT不要）:
--   - gacha_member_progress（あと◯回でガチャ、報告者本人分を+1）
--   - family_tree_seasons（今月のシーズン行が無ければ作成し、+1）


-- ============================================================
-- 7. chore_reactions
-- ============================================================
INSERT INTO chore_reactions (completion_id, reacted_by, kind, stamp_key) VALUES
  ((SELECT id FROM _seed_ids WHERE key = 'a_comp1'), (SELECT id FROM _seed_ids WHERE key = 'a_parent'),     'stamp', 'great'),
  ((SELECT id FROM _seed_ids WHERE key = 'a_comp1'), (SELECT id FROM _seed_ids WHERE key = 'a_supporter'),  'stamp', 'thanks'),
  ((SELECT id FROM _seed_ids WHERE key = 'b_comp1'), (SELECT id FROM _seed_ids WHERE key = 'b_parent'),     'stamp', 'great'),
  ((SELECT id FROM _seed_ids WHERE key = 'b_comp1'), (SELECT id FROM _seed_ids WHERE key = 'b_supporter'),  'stamp', 'thanks');


-- ============================================================
-- 8. chore_daily_flags（「まいにち」個人設定。トリガー無し、直接INSERT）
-- ============================================================
INSERT INTO chore_daily_flags (family_id, member_id, chore_id) VALUES
  ((SELECT id FROM _seed_ids WHERE key = 'fam_a'), (SELECT id FROM _seed_ids WHERE key = 'a_child'), (SELECT id FROM _seed_ids WHERE key = 'a_chore1')),
  ((SELECT id FROM _seed_ids WHERE key = 'fam_b'), (SELECT id FROM _seed_ids WHERE key = 'b_child'), (SELECT id FROM _seed_ids WHERE key = 'b_chore1'));


-- ============================================================
-- 9. rewards（family scope・personal scope）
-- ============================================================
-- [トリガー注意] chores同様、rewards_before_write() がcreated_byを
-- current_family_member_id() で強制上書きする。

SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'a_parent'))::text, false);

WITH ins AS (
  INSERT INTO rewards (family_id, name, emoji, cost, description, scope, is_active)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'fam_a'), 'テストごほうびA1', '🎁', 100, 'テスト用の説明文', 'family', true)
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_reward1', id FROM ins;

SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'a_supporter'))::text, false);

WITH ins AS (
  INSERT INTO rewards (family_id, name, emoji, cost, scope, is_active)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'fam_a'), 'テストみまもり専用ごほうびA', '🎫', 20, 'personal', true)
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_reward_personal', id FROM ins;

SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'b_parent'))::text, false);

WITH ins AS (
  INSERT INTO rewards (family_id, name, emoji, cost, description, scope, is_active)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'fam_b'), 'テストごほうびB1', '🎁', 90, 'テスト用の説明文', 'family', true)
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_reward1', id FROM ins;

SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'b_supporter'))::text, false);

WITH ins AS (
  INSERT INTO rewards (family_id, name, emoji, cost, scope, is_active)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'fam_b'), 'テストみまもり専用ごほうびB', '🎫', 15, 'personal', true)
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_reward_personal', id FROM ins;


-- ============================================================
-- 10. reward_redemptions
-- ============================================================
-- [トリガー注意] reward_redemptions_before_insert() はJWTクレームに依存せず、
-- NEW.member_id / NEW.reward_id とmember_points（残高View）だけで完結する。
-- 家族A: 子ども(180pt想定=50+50+80)が100ptのごほうびを交換、
-- みまもり(30pt想定)が20ptの自分専用ごほうびを交換。家族Bも同型。
INSERT INTO reward_redemptions (reward_id, member_id) VALUES
  ((SELECT id FROM _seed_ids WHERE key = 'a_reward1'), (SELECT id FROM _seed_ids WHERE key = 'a_child'));

INSERT INTO reward_redemptions (reward_id, member_id) VALUES
  ((SELECT id FROM _seed_ids WHERE key = 'a_reward_personal'), (SELECT id FROM _seed_ids WHERE key = 'a_supporter'));

INSERT INTO reward_redemptions (reward_id, member_id) VALUES
  ((SELECT id FROM _seed_ids WHERE key = 'b_reward1'), (SELECT id FROM _seed_ids WHERE key = 'b_child'));

INSERT INTO reward_redemptions (reward_id, member_id) VALUES
  ((SELECT id FROM _seed_ids WHERE key = 'b_reward_personal'), (SELECT id FROM _seed_ids WHERE key = 'b_supporter'));


-- ============================================================
-- 11. gratitude_points（感謝ポイント。1日3ptの上限に収まる範囲で投入）
-- ============================================================
-- [注意] みまもりメンバーは送信・受信いずれも対象外（RLSで制限。実運用と
-- 合わせるため、みまもりメンバーがsender/recipientになるデータは作らない）。
INSERT INTO gratitude_points (sender_id, recipient_id, points, note) VALUES
  ((SELECT id FROM _seed_ids WHERE key = 'a_parent'), (SELECT id FROM _seed_ids WHERE key = 'a_child'), 2, 'テストありがとうA-1'),
  ((SELECT id FROM _seed_ids WHERE key = 'a_child'),  (SELECT id FROM _seed_ids WHERE key = 'a_parent'), 1, 'テストありがとうA-2'),
  ((SELECT id FROM _seed_ids WHERE key = 'b_parent'), (SELECT id FROM _seed_ids WHERE key = 'b_child'), 2, 'テストありがとうB-1'),
  ((SELECT id FROM _seed_ids WHERE key = 'b_child'),  (SELECT id FROM _seed_ids WHERE key = 'b_parent'), 1, 'テストありがとうB-2');


-- ============================================================
-- 12. push_tokens
-- ============================================================
INSERT INTO push_tokens (member_id, expo_push_token) VALUES
  ((SELECT id FROM _seed_ids WHERE key = 'a_parent'), 'ExponentPushToken[test-a-parent-000000]'),
  ((SELECT id FROM _seed_ids WHERE key = 'a_child'),  'ExponentPushToken[test-a-child-0000000]'),
  ((SELECT id FROM _seed_ids WHERE key = 'b_parent'), 'ExponentPushToken[test-b-parent-000000]'),
  ((SELECT id FROM _seed_ids WHERE key = 'b_child'),  'ExponentPushToken[test-b-child-0000000]');


-- ============================================================
-- 13. family_invites
-- ============================================================
-- [トリガー注意] family_invites_before_insert() はfamily_id/created_by/role/
-- statusのすべてをJWTクレーム経由で無条件に上書きする。招待の承認
-- （accept_family_invite）はauth.jwt()->>'email'の一致確認等が絡み実運用の
-- ログインを要するため、本ファイルでは承認まで行わず「pending」のままにする
-- （それだけでも22テーブルのうち1行を埋める目的は満たす）。
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'a_parent'))::text, false);

INSERT INTO family_invites (invited_email, token)
VALUES ('rls-test-a-invitee@example.test', 'test-invite-token-a-' || substr(md5(random()::text), 1, 16));

SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'b_parent'))::text, false);

INSERT INTO family_invites (invited_email, token)
VALUES ('rls-test-b-invitee@example.test', 'test-invite-token-b-' || substr(md5(random()::text), 1, 16));


-- ============================================================
-- 14. family_drawings（秘匿性RLSの核心。A層で最も重要なテーブルの1つ）
-- ============================================================
-- [トリガー注意] family_drawings_before_insert() はfamily_id/artist_member_id
-- をJWTクレームから強制し、is_published/published_at/revealed_by_draw_idは
-- 常にfalse/NULL/NULLで作成する（公開状態の変更経路はガチャのみという設計を
-- 破らないため）。1枚は未公開のまま残し（＝A層が最も検査したい「他家族の
-- 保護者からも絶対に見えてはいけないデータ」）、もう1枚は後続17章で
-- 直接UPDATEして公開状態にする（draw_gacha()の結果を模した状態を作るため。
-- 理由は17章コメント参照）。line_dataの色は実装メモ.md 直近の許可リスト
-- （20260829150000_drawing_palette_red_pink.sql適用後の8色）から選んでいる。

-- --- 家族A ---
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'a_child'))::text, false);

WITH ins AS (
  INSERT INTO family_drawings (line_data)
  VALUES ('{"v":1,"lines":[{"c":"#3FA34D","p":[10,10,20,20,30,10]}]}'::jsonb)
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_draw_unpub', id FROM ins;

SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'a_supporter'))::text, false);

WITH ins AS (
  INSERT INTO family_drawings (line_data)
  VALUES ('{"v":1,"lines":[{"c":"#2F80ED","p":[5,5,15,15,25,5]}]}'::jsonb)
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_draw_topub', id FROM ins;

-- --- 家族B ---
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'b_child'))::text, false);

WITH ins AS (
  INSERT INTO family_drawings (line_data)
  VALUES ('{"v":1,"lines":[{"c":"#F5C518","p":[12,12,22,22,32,12]}]}'::jsonb)
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_draw_unpub', id FROM ins;

SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'b_supporter'))::text, false);

WITH ins AS (
  INSERT INTO family_drawings (line_data)
  VALUES ('{"v":1,"lines":[{"c":"#8B5CD6","p":[6,6,16,16,26,6]}]}'::jsonb)
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_draw_topub', id FROM ins;


-- ============================================================
-- 15. gacha_draws（抽選ログ。draw_gacha()は呼ばずテーブルへ直接記録する）
-- ============================================================
-- [設計判断] draw_gacha()はランダム抽選のため「絵が当たる」結果を確実に
-- 再現できない。draw_gacha()自体のロジック検証は本タスクの対象外（A層＝
-- 家族間分離のRLS検査）であるため、SECURITY DEFINER関数を経由せず、
-- gacha_draws・family_drawingsへ直接その「結果」を記録する（gacha_drawsには
-- INSERT/UPDATE/DELETEのRLSポリシーが1つも無く、postgres権限であれば
-- テーブル制約を満たす限り直接書き込める。トリガーも無いためJWTクレームの
-- 設定は不要）。抽選対象は自分専用の絵（a_draw_topub / b_draw_topub）とし、
-- 実際のdraw_gacha()と同じ「引いた本人（member_id）と絵の作者が別人」という
-- 制約を満たす形にしている。

WITH ins AS (
  INSERT INTO gacha_draws (family_id, member_id, prize_kind, prize_drawing_id, consumed_completion_from, consumed_completion_to)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_a'),
    (SELECT id FROM _seed_ids WHERE key = 'a_parent'),
    'family_drawing',
    (SELECT id FROM _seed_ids WHERE key = 'a_draw_topub'),
    1, 5
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_gacha1', id FROM ins;

WITH ins AS (
  INSERT INTO gacha_draws (family_id, member_id, prize_kind, prize_drawing_id, consumed_completion_from, consumed_completion_to)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_b'),
    (SELECT id FROM _seed_ids WHERE key = 'b_parent'),
    'family_drawing',
    (SELECT id FROM _seed_ids WHERE key = 'b_draw_topub'),
    1, 5
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_gacha1', id FROM ins;


-- ============================================================
-- 16. gacha_preset_ornaments — 追加投入なし（確認のみ）
-- ============================================================
-- 全家族共通のグローバルカタログであり、20260825120000マイグレーション自身が
-- 初期データ8件を投入済み（家族ごとのデータではないため、本ファイルでの
-- 追加投入は不要。rls_checks.sqlのA層でもこのテーブルだけは対象外にしている
-- 理由をrls_checks.sql側のコメントに明記した）。


-- ============================================================
-- 17. family_drawings の公開状態を直接更新（draw_gacha()の結果を模す）
-- ============================================================
-- [重要] family_drawingsにはUPDATEポリシーが1つも無い（本番ではdraw_gacha()
-- 経由でのみ公開状態が変わる設計）。postgres権限のUPDATEはRLSをバイパスする
-- ため直接実行できるが、これは「トリガーの無効化」ではない
-- （BEFORE INSERTトリガーはINSERT時にしか発火せず、UPDATEには最初から
-- 関与していない。本ファイルはDISABLE TRIGGERを一度も使っていない）。
UPDATE family_drawings
SET is_published = true, published_at = now(), revealed_by_draw_id = (SELECT id FROM _seed_ids WHERE key = 'a_gacha1')
WHERE id = (SELECT id FROM _seed_ids WHERE key = 'a_draw_topub');

UPDATE family_drawings
SET is_published = true, published_at = now(), revealed_by_draw_id = (SELECT id FROM _seed_ids WHERE key = 'b_gacha1')
WHERE id = (SELECT id FROM _seed_ids WHERE key = 'b_draw_topub');


-- ============================================================
-- 18. family_tree_decorations（木への飾り付け）
-- ============================================================
-- season_idは6章のchore_completions INSERTで自動生成済みの「進行中シーズン」
-- （season_end IS NULL）を実行時に検索して使う（IDを直書きしない）。
WITH ins AS (
  INSERT INTO family_tree_decorations (family_id, season_id, completion_id, draw_id)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_a'),
    (SELECT id FROM family_tree_seasons WHERE family_id = (SELECT id FROM _seed_ids WHERE key = 'fam_a') AND season_end IS NULL),
    (SELECT id FROM _seed_ids WHERE key = 'a_comp_parent'),
    (SELECT id FROM _seed_ids WHERE key = 'a_gacha1')
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_tree_deco1', id FROM ins;

WITH ins AS (
  INSERT INTO family_tree_decorations (family_id, season_id, completion_id, draw_id)
  VALUES (
    (SELECT id FROM _seed_ids WHERE key = 'fam_b'),
    (SELECT id FROM family_tree_seasons WHERE family_id = (SELECT id FROM _seed_ids WHERE key = 'fam_b') AND season_end IS NULL),
    (SELECT id FROM _seed_ids WHERE key = 'b_comp_parent'),
    (SELECT id FROM _seed_ids WHERE key = 'b_gacha1')
  ) RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_tree_deco1', id FROM ins;


-- ============================================================
-- 19. family_board_posts（家族の書き込みボード）
-- ============================================================
-- [トリガー注意] family_board_posts_before_insert() はauthor_member_idから
-- family_idを補完するだけで、JWTクレームには依存しない。
WITH ins AS (
  INSERT INTO family_board_posts (author_member_id, body)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'a_parent'), 'テスト投稿A-1(家族の書き込みボード)')
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_post1', id FROM ins;

INSERT INTO family_board_posts (author_member_id, body)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'a_child'), 'テスト投稿A-2(家族の書き込みボード)');

WITH ins AS (
  INSERT INTO family_board_posts (author_member_id, body)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'b_parent'), 'テスト投稿B-1(家族の書き込みボード)')
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_post1', id FROM ins;

INSERT INTO family_board_posts (author_member_id, body)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'b_child'), 'テスト投稿B-2(家族の書き込みボード)');


-- ============================================================
-- 20. family_board_reactions（掲示板リアクション。LINE風・個数表示版）
-- ============================================================
-- [トリガー注意] family_board_reactions_before_insert() はpost_idから
-- family_idを補完し、自己リアクションを拒否する。自分の投稿にはリアクション
-- しない組み合わせにしている。
INSERT INTO family_board_reactions (post_id, reactor_member_id, stamp_key) VALUES
  ((SELECT id FROM _seed_ids WHERE key = 'a_post1'), (SELECT id FROM _seed_ids WHERE key = 'a_supporter'), 'like'),
  ((SELECT id FROM _seed_ids WHERE key = 'a_post1'), (SELECT id FROM _seed_ids WHERE key = 'a_child'),      'love'),
  ((SELECT id FROM _seed_ids WHERE key = 'b_post1'), (SELECT id FROM _seed_ids WHERE key = 'b_supporter'), 'like'),
  ((SELECT id FROM _seed_ids WHERE key = 'b_post1'), (SELECT id FROM _seed_ids WHERE key = 'b_child'),      'love');


-- ============================================================
-- 21. weekly_family_digests（今週のまとめメッセージ）
-- ============================================================
-- generate_weekly_family_digest()はp_family_idを引数に取るSECURITY DEFINER
-- 関数で、JWTクレームには依存しない。EXECUTE権限はservice_role/postgres限定
-- （authenticated/anonからはREVOKE済み）だが、本ファイルはpostgres権限で
-- 実行されるため直接呼び出せる。
SELECT public.generate_weekly_family_digest(
  (SELECT id FROM _seed_ids WHERE key = 'fam_a'),
  public.jst_week_start_date(now())
);

SELECT public.generate_weekly_family_digest(
  (SELECT id FROM _seed_ids WHERE key = 'fam_b'),
  public.jst_week_start_date(now())
);


-- ============================================================
-- 22. 後片付け: なりすましJWTクレームを解除する
-- ============================================================
SELECT set_config('request.jwt.claims', '', false);


-- ============================================================
-- 確認用サマリ（投入結果の目視確認）
-- ============================================================
SELECT
  f.name AS family_name,
  (SELECT count(*) FROM family_members fm WHERE fm.family_id = f.id) AS members,
  (SELECT count(*) FROM chores c WHERE c.family_id = f.id) AS chores,
  (SELECT count(*) FROM chore_completions cc WHERE cc.family_id = f.id) AS completions,
  (SELECT count(*) FROM rewards r WHERE r.family_id = f.id) AS rewards,
  (SELECT count(*) FROM reward_redemptions rr WHERE rr.family_id = f.id) AS redemptions,
  (SELECT count(*) FROM gratitude_points gp WHERE gp.family_id = f.id) AS gratitude,
  (SELECT count(*) FROM family_drawings fd WHERE fd.family_id = f.id) AS drawings,
  (SELECT count(*) FROM family_drawings fd WHERE fd.family_id = f.id AND NOT fd.is_published) AS drawings_unpublished,
  (SELECT count(*) FROM family_board_posts fbp WHERE fbp.family_id = f.id) AS board_posts,
  (SELECT count(*) FROM family_board_reactions fbr WHERE fbr.family_id = f.id) AS board_reactions,
  (SELECT count(*) FROM family_tree_seasons fts WHERE fts.family_id = f.id) AS tree_seasons,
  (SELECT count(*) FROM weekly_family_digests wfd WHERE wfd.family_id = f.id) AS weekly_digests
FROM families f
ORDER BY f.created_at;

DROP TABLE _seed_ids;
