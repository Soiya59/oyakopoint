-- ============================================================
-- 完了報告のコメントへの「返信」の書き込み検査（ローカルDocker専用。最後にROLLBACKする）
--
-- [2026-10-13新設・開発部] 要件定義書07-48章、設計部/成果物/スキーマ設計.sql 86.13章（V1〜V24）、
-- 開発部/成果物/実装メモ.md 364章。rls_checks.sqlは読み取り専用で、返信の「書き込みの挙動」
-- （検査トリガーの各エラー・連動削除・非表示・通知の宛先）は見ない。それをここで確かめる。
--
-- 【本番に対して実行しない】テスト家族（seed.sqlの「RLS検査用テスト家族A/B」）がある環境が前提。
-- 全体を BEGIN … ROLLBACK で囲んでいるので、ローカルのデータは変わらない。
--
-- 実行方法:
--   docker exec -i supabase_db_oyakopoint-app psql -U postgres < supabase/tests/reply_checks.sql
-- 結果は最後の表（expect が期待、got が実測、result が PASS/FAIL）。FAILが1件でもあれば直す。
-- ============================================================
BEGIN;

CREATE TEMP TABLE ids (k text PRIMARY KEY, v uuid NOT NULL);
CREATE TEMP TABLE res (n serial, label text, expect text, got text);
GRANT ALL ON ids, res TO authenticated, service_role;
GRANT USAGE ON SEQUENCE res_n_seq TO authenticated;

-- 登場人物（家族A: 保護者P・子どもC1（報告者）・みまもりS1・みまもりS2。家族B: 保護者BP・子どもBC）
INSERT INTO ids SELECT 'P',  id FROM family_members WHERE display_name = 'TEST-A-Parent1';
INSERT INTO ids SELECT 'C1', id FROM family_members WHERE display_name = 'TEST-A-Child1';
INSERT INTO ids SELECT 'S1', id FROM family_members WHERE display_name = 'TEST-A-Supporter1';
INSERT INTO ids SELECT 'S2', id FROM family_members WHERE display_name = 'テストみまもり';
INSERT INTO ids SELECT 'BP', id FROM family_members WHERE display_name = 'TEST-B-Parent1';
INSERT INTO ids SELECT 'FA', family_id FROM family_members WHERE display_name = 'TEST-A-Parent1';
INSERT INTO ids SELECT 'FB', family_id FROM family_members WHERE display_name = 'TEST-B-Parent1';
-- 検査で行を足す前の、返信でない行の数（V22用）
SELECT count(*) AS before_rows FROM chore_reactions WHERE reply_to_reaction_id IS NULL \gset
-- 完了報告: X＝C1の報告（返信先のコメントが付く）、Y＝Pの報告（別の完了報告）、BX＝家族Bの報告
INSERT INTO ids SELECT 'X',  id FROM chore_completions WHERE note = 'テスト完了A-1';
INSERT INTO ids SELECT 'Y',  id FROM chore_completions WHERE note = 'テスト完了A-4(親の完了報告)';
INSERT INTO ids SELECT 'BX', id FROM chore_completions WHERE note = 'テスト完了B-1';

