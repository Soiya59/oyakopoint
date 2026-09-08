-- ============================================================
-- generate_weekly_family_digest() の引数なし版（死んだオーバーロード）を
-- 明示的にDROPする（2026-09-13）
-- ============================================================
-- 参照:
--   やること.md 4-7「generate_weekly_family_digest() の引数なし版が本番に
--     残っている」（企画部の照合〈2026-09-03〉で発見、本部長が本番で実在を確認）。
--   開発部/成果物/実装メモ.md 165章。
--
-- [経緯] 8月のマイグレーションで generate_weekly_family_digest を2引数化した
-- （p_family_id UUID, p_week_start DATE）際、本来別関数だった
-- generate_weekly_family_digests_for_all_families（複数形・全家族分をループする
-- バッチ入口）と混同しないよう名前を変えなかった。ところが
-- `20260829120000_rename_chore_to_quest_in_messages.sql` が文言差し替えのために
-- `SELECT prosrc FROM pg_proc WHERE proname = 'generate_weekly_family_digest'`
-- （シグネチャを見ずproname一致のみ）でその時点唯一の2引数版のprosrcを取得し、
-- それを**引数なしの新規関数**として`CREATE OR REPLACE FUNCTION
-- public.generate_weekly_family_digest()`してしまった（83.2章と同型の罠）。
-- 直後の`20260829123000_rename_chore_to_quest_digest_overload.sql`はこの
-- 事故に気づき2引数版の文言を正しく直したが、**引数なし版の後始末（DROP）は
-- 行われないまま8月から本番に残っていた**。
--
-- [引数なし版は死んでいるだけでなく壊れている] 本マイグレーション作成にあたり
-- ローカルDockerで実際に`SELECT public.generate_weekly_family_digest();`を
-- 実行して確認したところ、`column "p_week_start" does not exist`で必ず例外に
-- なることを確認した。引数なし版の本体は2引数版からコピーされた文言のまま
-- p_family_id・p_week_start（存在しない）を参照しているため、呼び出せば
-- 必ず失敗する。呼び出し元が無いことに加え、仮に呼ばれても実害
-- （中途半端な書き込み等）は発生しない状態であることも確認済み。
--
-- [呼び出し元の確認・引数なし版は使われていない] 開発部が以下を確認した。
--   - pg_cron（唯一のスケジューラ）が呼ぶのは
--     `generate_weekly_family_digests_for_all_families()`（複数形・別関数）
--     のみで、これは内部で2引数版`generate_weekly_family_digest(p_family_id,
--     p_week_start)`をPERFORMしている（`20260823100000_family_tree_and_
--     weekly_digest.sql`から不変）。引数なし版は呼んでいない。
--   - `supabase/functions/`（Edge Function）配下に
--     `generate_weekly_family_digest`への参照は0件。
--   - `oyakopoint-app/app/`・`oyakopoint-app/src/`（クライアントコード）にも
--     参照は0件（`src/data/api.ts`のコメント中の言及のみで、RPC呼び出しは
--     一切無い。今週のまとめは`weekly_family_digests`テーブルを読むだけで、
--     生成用RPCはservice_roleにのみEXECUTE権限がありクライアントからは
--     呼び出せない設計）。
--
-- [見つかった副作用: authenticated/anonへの意図しないEXECUTE権限] 引数なし版は
-- 2026-08-29に**新規オブジェクトとして**作成されたため、本プロジェクトの
-- 既知の挙動（34.5章。新規関数作成時にauthenticated/anonへEXECUTE権限が自動
-- 付与される）の対象になっていた。2引数版・generate_weekly_family_digests_
-- for_all_families(DATE)はいずれも作成時に明示REVOKEを追加していたが
-- （20260823100000）、引数なし版はこの明示REVOKEを一度も受けていなかった。
-- 実測（`has_function_privilege`）で確認したところ、引数なし版は
-- authenticated・anonの両方からEXECUTE可能な状態だった（呼んでも上記のとおり
-- 必ず例外になるため実害には至っていないが、想定外の権限が付与されたまま
-- 本番に残っていたことになる）。本DROPによりこの権限も消える。
--
-- [DROPで十分・CASCADEは不要] 依存オブジェクトを`pg_depend`で確認したところ
-- 0件（ビュー・トリガー・他関数のいずれからも参照されていない）。
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'generate_weekly_family_digest' AND p.pronargs = 0
  ) THEN
    RAISE EXCEPTION 'generate_weekly_family_digest()（引数なし版）が見つかりません。想定と異なる状態のため中断します。';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'generate_weekly_family_digest' AND p.pronargs = 2
  ) THEN
    RAISE EXCEPTION 'generate_weekly_family_digest(uuid,date)（現行版）が見つかりません。想定と異なる状態のため中断します。';
  END IF;
END $$;

DROP FUNCTION public.generate_weekly_family_digest();

-- 現行版（2引数）は無変更。存在確認のみ行う。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.oid::regprocedure::text = 'generate_weekly_family_digest(uuid,date)'
  ) THEN
    RAISE EXCEPTION 'DROP後にgenerate_weekly_family_digest(uuid,date)が消えています。想定外です。';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'generate_weekly_family_digest' AND p.pronargs = 0
  ) THEN
    RAISE EXCEPTION 'DROP後も引数なし版が残っています。想定外です。';
  END IF;
END $$;
