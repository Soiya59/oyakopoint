-- ============================================================
-- 07-13-2a章「お絵かきの題名（タイトル）」（2026-09-02追加）
-- ============================================================
-- 参照:
--   設計部/成果物/スキーマ設計.sql 42章（42.1〜42.7。列追加のDDL〔42.1章〕・
--     edit_unpublished_drawing()の改訂〔42.4章〕は、下記へそのまま写している。
--     設計判断の経緯〔書き込み経路の限定・DBレベルで書き換え不能なことの確認・
--     文字数チェックの位置〕は42.2〜42.3・42.5章参照）
--   設計部/成果物/API仕様.md 12.2・12.2a・12.4・12.5・12.6節・11章
--   企画部/成果物/要件定義書.md 07-13-2a章
--   開発部/成果物/実装メモ.md 118章（本マイグレーション対応章）
--
-- [背景] 統括依頼「お絵かきに名前をつけたい」（07-13-2a章）を受け、
-- family_drawingsに任意入力・上限20字の題名列を追加する。新規テーブルは
-- 追加しない（既存の非対称性の原則・33b章を一切変更しない）。
--
-- 破壊性: 非破壊的。既存テーブルへの列追加（NULL許容・デフォルト値なし）・
-- CHECK制約1本の追加と、既存関数1件のシグネチャ変更（引数追加）のみ。
-- 既存データ（公開済み9枚・未公開5枚、2026-09-02時点）は全行title=NULLの
-- ままADD COLUMNされる（NULL許容列のADD COLUMNはテーブル書き換えなしで
-- 即座に完了する）。
--
-- [重要・ハードカットオーバー] edit_unpublished_drawing()の旧シグネチャ
-- （UUID, JSONB）は本マイグレーションでDROP FUNCTIONにより削除される。
-- 新シグネチャ（UUID, JSONB, TEXT）にはDEFAULT値を与えない（42.4章の設計
-- 判断。DEFAULT NULLだと旧クライアントの編集呼び出しで既存の題名が意図せず
-- 消える）。適用した瞬間に旧クライアントの「未公開の絵の編集」は
-- 42883 undefined_functionで失敗するようになる。**本マイグレーションの
-- 適用とoyakopoint-appクライアント側のデプロイは、同一のデプロイで
-- 続けて行うこと。本部長が実施する。**
--
-- 権限影響: RLS照査スイート（oyakopoint-app/supabase/tests/rls_checks.sql）の
-- S1（RLSが有効なテーブル数）・S3（ポリシー一覧の照合）はいずれも±0
-- （新規テーブル・新規ポリシーを追加していない）。S4（authenticatedが実行
-- できる関数の一覧）は関数名のみを見る照合のため件数上も±0（旧
-- edit_unpublished_drawing(UUID,JSONB)をDROPし新edit_unpublished_drawing
-- (UUID,JSONB,TEXT)をGRANTするが、関数名は変わらない）。ただし
-- **シグネチャ（引数の個数）自体は変わっている**ため、開発部は件数だけでなく
-- `pg_get_function_identity_arguments`で個々の関数の引数を別途確認すること
-- （42.6章）。
--
-- [重要] 本マイグレーションはまだ本番に適用していない（作成のみ）。
-- 適用は統括の操作を待つ（開発部/成果物/実装メモ.md 118章参照）。
-- ============================================================

-- ------------------------------------------------------------
-- 42.1 列の追加（DDL） — スキーマ設計.sql 42.1章をそのまま写した
-- ------------------------------------------------------------
ALTER TABLE family_drawings ADD COLUMN IF NOT EXISTS title TEXT NULL;

ALTER TABLE family_drawings DROP CONSTRAINT IF EXISTS chk_family_drawings_title;
ALTER TABLE family_drawings
  ADD CONSTRAINT chk_family_drawings_title CHECK (
    title IS NULL OR char_length(trim(title)) BETWEEN 1 AND 20
  );

COMMENT ON COLUMN family_drawings.title IS
  '要件定義書07-13-2a章「お絵かきの題名」。任意入力（NULL許容）・上限20字（chk_family_drawings_title、42.1章）。付けられるのは作成者本人のみで、経路は(1)絵の新規保存時の直接INSERT（family_drawings_insert_self）と(2)edit_unpublished_drawing()による未公開の絵の編集時に限る（42.2章）。公開済み（is_published=true）の絵の題名は、family_drawingsにUPDATEポリシーが一切存在しないため、DBレベルで一切変更できない（42.3章）。';

