-- ============================================================
-- 「メッセージ」（社内呼称: 定時アナウンス）— 新設・2026-09-23
-- 参照: 企画部/成果物/要件定義書.md 07-37章4章
--       設計部/成果物/スキーマ設計.sql 75章（骨格の踏襲元。ただし下記の
--       ★変更点のとおり、本部長依頼〈2026-09-23〉により枠の識別子を
--       変更している。75章の本文は書き換えず、本マイグレーションの
--       コメントに変更点と理由を明記する形を取る）。
--       UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 64章
--       開発部/成果物/実装メモ.md 292章（本タスクの実装記録・決定ログ）
-- ============================================================
--
-- ★設計書（スキーマ設計.sql 75章）から変えた点（2026-09-23・統括決定を
-- 反映した本部長依頼による。実装メモ292.1章に詳細を記録）:
--   1. 画面に出す名前は「メッセージ」（クライアント側の定数1箇所にまとめる。
--      DBのコメント・列名には影響しない）。
--   2. **2つの枠は「朝」「夜」ではなく、時刻を自由に決められる2つの枠。**
--      75章は `slot TEXT CHECK (slot IN ('morning', 'evening'))` だったが、
--      本マイグレーションは **`slot SMALLINT CHECK (slot IN (1, 2))`** に
--      変更する。値そのものに「朝」「夜」の意味を持たせない（1つ目の枠・
--      2つ目の枠、というだけの識別子）。
--   3. 参考例は、要件定義書4-4節の朝4本・夜4本のどちらも、どちらの枠でも
--      選べるようにする（クライアント側の対応のみで、DB側の変更は無い）。
--   4. 文字数上限は20字ではなく **30字**（UIUXデザイン部/成果物/主要画面
--      ワイヤーフレーム.md 64.3節の決定、64.12節1番で本部長が承認済み）。
--   5. 1日の上限（2枠まで）・宛先（家族全員、書いた本人を含む）は変更なし。
--
-- ★75章に無く、本マイグレーションで追加した関数（実装メモ292章に理由を
-- 記録）:
--   - `delete_family_scheduled_announcement(p_slot)`: ワイヤーフレーム
--     64.6.0節「決定3」（メッセージを完全に消す「けす」操作）に対応する
--     行削除専用RPC。75章のUPSERT関数（`set_family_scheduled_announcement`）
--     だけでは行の削除ができないため新設した。
--
-- [依頼された3つの失敗の反映（75章冒頭と同じ確認）]
--   (1) 新設する関数はすべて `SET search_path = public` を付ける。
--   (2) pg_net・supabase_vaultはCREATE EXTENSIONしない（271章・74章の
--       実績どおり、ローカル・本番いずれも既に導入済みであることを
--       前提にする。相乗りするだけ）。
--   (3) family_membersへの新しいON DELETE RESTRICTは追加しない
--       （列を1本足すのみ）。family_scheduled_announcements.family_id→
--       families.idはON DELETE CASCADE。
-- ============================================================

