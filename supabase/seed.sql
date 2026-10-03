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
--   「テスト家族」を2つ作り、RLSが有効な23テーブル（105章作成当初は22テーブル。
--   NFCタグの人ごと化・実装メモ.md 108章でchore_nfc_tagsが追加された）のうち
--   実データを入れられるものすべてに一通りのデータを投入する。
--   supabase/tests/rls_checks.sql のA層はこのデータの存在を前提に
--   「家族が2つ以上あるか」で実行可否を判定する。
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
-- 22. chore_nfc_tags（NFCタグの人ごと化、2026-09-01追加・実装メモ.md 108章）
-- ============================================================
-- [トリガー注意] chore_nfc_tags_before_write()（設計部/成果物/スキーマ設計.sql
-- 39.3章）はJWTクレームに一切依存しない（current_family_member_id()を呼ばない）。
-- chore_id/member_idから対象chore・memberを直接引いてfamily一致・personal
-- scopeの持ち主一致・上限枚数を検証するだけのため、なりすましトリック
-- （105.2(4)章）は不要で、postgres権限のまま素のINSERTでよい。
INSERT INTO chore_nfc_tags (chore_id, member_id, tag_value) VALUES
  ((SELECT id FROM _seed_ids WHERE key = 'a_chore1'), (SELECT id FROM _seed_ids WHERE key = 'a_child'), 'seed-a-tag-child-chore1'),
  ((SELECT id FROM _seed_ids WHERE key = 'a_chore1'), (SELECT id FROM _seed_ids WHERE key = 'a_parent'), 'seed-a-tag-parent-chore1'),
  ((SELECT id FROM _seed_ids WHERE key = 'a_chore_personal'), (SELECT id FROM _seed_ids WHERE key = 'a_supporter'), 'seed-a-tag-supporter-personal'),
  ((SELECT id FROM _seed_ids WHERE key = 'b_chore1'), (SELECT id FROM _seed_ids WHERE key = 'b_child'), 'seed-b-tag-child-chore1'),
  ((SELECT id FROM _seed_ids WHERE key = 'b_chore1'), (SELECT id FROM _seed_ids WHERE key = 'b_parent'), 'seed-b-tag-parent-chore1'),
  ((SELECT id FROM _seed_ids WHERE key = 'b_chore_personal'), (SELECT id FROM _seed_ids WHERE key = 'b_supporter'), 'seed-b-tag-supporter-personal');


-- ============================================================
-- 23. join_consents（招待受諾フローの可視範囲説明への同意記録。2026-09-02追加・
--     開発部/成果物/実装メモ.md 111章）
-- ============================================================
-- [トリガー注意] join_consentsにはBEFORE INSERTトリガーが無く、INSERT用のRLS
-- ポリシーも一切定義されていない（設計部/成果物/スキーマ設計.sql 40.4章。
-- 本番ではjoin_family_with_invite_code/accept_family_inviteの内部からのみ
-- 書き込まれる）。本ファイルはpostgres（スーパーユーザー）権限で実行される
-- ためRLSはバイパスされ、素のINSERTで直接書き込める。RPCを経由しない直接
-- INSERTだが、A23（他家族の行が見えないこと）を検査するためのデータとしては
-- これで十分（A層はSELECT結果のみを見る）。
-- 実運用でこの家族のメンバーが実際にRPC経由で参加したときの同意記録を模して、
-- 各家族の保護者1名につき1行、current_join_consent_version()の現行値（1）で
-- 投入する。
INSERT INTO join_consents (family_id, family_member_id, consent_version) VALUES
  ((SELECT id FROM _seed_ids WHERE key = 'fam_a'), (SELECT id FROM _seed_ids WHERE key = 'a_parent'), 1),
  ((SELECT id FROM _seed_ids WHERE key = 'fam_b'), (SELECT id FROM _seed_ids WHERE key = 'b_parent'), 1);