-- 検査の補助。sql を実行し、成功なら 'ok'、失敗なら 'SQLSTATE メッセージ' を res に記録する（期待と比べる）。
-- {キー} は ids の uuid に置き換わる。呼び出した役割のまま実行される（SECURITY INVOKER）。
CREATE FUNCTION pg_temp.t(p_label text, p_expect text, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_sql text := p_sql;
  r record;
  v_got text;
BEGIN
  FOR r IN SELECT i.k, i.v FROM ids i LOOP
    v_sql := replace(v_sql, '{' || r.k || '}', quote_literal(r.v::text) || '::uuid');
  END LOOP;
  BEGIN
    EXECUTE v_sql;
    v_got := 'ok';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' ' || SQLERRM;
  END;
  INSERT INTO res(label, expect, got) VALUES (p_label, p_expect, v_got);
END;
$$;
-- 値を調べて記録する版（count等）。sql は1つの値(text)を返す SELECT。
CREATE FUNCTION pg_temp.v(p_label text, p_expect text, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_sql text := p_sql;
  r record;
  v_got text;
BEGIN
  FOR r IN SELECT i.k, i.v FROM ids i LOOP
    v_sql := replace(v_sql, '{' || r.k || '}', quote_literal(r.v::text) || '::uuid');
  END LOOP;
  BEGIN
    EXECUTE v_sql INTO v_got;
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' ' || SQLERRM;
  END;
  INSERT INTO res(label, expect, got) VALUES (p_label, p_expect, coalesce(v_got, 'NULL'));
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.t(text, text, text), pg_temp.v(text, text, text) TO authenticated;
-- 役割の切り替え（なりすまし）。キー名を渡す。
CREATE FUNCTION pg_temp.as_member(p_k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('family_member_id', (SELECT i.v::text FROM ids i WHERE i.k = p_k))::text, true);
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_member(text) TO authenticated;

-- ---------- 準備（管理者で）: コメント K1＝S1がXに書いたコメント、他家族のコメントBK ----------
INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body)
VALUES ((SELECT v FROM ids WHERE k='X'), (SELECT v FROM ids WHERE k='S1'), 'comment', '検査K1') RETURNING id \gset k1_
INSERT INTO ids VALUES ('K1', :'k1_id');
INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body)
VALUES ((SELECT v FROM ids WHERE k='BX'), (SELECT v FROM ids WHERE k='BP'), 'comment', '検査BK（家族B）') RETURNING id \gset bk_
INSERT INTO ids VALUES ('BK', :'bk_id');
-- 別の完了報告Yのコメント（Pの報告にS1がコメント）
INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body)
VALUES ((SELECT v FROM ids WHERE k='Y'), (SELECT v FROM ids WHERE k='S1'), 'comment', '検査YK（別の完了報告）') RETURNING id \gset yk_
INSERT INTO ids VALUES ('YK', :'yk_id');
-- スタンプ（Xに付いた保護者のスタンプ。seed）
INSERT INTO ids SELECT 'ST', id FROM chore_reactions WHERE completion_id = (SELECT v FROM ids WHERE k='X') AND kind = 'stamp' LIMIT 1;
-- 報告者C1の古い自己コメント（直接INSERTでは作れないので管理者で）
INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body)
VALUES ((SELECT v FROM ids WHERE k='X'), (SELECT v FROM ids WHERE k='C1'), 'comment', '検査自己コメント') RETURNING id \gset self_
INSERT INTO ids VALUES ('SELFK', :'self_id');

-- ---------- V1〜V3: C1（報告者）がK1に返信 ----------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_member('C1');
SELECT pg_temp.t('V1 報告者C1がK1に返信', 'ok',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査返信1', {K1}) $q$);
SELECT pg_temp.v('V1 family_idが補完され、本人に見える', '1',
  $q$ SELECT count(*)::text FROM chore_reactions WHERE reply_to_reaction_id = {K1} AND family_id = {FA} $q$);
SELECT pg_temp.t('V2 同じK1にもう一度返信', '23505 このコメントには、すでに返信があります',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査返信2', {K1}) $q$);
-- 返信のidを控える（ロール切り替え中でも ids に書ける）
INSERT INTO ids SELECT 'R1', id FROM chore_reactions WHERE reply_to_reaction_id = (SELECT v FROM ids WHERE k='K1');

-- V4: 報告者でない者の返信（S2・保護者P）
SELECT pg_temp.as_member('S2');
SELECT pg_temp.t('V4 報告者でないS2がK1に返信', '42501 返信できるのは、その完了報告をした本人だけです',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {S2}, 'comment', '検査', {K1}) $q$);
SELECT pg_temp.as_member('P');
SELECT pg_temp.t('V4 報告者でない保護者PがK1に返信', '42501 返信できるのは、その完了報告をした本人だけです',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {P}, 'comment', '検査', {K1}) $q$);
-- 他人になりすまして書く（reacted_byを他人にする）→ RLS拒否
SELECT pg_temp.as_member('C1');
SELECT pg_temp.t('V4b C1がreacted_byをS2にして返信（なりすまし）', '42501',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {S2}, 'comment', '検査', {K1}) $q$);

