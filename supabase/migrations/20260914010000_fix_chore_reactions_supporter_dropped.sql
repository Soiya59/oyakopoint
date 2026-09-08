-- ============================================================
-- 完了報告へのスタンプ・コメントから、みまもりメンバーが送れなくなっていた
-- デグレを修正する（2026-09-08発見・本部長が本番で確認）
-- ============================================================
-- 参照:
--   本部長からの業務指示（統括の実機確認「みまもりが完了報告のコメントや
--   絵文字ができない」・2026-09-08）。
--   開発部/成果物/実装メモ.md 170章に判断理由・検証結果を記録する。
--
-- [原因] `20260910020000_toggle_chore_reaction_stamp.sql`（実装メモ157章）が
-- `chore_reactions_insert_scoped`ポリシーを置き換えた際、送信者側の条件を
-- 誤って書き換えていた。
--   置き換え前（`20260823060000_shrink_supporter_scope.sql` 171行目〜、
--   本プロジェクトの確定仕様＝家族・ロールの境界条件）:
--     current_family_role() IN ('parent', 'supporter')
--   置き換え後（157章。誤り）:
--     is_current_user_parent()  -- current_family_role() = 'parent' のみの糖衣。
--                                  supporterが条件から落ちている。
-- 同じ誤りが`toggle_chore_reaction_stamp()`関数本体の権限判定（157章で新設した
-- 箇所）にも複製されていた。157章はスタンプの直接INSERTを`kind = 'comment'`条件で
-- 塞ぎ本RPC経由に一本化していたため、この関数の誤りにより**スタンプは完全に、
-- コメントはポリシー経由で、みまもりメンバーが送信不能**になっていた。
--
-- [157章のマイグレーション本体コメント（62行目・94行目付近）の記述誤りについて]
-- 157章は「家族・ロールの境界条件（保護者は誰にでも、子どもは対象completionの
-- 報告者がparentの場合のみ）は変更していない（条件式にkind='comment'を追加した
-- だけ）」「破壊性: 非破壊的」と記していたが、**この記述は誤りだった**。実際には
-- `current_family_role() IN ('parent', 'supporter')`を`is_current_user_parent()`へ
-- 書き換えており、みまもりメンバーの送信経路を落とす破壊的変更だった。157章の
-- ファイル自体は「本番へは未適用（作成のみ）」時点の記述として書かれたものであり、
-- 過去の適用済みマイグレーションは書き換えない方針（本プロジェクトのルール）に
-- 従い、157章のファイル本体はそのまま残す。この誤りの記録は本ファイルと
-- 実装メモ170章、および`supabase/tests/rls_checks.sql`の該当コメント（157章分）に
-- 追記する。
--
-- [残っていた抜け道] 第2項の`EXISTS(... fm.role = 'parent')`（子どもの完了報告のうち
-- 報告者がparentロールの場合のみ）は変更されていなかったため、みまもりは
-- 「保護者の完了報告」には引き続き反応できていた。「子どもの完了報告」に
-- 反応できなくなっていた点が実害（本部長の実機確認、統括が使うのは主に
-- 子どもの報告のため）。
--
-- [本番の実害の記録] 本部長が本番`chore_reactions`を確認し、みまもりが送った
-- スタンプ1件・コメント1件（最終2026-09-05、157章適用より前）が実在することを
-- 確認済み。「以前はできていたことが、157章の適用後にできなくなった」という
-- デグレである。
--
-- [修正方針] `chore_reactions_insert_scoped`ポリシーと
-- `toggle_chore_reaction_stamp()`関数本体の両方で、送信者側の条件を
-- `is_current_user_parent()`から`current_family_role() IN ('parent', 'supporter')`に
-- 戻す。`kind = 'comment'`制約（ポリシー側）と第2項（子ども向けの条件）は
-- 一切変更しない。
--
-- [オーバーロード事故の予防（実装メモ83.2章・165章の教訓）] 本ファイル適用前後で
-- `toggle_chore_reaction_stamp`の引数の形（UUID, TEXT）が唯一であることをDO块で
-- 確認する。引数の形は変更しない（CREATE OR REPLACEのみで足り、DROP FUNCTIONは
-- 不要）。
--
-- [EXECUTE権限（GRANT/REVOKE）] シグネチャ不変のCREATE OR REPLACEのため、
-- 既存のGRANT/REVOKE（REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated;
-- 157章で設定済み）は失われない（45.12章コメントで確認済みの本プロジェクトの
-- 既知の挙動）。本ファイルでの再GRANT/REVOKEは不要。
--
-- 破壊性の評価: 非破壊的。既存ポリシー1本の条件式の訂正（送信者側の条件を
-- 元の確定仕様に戻すのみ。`kind = 'comment'`制約・第2項は無変更）と、既存関数
-- 1本（シグネチャ不変）の権限判定ロジックの訂正のみ。新規テーブル・新規列は無い。
-- データの書き換えは行わない。
--
-- 権限影響: RLS照査スイート（oyakopoint-app/supabase/tests/rls_checks.sql）の
-- S3（既存1行のハッシュ変更。本数54本のまま）が変わる見込み。S1（27のまま。
-- テーブルの追加・削除は無い）・S4（58のまま。関数の追加・削除は無い。
-- toggle_chore_reaction_stampのGRANT/REVOKEは既存のまま変更しない）は
-- 変更しない見込み。ローカルDocker環境で実測したうえでスナップショットを
-- 更新する（96.5章の遵守）。
--
-- [重要] 本マイグレーションはまだ本番に適用していない（作成・ローカル検証のみ）。
-- 適用は本部長の操作を待つ（開発部/成果物/実装メモ.md 170章参照）。
-- ============================================================