-- ============================================================
-- 23b. member_avatar_stocks（「まえのアバター」。2026-09-30追加・要件定義書07-44章、
--      開発部/成果物/実装メモ.md 334章）
-- ============================================================
-- 表が0件だと、rls_checks.sqlのB-S1〜B-S3・A32が「何も見えない」を自明に満たして
-- しまい、RLSが緩くても通る（設計部/成果物/スキーマ設計.sql 81.8章の前提1）。
-- そのため各家族の子ども・保護者・みまもりに行を入れる。INSERT用のRLSポリシーは
-- 一切無い（本番ではRPCだけが書く）が、本ファイルはpostgres権限で実行されるため
-- 素のINSERTでよい。トリガーも無い。絵は1本の線だけの最小のもの（pの最初の値が
-- 違えば別の絵）。家族A（代表ロールとして選ばれる側）の子どもには2枚、他は1枚。
INSERT INTO member_avatar_stocks (member_id, family_id, line_data)
SELECT (SELECT id FROM _seed_ids WHERE key = v.member_key),
       (SELECT id FROM _seed_ids WHERE key = v.family_key),
       jsonb_build_object('v', 1, 'lines', jsonb_build_array(
         jsonb_build_object('c', '#2E2E2E', 'p', jsonb_build_array(v.x, 100, 200, 200))))
FROM (VALUES
  ('a_child',     'fam_a', 110),
  ('a_child',     'fam_a', 111),
  ('a_parent',    'fam_a', 120),
  ('a_supporter', 'fam_a', 130),
  ('b_child',     'fam_b', 140),
  ('b_parent',    'fam_b', 150),
  ('b_supporter', 'fam_b', 160)
) AS v(member_key, family_key, x);


-- ============================================================
-- 23c. chores.is_request（保護者から子どもへの「おねがい」。2026-09-30追加・要件定義書
--      07-43章、開発部/成果物/実装メモ.md 335章、設計部/成果物/スキーマ設計.sql 82.14章）
-- ============================================================
-- 0件だと、rls_checks.sqlのB-R1・B-R2・A-R1・C-R8が「何も見えない／何も違反しない」を
-- 自明に満たしてしまい、RLSが緩くても通る（82.14章の前提）。そのため各家族に
-- 「やってくれた（完了報告あり）おねがい」1件と、家族Aにはさらに「未完了のおねがい」1件、
-- 完了通知の記録（chore_request_done_notices）を入れる。
-- ・chores_request_guard()（検証）は通常どおり通す（トリガーは無効化していない）。
--   created_byはchores_before_write()がcurrent_family_member_id()で決めるため、
--   INSERTの直前に保護者になりすます。
-- ・家族トグル（push_notifications_enabled）は既定falseのままなので、通知は飛ばない。
-- ・seedの家族構成（各家族に子ども1人）は変えない。82.14章は「担当が別々の子ども2人」と
--   しているが、子どもを増やすと他の検査（代表ロールの選び方）に響くため、同じ子どもに
--   未完了1・完了1を入れる形にした（未完了の上限3の範囲内）。
-- ・chore_request_done_noticesにはINSERT用のポリシーが無い（default-deny）が、
--   本ファイルはpostgres権限で実行されるため素のINSERTでよい。
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'a_parent'))::text, false);

WITH ins AS (
  INSERT INTO chores (family_id, title, points, is_repeatable, scope, assigned_to, is_request)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'fam_a'), 'テストおねがいA1(まどふき・済)', 0, false, 'family',
          (SELECT id FROM _seed_ids WHERE key = 'a_child'), true)
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'a_request_done', id FROM ins;

INSERT INTO chores (family_id, title, points, is_repeatable, scope, assigned_to, is_request)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'fam_a'), 'テストおねがいA2(みずやり・未完了)', 0, false, 'family',
        (SELECT id FROM _seed_ids WHERE key = 'a_child'), true);

INSERT INTO chore_completions (chore_id, reported_by, note)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'a_request_done'), (SELECT id FROM _seed_ids WHERE key = 'a_child'), 'テスト完了A-おねがい');

