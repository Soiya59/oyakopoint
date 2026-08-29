-- 【20260829120000 の取りこぼし修正】週次まとめメッセージの2引数版を置き換える
--
-- [2026-08-29・本部長／軽微変更ルート]
--
-- 直前のマイグレーションで `generate_weekly_family_digest` の文言を差し替えたつもりだったが、
-- **この関数にはオーバーロードが2つあった**。
--
--   generate_weekly_family_digest()             … バッチ用のラッパー（置換済み）
--   generate_weekly_family_digest(uuid, date)   … 実際にメッセージを組み立てる本体（未置換）
--
-- `CREATE OR REPLACE FUNCTION public.generate_weekly_family_digest()` は引数なしの
-- シグネチャだけを置き換えるため、本体側の「家族みんなのお手伝いがいちばん多い日でした」が
-- そのまま残っていた。適用後に pg_proc を実際に検索して発覚した
-- （マイグレーションが「成功」しても、意図した変更が入ったとは限らない）。
--
-- 教訓: 関数の文言を書き換えるときは、`proname` ではなく
-- `oid::regprocedure` でシグネチャごとに確認する。

DO $$
DECLARE
  v_oid OID;
  v_src TEXT;
BEGIN
  SELECT p.oid, p.prosrc INTO v_oid, v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid::regprocedure::text = 'generate_weekly_family_digest(uuid,date)';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'generate_weekly_family_digest(uuid,date) が見つかりません';
  END IF;
  IF position('家族みんなのお手伝いがいちばん多い日でした' in v_src) = 0 THEN
    RAISE EXCEPTION '想定した文言が見つかりません（既に変更済みか、関数が改訂されています）';
  END IF;

  -- 実行属性（SECURITY DEFINER / search_path）は元の定義と同じものを明示する。
  EXECUTE 'CREATE OR REPLACE FUNCTION public.generate_weekly_family_digest(p_family_id uuid, p_week_start date) ' ||
    'RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS ' ||
    quote_literal(
      replace(v_src,
        '家族みんなのお手伝いがいちばん多い日でした',
        '家族みんなのクエストがいちばん多い日でした')
    );
END $$;