-- ------------------------------------------------------------
-- 0. 事前確認: toggle_chore_reaction_stamp のオーバーロードが1本（UUID, TEXT）
--    のみであることを確認する（実装メモ83.2章・165章の教訓）。
-- ------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'toggle_chore_reaction_stamp') <> 1 THEN
    RAISE EXCEPTION 'toggle_chore_reaction_stamp のオーバーロード数が想定(1本)と異なります。想定外の状態のため中断します。';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'toggle_chore_reaction_stamp'
      AND oid::regprocedure::text = 'toggle_chore_reaction_stamp(uuid,text)'
  ) THEN
    RAISE EXCEPTION 'toggle_chore_reaction_stamp(uuid, text) のシグネチャが見つかりません。想定外の状態のため中断します。';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1. chore_reactions_insert_scoped: 送信者側の条件を
--    is_current_user_parent() → current_family_role() IN ('parent', 'supporter')
--    に戻す。kind = 'comment'制約・第2項（子ども向けの条件）は変更しない。
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chore_reactions_insert_scoped" ON chore_reactions;

CREATE POLICY "chore_reactions_insert_scoped" ON chore_reactions
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND reacted_by = current_family_member_id()
    AND kind = 'comment'
    AND (
      current_family_role() IN ('parent', 'supporter')
      OR EXISTS (
        SELECT 1
        FROM chore_completions cc
        JOIN family_members fm ON fm.id = cc.reported_by
        WHERE cc.id = chore_reactions.completion_id
          AND fm.role = 'parent'
      )
    )
  );