-- [2026-09-30再改訂・要件定義書07-43章決定20〜27、設計部82.19.9章、実装メモ341章]
-- ポイント付きのおねがい。0ptだけのseedだと、C-R16・B層が「ポイントがあっても見える／数えられる」を
-- 確かめられない。家族Aに「未完了の2pt」（上のA2と合わせて未完了2つ。上限3の範囲内）、
-- 家族Bに「やってくれた3pt」（完了報告付き。子どもの残高が+3になる）を入れる。
INSERT INTO chores (family_id, title, points, is_repeatable, scope, assigned_to, is_request)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'fam_a'), 'テストおねがいA3(かたづけ・2pt・未完了)', 2, false, 'family',
        (SELECT id FROM _seed_ids WHERE key = 'a_child'), true);

INSERT INTO chore_request_done_notices (chore_id, family_id)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'a_request_done'), (SELECT id FROM _seed_ids WHERE key = 'fam_a'));

SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'b_parent'))::text, false);

WITH ins AS (
  INSERT INTO chores (family_id, title, points, is_repeatable, scope, assigned_to, is_request)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'fam_b'), 'テストおねがいB1(くつみがき・済)', 0, false, 'family',
          (SELECT id FROM _seed_ids WHERE key = 'b_child'), true)
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_request_done', id FROM ins;

INSERT INTO chore_completions (chore_id, reported_by, note)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'b_request_done'), (SELECT id FROM _seed_ids WHERE key = 'b_child'), 'テスト完了B-おねがい');

INSERT INTO chore_request_done_notices (chore_id, family_id)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'b_request_done'), (SELECT id FROM _seed_ids WHERE key = 'fam_b'));

WITH ins AS (
  INSERT INTO chores (family_id, title, points, is_repeatable, scope, assigned_to, is_request)
  VALUES ((SELECT id FROM _seed_ids WHERE key = 'fam_b'), 'テストおねがいB2(おてつだい・3pt・済)', 3, false, 'family',
          (SELECT id FROM _seed_ids WHERE key = 'b_child'), true)
  RETURNING id
)
INSERT INTO _seed_ids SELECT 'b_request_done_3pt', id FROM ins;

INSERT INTO chore_completions (chore_id, reported_by, note)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'b_request_done_3pt'), (SELECT id FROM _seed_ids WHERE key = 'b_child'), 'テスト完了B-おねがい(3pt)');

INSERT INTO chore_request_done_notices (chore_id, family_id)
VALUES ((SELECT id FROM _seed_ids WHERE key = 'b_request_done_3pt'), (SELECT id FROM _seed_ids WHERE key = 'fam_b'));


-- ============================================================
-- 23d. gratitude_reactions（感謝ポイントへのスタンプの返し。2026-10-03追加・要件定義書
--      07-45章、設計部/成果物/スキーマ設計.sql 83.11章・83.13章、開発部/成果物/
--      実装メモ.md 347章）
-- ============================================================
-- 0件だと、rls_checks.sqlのB-G1〜B-G4・A-G1が「何も見えない」を自明に満たしてしまい、
-- RLSが緩くても通る（83.13章の前提）。そこで家族Aに、保護者P・子どもC・みまもりSの
-- 感謝とスタンプを3組入れ、家族Bにも1組入れる:
--   G1: P→C（スタンプ arigato）／G2: S→C（スタンプ sugoi）／G3: C→P（スタンプ ganbatta）
--   B : 保護者→子ども（スタンプ arigato。A層用）
-- 期待値: 子どもCは3件・保護者Pは2件（G1・G3）・みまもりSは1件（G2）。Pにとって当事者でないのはG2の1件。
-- ・G1・G3・Bは、セクション11で入れた感謝（A-1・A-2・B-1）にスタンプを足す。G2用の
--   「みまもり→子ども」の感謝だけここで足す（みまもりは感謝を贈れる。20260907030000）。
-- ・INSERT用のポリシー・権限は無い（本番ではRPCだけが書く）が、本ファイルはpostgres権限で
--   実行されるため素のINSERTでよい。この表にトリガーは無い。
-- ・家族を削除する検査（83.11章）はこのスタンプ入りの家族を使う。
SELECT set_config('request.jwt.claims', '', false);

