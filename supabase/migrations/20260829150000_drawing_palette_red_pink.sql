-- お絵かきパレットの「あか」「ピンク」を差し替える
--
-- [2026-08-29・本部長／軽微変更ルート] ユーザーの実機所感
-- 「あかをもっとあかに、ピンクをもっとピンクにしてほしい。今の感じだと赤とオレンジが
--  似ていて、ピンクもどことなく赤とオレンジに似ている気がする」への対応。
--
-- ■ 何が起きていたか（色相で確認）
--   あか      #E4572E … 色相 13°（ほぼ朱色）
--   オレンジ  #F2913D … 色相 28°
--   → 14°しか離れておらず、パレットの小さい丸では見分けが付かない。
--   ピンク    #E5449B … 色相 328°。色相自体はピンク寄りだが暗く濃いマゼンタのため、
--                        朱色寄りの「あか」の隣では「濃い赤」に見えていた。
--
-- ■ 変更後（src/theme/theme.ts drawingPalette と一致）
--   あか    #E4572E → #DC2626 … 色相 0°の素直な赤。オレンジとの差が28°に広がる
--   ピンク  #E5449B → #FF6FB5 … 色相はほぼ保ったまま明るくし、ピンクとして読ませる
--
-- ■ なぜDB側も直す必要があるか
-- `is_valid_drawing_line_data()` は `family_drawings.line_data` のCHECK制約から呼ばれ、
-- **許可色のホワイトリスト**を持っている。クライアントのパレットだけ変えると、
-- 新しい色で描いた絵が保存できなくなる（CHECK制約違反）。
--
-- ■ 旧色を許可リストから外さない理由
-- **既存の絵は旧色（#E4572E / #E5449B）を含んだまま保存されている。**
-- 旧色を削除すると既存行がCHECK制約に違反する状態になり、将来の再検証・テーブル再作成・
-- pg_dumpからのリストア時に失敗しうる。**色の許可リストは追加のみで運用し、削除しない。**
-- クライアントは新色8色のみを提示するため、新しく描かれる絵に旧色が混ざることはない。
--
-- ■ 実装方法
-- 関数のロジック本体（線数・座標数・バイト数の検証）には一切触れず、既存の `prosrc` から
-- **色配列の行だけ**を置換して作り直す。34.3章・83.2章と同じ手順で、実行属性
-- （LANGUAGE plpgsql / IMMUTABLE / SECURITY INVOKER）も元の定義に合わせて明示する。

DO $$
DECLARE
  v_src TEXT;
  v_new TEXT;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid::regprocedure::text = 'is_valid_drawing_line_data(jsonb)';

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'is_valid_drawing_line_data(jsonb) が見つかりません';
  END IF;
  IF position('''#2E2E2E'', ''#E4572E'', ''#F2913D'', ''#F5C518'',' in v_src) = 0 THEN
    RAISE EXCEPTION '想定した色リストが見つかりません（既に変更済みか、関数が改訂されています）';
  END IF;

  -- 旧2色は残したまま、新2色を追加する（上記「追加のみで運用」の方針）。
  v_new := replace(
    v_src,
    '''#2E2E2E'', ''#E4572E'', ''#F2913D'', ''#F5C518'',',
    '''#2E2E2E'', ''#E4572E'', ''#F2913D'', ''#F5C518'', ''#DC2626'', ''#FF6FB5'','
  );

  IF v_new = v_src THEN
    RAISE EXCEPTION '置換が行われませんでした';
  END IF;

  -- 引数名は既存定義と同じ `p_line_data` でなければならない
  -- （CREATE OR REPLACE は引数名の変更を許さない: SQLSTATE 42P13）。
  EXECUTE 'CREATE OR REPLACE FUNCTION public.is_valid_drawing_line_data(p_line_data jsonb) ' ||
    'RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS ' || quote_literal(v_new);
END $$;
