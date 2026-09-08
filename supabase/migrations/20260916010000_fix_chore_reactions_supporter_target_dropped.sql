-- ============================================================
-- 完了報告へのスタンプ・コメントから、みまもりメンバーが「対象」として
-- 反応してもらえなくなっていたデグレの修正・その2（本部長指示・2026-09-09）
-- ============================================================
-- 参照:
--   本部長からの業務指示（統括の実機確認「子供モードで完了報告のリアクションや
--   コメントできない」・2026-09-09）。
--   開発部/成果物/実装メモ.md 174章に判断理由・検証結果を記録する。
--
-- [経緯・関係] 170章（`20260914010000_fix_chore_reactions_supporter_dropped.sql`）は
-- `chore_reactions_insert_scoped`ポリシーと`toggle_chore_reaction_stamp()`関数本体の
-- **第1項（送信者側）**の条件を`is_current_user_parent()`から
-- `current_family_role() IN ('parent', 'supporter')`に戻した。しかし**第2項
-- （EXISTS、子どもがどの完了報告に反応できるかの条件）**は170章では変更されておらず、
-- `fm.role = 'parent'`のまま残っていた。第2項は本来
-- `20260823070000_supporter_chore_public_visibility.sql`（実装メモ64章）22番の
-- `fm.role IN ('parent', 'supporter')`が確定仕様であり、170章はこの部分を見落としていた。
--
-- [実害] 第2項が`fm.role = 'parent'`のままだったため、「子どもが、みまもりメンバーの
-- 完了報告に反応できない」状態が本番適用（170章、2026-09-08）後も続いていた
-- （みまもりが送信できないデグレは170章で直ったが、逆方向＝みまもりが対象になる側は
-- 直っていなかった）。「保護者の完了報告」には子どもは引き続き反応できていたため、
-- 170章のローカル検証（実装メモ170.4節シナリオ6b「子どもが保護者自身の完了報告に
-- コメント」）はPASSしており、この見落としは検出されなかった。統括の2026-09-09の
-- 実機確認（「子供モードで完了報告のリアクションやコメントできない」）で発覚した。
--
-- [本部長の実測での裏付け] 本部長が本番の`pg_policy`・`pg_get_functiondef`を確認し、
-- ポリシー・関数本体の両方で第2項が`fm.role = 'parent'`のままであることを確認済み。
--
-- [修正方針] `chore_reactions_insert_scoped`ポリシーと
-- `toggle_chore_reaction_stamp()`関数本体の両方で、第2項（EXISTS内の条件）を
-- `fm.role = 'parent'`から`fm.role IN ('parent', 'supporter')`に戻す。
-- 第1項（送信者側、`current_family_role() IN ('parent','supporter')`）は170章で
-- 直したとおりであり、本ファイルでは変更しない。`kind = 'comment'`制約（157章、
-- スタンプの直接INSERTを塞ぎ本RPC経由に一本化するための条件）も変更しない。
--
-- [20260823070000の22番との突き合わせ結果（本部長依頼の1文字ずつの確認）]
-- `20260823070000_supporter_chore_public_visibility.sql`62〜78行目
-- （`chore_reactions_insert_scoped`）と、本ファイルで作る定義を突き合わせた結果、
-- 差分は以下の2点のみだった。
--   1. `kind = 'comment'`条件の追加（157章で新設。20260823070000時点にはまだ
--      `chore_reactions.kind`列そのものが存在しなかったため元々含まれていない。
--      スタンプの直接INSERTを本RPC経由に一本化するための意図した追加であり、
--      本部長の依頼どおり本ファイルでは変更しない）。
--   2. 第2項の`fm.role`条件（今回の修正対象そのもの）。
-- 上記2点以外の差分（`family_id = current_family_id()`・
-- `reacted_by = current_family_member_id()`・第1項
-- `current_family_role() IN ('parent', 'supporter')`・EXISTS内のJOIN・
-- `cc.id = chore_reactions.completion_id`の対応）は文字通り同一であり、
-- 他に落ちている条件は無いことを確認した。
--
-- `toggle_chore_reaction_stamp()`関数本体（157章で新設・170章で第1項のみ訂正）に
-- ついても同様に、第2項が同じ理由で取り残されていたことを確認した。関数本体には
-- 20260823070000時点の対応物が無い（157章で新設された箇所のため）が、
-- 「ポリシーと同じ権限判定をここで再実装する」という157章・170章のコメント上の方針
-- どおり、ポリシーの第2項と揃える。
--
-- [オーバーロード事故の予防（実装メモ83.2章・165章・170章の教訓）] 適用前後で
-- `toggle_chore_reaction_stamp`の引数の形（UUID, TEXT）が唯一であることをDO块で
-- 確認する。引数の形は変更しない（CREATE OR REPLACEのみで足り、DROP FUNCTIONは
-- 不要）。
--
-- [EXECUTE権限（GRANT/REVOKE）] シグネチャ不変のCREATE OR REPLACEのため、
-- 既存のGRANT/REVOKE（REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated;
-- 157章で設定済み）は失われない（45.12章コメントで確認済みの本プロジェクトの
-- 既知の挙動）。本ファイルでの再GRANT/REVOKEは不要。
--
-- 破壊性の評価: 非破壊的。既存ポリシー1本の条件式の訂正（第2項を元の確定仕様に
-- 戻すのみ。第1項・`kind = 'comment'`制約は無変更）と、既存関数1本（シグネチャ不変）の
-- 権限判定ロジックの訂正のみ。新規テーブル・新規列は無い。データの書き換えは行わない。
--
-- 権限影響: RLS照査スイート（oyakopoint-app/supabase/tests/rls_checks.sql）の
-- S3（既存1行のハッシュ変更。本数54本のまま）が変わる見込み。S1（27のまま。
-- テーブルの追加・削除は無い）・S4（58のまま。関数の追加・削除は無い。
-- toggle_chore_reaction_stampのGRANT/REVOKEは既存のまま変更しない）は
-- 変更しない見込み。ローカルDocker環境で実測したうえでスナップショットを
-- 更新する（96.5章の遵守）。
--
-- [重要] 本マイグレーションはまだ本番に適用していない（作成・ローカル検証のみ）。
-- 適用は本部長の操作を待つ（開発部/成果物/実装メモ.md 174章参照）。
-- ============================================================