INSERT INTO gratitude_points (sender_id, recipient_id, points, note) VALUES
  ((SELECT id FROM _seed_ids WHERE key = 'a_supporter'), (SELECT id FROM _seed_ids WHERE key = 'a_child'), 1, 'テストありがとうA-3(みまもりから)');

INSERT INTO gratitude_reactions (gratitude_id, family_id, stamp_key)
SELECT gp.id, gp.family_id, v.stamp_key
FROM (VALUES
  ('テストありがとうA-1',               'arigato'),
  ('テストありがとうA-3(みまもりから)', 'sugoi'),
  ('テストありがとうA-2',               'ganbatta'),
  ('テストありがとうB-1',               'arigato')
) AS v(note_text, stamp_key)
JOIN gratitude_points gp ON gp.note = v.note_text;


-- ============================================================
-- 23e. member_chore_name_counts（「きろく」のクエストごとの回数。2026-10-03追加・要件定義書
--      07-46章、設計部/成果物/スキーマ設計.sql 84.10章、開発部/成果物/実装メモ.md 353章）
-- ============================================================
-- 0件だと、rls_checks.sqlのB-Q1〜B-Q5が「何も見えない」を自明に満たしてしまい、条件が緩くても
-- 通る（84.10章の前提）。そこで家族Aの子どもCに、名前のまとめ方の全パターンを入れる。
-- **chore_completionsのBEFORE INSERTトリガーがchore_title・chore_emojiをchoresから上書きする**ので、
-- 「クエストを作る→完了報告を入れる→改名または削除する」の順で作る（トリガーは無効化しない）。
-- reported_atは「いまから◯分前」にずらして、最近やった順の並びが毎回同じになるようにする
-- （1日の上限〔daily_limit〕は50にする。NULLにすると、トリガーが上限1回にしてしまう。数時間以内に収め、月をまたがない）。
--   a. 今ある「はみがき」: 4件
--   b. 消したクエストの記録名「おしっこ1人でできた」: 3件（クエストを消す。絵文字🚽）
--   c. 今ある別のクエスト「おしっこ1人でできた」（作り直し。絵文字は🚾に変える）: 1件 → bと1行にまとまる（4）
--   d. 改名: 記録名「くつ」2件→題名を「くつをそろえる」に変更→1件 → 今の名前の1行（3）
--   e. 改名してから削除: 記録名「ごはん」2件→「ごはんをたべる」に改名→1件→削除 → 2行に分かれる（2と1）
--   f. 前後に全角スペース付きの記録名「かたづけ　」1件（消す）＋今ある「かたづけ」1件 → 1行（2）
--   g. 全角「ＡＢＣ」1件・半角「ABC」1件 → 2行（同じとみなさない）
--   h. おねがいの完了: セクション23cのa_request_doneがすでに子どもCにある（1件）。ここでは足さない
-- 子どもCの期待値: 上のa〜gで8行（はみがき4・おしっこ1人でできた4・くつをそろえる3・ごはん2・
--   ごはんをたべる1・かたづけ2・ＡＢＣ1・ABC1。回数の合計18）＋セクション6のクエスト2行
--   （おさらあらい2・にわそうじ1。合計3）＝**10行・合計21**。おねがい1件は除く
--   （基礎の表のCの件数は22）。保護者P・みまもりSは各1行（セクション6）。保護者Pが見える家族Aの全員ぶんは12行・3人。
-- 家族Bの子どもにも、消したクエストを含めて少し入れる（A層用。家族Bの子どもは「はみがき」2件と、
--   消した「おしっこ1人でできた」1件）。
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'a_parent'))::text, false);

DO $seed23e$
DECLARE
  v_fam UUID := (SELECT id FROM _seed_ids WHERE key = 'fam_a');
  v_child UUID := (SELECT id FROM _seed_ids WHERE key = 'a_child');
  v_chore UUID;
  v_mins INT;
