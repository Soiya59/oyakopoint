-- ============================================================
-- 完了報告のコメントへの「返信」（報告した本人が返せる）
-- 要件定義書 07-48章（2026-10-12・統括決定「推奨通り」）、
-- 設計部/成果物/スキーマ設計.sql 86章、設計部/成果物/API仕様.md 42章、
-- 開発部/成果物/実装メモ.md 364章、やること.md 4-99
-- ============================================================
-- 【変えるもの】既存の表 chore_reactions に列1つ（reply_to_reaction_id）、制約・索引、
--   INSERTポリシー1本の条件式、BEFOREトリガー1本（返信の検査）、AFTER UPDATEトリガー1本
--   （元のコメントの論理削除に返信を連動）、既存4関数の本文（comment_notification_payload・
--   chore_reactions_after_insert_notify・hide_content・unhide_content。シグネチャ不変）。
-- 【作らないもの】新しい表・View・通常の関数（RPC）。トリガー関数2本は REVOKE ALL するので
--   rls_checks の S4（authenticated が実行できる関数）には数えない。
-- 【既存の行】reply_to_reaction_id は全部 NULL のまま（移行なし。表の書き直しも起きない）。
-- 【破壊的操作】なし。DROP するのは名前を付け直す制約・ポリシー・トリガー（IF EXISTS 付き）だけで、
--   データを消す操作は無い。ロールバック手順は スキーマ設計.sql 86.12章（実装メモ364章に転記）。
-- 【出す順序】Edge Function notify-comment（新kind）→ この migration → アプリ（OTA）。
-- 【PL/pgSQL の列名衝突の自己点検（設計部/CLAUDE.md の規則）】
--   本ファイルの関数は RETURNS TRIGGER／RETURNS jsonb／RETURNS uuid／RETURNS boolean で、
--   RETURNS TABLE の出力列は無い。本文中の表の列参照はすべて別名（r・r2・cc・fm・h・h2・pr・pt・t）付き。
--   ON CONFLICT (content_kind, content_id) は既存の hide_content と同じ書き方で、戻り値の名前と衝突しない。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 列・制約・索引（スキーマ設計.sql 86.3章）
-- ------------------------------------------------------------
ALTER TABLE chore_reactions
  ADD COLUMN IF NOT EXISTS reply_to_reaction_id UUID NULL;

-- 複合外部キーの参照先になる一意索引（id が主キーなので常に成立する）
CREATE UNIQUE INDEX IF NOT EXISTS uq_chore_reactions_completion_id_id
  ON chore_reactions (completion_id, id);

-- (b) 同じ完了報告のコメントしか指せない（他家族の行も指せない）。
--     MATCH SIMPLE（既定）なので reply_to_reaction_id が NULL の行は検査されない。
ALTER TABLE chore_reactions DROP CONSTRAINT IF EXISTS fk_chore_reactions_reply_to;
ALTER TABLE chore_reactions
  ADD CONSTRAINT fk_chore_reactions_reply_to
  FOREIGN KEY (completion_id, reply_to_reaction_id)
  REFERENCES chore_reactions (completion_id, id) ON DELETE CASCADE;

-- (a)(g) 返信はコメントの行にだけ。自分自身を指さない
ALTER TABLE chore_reactions DROP CONSTRAINT IF EXISTS chk_chore_reactions_reply_only_comment;
ALTER TABLE chore_reactions
  ADD CONSTRAINT chk_chore_reactions_reply_only_comment
  CHECK (reply_to_reaction_id IS NULL OR kind = 'comment');
ALTER TABLE chore_reactions DROP CONSTRAINT IF EXISTS chk_chore_reactions_reply_not_self;
ALTER TABLE chore_reactions
  ADD CONSTRAINT chk_chore_reactions_reply_not_self
  CHECK (reply_to_reaction_id IS NULL OR reply_to_reaction_id <> id);

-- (e) 1つのコメントに、削除されていない返信は1つまで。返信を消せば（deleted_at が立てば）書き直せる
CREATE UNIQUE INDEX IF NOT EXISTS uq_chore_reactions_one_live_reply
  ON chore_reactions (reply_to_reaction_id)
  WHERE reply_to_reaction_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN chore_reactions.reply_to_reaction_id IS
  '要件定義書07-48章（2026-10-12統括決定）。この行が返信のとき、返信先のコメント（同じ表の別の行）のid。返信でない行はNULL。返信はkind=''comment''の行だけ。1つのコメントに削除されていない返信は1つまで（uq_chore_reactions_one_live_reply）。返信できるのはその完了報告の報告者だけ（INSERTポリシーとchore_reactions_reply_guard）。返信への返信は不可。行は書き換えない（UPDATEポリシーが無く、delete_family_comment()はdeleted_atしか触らない）';

