-- ============================================================
-- 子ども同士の完了報告リアクションを解禁し、自己リアクションを禁止する
-- （企画部/成果物/要件定義書.md 07-23章、本部長指示・2026-09-09）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-23章「子ども同士の完了報告リアクション」。
--   決定1（当初案「スタンプのみ」→【2026-09-09・統括判断により変更】で
--   「コメントも許す」に改訂）・決定2（自己リアクション禁止、対象は子どもに
--   限らず保護者・みまもりメンバーを含む全ロール）・決定3（みまもり関連は
--   `20260916010000_fix_chore_reactions_supporter_target_dropped.sql`のとおり
--   現状維持、本ファイルでは触れない）を実装する。開発部/成果物/実装メモ.md
--   175章に判断理由・検証結果を記録する。
--
-- [本マイグレーションの位置づけ] `20260916010000_fix_chore_reactions_supporter_
-- target_dropped.sql`（実装メモ174章、みまもり関連デグレの復元）とは別の、
-- 新しいスコープ拡張である（07-23章「経緯・前提として確認した事実」に明記済み）。
-- `20260916010000`は書き換えず、本ファイルはその適用後の状態を前提に差分を積む
-- （07-23章「データモデルへの示唆」末尾の推奨どおり別マイグレーションとして扱う）。
-- 本番へは`20260916010000`とあわせて本部長がまとめて適用する予定であり
-- （統括判断）、ローカルDockerでは`20260916010000`を先に適用した状態に本ファイルを
-- 重ねて検証する。
--
-- [決定1（対象とする行為）の実装] 07-23章決定1は当初「スタンプのみ」だったが、
-- 統括に諮った結果【2026-09-09・統括判断により変更】で「コメントも許す」に
-- 改訂された（要件定義書.md該当注記参照）。この結果、スタンプとコメントで条件を
-- 分ける必要が無くなった。あわせて、対象completionの報告者の役割
-- （parent/supporter）による絞り込み（従来の第2項）と、送信者の役割による絞り込み
-- （従来の第1項）の両方を撤廃する。送信者側は「ログイン済みの家族の一員である
-- こと」（`current_family_id()`・`current_family_member_id()`が非NULLであること。
-- 無変更のまま維持）だけで足り、対象側は下記決定2の自己リアクション禁止のみが
-- 制約になる。結果として「家族内の誰でも、家族内の誰の完了報告にも反応できる
-- （自分自身を除く）」という対称な条件になる。
--
-- [決定2（自己リアクションの禁止）の実装] 07-23章「経緯・前提として確認した事実」
-- が指摘するとおり、現行の`chore_reactions_insert_scoped`・
-- `toggle_chore_reaction_stamp()`はいずれも`reacted_by`と対象completionの
-- `reported_by`の一致を検査しておらず、自己リアクションを禁止する仕組みが
-- 存在しない。掲示板の`toggle_family_board_reaction_stamp()`
-- （`20260910030000_toggle_family_board_reaction_stamp.sql`171〜173行）が
-- `author_member_id = reactor_member_id`を検査して「自分の投稿にはリアクション
-- できません」で拒否しているのと同じ考え方・同じ文言のトーンで、対象completionの
-- `reported_by`と`reacted_by`が一致する場合を拒否する（文言は「投稿」→「完了報告」
-- に置き換えた）。対象は子どもに限らず、保護者・みまもりメンバーを含む全ロール
-- （決定2、掲示板と同じくロールを問わない一律のルール）。
--
-- [家族・本人確認の境界（本部長依頼により絶対に緩めない）]
--   - `family_id = current_family_id()`（ポリシー）・
--     `cc.family_id = v_caller_family_id`（関数、対象completionの取得条件）は
--     無変更のまま維持する。`family_id`はトリガー（`chore_reactions_before_insert`、
--     本ファイルでは変更しない）が対象completionから自動補完するため、他家族の
--     completion_idを指定した場合はこの一致チェックで必ず弾かれる。今回の
--     「誰が誰に送れるか」という役割条件の変更とは独立した、別の防御層であり
--     今回一切触れていない。
--   - `reacted_by = current_family_member_id()`（ポリシー）・
--     `v_caller_member_id := current_family_member_id()`からのINSERT（関数）も
--     無変更のまま維持する。他人になりすましてリアクションを送ることはできない。
--   - 175.4節で、(a)他家族のcompletion_idに対する操作が今回も拒否されること、
--     (b)自分になりすまし以外の送信ができないことを実測して確認する。
--
-- [引数の形を変えない（実装メモ83.2章・165章・170章・174章の教訓）]
-- `toggle_chore_reaction_stamp(uuid, text)`の引数の形は変更しない。
-- `CREATE OR REPLACE FUNCTION`のみを使い、`DROP FUNCTION`は行わない。適用前後で
-- オーバーロードが1本のみであることをDO块で確認する（174章と同じ方式）。
--
-- [EXECUTE権限（GRANT/REVOKE）] シグネチャ不変の`CREATE OR REPLACE`のため、既存の
-- GRANT/REVOKE（157章で設定、170章・174章で保持確認済み）は失われない
-- （45.12章の既知の挙動）。本ファイルでの再GRANT/REVOKEは不要。
--
-- 破壊性の評価: 非破壊的。既存ポリシー1本の条件式の変更（役割による絞り込みの
-- 撤廃＋自己リアクション禁止の追加）と、既存関数1本（シグネチャ不変）の権限
-- 判定ロジックの変更のみ。新規テーブル・新規列は無い。**既存データの書き換え・
-- 削除は一切行わない**（既存の自己リアクション行が見つかった場合も、本
-- マイグレーションでは削除しない。実装メモ175.3節に確認結果を記録する）。
--
-- 権限影響: RLS照査スイート（oyakopoint-app/supabase/tests/rls_checks.sql）の
-- S3（既存1行のハッシュ変更。本数54本のまま）が変わる見込み。S1（27のまま。
-- テーブルの追加・削除は無い）・S4（58のまま。関数の追加・削除は無い。
-- toggle_chore_reaction_stampのGRANT/REVOKEは既存のまま変更しない）は変更しない
-- 見込み。ローカルDocker環境で実測したうえでスナップショットを更新する
-- （96.5章の遵守。FAILを消すための書き換えはしない）。
--
-- [重要] 本マイグレーションはまだ本番に適用していない（作成・ローカル検証のみ）。
-- `20260916010000`と合わせて、本部長の操作を待って本番適用される予定
-- （依頼・統括判断どおり）。
-- ============================================================