-- ------------------------------------------------------------
-- 2. toggle_chore_reaction_stamp() — 権限判定を同じ条件に訂正する。
--    引数・戻り値の型は無変更（UUID, TEXT → TABLE(removed BOOLEAN, reaction_id UUID)）。
--    2.以外のロジック（存在確認・トグル判定・1件までの強制・INSERT）は無変更。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.toggle_chore_reaction_stamp(
  p_completion_id UUID,
  p_stamp_key TEXT
)
RETURNS TABLE (
  removed BOOLEAN,
  reaction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_family_id UUID := current_family_id();
  v_caller_member_id UUID := current_family_member_id();
  v_completion RECORD;
  v_had_same BOOLEAN;
  v_new_id UUID;
BEGIN
  IF v_caller_family_id IS NULL OR v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 1. 対象completionの存在確認・自家族限定（他家族の行と存在しないIDを区別しない。
  --    cancel_chore_completionと同じ方針。無変更）。
  SELECT cc.* INTO v_completion
  FROM chore_completions cc
  WHERE cc.id = p_completion_id
    AND cc.family_id = v_caller_family_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の完了報告が見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  -- 2. 権限判定【本マイグレーションでの訂正箇所】: chore_reactions_insert_scopedと
  --    同じ条件をここで再実装する（SECURITY DEFINERはRLSを経由しないため。
  --    157章コメント[権限判定の二重実装]の方針を踏襲）。157章では誤って
  --    is_current_user_parent()（parentのみ）としていたが、正しくは
  --    current_family_role() IN ('parent', 'supporter')（みまもりメンバーも含む）。
  IF NOT (
    public.current_family_role() IN ('parent', 'supporter')
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = v_completion.reported_by AND fm.role = 'parent'
    )
  ) THEN
    RAISE EXCEPTION 'この完了報告にはリアクションできません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 3. 自分が既にちょうど同じスタンプを送っているか（トグルの判定材料。無変更）。
  SELECT EXISTS (
    SELECT 1 FROM chore_reactions
    WHERE completion_id = p_completion_id
      AND reacted_by = v_caller_member_id
      AND kind = 'stamp'
      AND stamp_key = p_stamp_key
  ) INTO v_had_same;

  -- 4. 自分の既存スタンプ（種類問わず）をいったん全て消す（無変更）。
  DELETE FROM chore_reactions
  WHERE completion_id = p_completion_id
    AND reacted_by = v_caller_member_id
    AND kind = 'stamp';

  IF v_had_same THEN
    -- 同じスタンプを押した → 取消のみ。
    RETURN QUERY SELECT true, NULL::uuid;
    RETURN;
  END IF;

  -- 5. 新しいスタンプを送る（未送信 or 違うスタンプへの切替。無変更）。
  INSERT INTO chore_reactions (completion_id, reacted_by, kind, stamp_key)
  VALUES (p_completion_id, v_caller_member_id, 'stamp', p_stamp_key)
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT false, v_new_id;
END;
$$;

COMMENT ON FUNCTION public.toggle_chore_reaction_stamp(UUID, TEXT) IS
  '統括指示「絵文字のリアクションを、もう一回タップしたら取り消しにできるか」への対応（開発部/成果物/実装メモ.md 157章）。同じスタンプを再度押すと取消、違うスタンプを押すと切替、未送信なら新規追加。自分の行のみ操作可（reacted_by = current_family_member_id()）、他家族のcompletion_idは対象外（family_id一致を要求）。コメント（kind=''comment''）は対象外・取消不可のまま（chore_reactions_insert_scopedにkind=''comment''制約を追加し、スタンプの直接INSERTは本関数経由に一本化した）。権限判定は保護者に加えみまもりメンバー（current_family_role() = ''supporter''）も対象（170章で修正。157章はis_current_user_parent()のみとしておりみまもりが送信不能になっていたデグレがあった）。EXECUTE権限は157章から変更なし（シグネチャ不変のためCREATE OR REPLACEでも失われない）。';

-- ------------------------------------------------------------
-- 事後確認: オーバーロードが増えていないこと（DROP FUNCTIONを使っていないため
-- 想定どおり1本のままのはずだが、念のため確認する）。
-- ------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'toggle_chore_reaction_stamp') <> 1 THEN
    RAISE EXCEPTION 'CREATE OR REPLACE後にtoggle_chore_reaction_stampのオーバーロード数が想定(1本)と異なります。想定外です。';
  END IF;
END $$;

-- [EXECUTE権限] 157章の GRANT/REVOKE（REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE
-- TO authenticated;）はシグネチャ不変のCREATE OR REPLACEでは失われないため、
-- 本ファイルでの再GRANT/REVOKEは不要（45.12章と同じ確認済みの挙動）。