-- ------------------------------------------------------------
-- 1. family_scheduled_announcements（家族の2つの枠）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_scheduled_announcements (
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  -- [★変更点2] 1・2の2値のみ。「朝」「夜」の意味を持たない識別子。
  -- 要件定義書07-37-4-8節「2枠まで」の上限を、この2値に固定することで
  -- DB側でも表現する（3枠目が要件化されたらCHECKを広げるだけで済む）。
  slot SMALLINT NOT NULL CHECK (slot IN (1, 2)),
  -- その枠のオンオフ（ワイヤーフレーム64.6.0節「そうしんする／いまは
  -- そうしんしない」）。既定false——行が新規に作られる場面は下記4章の
  -- RPC経由のみで、そのRPCが必ずp_enabledを要求するため、この既定値が
  -- 実際に使われることはない（NOT NULL列のため形式上必要）。
  enabled BOOLEAN NOT NULL DEFAULT false,
  -- JST（Asia/Tokyo）の壁時計時刻として解釈する（下記6章のcron本体が
  -- `now() AT TIME ZONE 'Asia/Tokyo'`で判定する。タイムゾーン情報を
  -- 持たないTIME型を採用）。
  send_time TIME NOT NULL,
  -- 自由入力の文面。NULLは「まだ設定されていない」。
  -- [★変更点4] 文字数上限は30字（ワイヤーフレーム64.3.2節の決定。
  -- 統括提示の参考例そのもの〈28字〉が20字に収まらないため30字に
  -- 変更された。64.12節1番で本部長が承認済み）。
  message TEXT NULL CHECK (message IS NULL OR char_length(trim(message)) BETWEEN 1 AND 30),
  -- [下記6章のcron本体が使う「今日はもう処理した」印。JST基準の暦日]
  -- 一致する分に達しても、その日すでに処理済みなら送らない
  -- （二重送信防止・繰り越しをしない設計の両方をこの1列で表現する）。
  last_sent_on DATE NULL,
  -- [失敗に気づく経路。284章の再発防止] bearerトークン等の秘密情報は
  -- 書き込まない（net.http_post呼び出し自体の失敗理由のみを想定）。
  last_dispatch_attempted_at TIMESTAMPTZ NULL,
  last_dispatch_recipient_count INT NULL CHECK (last_dispatch_recipient_count IS NULL OR last_dispatch_recipient_count >= 0),
  last_dispatch_error TEXT NULL,
  -- 最後にこの枠を保存・変更した保護者。67.2章・74.3章と同じ理由で
  -- 外部キーは張らない（循環参照回避）。
  updated_by UUID NULL,
  -- **意図的に自動更新トリガーを付けない。**下記6章のcron本体が毎分
  -- `last_sent_on`等を更新しうるため、汎用トリガー（`set_updated_at()`）に
  -- 任せると「保護者が設定を変更した時刻」と「cronが発火を試みた時刻」が
  -- 混ざる。`updated_at`は下記4章のRPC内でのみ明示的に更新する。
  updated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- enabled=trueなら必ずmessageが要る（要件定義書07-37-4-7節「メッセージ
  -- が1件も設定されていない家族には送るものが無い」のDB側の強制）。
  CONSTRAINT chk_family_scheduled_announcements_enabled_needs_message
    CHECK (NOT enabled OR message IS NOT NULL),

  PRIMARY KEY (family_id, slot)
);

COMMENT ON TABLE family_scheduled_announcements IS
  '要件定義書07-37章4章「定時アナウンス」（画面上の名称は「メッセージ」、
   実装メモ292.1章）。1家族につき最大2行（slot=1・slot=2。朝夜の意味は
   持たない識別子。実装メモ292.1章）。書き込みは下記4章のSECURITY DEFINER
   関数のみが行い、クライアントからの直接書き込みは許可しない。cron本体
   （下記6章）が毎分1回、送るべき行を探して更新する。';

ALTER TABLE family_scheduled_announcements ENABLE ROW LEVEL SECURITY;

-- [RLS] 読めるのは家族全員（子ども含む）。設定できるのは保護者のみだが、
-- それをRLSのINSERT/UPDATEポリシーでは表現しない。family_tree_seasons・
-- weekly_family_digests（66章）と同じ「書き込みポリシーを1つも定義せず、
-- RLS有効時のデフォルト拒否に任せる」方式を踏襲する。
DROP POLICY IF EXISTS "family_scheduled_announcements_select_same_family" ON family_scheduled_announcements;
CREATE POLICY "family_scheduled_announcements_select_same_family" ON family_scheduled_announcements
  FOR SELECT
  USING (family_id = current_family_id());

-- [重要] INSERT/UPDATE/DELETEポリシーは意図的に一切定義しない。書き込みは
-- 下記4章の関数群のみが行う（いずれもSECURITY DEFINER）。

