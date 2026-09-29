-- ============================================================
-- 週次まとめの生成バッチ（pg_cron）を止める
-- やること.md 4-14、実装メモ332章（2026-09-29・統括判断「止めてください」）
-- ============================================================
--
-- [なぜ止めるか]
-- `weekly-family-digest-generation`（20260823100000で登録、毎週月曜0:00 JST）は、
-- 要件定義書07-8章「今週のまとめメッセージ」のために週1回
-- `generate_weekly_family_digests_for_all_families()`を実行している。しかし保護者ホーム
-- （P7）が掲示板カード（`useFamilyHomeCard`）に置き換わり、その後P7自体も下部タブ化で
-- 廃止されたため、この結果を読む画面は1つも無い（`useWeeklyDigest`・
-- `fetchLatestWeeklyFamilyDigest`の呼び出し元は0件、2026-09-29確認）。
-- 本番では2026-09-29時点で有効のまま動いており、最終実行は2026-09-28 00:00 JSTで成功していた
-- （本部長がダッシュボードのCron画面で確認）。誰も読まない行を書き続けていた。
--
-- [止めるのはジョブだけ] 表・関数・既存の行は残す。再開が必要になったら、
-- 20260823100000と同じ`cron.schedule(...)`を1回実行すれば戻る。
--
-- [書き方] 20260930130000と同じく、ジョブが無い環境（ローカルの作り直し等）でも
-- 失敗しないよう、存在を確かめてから外す。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-family-digest-generation') THEN
    PERFORM cron.unschedule('weekly-family-digest-generation');
  END IF;
END
$$;

COMMENT ON FUNCTION public.generate_weekly_family_digests_for_all_families(DATE) IS
  '07-8章「今週のまとめメッセージ」の週次バッチのエントリポイント。【2026-09-29・統括判断で停止】結果を表示する画面が無くなったため、pg_cronのジョブ`weekly-family-digest-generation`を20260930220000で外した。関数と表は残してあり、再開するときは20260823100000と同じcron.scheduleを実行する（やること.md 4-14、実装メモ332章）。';
