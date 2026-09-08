-- ============================================================
-- 完了報告へのスタンプ（絵文字）リアクションの取消・切替（2026-09-10）
-- ============================================================
-- 参照:
--   本部長からの業務指示（統括発言「このえもじのりあくしよんについて、間違えて
--   押すときもある。もう一回タップしたら、取り消しにできるかな？」）。
--   **設計部を通していない。** 規模が小さく、既存の取消（cancel_chore_completion・
--   gratitude_pointsの取消）に前例があるため、開発部の判断で設計・実装した
--   （開発部/成果物/実装メモ.md 157章に判断理由を記録）。
--
-- [重要・既存の設計判断を上書きする] `20260815093520_initial_schema.sql`
-- 「5b. chore_reactions（新規：保護者リアクション。スタンプ／コメント）」内の
-- [設計判断: 取消（DELETE/UPDATE）を許可するか]は「一切許可しない（Strava Kudosの
-- 『一度送ると取り消せない』という設計思想を踏襲する）」という結論だった。
-- 本マイグレーションは統括の明示的な指示により、**スタンプ（kind='stamp'）に限り**
-- この結論を撤回する。コメント（kind='comment'）は従来どおり取消不可のままとする
-- （統括の指示が絵文字のスタンプについてのものであり、任意の長文コメントの取消は
-- 依頼されていないため。実装メモ.md 157章「設計を膨らませないこと」の遵守）。
--
-- [確定した仕様]
--   - 同じスタンプをもう一度押す → 消える（取消）
--   - 違うスタンプを押す → そちらに切り替わる
--   - 時間の制限は付けない（統括判断。ポイントが動かないため実害が小さい）
--
-- [本部長が確認した事実で判明した誤り（実装メモ.md 157章に詳細）]
-- 統括は「違うスタンプへの切替は現状すでに1人1つの選択になっているはず」という
-- 前提だったが、実際には`chore_reactions_insert_scoped`（20260820045200）は
-- 1人が同じcompletionに複数種類のスタンプを重ねて送ることを禁止していなかった
-- （`uq_chore_reactions_stamp_dedup`は「同じ種類の連打」のみを防ぐ部分ユニーク
-- インデックスであり、「異なる種類を複数」は禁止していない）。本マイグレーションは
-- 取消の実装と同時に「1人1completionにつき有効なスタンプは常に1件まで」を
-- 新たに強制する（下記関数本体を参照）。
--
-- [削除の方式についての判断: DELETEポリシー vs SECURITY DEFINER RPC]
-- gratitude_pointsの取消（`gratitude_points_update_revoke_by_sender`、単純な
-- UPDATEポリシー＋トリガー）とcancel_chore_completion（複数テーブルにまたがる
-- 副作用があるためSECURITY DEFINER RPCに集約）の2つの前例を確認した。
-- 本件はgratitude_pointsと同じく「他テーブルへの副作用が無い単純な取消」だが、
-- 以下の理由でRPC方式を選んだ（DELETEポリシー単体は採らなかった）:
--   (a) 「違うスタンプへ切り替える」動作は、DELETEポリシー＋INSERTポリシーの
--       組み合わせだけで実現しようとするとクライアントから2回のDB呼び出し
--       （旧スタンプのDELETE→新スタンプのINSERT）が必要になり、間の失敗で
--       「どちらも無い」状態が生じうる。RPCなら1回の呼び出し・1トランザクションで
--       完結できる。
--   (b) 上記の新規制約「1人1completionにつき1件まで」をDBレベルで強制するには、
--       「新しいスタンプを入れる前に自分の既存スタンプを消す」という手順を
--       常に一体で実行する必要があり、これは単純なCHECK制約や部分ユニーク
--       インデックスでは表現できない（他行の削除を伴うため）。RPCの中に手順として
--       まとめるのが最も単純。
--   (c) このプロジェクトは書き込みをRPCに集約する方針を複数箇所で採っており
--       （cancel_chore_completion・draw_gacha・purchase_sticker等）、"chore_reactions
--       への新しい削除経路をポリシーとRPCの2箇所に分散させない"という
--       cancel_chore_completionの方針（43.1章「chore_completionsへの新しいDELETE
--       ポリシーは追加せず、削除経路を本RPCに集約する」）を踏襲した。
--
-- [直接INSERTポリシーの扱い]
-- 上記(b)の制約をバイパスされないよう、`chore_reactions_insert_scoped`に
-- `kind = 'comment'`条件を追加し、スタンプ（kind='stamp'）の直接INSERTを塞ぐ。
-- 以後、スタンプの追加・切替・取消はすべて本RPC経由に統一される。家族・ロールの
-- 境界条件（保護者は誰にでも、子どもは対象completionの報告者がparentの場合のみ）は
-- 変更していない（条件式にkind='comment'を追加しただけ）。コメント（kind='comment'）の
-- 直接INSERTは従来どおり変更なし。
--
-- [権限判定の二重実装についての注意]
-- 本関数はSECURITY DEFINERのためRLSを経由しない。そのため
-- `chore_reactions_insert_scoped`と同じ「誰が誰にリアクションできるか」の条件
-- （保護者は誰にでも、子どもは対象completionの報告者がparentの場合のみ）を
-- 関数本体内で独立して再実装している（cancel_chore_completionが同様に
-- 権限判定を関数内で再実装しているのと同じパターン）。将来
-- `chore_reactions_insert_scoped`の条件を変更する場合は、本関数の権限判定も
-- 合わせて見直すこと。
--
-- [自分のスタンプだけ消せること／家族をまたいで消せないこと]
--   - `reacted_by = v_caller_member_id`で常に絞り込むため、他人のスタンプは
--     一切対象にならない。
--   - 対象completionの取得を`cc.family_id = v_caller_family_id`で絞り込むため、
--     他家族のcompletion_idを渡されても「対象の完了報告が見つかりません」に
--     収束し、他家族のスタンプを操作することはできない。
--
-- [family_board_reactionsについての確認結果（今回は対象外・記録のみ）]
-- 統括の依頼により、掲示板のリアクション（`family_board_reactions`）に同じ問題
-- （取消不可）があるかを確認した。**同じ問題がある**（20260901160000_family_board_
-- reactions.sqlはUPDATE/DELETEポリシーを一切作らない設計であり、取消経路が無い）。
-- 今回は直さない（統括の依頼はchore_reactionsのスタンプのみを対象にしており、
-- 掲示板は別テーブル・別要件〈07-14章「取消の可否」は明示的に不可としている〉の
-- ため、設計を膨らませないという指示に従いスコープ外とした）。詳細は
-- 開発部/成果物/実装メモ.md 157章に記録する。
--
-- 破壊性: 非破壊的。新規関数1件（toggle_chore_reaction_stamp）の追加と、既存の
-- `chore_reactions_insert_scoped`ポリシーの条件式変更（kind='comment'を追加する
-- だけであり、家族・ロールの境界条件そのものは変更しない）のみ。新規テーブル・
-- 新規列は無い。
--
-- 権限影響: RLS照査スイート（oyakopoint-app/supabase/tests/rls_checks.sql）の
-- S3（既存1行のハッシュ変更。本数55本のまま）・S4（57→58、新規関数1件を
-- authenticatedへ明示的にGRANT）が変わる見込み。ローカルDocker環境で実測した
-- うえでスナップショットを更新する（96.5章の遵守）。S1（27のまま。新規テーブル
-- 無し）は変更しない。
--
-- [重要] 本マイグレーションはまだ本番に適用していない（作成のみ）。
-- 適用は本部長の操作を待つ（開発部/成果物/実装メモ.md 157章参照）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. chore_reactions_insert_scoped: スタンプ（kind='stamp'）の直接INSERTを塞ぐ
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chore_reactions_insert_scoped" ON chore_reactions;