-- ------------------------------------------------------------
-- 2. family_members への列1本（人ごとの受信オンオフ）
-- ------------------------------------------------------------
-- [どこに持たせるか] 人（メンバー）に属する設定のため、人の行に持たせる
-- （要件定義書07-37-4-8節「保護者・みまもりメンバー・子どもそれぞれ自分の
-- 分だけ操作できる」）。
--
-- [RLS: 新しいポリシー・新しいRPCは不要] 本人が自分の行のこの列だけを
-- 変更する経路は、既存の`family_members_update_scoped`ポリシー（2章）と
-- `family_members_before_update()`トリガー（同章）がそのまま提供する
-- （USING/WITH CHECKが`is_current_user_parent() OR id = current_family_
-- member_id()`——保護者は家族内の誰の行でも更新可、本人は自分の行のみ
-- 更新可。トリガーは role/auth_user_id/family_id/is_owner/is_activeの
-- 書き換えのみを禁止するブロックリスト方式のため、新しい列は自動的に
-- 許可される）。クライアントは
-- `supabase.from('family_members').update({ scheduled_announcement_
-- notifications_enabled: false }).eq('id', myMemberId)`という既存と同じ
-- 形の直接UPDATEで実現できる。
--
-- [既定値] `DEFAULT true`。本列はOSの許可ダイアログを一切発生させない
-- （ダイアログを発生させるかどうかは下記5章の
-- `current_family_push_permission_needed()`で決まり、本列はその後段の
-- 「実際に自分の端末で鳴らすか」という個人設定に過ぎない）。通常の
-- 「機能は既定でON、嫌なら個人が止める」というオプトアウト型にする。
ALTER TABLE family_members
  ADD COLUMN IF NOT EXISTS scheduled_announcement_notifications_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN family_members.scheduled_announcement_notifications_enabled IS
  '要件定義書07-37-4-8節。「メッセージ」（実装メモ292.1章、社内呼称:
   定時アナウンス）を、この人自身の端末で受け取るかどうか。本人
   （current_family_member_id()が一致）または保護者のみ変更可——新しい
   RLSポリシーは追加せず、既存のfamily_members_update_scopedをそのまま
   使う。OSの通知許可ダイアログの要否には関与しない（下記5章参照）。
   既定true。';

-- [家族削除への影響] family_membersへの列追加のみ。新しい外部キーは0本。

-- ------------------------------------------------------------
-- 3. family_scheduled_announcement_notification_payload()
--    （送信内容の組み立て）
-- ------------------------------------------------------------
-- [74.8章との違い] 「投稿者を除く」という除外ロジックを持たない。要件
-- 定義書07-37-4-8節「宛先：家族全員（書いた本人を含む）」のとおり、誰も
-- 除外しない。送信対象は「その家族の、在籍中(is_active)かつ本人が受信を
-- オフにしていない(scheduled_announcement_notifications_enabled)メンバー
-- に紐づく全push_tokens」。
CREATE OR REPLACE FUNCTION public.family_scheduled_announcement_notification_payload(
  p_family_id UUID,
  p_slot SMALLINT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message TEXT;
  v_tokens jsonb;
BEGIN
  SELECT fsa.message INTO v_message
  FROM family_scheduled_announcements fsa
  WHERE fsa.family_id = p_family_id AND fsa.slot = p_slot;

  IF v_message IS NULL THEN
    -- 設定が無い、または下記6章のUPDATEとの競合でmessageがNULLになって
    -- いた（想定外）。空を返し、呼び出し側で処理を打ち切らせる。
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(DISTINCT pt.expo_push_token), '[]'::jsonb)
    INTO v_tokens
  FROM push_tokens pt
  JOIN family_members fm ON fm.id = pt.member_id
  WHERE fm.family_id = p_family_id
    AND fm.is_active
    AND fm.scheduled_announcement_notifications_enabled;

  RETURN jsonb_build_object(
    'family_id', p_family_id,
    'slot', p_slot,
    'message', v_message,
    'recipient_tokens', v_tokens
  );
END;
$$;

COMMENT ON FUNCTION public.family_scheduled_announcement_notification_payload(UUID, SMALLINT) IS
  '要件定義書07-37章4章。1家族・1枠分の「メッセージ」送信に必要な最小限の
   情報（文面・送信先Expoトークンの配列）だけをjsonbで組み立てる。
   「投稿者の除外」は行わない（宛先は家族全員、書いた本人を含む）。
   送信先は在籍中かつ本人が受信をオフにしていないメンバーのトークンのみ。';