BEGIN
  -- a. 今ある「はみがき」4件
  INSERT INTO chores (family_id, title, emoji, points, is_repeatable, daily_limit, scope)
  VALUES (v_fam, 'はみがき', '🪥', 10, true, 50, 'family') RETURNING id INTO v_chore;
  FOREACH v_mins IN ARRAY ARRAY[50, 40, 30, 20] LOOP
    INSERT INTO chore_completions (chore_id, reported_by, reported_at, note)
    VALUES (v_chore, v_child, now() - make_interval(mins => v_mins), 'テスト完了23e-a');
  END LOOP;

  -- b. 消したクエストの記録名「おしっこ1人でできた」3件（絵文字🚽）→ クエストを消す
  INSERT INTO chores (family_id, title, emoji, points, is_repeatable, daily_limit, scope)
  VALUES (v_fam, 'おしっこ1人でできた', '🚽', 10, true, 50, 'family') RETURNING id INTO v_chore;
  FOREACH v_mins IN ARRAY ARRAY[55, 45, 35] LOOP
    INSERT INTO chore_completions (chore_id, reported_by, reported_at, note)
    VALUES (v_chore, v_child, now() - make_interval(mins => v_mins), 'テスト完了23e-b');
  END LOOP;
  DELETE FROM chores WHERE id = v_chore;

  -- c. 今ある別のクエスト「おしっこ1人でできた」（作り直し。絵文字は🚾）1件。bと1行にまとまる（4）
  INSERT INTO chores (family_id, title, emoji, points, is_repeatable, daily_limit, scope)
  VALUES (v_fam, 'おしっこ1人でできた', '🚾', 10, true, 50, 'family') RETURNING id INTO v_chore;
  INSERT INTO chore_completions (chore_id, reported_by, reported_at, note)
  VALUES (v_chore, v_child, now() - make_interval(mins => 10), 'テスト完了23e-c');

  -- d. 改名: 「くつ」2件→「くつをそろえる」に改名→1件。今の名前の1行（3）
  INSERT INTO chores (family_id, title, emoji, points, is_repeatable, daily_limit, scope)
  VALUES (v_fam, 'くつ', '👟', 10, true, 50, 'family') RETURNING id INTO v_chore;
  FOREACH v_mins IN ARRAY ARRAY[58, 48] LOOP
    INSERT INTO chore_completions (chore_id, reported_by, reported_at, note)
    VALUES (v_chore, v_child, now() - make_interval(mins => v_mins), 'テスト完了23e-d');
  END LOOP;
  UPDATE chores SET title = 'くつをそろえる' WHERE id = v_chore;
  INSERT INTO chore_completions (chore_id, reported_by, reported_at, note)
  VALUES (v_chore, v_child, now() - make_interval(mins => 15), 'テスト完了23e-d(改名後)');

  -- e. 改名してから削除: 「ごはん」2件→「ごはんをたべる」に改名→1件→削除。2行に分かれる（2と1）
  INSERT INTO chores (family_id, title, emoji, points, is_repeatable, daily_limit, scope)
  VALUES (v_fam, 'ごはん', '🍚', 10, true, 50, 'family') RETURNING id INTO v_chore;
  FOREACH v_mins IN ARRAY ARRAY[57, 47] LOOP
    INSERT INTO chore_completions (chore_id, reported_by, reported_at, note)
    VALUES (v_chore, v_child, now() - make_interval(mins => v_mins), 'テスト完了23e-e');
  END LOOP;
  UPDATE chores SET title = 'ごはんをたべる' WHERE id = v_chore;
  INSERT INTO chore_completions (chore_id, reported_by, reported_at, note)
  VALUES (v_chore, v_child, now() - make_interval(mins => 25), 'テスト完了23e-e(改名後)');
  DELETE FROM chores WHERE id = v_chore;

  -- f. 前後に全角スペース付きの記録名「かたづけ　」1件（クエストを消す）＋今ある「かたづけ」1件 → 1行（2）
  INSERT INTO chores (family_id, title, emoji, points, is_repeatable, daily_limit, scope)
  VALUES (v_fam, 'かたづけ　', '🧺', 10, true, 50, 'family') RETURNING id INTO v_chore;
  INSERT INTO chore_completions (chore_id, reported_by, reported_at, note)
  VALUES (v_chore, v_child, now() - make_interval(mins => 52), 'テスト完了23e-f');
  DELETE FROM chores WHERE id = v_chore;
  INSERT INTO chores (family_id, title, emoji, points, is_repeatable, daily_limit, scope)
  VALUES (v_fam, 'かたづけ', '🧺', 10, true, 50, 'family') RETURNING id INTO v_chore;
  INSERT INTO chore_completions (chore_id, reported_by, reported_at, note)
  VALUES (v_chore, v_child, now() - make_interval(mins => 12), 'テスト完了23e-f(今ある)');

  -- g. 全角「ＡＢＣ」1件・半角「ABC」1件 → 2行（同じとみなさない）
  INSERT INTO chores (family_id, title, emoji, points, is_repeatable, daily_limit, scope)
  VALUES (v_fam, 'ＡＢＣ', '🔤', 10, true, 50, 'family') RETURNING id INTO v_chore;
  INSERT INTO chore_completions (chore_id, reported_by, reported_at, note)
  VALUES (v_chore, v_child, now() - make_interval(mins => 5), 'テスト完了23e-g(全角)');
  INSERT INTO chores (family_id, title, emoji, points, is_repeatable, daily_limit, scope)
  VALUES (v_fam, 'ABC', '🔡', 10, true, 50, 'family') RETURNING id INTO v_chore;
  INSERT INTO chore_completions (chore_id, reported_by, reported_at, note)
  VALUES (v_chore, v_child, now() - make_interval(mins => 4), 'テスト完了23e-g(半角)');
