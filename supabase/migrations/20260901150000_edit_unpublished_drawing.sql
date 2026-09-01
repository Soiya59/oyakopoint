-- ============================================================
-- 07-13-2章「お絵かき」— 未公開の絵を「編集」できるようにする
-- （2026-09-01・統括決定「公開前の編集」への対応）
-- ============================================================
-- 参照:
--   設計部/成果物/スキーマ設計.sql 38章（38.1〜38.6。edit_unpublished_drawing()の
--     DDL本体〔38.4章〕・EXECUTE権限〔38.5章〕は、下記へそのまま写している。
--     設計判断の経緯〔危険1・危険2への対処、却下した案〕は38.1〜38.3章参照）
--   設計部/成果物/API仕様.md 12.2a章（呼び出し方法）・12.2節末尾の補足・
--     12.6節（権限のまとめ）・11章（エラー表に3行追記）
--   開発部/成果物/実装メモ.md 102章（本マイグレーション対応章）
--
-- [背景] 統括決定（2026-09-01）「完成品（公開済み）の編集は希望していない。
-- 公開前の編集を意味していた」を受け、未公開（is_published=false）の絵に限り
-- 「編集」できるようにする。公開済みの絵は現状どおり編集も削除もできないまま
-- （33b章の非対称性の原則は一切変更しない）。
--
-- 新しいUPDATEポリシーは追加しない（33b章「UPDATEポリシーは一切定義しない」を
-- 維持する）。線データの部分編集APIも提供しない（従来どおり「削除して新規に
-- INSERTし直す」の1手順のまま）。本マイグレーションが追加するのは、その1手順を
-- SECURITY DEFINERのRPCとして1トランザクションに安全にパッケージ化する
-- edit_unpublished_drawing() のみである。
--
-- 破壊性: 非破壊的。新規関数1件（edit_unpublished_drawing）の追加のみで、
-- 既存テーブル・既存関数・既存ポリシーの定義・既存データには一切触れない。
--
-- 権限影響: RLS照査スイート（oyakopoint-app/supabase/tests/rls_checks.sql）の
-- S4（authenticatedが実行できる関数の件数照合）の期待値が42件→43件になる
-- （新規関数1件をauthenticatedへGRANTするため）。S3（ポリシー41本の定義照合）は
-- 影響なし。適用後、開発部/成果物/実装メモ.md 102章の手順に従いS3/S4を実行し、
-- FAILが本ファイルの意図した変更によるものであることを確認したうえで
-- スナップショットを更新すること（96章の運用手順）。
--
-- [重要] 本マイグレーションはまだ本番に適用していない（作成のみ）。
-- 適用は統括の操作を待つ（開発部/成果物/実装メモ.md 102章参照）。
-- ============================================================

-- ------------------------------------------------------------
-- edit_unpublished_drawing() DDL本体（スキーマ設計.sql 38.4章）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_unpublished_drawing(
  p_drawing_id UUID,
  p_new_line_data JSONB
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

  -- [早期リターン] 無効な線データのときはロックを取る前に弾く。無駄なロック
  -- 保持を避けるための最適化であり、chk_family_drawings_line_data制約
  -- （33b章）は下記INSERTでも二重に効くため、こちらが万一漏れても安全。
  IF NOT public.is_valid_drawing_line_data(p_new_line_data) THEN
    RAISE EXCEPTION '線データの形式が不正です（座標範囲・線数・点数・パレット・サイズのいずれかが上限を超えています）' USING ERRCODE = 'check_violation';
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
  -- ここでDELETEを試みて0件になる（＝成功したように見えて実は何も起きて
  -- いない）という80.4/81.2章型の罠を踏まないよう、DELETE前に明示的に
  -- チェックして例外を投げる。呼び出し側は「例外が飛んでこなければ必ず
  -- 編集が反映されている」という単純な成否判定でよくなる。
  IF v_drawing.is_published THEN
    RAISE EXCEPTION 'この絵はすでに家族に公開されました。編集内容は保存されていません'
      USING ERRCODE = 'check_violation';
  END IF;

  -- [38.2章・危険1対策の核心] DELETEとINSERTを同一トランザクション
  -- （＝本関数呼び出し1回）内で行う。この関数のどこかで例外が飛べば関数全体が
  -- ロールバックされ、元の絵はそのまま残る。逆にここまで到達すればDELETE・
  -- INSERTのいずれかが単独で失敗して絵が消えるという状態は原理的に起こらない。
  DELETE FROM family_drawings WHERE id = p_drawing_id;
  -- 直前のFOR UPDATEで対象1行の存在・自分の未公開の絵であることを確認済み
  -- なので、このDELETEは必ず1件成功する（SECURITY DEFINERのためRLSの
  -- family_drawings_delete_own_unpublishedポリシー自体は評価されないが、
  -- 直前のIF文が同じ条件を代わりに担保している）。

  INSERT INTO family_drawings (family_id, artist_member_id, line_data)
  VALUES (v_family_id, v_member_id, p_new_line_data)
  RETURNING id INTO v_new_id;
  -- trg_family_drawings_before_insert（33d章末尾）がそのまま発火し、
  -- is_published等の強制上書き・保有上限チェックを行う。保有上限チェックの
  -- SELECT count(*)は、直前のDELETEが同一トランザクション内で既に反映された
  -- 後に実行されるため、「3枚ちょうど保持している状態での編集」でも上限超過
  -- エラーにならない（38.2章）。line_dataの形式検証は本関数冒頭のIF文に加え、
  -- chk_family_drawings_line_data制約（33b章）が二重に効く。

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.edit_unpublished_drawing(UUID, JSONB) IS
  '要件定義書07-13-2章「お絵かき」・2026-09-01統括決定「公開前の編集」。未公開（is_published=false）の自分の絵に限り、削除して新規にINSERTし直す（33b章の1手順）を1トランザクションで安全に行う。公開済みの絵・他人の絵は対象外（decorate_tree_with_gacha_prize()と同じ理由で存在の有無を漏らさない単一のエラーにまとめる）。編集中に他の家族のガチャで対象の絵が公開された場合は編集を破棄しcheck_violationを返す（38.3章）。新しいUPDATEポリシーは追加しない（33b章の設計を維持）。EXECUTE権限は38.5章参照。';

-- ------------------------------------------------------------
-- EXECUTE権限（GRANT/REVOKE）— スキーマ設計.sql 38.5章
-- ------------------------------------------------------------
-- draw_gacha()・decorate_tree_with_gacha_prize()（33g章）と同じ扱いとする。
-- 未公開の絵の編集は本人が自分の意思で呼ぶ操作であり、31a章の
-- cronバッチ関数とは呼び出し経路が異なる。33g章の教訓（PUBLICからのREVOKEだけ
-- ではSupabaseが直接付与するanonのEXECUTEは消えない）を踏まえ、anonを明示的に
-- REVOKEの対象に含める。
REVOKE ALL ON FUNCTION public.edit_unpublished_drawing(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_unpublished_drawing(UUID, JSONB) TO authenticated;