-- ------------------------------------------------------------
-- 2. INSERTポリシーの分岐（スキーマ設計.sql 86.4章。SELECT・DELETEは変えない）
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chore_reactions_insert_scoped" ON chore_reactions;

CREATE POLICY "chore_reactions_insert_scoped" ON chore_reactions
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND reacted_by = current_family_member_id()
    AND kind = 'comment'
    AND (
      -- 返信でないコメント: 今までどおり。自分の報告には書けない（07-23章決定2）
      (
        reply_to_reaction_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM chore_completions cc
          WHERE cc.id = chore_reactions.completion_id
            AND cc.reported_by = chore_reactions.reacted_by
        )
      )
      OR
      -- 返信: 書き手が、その完了報告の報告者であるときだけ（07-23章決定2の唯一の例外）
      (
        reply_to_reaction_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM chore_completions cc
          WHERE cc.id = chore_reactions.completion_id
            AND cc.reported_by = chore_reactions.reacted_by
        )
      )
    )
  );

-- ------------------------------------------------------------
-- 3. 返信の検査トリガー（スキーマ設計.sql 86.5章）
--    名前順で trg_chore_reactions_before_insert の後・trg_chore_reactions_social_toggle_guard の前
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chore_reactions_reply_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_family_id UUID := current_family_id();
  v_reporter_id      UUID;
  v_parent           RECORD;
  v_author_active    BOOLEAN;