-- ------------------------------------------------------------
-- 42.4 edit_unpublished_drawing()の改訂（引数追加・旧シグネチャの明示DROP）
-- — スキーマ設計.sql 42.4章をそのまま写した
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_unpublished_drawing(
  p_drawing_id UUID,
  p_new_line_data JSONB,
  p_new_title TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_drawing RECORD;
  v_new_id UUID;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [早期リターン] 無効な線データのときはロックを取る前に弾く（38.4章と
  -- 同じ最適化）。chk_family_drawings_line_data制約（33b章）は下記
  -- INSERTでも二重に効くため、こちらが万一漏れても安全。
  IF NOT public.is_valid_drawing_line_data(p_new_line_data) THEN
    RAISE EXCEPTION '線データの形式が不正です（座標範囲・線数・点数・パレット・サイズのいずれかが上限を超えています）' USING ERRCODE = 'check_violation';
  END IF;

  -- [42.4章・追加] 題名の形式検証も、行ロックを取る前に済ませる
  -- （line_dataと同じ「無駄なロック保持を避ける」早期リターンの方針）。
  -- chk_family_drawings_title制約（42.1章）と全く同じ条件をここでも
  -- 検査する。制約は下記INSERTでも二重に効くため、こちらが万一漏れても
  -- 安全（is_valid_drawing_line_data()と同じ二重防御パターン）。
  IF p_new_title IS NOT NULL AND NOT (char_length(trim(p_new_title)) BETWEEN 1 AND 20) THEN
    RAISE EXCEPTION '題名は20字以内で入力してください' USING ERRCODE = 'check_violation';
  END IF;

  -- [38.3章] 行ロックを取得してから最新のis_publishedを見る。存在しない・
  -- 他家族の絵・自分以外が描いた絵のいずれも同一のエラーにまとめる
  -- （decorate_tree_with_gacha_prize()と同じ、存在の有無を漏らさない設計）。
  SELECT * INTO v_drawing
  FROM family_drawings
  WHERE id = p_drawing_id
    AND family_id = v_family_id
    AND artist_member_id = v_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の絵が見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  -- [38.3章・成否判定の核心] is_published=trueなら「先にガチャで引かれた」。
  IF v_drawing.is_published THEN
    RAISE EXCEPTION 'この絵はすでに家族に公開されました。編集内容は保存されていません'
      USING ERRCODE = 'check_violation';
  END IF;

  -- [38.2章・危険1対策の核心] DELETEとINSERTを同一トランザクション
  -- （＝本関数呼び出し1回）内で行う。
  DELETE FROM family_drawings WHERE id = p_drawing_id;
  -- 直前のFOR UPDATEで対象1行の存在・自分の未公開の絵であることを確認済み
  -- なので、このDELETEは必ず1件成功する（SECURITY DEFINERのためRLSの
  -- family_drawings_delete_own_unpublishedポリシー自体は評価されないが、
  -- 直前のIF文が同じ条件を代わりに担保している）。

  -- [42.4章・変更点] titleをINSERT対象列に追加。p_new_titleにNULLを
  -- 渡せば「題名を消す」編集も、既存と同じ値を渡せば「題名は変えない」
  -- 編集も、この1つの経路で表現できる（line_dataと同じ「全置換」の
  -- 設計文法。部分パッチではなく常に新しい値を明示的に渡す）。
  INSERT INTO family_drawings (family_id, artist_member_id, line_data, title)
  VALUES (v_family_id, v_member_id, p_new_line_data, p_new_title)
  RETURNING id INTO v_new_id;
  -- trg_family_drawings_before_insert（33d章末尾）がそのまま発火し、
  -- is_published等の強制上書き・保有上限チェックを行う（titleには
  -- 一切触れない。42.2章参照）。line_dataの形式検証は本関数冒頭のIF文に
  -- 加えchk_family_drawings_line_data制約が、titleの形式検証は同じく
  -- 本関数冒頭のIF文に加えchk_family_drawings_title制約が、それぞれ
  -- 二重に効く。

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.edit_unpublished_drawing(UUID, JSONB, TEXT) IS
  '要件定義書07-13-2a章「お絵かきの題名」・38章の改訂。未公開（is_published=false）の自分の絵に限り、削除して新規にINSERTし直す（33b章の1手順）を1トランザクションで安全に行う。line_dataに加えtitle（任意・上限20字、chk_family_drawings_title）も同時に書き換えられる。公開済みの絵・他人の絵は対象外（decorate_tree_with_gacha_prize()と同じ理由で存在の有無を漏らさない単一のエラーにまとめる）。編集中に他の家族のガチャで対象の絵が公開された場合は編集を破棄しcheck_violationを返す（38.3章）。新しいUPDATEポリシーは追加しない（33b章・42.3章の設計を維持）。旧シグネチャ（UUID, JSONB）は下記で明示的にDROPする（40.7章と同じ罠の対処）。EXECUTE権限は本ファイル末尾参照。';

-- [重要] 旧シグネチャ（3引数化前・38.4章・102章で本番未適用のまま導入）を
-- 明示的に削除する。これを忘れると本マイグレーションの意図（題名も含めて
-- 一括で編集させる）が無効化され、旧シグネチャが残存動作し続ける
-- （42.4章「重要な罠の再確認・40.7章と同じ」）。
DROP FUNCTION IF EXISTS public.edit_unpublished_drawing(UUID, JSONB);

-- ------------------------------------------------------------
-- EXECUTE権限（GRANT/REVOKE）— スキーマ設計.sql 42.4章
-- ------------------------------------------------------------
-- draw_gacha()・decorate_tree_with_gacha_prize()・旧edit_unpublished_drawing
-- (33g章・38.5章)と同じ扱いを新シグネチャにもそのまま引き継ぐ。33g章の教訓
-- （PUBLICからのREVOKEだけではSupabaseが直接付与するanonのEXECUTEは消えない）
-- を踏まえ、anonを明示的にREVOKEの対象に含める。
REVOKE ALL ON FUNCTION public.edit_unpublished_drawing(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_unpublished_drawing(UUID, JSONB, TEXT) TO authenticated;