END
$seed23e$;

SELECT set_config('request.jwt.claims', json_build_object('family_member_id', (SELECT id::text FROM _seed_ids WHERE key = 'b_parent'))::text, false);

DO $seed23e_b$
DECLARE
  v_fam UUID := (SELECT id FROM _seed_ids WHERE key = 'fam_b');
  v_child UUID := (SELECT id FROM _seed_ids WHERE key = 'b_child');
  v_chore UUID;
BEGIN
  INSERT INTO chores (family_id, title, emoji, points, is_repeatable, daily_limit, scope)
  VALUES (v_fam, 'はみがき', '🪥', 10, true, 50, 'family') RETURNING id INTO v_chore;
  INSERT INTO chore_completions (chore_id, reported_by, reported_at, note)
  VALUES (v_chore, v_child, now() - make_interval(mins => 30), 'テスト完了23e-B1'),
         (v_chore, v_child, now() - make_interval(mins => 20), 'テスト完了23e-B2');

  INSERT INTO chores (family_id, title, emoji, points, is_repeatable, daily_limit, scope)
  VALUES (v_fam, 'おしっこ1人でできた', '🚽', 10, true, 50, 'family') RETURNING id INTO v_chore;
  INSERT INTO chore_completions (chore_id, reported_by, reported_at, note)
  VALUES (v_chore, v_child, now() - make_interval(mins => 10), 'テスト完了23e-B3');
  DELETE FROM chores WHERE id = v_chore;
END
$seed23e_b$;


-- ============================================================
-- 24. 後片付け: なりすましJWTクレームを解除する
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
  (SELECT count(*) FROM weekly_family_digests wfd WHERE wfd.family_id = f.id) AS weekly_digests,
  (SELECT count(*) FROM chore_nfc_tags cnt WHERE cnt.family_id = f.id) AS chore_nfc_tags,
  (SELECT count(*) FROM join_consents jc WHERE jc.family_id = f.id) AS join_consents,
  (SELECT count(*) FROM member_avatar_stocks mas WHERE mas.family_id = f.id) AS member_avatar_stocks,
  (SELECT count(*) FROM chores c WHERE c.family_id = f.id AND c.is_request) AS chore_requests,
  (SELECT count(*) FROM chore_request_done_notices crdn WHERE crdn.family_id = f.id) AS request_done_notices,
  (SELECT count(*) FROM gratitude_reactions gr WHERE gr.family_id = f.id) AS gratitude_reactions
FROM families f
ORDER BY f.created_at;

DROP TABLE _seed_ids;
