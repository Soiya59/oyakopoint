-- DB関数に焼き込まれたユーザー向け文言「お手伝い」→「クエスト」
--
-- [2026-08-29・本部長／軽微変更ルート] 呼称変更「お手伝い」→「クエスト」に伴う対応。
-- 変更理由: 本番に「勉強」「ウォーキング」といったクエストが登録されており、みまもり
-- メンバー向けの自分専用機能はそもそもダイエット・運動・勉強のために作ったもの（07-7章）。
-- 「お手伝い」という語がすでに実態と合っていなかった。
--
-- ■ なぜDB側も直す必要があるか
-- 呼称変更はクライアントの表示文言だけで済むと考えたが、**ユーザーの目に触れる日本語が
-- DB関数の中にも焼き込まれていた**。放置するとアプリ全体が「クエスト」なのに、
-- 週次まとめメッセージとエラー文だけ「お手伝い」という状態になる。
-- 特に generate_weekly_family_digest は毎週月曜0時のバッチで実行されるため、
-- 直近では2026-08-31（月）に旧称のメッセージが生成されるところだった。
--
-- ■ 変更しないもの
-- テーブル名 `chores`・列名 `chore_id`/`chore_title`/`chore_emoji`、および
-- クライアントの変数名は**一切変更しない**。表示名と内部名が異なるのは通常のことで、
-- 動作に影響しない一方、DBの識別子変更は全機能に波及して壊れやすいため。
-- 日本語の語が判定・分岐に使われている箇所が無いことは本部長が確認済み
-- （grepで比較・includes・固定文字列代入のいずれも該当なし）。したがって
-- 本マイグレーションは表示文言の差し替えのみであり、挙動は変わらない。

-- 1) 週次まとめメッセージの曜日ハイライト文言
--    （UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 19.1節の文言テンプレート）
DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'generate_weekly_family_digest';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'generate_weekly_family_digest が見つかりません';
  END IF;
  IF position('家族みんなのお手伝いがいちばん多い日でした' in v_src) = 0 THEN
    RAISE EXCEPTION '想定した文言が見つかりません（既に変更済みか、関数が改訂されています）';
  END IF;

  EXECUTE 'CREATE OR REPLACE FUNCTION public.generate_weekly_family_digest() RETURNS ' ||
    (SELECT pg_get_function_result(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='generate_weekly_family_digest') ||
    ' LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''public'' AS ' ||
    quote_literal(replace(v_src, '家族みんなのお手伝いがいちばん多い日でした', '家族みんなのクエストがいちばん多い日でした'));
END $$;

-- 2) 完了報告トリガーのエラー文言（単発の二重報告・自分専用クエストの本人限定）
DO $$
DECLARE
  v_src TEXT;
  v_new TEXT;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'chore_completions_before_insert';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'chore_completions_before_insert が見つかりません';
  END IF;

  v_new := replace(v_src, 'このお手伝いはすでに完了報告済みです', 'このクエストはすでに完了報告済みです');
  v_new := replace(v_new, '自分専用のお手伝いは作成者本人のみ完了報告できます', '自分専用のクエストは作成者本人のみ完了報告できます');

  IF v_new = v_src THEN
    RAISE EXCEPTION '想定した文言が見つかりません（既に変更済みか、関数が改訂されています）';
  END IF;

  -- このトリガー関数は SECURITY DEFINER ではない（呼び出し元ロールで実行される）。
  -- 34.3章の教訓のとおり、実行属性を勝手に変えないよう元の定義に合わせて作り直す。
  EXECUTE 'CREATE OR REPLACE FUNCTION public.chore_completions_before_insert() RETURNS trigger LANGUAGE plpgsql AS ' ||
    quote_literal(v_new);
END $$;