BEGIN
  -- 返信でない行（スタンプ・普通のコメント）は何もしない
  IF NEW.reply_to_reaction_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 1. 返信先を引く。「無い」「他の家族」「別の完了報告」「スタンプ」「削除済み」「運営が非表示」は
  --    すべて同じ文言に収束させる（存在を漏らさない）。NEW.family_id は
  --    trg_chore_reactions_before_insert が完了報告から補完済み（名前順で先に動く）
  SELECT r.family_id, r.completion_id, r.kind, r.reacted_by, r.reply_to_reaction_id, r.deleted_at
    INTO v_parent
  FROM chore_reactions r
  WHERE r.id = NEW.reply_to_reaction_id;

  IF NOT FOUND
     OR v_parent.family_id IS DISTINCT FROM v_caller_family_id
     OR v_parent.family_id IS DISTINCT FROM NEW.family_id
     OR v_parent.completion_id IS DISTINCT FROM NEW.completion_id
     OR v_parent.kind <> 'comment'
     OR v_parent.deleted_at IS NOT NULL
     OR EXISTS (
          SELECT 1 FROM hidden_contents h
          WHERE h.content_kind = 'chore_reaction_comment'
            AND h.content_id = NEW.reply_to_reaction_id
        )
  THEN
    RAISE EXCEPTION '返信先のコメントが見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  -- 2. (d) 書き手は、その完了報告の報告者本人だけ
  SELECT cc.reported_by INTO v_reporter_id
  FROM chore_completions cc
  WHERE cc.id = NEW.completion_id;

  IF v_reporter_id IS NULL OR NEW.reacted_by <> v_reporter_id THEN
    RAISE EXCEPTION '返信できるのは、その完了報告をした本人だけです' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 3. (b) 返信への返信はできない
  IF v_parent.reply_to_reaction_id IS NOT NULL THEN
    RAISE EXCEPTION '返信には返信できません' USING ERRCODE = 'check_violation';
  END IF;

  -- 4. (c) 報告者自身のコメントには返信できない（古いデータの自己コメントも含む）
  IF v_parent.reacted_by = v_reporter_id THEN
    RAISE EXCEPTION '自分のコメントには返信できません' USING ERRCODE = 'check_violation';
  END IF;

  -- 5. 元のコメントを書いた人が家族から抜けているときは返信しない（読む人がいない）
  SELECT fm.is_active INTO v_author_active
  FROM family_members fm
  WHERE fm.id = v_parent.reacted_by;

  IF NOT COALESCE(v_author_active, false) THEN
    RAISE EXCEPTION 'コメントを書いた人が家族にいないため、返信できません' USING ERRCODE = 'check_violation';
  END IF;

  -- 6. (e) すでに削除されていない返信がある。親切な文言のための事前検査（本当の守りは部分一意索引）
  IF EXISTS (
       SELECT 1 FROM chore_reactions r2
       WHERE r2.reply_to_reaction_id = NEW.reply_to_reaction_id
         AND r2.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'このコメントには、すでに返信があります' USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chore_reactions_reply_guard ON chore_reactions;
CREATE TRIGGER trg_chore_reactions_reply_guard
  BEFORE INSERT ON chore_reactions
  FOR EACH ROW EXECUTE FUNCTION public.chore_reactions_reply_guard();

-- トリガー関数は呼び出し権限が要らない。authenticated などに実行権限を残さない（S4に数えられない）
REVOKE ALL ON FUNCTION public.chore_reactions_reply_guard() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.chore_reactions_reply_guard() IS
  '要件定義書07-48章。chore_reactionsに返信（reply_to_reaction_idが入った行）をINSERTするときの検査。返信先が同じ家族・同じ完了報告の削除されていない未非表示のコメントで、返信でなく報告者のものでなく、書き手が報告者本人で、書いた人が在籍中で、すでに返信が無いことを確かめる。見つからない理由は全部同じ文言に収束させる。';

-- ------------------------------------------------------------
-- 4. 元のコメントが論理削除されたら、返信も同じ値で論理削除する（スキーマ設計.sql 86.6章）
--    返信だけを消しても元のコメントは残る（逆向きの連動は無い）。物理DELETEはしない。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chore_reactions_cascade_delete_replies()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE chore_reactions r
     SET deleted_at = NEW.deleted_at,
         deleted_by_member_id = NEW.deleted_by_member_id
   WHERE r.reply_to_reaction_id = NEW.id
     AND r.deleted_at IS NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chore_reactions_cascade_delete_replies ON chore_reactions;
CREATE TRIGGER trg_chore_reactions_cascade_delete_replies
  AFTER UPDATE OF deleted_at ON chore_reactions
  FOR EACH ROW
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
  EXECUTE FUNCTION public.chore_reactions_cascade_delete_replies();

REVOKE ALL ON FUNCTION public.chore_reactions_cascade_delete_replies() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.chore_reactions_cascade_delete_replies() IS
  '要件定義書07-48章。元のコメントにdeleted_atが立ったとき、その返信（あれば）にも同じdeleted_at・deleted_by_member_idを立てる。返信を単独で消しても元のコメントは残る。';

-- ------------------------------------------------------------
-- 5. 運営の非表示（hidden_contents）に返信ぶんを連動（スキーマ設計.sql 86.6章）
--    他の部分は 20260930140000（hide_content）・20260930020000（unhide_content）の本文のまま。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hide_content(
  p_content_kind TEXT,
  p_content_id UUID
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_id UUID;
BEGIN
  IF p_content_id IS NULL THEN
    RAISE EXCEPTION '対象のIDを指定してください' USING ERRCODE = 'check_violation';
  END IF;

  CASE p_content_kind
    WHEN 'family_board_post' THEN
      SELECT t.family_id INTO v_family_id FROM family_board_posts t WHERE t.id = p_content_id;
    WHEN 'family_board_comment' THEN
      SELECT t.family_id INTO v_family_id FROM family_board_comments t WHERE t.id = p_content_id;
    WHEN 'chore_completion_note' THEN
      SELECT t.family_id INTO v_family_id FROM chore_completions t WHERE t.id = p_content_id;
    WHEN 'chore_reaction_comment' THEN
      SELECT t.family_id INTO v_family_id FROM chore_reactions t WHERE t.id = p_content_id;
    WHEN 'gratitude_note' THEN
      SELECT t.family_id INTO v_family_id FROM gratitude_points t WHERE t.id = p_content_id;
    WHEN 'family_drawing' THEN
      SELECT t.family_id INTO v_family_id FROM family_drawings t WHERE t.id = p_content_id;
    WHEN 'family_drawing_comment' THEN
      SELECT t.family_id INTO v_family_id FROM family_drawing_comments t WHERE t.id = p_content_id;
    ELSE
      RAISE EXCEPTION '対象の種別が正しくありません（7値のいずれか）: %', p_content_kind
        USING ERRCODE = 'check_violation';
  END CASE;

  IF v_family_id IS NULL THEN
    RAISE EXCEPTION '対象が見つかりません（種別 % / ID %）', p_content_kind, p_content_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  INSERT INTO hidden_contents (family_id, content_kind, content_id)
  VALUES (v_family_id, p_content_kind, p_content_id)
  ON CONFLICT (content_kind, content_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT h.id INTO v_id FROM hidden_contents h
    WHERE h.content_kind = p_content_kind AND h.content_id = p_content_id;
  END IF;

  -- [2026-10-13追加・07-48章] 元のコメントを隠すときは、その返信ぶんも隠す
  -- （古いアプリは hidden_contents の行しか知らないため。べき等）。戻り値は元のコメントの分。
  IF p_content_kind = 'chore_reaction_comment' THEN
    INSERT INTO hidden_contents (family_id, content_kind, content_id)
    SELECT r.family_id, 'chore_reaction_comment', r.id
    FROM chore_reactions r
    WHERE r.reply_to_reaction_id = p_content_id
    ON CONFLICT (content_kind, content_id) DO NOTHING;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.hide_content(TEXT, UUID) IS
  '運営が、対象のコンテンツを家族全員から見えなくする（要件定義書07-32章
   決定7の段階3）。service_roleからのみ実行できる。べき等（既に隠して
   あれば同じidを返す）。データは消さない（論理的な非表示のみ）。
   2026-09-23、対象を7値に拡張（family_board_comment・family_drawing_
   commentを実装）。2026-10-13、chore_reaction_commentを隠すときは
   その返信（reply_to_reaction_idが指す行）も同時に隠す（07-48章）。';

CREATE OR REPLACE FUNCTION public.unhide_content(
  p_content_kind TEXT,
  p_content_id UUID
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
BEGIN
  DELETE FROM hidden_contents h
  WHERE h.content_kind = p_content_kind AND h.content_id = p_content_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- [2026-10-13追加・07-48章] 元のコメントを戻すときは、その返信ぶんも戻す（戻り値は元のコメントの分だけ数える）。
  -- 返信だけを隠したままにしたいときは、運営が返信に対して hide_content をやり直す。
  IF p_content_kind = 'chore_reaction_comment' THEN
    DELETE FROM hidden_contents h2
    WHERE h2.content_kind = 'chore_reaction_comment'
      AND h2.content_id IN (SELECT r.id FROM chore_reactions r WHERE r.reply_to_reaction_id = p_content_id);
  END IF;

  RETURN v_deleted > 0;
END;
$$;

COMMENT ON FUNCTION public.unhide_content(TEXT, UUID) IS
  '運営が非表示を取り消す。service_roleからのみ実行できる（保護者は戻せない。
   要件定義書07-32章 決定7）。2026-10-13、chore_reaction_commentを戻すときは
   その返信ぶんの非表示も一緒に戻す（07-48章）。';

-- ------------------------------------------------------------
-- 6. 通知（スキーマ設計.sql 86.7章）。comment_notification_payload に4つ目のkind
--    chore_reaction_reply を足し、chore_reactions_after_insert_notify が返信かどうかで出し分ける。
--    それ以外は 20260930140000 の本文のまま。シグネチャ不変の CREATE OR REPLACE なので
--    REVOKE は保たれる（再度明示する）。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comment_notification_payload(
  p_kind TEXT,
  p_comment_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_target_member_id UUID;
  v_commenter_member_id UUID;
  v_commenter_name TEXT;
  v_tokens jsonb;
BEGIN
  CASE p_kind
    WHEN 'family_board_comment' THEN
      SELECT c.family_id, p.author_member_id, c.commenter_member_id
        INTO v_family_id, v_target_member_id, v_commenter_member_id
      FROM family_board_comments c
      JOIN family_board_posts p ON p.id = c.post_id
      WHERE c.id = p_comment_id;
    WHEN 'chore_reaction_comment' THEN
      -- [2026-10-13変更] 返信の行を誤ってこの種別で渡しても通知が出ない（報告者に自分の返信を通知しない）
      SELECT r.family_id, cc.reported_by, r.reacted_by
        INTO v_family_id, v_target_member_id, v_commenter_member_id
      FROM chore_reactions r
      JOIN chore_completions cc ON cc.id = r.completion_id
      WHERE r.id = p_comment_id
        AND r.reply_to_reaction_id IS NULL;
    WHEN 'chore_reaction_reply' THEN
      -- [2026-10-13追加] 宛先＝返信先のコメントを書いた人（親の行の reacted_by）、コメントした人＝返信した人
      SELECT r.family_id, pr.reacted_by, r.reacted_by
        INTO v_family_id, v_target_member_id, v_commenter_member_id
      FROM chore_reactions r
      JOIN chore_reactions pr ON pr.id = r.reply_to_reaction_id
      WHERE r.id = p_comment_id;
    WHEN 'family_drawing_comment' THEN
      SELECT dc.family_id, d.artist_member_id, dc.commenter_member_id
        INTO v_family_id, v_target_member_id, v_commenter_member_id
      FROM family_drawing_comments dc
      JOIN family_drawings d ON d.id = dc.drawing_id
      WHERE dc.id = p_comment_id;
    ELSE
      RETURN NULL;
  END CASE;

  IF v_family_id IS NULL THEN
    RETURN NULL; -- 対象が見つからない（呼び出し側の取り違え等）。
  END IF;

  -- 自己コメントには通知しない。
  IF v_target_member_id = v_commenter_member_id THEN
    RETURN NULL;
  END IF;

  SELECT fm.display_name INTO v_commenter_name
  FROM family_members fm WHERE fm.id = v_commenter_member_id;

  -- 端末単位の除外（コメントした人の端末では鳴らさない。コメント者と
  -- 宛先が同じ共有端末を使っている場合の対策）。
  SELECT COALESCE(jsonb_agg(DISTINCT pt.expo_push_token), '[]'::jsonb)
    INTO v_tokens
  FROM push_tokens pt
  JOIN family_members fm ON fm.id = pt.member_id
  WHERE fm.family_id = v_family_id
    AND fm.is_active
    AND pt.member_id = v_target_member_id
    AND pt.expo_push_token NOT IN (
      SELECT pt2.expo_push_token FROM push_tokens pt2 WHERE pt2.member_id = v_commenter_member_id
    );

  RETURN jsonb_build_object(
    'kind', p_kind,
    'comment_id', p_comment_id,
    -- 「コメントの中身は出さない」。本文（body/comment_body）は一切含めない。
    'commenter_display_name', v_commenter_name,
    'recipient_tokens', v_tokens
  );
END;
$$;

COMMENT ON FUNCTION public.comment_notification_payload(TEXT, UUID) IS
  '要件定義書07章隣接の2026-09-23決定「コメントが付いたら書いた人にだけ
   通知する」。掲示板・完了報告・お絵かきの3種のコメントについて、通知に
   必要な最小限の情報（種別・コメントした人の表示名・送信先Expoトークンの
   配列）だけをjsonbで組み立てる。コメント本文は含めない。自己コメント
   （対象=コメントした本人）はNULLを返し送信しない。2026-10-13、4つ目の
   種別chore_reaction_reply（完了報告のコメントへの返信。宛先＝返信先の
   コメントを書いた人。要件定義書07-48章）を追加。';

REVOKE ALL ON FUNCTION public.comment_notification_payload(TEXT, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chore_reactions_after_insert_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_notify_enabled BOOLEAN;
  v_notify_kind TEXT;
  v_payload jsonb;
  v_url TEXT;
  v_bearer TEXT;
BEGIN
  IF NEW.kind <> 'comment' THEN
    RETURN NEW;
  END IF;

  SELECT f.push_notifications_enabled INTO v_family_notify_enabled
  FROM families f WHERE f.id = NEW.family_id;

  IF NOT COALESCE(v_family_notify_enabled, false) THEN
    RETURN NEW;
  END IF;

  -- [2026-10-13追加・07-48章] 返信かどうかで通知の種別を出し分ける
  v_notify_kind := CASE WHEN NEW.reply_to_reaction_id IS NULL
                        THEN 'chore_reaction_comment' ELSE 'chore_reaction_reply' END;
  v_payload := public.comment_notification_payload(v_notify_kind, NEW.id);

  IF v_payload IS NULL
     OR jsonb_array_length(COALESCE(v_payload->'recipient_tokens', '[]'::jsonb)) = 0 THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'comment_notify_url';
    SELECT decrypted_secret INTO v_bearer FROM vault.decrypted_secrets WHERE name = 'comment_notify_bearer';

    IF v_url IS NULL OR v_bearer IS NULL THEN
      RAISE WARNING 'chore_reactions notify skipped for % (vault secrets not configured)', NEW.id;
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_bearer),
      body    := v_payload
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chore_reactions notify failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- トリガー本体（trg_chore_reactions_after_insert_notify）は 20260930140000 のまま。
-- 関数の中身だけを差し替えたので、トリガーを作り直す必要はない。