-- ------------------------------------------------------------
-- 0. 事前確認: toggle_chore_reaction_stamp のオーバーロードが1本（UUID, TEXT）
--    のみであることを確認する（実装メモ83.2章・165章・170章・174章の教訓）。
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
-- 1. chore_reactions_insert_scoped:
--    - 役割による絞り込み（送信者側・対象側の第1項・第2項）を撤廃する（決定1）。
--    - 自己リアクション禁止を追加する（決定2）。
--    - family_id・reacted_by の本人・家族確認、kind = 'comment' 制約は無変更。
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chore_reactions_insert_scoped" ON chore_reactions;

CREATE POLICY "chore_reactions_insert_scoped" ON chore_reactions
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND reacted_by = current_family_member_id()
    AND kind = 'comment'
    AND NOT EXISTS (
      SELECT 1
      FROM chore_completions cc
      WHERE cc.id = chore_reactions.completion_id
        AND cc.reported_by = chore_reactions.reacted_by
    )
  );

-- ------------------------------------------------------------
-- 2. toggle_chore_reaction_stamp() — 権限判定を決定1・決定2のとおりに書き換える。
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

  -- 2. 権限判定【本マイグレーションでの変更箇所】: 07-23章決定1（コメントも許すに
  --    改訂）により、送信者側・対象側いずれの役割による絞り込みも撤廃した。
  --    家族内であれば誰でも送信できる（family_idの一致は上記1で確認済み）。
  --    唯一の制約は決定2（自己リアクション禁止、全ロール対象）であり、掲示板の
  --    toggle_family_board_reaction_stamp()（20260910030000、171〜173行）と
  --    同じ考え方・同じERRCODEで、対象completionの報告者が呼び出し元自身の
  --    場合を拒否する。
  IF v_completion.reported_by = v_caller_member_id THEN
    RAISE EXCEPTION '自分の完了報告にはリアクションできません' USING ERRCODE = 'check_violation';
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
  '統括指示「絵文字のリアクションを、もう一回タップしたら取り消しにできるか」への対応（開発部/成果物/実装メモ.md 157章）。同じスタンプを再度押すと取消、違うスタンプを押すと切替、未送信なら新規追加。自分の行のみ操作可（reacted_by = current_family_member_id()）、他家族のcompletion_idは対象外（family_id一致を要求）。コメント（kind=''comment''）は対象外・取消不可のまま（chore_reactions_insert_scopedにkind=''comment''制約を追加し、スタンプの直接INSERTは本関数経由に一本化した）。権限判定は要件定義書07-23章決定1・決定2（開発部/成果物/実装メモ.md 175章）により「家族内の誰でも、家族内の誰の完了報告にも送信できる（自分自身の完了報告を除く）」という対称な条件に改訂した（従来は保護者・みまもりメンバーのみ送信可、対象も保護者・みまもりメンバーの完了報告のみだったが、子ども同士の反応を許可する統括判断〈2026-09-09〉に伴い役割による絞り込みを撤廃し、代わりに自己リアクション禁止を新設した）。EXECUTE権限は157章から変更なし（シグネチャ不変のためCREATE OR REPLACEでも失われない）。';

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