CREATE POLICY "chore_reactions_insert_scoped" ON chore_reactions
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND reacted_by = current_family_member_id()
    AND kind = 'comment'
    AND (
      is_current_user_parent()
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
-- 2. toggle_chore_reaction_stamp() — スタンプの追加・切替・取消
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
  --    cancel_chore_completionと同じ方針）。
  SELECT cc.* INTO v_completion
  FROM chore_completions cc
  WHERE cc.id = p_completion_id
    AND cc.family_id = v_caller_family_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の完了報告が見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  -- 2. 権限判定: chore_reactions_insert_scopedと同じ条件をここで再実装する
  --    （SECURITY DEFINERはRLSを経由しないため。上記コメント[権限判定の二重実装]参照）。
  IF NOT (
    public.is_current_user_parent()
    OR EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = v_completion.reported_by AND fm.role = 'parent'
    )
  ) THEN
    RAISE EXCEPTION 'この完了報告にはリアクションできません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 3. 自分が既にちょうど同じスタンプを送っているか（トグルの判定材料）。
  SELECT EXISTS (
    SELECT 1 FROM chore_reactions
    WHERE completion_id = p_completion_id
      AND reacted_by = v_caller_member_id
      AND kind = 'stamp'
      AND stamp_key = p_stamp_key
  ) INTO v_had_same;

  -- 4. 自分の既存スタンプ（種類問わず）をいったん全て消す。「1人1completionにつき
  --    有効なスタンプは1件まで」を本関数で新たに強制する（上記コメント参照。
  --    複数残っていた場合の自己修復も兼ねる）。
  DELETE FROM chore_reactions
  WHERE completion_id = p_completion_id
    AND reacted_by = v_caller_member_id
    AND kind = 'stamp';

  IF v_had_same THEN
    -- 同じスタンプを押した → 取消のみ。
    RETURN QUERY SELECT true, NULL::uuid;
    RETURN;
  END IF;

  -- 5. 新しいスタンプを送る（未送信 or 違うスタンプへの切替）。family_idは
  --    chore_reactions_before_insertトリガーが対象completionから自動補完する。
  --    stamp_keyの空文字・NULL・長さ超過はchk_reaction_kind_payload／既存の
  --    CHECK制約がcheck_violationとして拒否する（本関数で二重にバリデーションしない）。
  INSERT INTO chore_reactions (completion_id, reacted_by, kind, stamp_key)
  VALUES (p_completion_id, v_caller_member_id, 'stamp', p_stamp_key)
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT false, v_new_id;
END;
$$;

COMMENT ON FUNCTION public.toggle_chore_reaction_stamp(UUID, TEXT) IS
  '統括指示「絵文字のリアクションを、もう一回タップしたら取り消しにできるか」への対応（開発部/成果物/実装メモ.md 157章）。同じスタンプを再度押すと取消、違うスタンプを押すと切替、未送信なら新規追加。自分の行のみ操作可（reacted_by = current_family_member_id()）、他家族のcompletion_idは対象外（family_id一致を要求）。コメント（kind=''comment''）は対象外・取消不可のまま（chore_reactions_insert_scopedにkind=''comment''制約を追加し、スタンプの直接INSERTは本関数経由に一本化した）。EXECUTE権限は下記参照。';

-- ------------------------------------------------------------
-- EXECUTE権限（GRANT/REVOKE）— cancel_chore_completion等と同じパターン
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.toggle_chore_reaction_stamp(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_chore_reaction_stamp(UUID, TEXT) TO authenticated;