-- ------------------------------------------------------------
-- 0. 事前確認: toggle_chore_reaction_stamp のオーバーロードが1本（UUID, TEXT）
--    のみであることを確認する（実装メモ83.2章・165章・170章の教訓）。
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
-- 1. chore_reactions_insert_scoped: 第2項（子どもが対象にできる完了報告の条件）を
--    fm.role = 'parent' → fm.role IN ('parent', 'supporter') に戻す。
--    第1項（送信者側）・kind = 'comment'制約は変更しない。
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
          AND fm.role IN ('parent', 'supporter')
      )
    )
  );

-- ------------------------------------------------------------
-- 2. toggle_chore_reaction_stamp() — 権限判定の第2項を同じ条件に訂正する。
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
  --    157章コメント[権限判定の二重実装]の方針を踏襲）。第1項は170章で訂正済み。
  --    第2項は本マイグレーションで初めて訂正する。170章では誤って
  --    fm.role = 'parent'（保護者の完了報告のみ）としていたが、正しくは
  --    fm.role IN ('parent', 'supporter')（みまもりメンバーの完了報告も対象に含む）。
  IF NOT (
    public.current_family_role() IN ('parent', 'supporter')
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = v_completion.reported_by AND fm.role IN ('parent', 'supporter')
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
  '統括指示「絵文字のリアクションを、もう一回タップしたら取り消しにできるか」への対応（開発部/成果物/実装メモ.md 157章）。同じスタンプを再度押すと取消、違うスタンプを押すと切替、未送信なら新規追加。自分の行のみ操作可（reacted_by = current_family_member_id()）、他家族のcompletion_idは対象外（family_id一致を要求）。コメント（kind=''comment''）は対象外・取消不可のまま（chore_reactions_insert_scopedにkind=''comment''制約を追加し、スタンプの直接INSERTは本関数経由に一本化した）。権限判定は保護者・みまもりメンバー（current_family_role() IN (''parent'',''supporter'')）が送信でき、対象completionの報告者が保護者・みまもりメンバーのいずれかであれば子どもも反応できる（174章で第2項も修正。170章は第1項＝送信者側のみ修正しており、第2項＝対象側にみまもりメンバーが漏れていたデグレがあった）。EXECUTE権限は157章から変更なし（シグネチャ不変のためCREATE OR REPLACEでも失われない）。';

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