REVOKE ALL ON FUNCTION public.family_scheduled_announcement_notification_payload(UUID, SMALLINT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. dispatch_due_family_scheduled_announcements()
--    （cronから呼ばれる本体。下記6章のジョブが毎分呼ぶ）
-- ------------------------------------------------------------
-- [設計の骨格] 「対象行を選んで“処理済み”の印を付ける」処理と「実際に
-- 送信を試みる」処理を1本のUPDATE ... RETURNING（データ変更CTE）で分離
-- する。これにより、同じ分に2回呼ばれる・複数のワーカーが同時に動く、
-- といったレースが起きても「今日はもう処理した」印（`last_sent_on`）が
-- 先に立つため、二重送信が起こらない（UPDATE文自体が行ロックを取るため、
-- PostgreSQLの通常の同時実行制御にそのまま乗る）。
CREATE OR REPLACE FUNCTION public.dispatch_due_family_scheduled_announcements()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now_jst   TIMESTAMP := (now() AT TIME ZONE 'Asia/Tokyo');
  v_today     DATE := v_now_jst::date;
  v_now_time  TIME := date_trunc('minute', v_now_jst)::time;
  v_url       TEXT;
  v_bearer    TEXT;
  v_vault_checked BOOLEAN := false;
  v_vault_ok  BOOLEAN := false;
  v_row       RECORD;
  v_payload   jsonb;
  v_recipient_count INT;
BEGIN
  FOR v_row IN
    WITH claimed AS (
      UPDATE family_scheduled_announcements fsa
         SET last_sent_on = v_today,
             last_dispatch_attempted_at = now(),
             last_dispatch_error = NULL,
             last_dispatch_recipient_count = NULL
       WHERE fsa.enabled
         AND fsa.message IS NOT NULL
         AND fsa.send_time = v_now_time
         AND (fsa.last_sent_on IS NULL OR fsa.last_sent_on <> v_today)
      RETURNING fsa.family_id, fsa.slot
    )
    SELECT claimed.family_id, claimed.slot FROM claimed
  LOOP
    IF NOT v_vault_checked THEN
      v_vault_checked := true;
      BEGIN
        SELECT decrypted_secret INTO v_url
        FROM vault.decrypted_secrets WHERE name = 'family_scheduled_announcement_notify_url';

        SELECT decrypted_secret INTO v_bearer
        FROM vault.decrypted_secrets WHERE name = 'family_scheduled_announcement_notify_bearer';

        v_vault_ok := (v_url IS NOT NULL AND v_bearer IS NOT NULL);
      EXCEPTION WHEN OTHERS THEN
        v_vault_ok := false;
      END;
    END IF;

    IF NOT v_vault_ok THEN
      UPDATE family_scheduled_announcements fsa2
         SET last_dispatch_recipient_count = 0,
             last_dispatch_error = 'vault secrets not configured'
       WHERE fsa2.family_id = v_row.family_id AND fsa2.slot = v_row.slot;
      RAISE WARNING 'family_scheduled_announcements dispatch skipped for %/% (vault secrets not configured)', v_row.family_id, v_row.slot;
      CONTINUE;
    END IF;

    v_payload := public.family_scheduled_announcement_notification_payload(v_row.family_id, v_row.slot);

    IF v_payload IS NULL THEN
      UPDATE family_scheduled_announcements fsa2
         SET last_dispatch_recipient_count = 0,
             last_dispatch_error = 'payload build returned null (message missing at dispatch time)'
       WHERE fsa2.family_id = v_row.family_id AND fsa2.slot = v_row.slot;
      CONTINUE;
    END IF;

    v_recipient_count := jsonb_array_length(COALESCE(v_payload->'recipient_tokens', '[]'::jsonb));

    UPDATE family_scheduled_announcements fsa2
       SET last_dispatch_recipient_count = v_recipient_count
     WHERE fsa2.family_id = v_row.family_id AND fsa2.slot = v_row.slot;

    IF v_recipient_count = 0 THEN
      -- 送り先が無いだけであり、これ自体はエラーではない。
      CONTINUE;
    END IF;

    BEGIN
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || v_bearer),
        body    := v_payload
      );
    EXCEPTION WHEN OTHERS THEN
      UPDATE family_scheduled_announcements fsa2
         SET last_dispatch_error = SQLERRM
       WHERE fsa2.family_id = v_row.family_id AND fsa2.slot = v_row.slot;
      RAISE WARNING 'family_scheduled_announcements dispatch failed for %/%: %', v_row.family_id, v_row.slot, SQLERRM;
    END;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.dispatch_due_family_scheduled_announcements() IS
  '要件定義書07-37章4章。下記6章のpg_cronジョブが毎分呼ぶ。いまJST時刻と
   send_timeが一致し、今日まだ処理していない枠を「claim」（last_sent_on
   を更新）したうえで、Edge Function notify-family-scheduled-announcement
   をnet.http_postで非同期に呼ぶ。失敗はRAISE WARNINGに加えて対象行の
   last_dispatch_error列にも記録する。';