-- V5: 返信への返信
SELECT pg_temp.t('V5 返信R1への返信', '23514 返信には返信できません',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査', {R1}) $q$);
-- V6: 報告者自身のコメントへの返信
SELECT pg_temp.t('V6 自分（報告者）のコメントへの返信', '23514 自分のコメントには返信できません',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査', {SELFK}) $q$);
-- V7: 返信先なしで自分の報告にコメント／スタンプ
SELECT pg_temp.t('V7 返信先なしで自分の報告にコメント（従来どおり拒否）', '42501',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body)
      VALUES ({X}, {C1}, 'comment', '検査') $q$);
SELECT pg_temp.t('V7 自分の報告にスタンプ（従来どおり拒否）', 'エラーになる',
  $q$ SELECT * FROM toggle_chore_reaction_stamp({X}, 'great') $q$);
-- V8: スタンプへの返信／別の完了報告のコメントへ
SELECT pg_temp.t('V8 スタンプを返信先に', 'P0002 返信先のコメントが見つかりません',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査', {ST}) $q$);
SELECT pg_temp.t('V8 別の完了報告Yのコメントを返信先に', 'P0002 返信先のコメントが見つかりません',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査', {YK}) $q$);
-- V9: 他の家族のコメント／存在しないid
SELECT pg_temp.t('V9 他の家族のコメントを返信先に', 'P0002 返信先のコメントが見つかりません',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査', {BK}) $q$);
SELECT pg_temp.t('V9 存在しないidを返信先に', 'P0002 返信先のコメントが見つかりません',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査', gen_random_uuid()) $q$);
-- 返信先を指定して返信でないコメントを自分の報告に（reply_toだけ付けて報告者以外…は V4）。返信先なし＋他人の報告にはC1が書ける（V18）
SELECT pg_temp.t('V18 古い形（返信先なし）のコメントを他人の報告に（従来どおり通る）', 'ok',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body)
      VALUES ({Y}, {C1}, 'comment', '検査18') $q$);

-- V3: 返信を消して書き直し／5分過ぎ
SELECT pg_temp.t('V3 報告者C1が自分の返信を5分以内に削除', 'ok',
  $q$ SELECT delete_family_comment('chore_reaction_comment', {R1}) $q$);
SELECT pg_temp.t('V3 削除後、K1にもう一度返信できる', 'ok',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査返信1b', {K1}) $q$);
INSERT INTO ids SELECT 'R1b', id FROM chore_reactions WHERE reply_to_reaction_id = (SELECT v FROM ids WHERE k='K1') AND deleted_at IS NULL;
RESET ROLE;
UPDATE chore_reactions SET created_at = now() - interval '10 minutes' WHERE id = (SELECT v FROM ids WHERE k='R1b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_member('C1');
SELECT pg_temp.t('V21 5分過ぎた自分の返信は本人は消せない', 'エラーになる',
  $q$ SELECT delete_family_comment('chore_reaction_comment', {R1b}) $q$);
SELECT pg_temp.as_member('P');
SELECT pg_temp.t('V21 5分過ぎた返信を保護者は消せる', 'ok',
  $q$ SELECT delete_family_comment('chore_reaction_comment', {R1b}) $q$);
SELECT pg_temp.v('V3 保護者の削除後、K1は残っている', '1',
  $q$ SELECT count(*)::text FROM chore_reactions WHERE id = {K1} AND deleted_at IS NULL $q$);
RESET ROLE;

-- V10: 削除済み／運営が非表示のコメントを返信先に
INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, deleted_at, deleted_by_member_id)
VALUES ((SELECT v FROM ids WHERE k='X'), (SELECT v FROM ids WHERE k='S2'), 'comment', '検査削除済み', now(), (SELECT v FROM ids WHERE k='P')) RETURNING id \gset dk_
INSERT INTO ids VALUES ('DK', :'dk_id');
INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body)
VALUES ((SELECT v FROM ids WHERE k='X'), (SELECT v FROM ids WHERE k='S2'), 'comment', '検査HK（運営が非表示）') RETURNING id \gset hk_
INSERT INTO ids VALUES ('HK', :'hk_id');
INSERT INTO hidden_contents (family_id, content_kind, content_id) VALUES ((SELECT v FROM ids WHERE k='FA'), 'chore_reaction_comment', (SELECT v FROM ids WHERE k='HK'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_member('C1');
SELECT pg_temp.t('V10 削除済みのコメントを返信先に', 'P0002 返信先のコメントが見つかりません',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査', {DK}) $q$);
SELECT pg_temp.t('V10 運営が非表示のコメントを返信先に', 'P0002 返信先のコメントが見つかりません',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査', {HK}) $q$);
RESET ROLE;

-- V11: 「家族のやりとりを使う」オフ
UPDATE families SET social_interactions_enabled = false WHERE id = (SELECT v FROM ids WHERE k='FA');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_member('C1');
SELECT pg_temp.t('V11 トグルオフで返信', '23514',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査', {K1}) $q$);
SELECT pg_temp.as_member('C1');
SELECT pg_temp.t('V11 トグルオフでもスタンプは通る（C1がPの報告Yにスタンプ）', 'ok',
  $q$ SELECT * FROM toggle_chore_reaction_stamp({Y}, 'great') $q$);
RESET ROLE;
UPDATE families SET social_interactions_enabled = true WHERE id = (SELECT v FROM ids WHERE k='FA');

-- V12: 元の書き手が家族から抜けている
-- is_active（退会/復帰）はクライアントから直接変更できない（トリガー）ので、Edge Functionと同じ service_role で変える
SET LOCAL ROLE service_role;
UPDATE family_members SET is_active = false WHERE id = (SELECT v FROM ids WHERE k='S1');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_member('C1');
SELECT pg_temp.t('V12 K1を書いたS1が退会済みのとき返信', '23514 コメントを書いた人が家族にいないため、返信できません',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査', {K1}) $q$);
RESET ROLE;
-- is_active（退会/復帰）はクライアントから直接変更できない（トリガー）ので、Edge Functionと同じ service_role で変える
SET LOCAL ROLE service_role;
UPDATE family_members SET is_active = true WHERE id = (SELECT v FROM ids WHERE k='S1');
RESET ROLE;

-- V8（最後の砦）: トリガーを外しても、別の完了報告を指す返信は複合外部キーで拒否される
ALTER TABLE chore_reactions DISABLE TRIGGER trg_chore_reactions_reply_guard;
SELECT pg_temp.t('V8 トリガー無効でも別の完了報告を指す返信は複合外部キーで拒否', '23503',
  $q$ INSERT INTO chore_reactions (family_id, completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({FA}, {X}, {C1}, 'comment', '検査', {YK}) $q$);
SELECT pg_temp.t('V8 トリガー無効でも自分自身を指す返信はCHECKで拒否', '23514',
  $q$ WITH n AS (SELECT gen_random_uuid() AS i)
      INSERT INTO chore_reactions (id, family_id, completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      SELECT i, {FA}, {X}, {C1}, 'comment', '検査', i FROM n $q$);
SELECT pg_temp.t('V8 スタンプ行にreply_to_reaction_idを入れるとCHECKで拒否', '23514',
  $q$ INSERT INTO chore_reactions (family_id, completion_id, reacted_by, kind, stamp_key, reply_to_reaction_id)
      VALUES ({FA}, {X}, {S2}, 'stamp', 'thanks', {K1}) $q$);
ALTER TABLE chore_reactions ENABLE TRIGGER trg_chore_reactions_reply_guard;

-- V2（並行）の代わりに、トリガーを外しても二重返信は部分一意索引が止める
ALTER TABLE chore_reactions DISABLE TRIGGER trg_chore_reactions_reply_guard;
INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
VALUES ((SELECT v FROM ids WHERE k='X'), (SELECT v FROM ids WHERE k='C1'), 'comment', '検査返信3', (SELECT v FROM ids WHERE k='K1')) RETURNING id \gset r3_
INSERT INTO ids VALUES ('R3', :'r3_id');
SELECT pg_temp.t('V2 トリガー無効でも2つ目の返信は部分一意索引で拒否', '23505',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査返信4', {K1}) $q$);
ALTER TABLE chore_reactions ENABLE TRIGGER trg_chore_reactions_reply_guard;

-- V13: 元のコメントを消すと返信も消える（K1にR3が付いている）
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_member('S1');
SELECT pg_temp.t('V13 K1の書き手S1が5分以内にK1を削除', 'ok',
  $q$ SELECT delete_family_comment('chore_reaction_comment', {K1}) $q$);
RESET ROLE;
SELECT pg_temp.v('V13 K1とR3の両方にdeleted_atが立ち、deleted_byが同じ', '2',
  $q$ SELECT count(*)::text FROM chore_reactions WHERE id IN ({K1}, {R3}) AND deleted_at IS NOT NULL
        AND deleted_by_member_id = {S1} $q$);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_member('P');
SELECT pg_temp.v('V13 保護者の画面からK1とR3が消える', '0',
  $q$ SELECT count(*)::text FROM chore_reactions WHERE id IN ({K1}, {R3}) $q$);
SELECT pg_temp.as_member('S2');
SELECT pg_temp.v('V13 みまもりの画面からも消える', '0',
  $q$ SELECT count(*)::text FROM chore_reactions WHERE id IN ({K1}, {R3}) $q$);
SELECT pg_temp.as_member('C1');
SELECT pg_temp.v('V13 子どもの画面からも消える', '0',
  $q$ SELECT count(*)::text FROM chore_reactions WHERE id IN ({K1}, {R3}) $q$);
RESET ROLE;

-- 返信だけを消しても元のコメントは残る（K2を作って返信→返信だけ削除）
INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body)
VALUES ((SELECT v FROM ids WHERE k='X'), (SELECT v FROM ids WHERE k='S2'), 'comment', '検査K2') RETURNING id \gset k2_
INSERT INTO ids VALUES ('K2', :'k2_id');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_member('C1');
SELECT pg_temp.t('V13 K2に返信', 'ok',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査K2への返信', {K2}) $q$);
INSERT INTO ids SELECT 'R2', id FROM chore_reactions WHERE reply_to_reaction_id = (SELECT v FROM ids WHERE k='K2');
SELECT pg_temp.t('V13 返信R2だけを削除', 'ok', $q$ SELECT delete_family_comment('chore_reaction_comment', {R2}) $q$);
SELECT pg_temp.v('V13 返信だけ消してもK2は残る', '1', $q$ SELECT count(*)::text FROM chore_reactions WHERE id = {K2} $q$);
RESET ROLE;

-- V14: hide_content / unhide_content（K2に新しい返信を付けてから）
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_member('C1');
SELECT pg_temp.t('V14準備 K2に返信し直す', 'ok',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査K2への返信2', {K2}) $q$);
INSERT INTO ids SELECT 'R2b', id FROM chore_reactions WHERE reply_to_reaction_id = (SELECT v FROM ids WHERE k='K2') AND deleted_at IS NULL;
RESET ROLE;
CREATE TEMP TABLE hid (id uuid);
GRANT ALL ON hid TO authenticated, service_role;
INSERT INTO hid SELECT hide_content('chore_reaction_comment', (SELECT v FROM ids WHERE k='K2'));
SELECT pg_temp.v('V14 hide_content(K2) は元のコメントのhidden_contentsのidを返す', '1',
  $q$ SELECT count(*)::text FROM hid h JOIN hidden_contents hc ON hc.id = h.id WHERE hc.content_id = {K2} $q$);
SELECT pg_temp.v('V14 K2と返信R2bの両方がhidden_contentsに入る', '2',
  $q$ SELECT count(*)::text FROM hidden_contents WHERE content_kind = 'chore_reaction_comment' AND content_id IN ({K2}, {R2b}) $q$);
SELECT pg_temp.t('V14 もう一度 hide_content(K2) を実行（べき等）', 'ok',
  $q$ SELECT hide_content('chore_reaction_comment', {K2}) $q$);
SELECT pg_temp.v('V14 べき等のあとも2行', '2',
  $q$ SELECT count(*)::text FROM hidden_contents WHERE content_kind = 'chore_reaction_comment' AND content_id IN ({K2}, {R2b}) $q$);
SELECT pg_temp.v('V14 unhide_content(K2) は true を返す', 'true',
  $q$ SELECT unhide_content('chore_reaction_comment', {K2})::text $q$);
SELECT pg_temp.v('V14 unhide_content のあと、K2と返信の両方が戻る', '0',
  $q$ SELECT count(*)::text FROM hidden_contents WHERE content_kind = 'chore_reaction_comment' AND content_id IN ({K2}, {R2b}) $q$);
SELECT pg_temp.t('V14 返信だけに hide_content', 'ok', $q$ SELECT hide_content('chore_reaction_comment', {R2b}) $q$);
SELECT pg_temp.v('V14 返信だけが隠れ、K2は隠れない', '0 / 1',
  $q$ SELECT (SELECT count(*)::text FROM hidden_contents WHERE content_id = {K2}) || ' / ' ||
            (SELECT count(*)::text FROM hidden_contents WHERE content_id = {R2b}) $q$);
DELETE FROM hidden_contents WHERE content_id IN (SELECT v FROM ids WHERE k IN ('K2','R2b'));

-- V15: 通知の宛先関数（トグルや端末の有無は管理者で確認）。K3＝保護者PがXに書いたコメント、C1が返信
INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body)
VALUES ((SELECT v FROM ids WHERE k='X'), (SELECT v FROM ids WHERE k='P'), 'comment', '検査K3') RETURNING id \gset k3_
INSERT INTO ids VALUES ('K3', :'k3_id');
-- K3にはR2cで返信。K2の返信R2bは残っているので先に消す
UPDATE chore_reactions SET deleted_at = now() WHERE id = (SELECT v FROM ids WHERE k='R2b');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_member('C1');
SELECT pg_temp.t('V15準備 K3（保護者のコメント）に返信', 'ok',
  $q$ INSERT INTO chore_reactions (completion_id, reacted_by, kind, comment_body, reply_to_reaction_id)
      VALUES ({X}, {C1}, 'comment', '検査K3への返信', {K3}) $q$);
INSERT INTO ids SELECT 'R3b', id FROM chore_reactions WHERE reply_to_reaction_id = (SELECT v FROM ids WHERE k='K3');
RESET ROLE;
SELECT pg_temp.v('V15 返信の通知: キー4つ・種別・本文を含まない・宛先はPの端末', '4 / chore_reaction_reply / true / false',
  $q$ SELECT (SELECT count(*) FROM jsonb_object_keys(pl))::text || ' / ' || (pl->>'kind') || ' / ' ||
            ((pl->'recipient_tokens')::text LIKE '%test-a-parent%')::text || ' / ' || (pl::text LIKE '%検査K3への返信%')::text
       FROM (SELECT comment_notification_payload('chore_reaction_reply', {R3b}) AS pl) x $q$);
SELECT pg_temp.v('V15 返信のidを chore_reaction_comment で渡すとNULL', 'NULL',
  $q$ SELECT comment_notification_payload('chore_reaction_comment', {R3b})::text $q$);
SELECT pg_temp.v('V15 K3（保護者のコメント）の通知は従来どおり報告者C1宛て（C1の端末1つ）', 'chore_reaction_comment / 1端末（C1）',
  $q$ SELECT (pl->>'kind') || ' / ' || CASE WHEN (pl->'recipient_tokens')::text LIKE '%test-a-child%' THEN '1端末（C1）' ELSE (pl->'recipient_tokens')::text END
       FROM (SELECT comment_notification_payload('chore_reaction_comment', {K3}) AS pl) x $q$);
-- is_active（退会/復帰）はクライアントから直接変更できない（トリガー）ので、Edge Functionと同じ service_role で変える
SET LOCAL ROLE service_role;
UPDATE family_members SET is_active = false WHERE id = (SELECT v FROM ids WHERE k='P');
RESET ROLE;
SELECT pg_temp.v('V16 宛先が退会済みなら端末は含まれない', '[]',
  $q$ SELECT (comment_notification_payload('chore_reaction_reply', {R3b})->'recipient_tokens')::text $q$);
-- is_active（退会/復帰）はクライアントから直接変更できない（トリガー）ので、Edge Functionと同じ service_role で変える
SET LOCAL ROLE service_role;
UPDATE family_members SET is_active = true WHERE id = (SELECT v FROM ids WHERE k='P');
RESET ROLE;

-- V23: 権限
SELECT pg_temp.v('V23 authenticatedは通知関数・新トリガー関数を実行できない', 'false / false / false',
  $q$ SELECT has_function_privilege('authenticated', 'public.comment_notification_payload(text, uuid)', 'EXECUTE')::text || ' / ' ||
            has_function_privilege('authenticated', 'public.chore_reactions_reply_guard()', 'EXECUTE')::text || ' / ' ||
            has_function_privilege('authenticated', 'public.chore_reactions_cascade_delete_replies()', 'EXECUTE')::text $q$);

-- V22: 既存の行（返信でない行）の数は、検査で足したぶんを除いて変わっていない
-- 検査で足した返信でない行は10件（K1・BK・YK・SELFK・DK・HK・K2・K3・V18のコメント・V11のスタンプ）。それ以外は増減していない
SELECT pg_temp.v('V22 返信でない行の数 = 検査前の数 + 検査で足した10件', (:before_rows + 10)::text,
  $q$ SELECT count(*)::text FROM chore_reactions WHERE reply_to_reaction_id IS NULL $q$);

-- V24: 返信を含む家族を削除すると chore_reactions に1行も残らない（家族Aには返信がある）
SELECT pg_temp.v('V24 検査前に家族Aには返信がある', 'true',
  $q$ SELECT (count(*) > 0)::text FROM chore_reactions WHERE family_id = {FA} AND reply_to_reaction_id IS NOT NULL $q$);
DELETE FROM families WHERE id = (SELECT v FROM ids WHERE k='FA');
SELECT pg_temp.v('V24 家族Aを削除したら chore_reactions が0行', '0',
  $q$ SELECT count(*)::text FROM chore_reactions WHERE family_id = {FA} $q$);

-- ---------- 結果 ----------
SELECT n, label, expect, got,
  CASE WHEN expect = 'エラーになる' THEN CASE WHEN got <> 'ok' THEN 'PASS' ELSE '*** FAIL ***' END
       WHEN got = expect THEN 'PASS'
       WHEN expect ~ '^[0-9A-Z]{5}$' AND got LIKE expect || ' %' THEN 'PASS'
       WHEN expect ~ '^[0-9A-Z]{5}$' AND got = expect THEN 'PASS'
       ELSE '*** FAIL ***' END AS result
FROM res ORDER BY n;

ROLLBACK;