REVOKE ALL ON FUNCTION public.dispatch_due_family_scheduled_announcements() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. set_family_scheduled_announcement()（保護者の設定RPC）
-- ------------------------------------------------------------
-- [呼び出しの形] クライアントは保護者の設定画面（P44）が持つ現在の全項目
-- （オンオフ・時刻・文面）を毎回まとめて渡す「保存」操作として呼ぶ。
-- UPSERT（ON CONFLICT）のため、初回の設定でも2回目以降の変更でも同じ
-- 呼び出し方でよい。
--
-- [列名衝突の確認] RETURNS void。ON CONFLICT (family_id, slot)は別名を
-- 付けられない構文位置のため、#variable_conflict use_columnを宣言部に
-- 置く（設計部CLAUDE.mdのルールどおり）。
CREATE OR REPLACE FUNCTION public.set_family_scheduled_announcement(
  p_slot SMALLINT,
  p_enabled BOOLEAN,
  p_send_time TIME,
  p_message TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_family_id UUID;
  v_member_id UUID;
  v_message   TEXT;
BEGIN
  v_family_id := public.current_family_id();
  v_member_id := public.current_family_member_id();

  IF v_family_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 設定できるのは保護者のみ（要件定義書07-37-4-7節）。
  IF NOT COALESCE(public.is_current_user_parent(), false) THEN
    RAISE EXCEPTION 'この設定は保護者のみ変更できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_slot NOT IN (1, 2) THEN
    RAISE EXCEPTION '枠の指定が不正です' USING ERRCODE = 'check_violation';
  END IF;

  IF p_enabled IS NULL OR p_send_time IS NULL THEN
    RAISE EXCEPTION '設定を指定してください' USING ERRCODE = 'check_violation';
  END IF;

  v_message := NULLIF(trim(COALESCE(p_message, '')), '');

  -- 起動条件: enabled=trueならmessage必須。
  IF p_enabled AND v_message IS NULL THEN
    RAISE EXCEPTION 'メッセージを入力してください' USING ERRCODE = 'check_violation';
  END IF;

  -- 文字数上限（★変更点4。30字、ワイヤーフレーム64.3.2節）。
  IF v_message IS NOT NULL AND char_length(v_message) > 30 THEN
    RAISE EXCEPTION 'メッセージは30文字までです' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO family_scheduled_announcements
    (family_id, slot, enabled, send_time, message, updated_by, updated_at)
  VALUES
    (v_family_id, p_slot, p_enabled, p_send_time, v_message, v_member_id, now())
  ON CONFLICT (family_id, slot) DO UPDATE
     SET enabled    = EXCLUDED.enabled,
         send_time  = EXCLUDED.send_time,
         message    = EXCLUDED.message,
         updated_by = EXCLUDED.updated_by,
         updated_at = EXCLUDED.updated_at;
  -- last_sent_on・last_dispatch_*列はここでは触らない（下記6章のcron本体
  -- 専用の列のため）。時刻・文面を変更しても「今日はもう処理した」印は
  -- 消さない（即日反映の挙動は、この列に触れないことでそのまま成立する）。
END;
$$;

COMMENT ON FUNCTION public.set_family_scheduled_announcement(SMALLINT, BOOLEAN, TIME, TEXT) IS
  '要件定義書07-37章4章。保護者が家族の「メッセージ」（社内呼称: 定時
   アナウンス、2つの枠 slot=1/2）のオンオフ・時刻・文面をまとめて保存
   する。UPSERT。書き込み対象が無い（行が存在しない）状態からの初回設定
   にも、既存設定の変更にも同じ呼び出しで対応する。';

REVOKE ALL ON FUNCTION public.set_family_scheduled_announcement(SMALLINT, BOOLEAN, TIME, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_family_scheduled_announcement(SMALLINT, BOOLEAN, TIME, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 5b. delete_family_scheduled_announcement()（★75章に無い追加。
--     ワイヤーフレーム64.6.0節「決定3」対応。実装メモ292章に理由を記録）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_family_scheduled_announcement(
  p_slot SMALLINT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  v_family_id := public.current_family_id();

  IF v_family_id IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT COALESCE(public.is_current_user_parent(), false) THEN
    RAISE EXCEPTION 'この設定は保護者のみ変更できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_slot NOT IN (1, 2) THEN
    RAISE EXCEPTION '枠の指定が不正です' USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM family_scheduled_announcements
  WHERE family_id = v_family_id AND slot = p_slot;
END;
$$;

COMMENT ON FUNCTION public.delete_family_scheduled_announcement(SMALLINT) IS
  'UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 64.6.0節「決定3」。
   保護者が「メッセージ」の1枠を完全に消す（行ごとDELETE）。
   set_family_scheduled_announcement()はUPSERT専用で行の削除ができない
   ため新設した（スキーマ設計.sql 75章には無い関数。実装メモ292章）。';

REVOKE ALL ON FUNCTION public.delete_family_scheduled_announcement(SMALLINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_family_scheduled_announcement(SMALLINT) TO authenticated;

-- ------------------------------------------------------------
-- 6. pg_cronジョブの登録
-- ------------------------------------------------------------
-- [同名ジョブの再登録・安全側の書き方] pg_cron 1.6.4で`cron.schedule()`を
-- 同名で再度呼んだときの挙動（上書きか・重複登録か）は、この案件の
-- ドキュメント内では未検証だった（スキーマ設計.sql 75.15章）。本タスクで
-- ローカルDockerで実測した結果は実装メモ292章に記録する。実測の有無に
-- かかわらず、`cron.unschedule`してから`cron.schedule`する安全側の
-- 書き方を採る。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'family-scheduled-announcements-dispatch') THEN
    PERFORM cron.unschedule('family-scheduled-announcements-dispatch');
  END IF;
END;
$$;

SELECT cron.schedule(
  'family-scheduled-announcements-dispatch',
  '* * * * *',
  $$SELECT public.dispatch_due_family_scheduled_announcements();$$
);

-- ------------------------------------------------------------
-- 7. current_family_push_permission_needed()
--    （74.6章のソフトアスク表示条件(a)への追記。API仕様.md 31.7章対応）
-- ------------------------------------------------------------
-- [SECURITY INVOKERでよい理由] 本関数はfamiliesとfamily_scheduled_
-- announcementsという、どちらも呼び出し元に対するSELECT用RLSポリシーが
-- 既にある表しか読まない。関数自身に特権は不要で、呼び出し元
-- （authenticatedの現在ユーザー）のRLSがそのまま適用されるSECURITY
-- INVOKER（既定）でよい。
CREATE OR REPLACE FUNCTION public.current_family_push_permission_needed()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT f.push_notifications_enabled FROM families f WHERE f.id = public.current_family_id()), false)
      OR EXISTS (
           SELECT 1 FROM family_scheduled_announcements fsa
           WHERE fsa.family_id = public.current_family_id() AND fsa.enabled
         );
$$;

COMMENT ON FUNCTION public.current_family_push_permission_needed() IS
  '要件定義書07-37章6章。ソフトアスク（OSの通知許可を求める前の案内画面）
   を表示すべきか判定する条件(a)を1箇所にまとめる。掲示板の投稿通知
   （families.push_notifications_enabled）と「メッセージ」（いずれかの
   枠がenabled）のどちらか一方でも有効ならtrue。74.6章・API仕様.md
   31.5章の条件(a)は、本関数呼び出しに置き換えること（API仕様.md
   31.7章）。SECURITY INVOKER（既定）——呼び出し元のRLSがそのまま
   適用される。';

REVOKE ALL ON FUNCTION public.current_family_push_permission_needed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_family_push_permission_needed() TO authenticated;
