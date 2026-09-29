-- ============================================================
-- おねがい（保護者から子どもへ）と、感謝ポイントのプッシュ通知
--   要件定義書07-43章（2026-09-30改訂版）・統括回答U2・U5〜U8と追加決定、
--   設計部/成果物/スキーマ設計.sql 82章、API仕様.md 38章、
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 70章、
--   開発部/成果物/実装メモ.md 335章
-- ============================================================
-- [非破壊] 既存表 chores に列を1本足す（既存行は全部 false）。新しい表を1つ、
--   関数を7つ、トリガーを4本、CHECK制約を1本足す。既存の関数・ポリシー・
--   表は1文字も変えない（gratitude_points・chores_before_write・
--   chore_completions・cancel_chore_completion・families の各RLS/トリガー）。
--   ロールバック: トリガー4本→関数7→表1→CHECK制約→列 の順にDROPする。
-- [記述順（82.17章 開発部1）] 列→CHECK→上限の定数関数→検証関数・トリガー→表
--   →宛先関数→通知トリガー→REVOKE→列COMMENTの更新。
-- [本番適用順（82.17章 開発部2）] Edge Function2本のデプロイ → Vaultの4件 →
--   このmigration → OTA。migrationを先に当てても壊れない（Vault未設定は
--   RAISE WARNINGだけで通知が送られない）が、適用直後の通知が黙って無くなる。
-- [列名衝突の確認（設計部CLAUDE.md）] RETURNS TABLEは1つも使っていない
--   （RETURNS jsonb・RETURNS TRIGGER・RETURNS INT）。引数はp_始まり・変数は
--   v_始まりで、本文の表の列参照はすべて別名（fm・c・cc・pt・pt2・f・vs・g）付き。
-- [新しい表のGRANT（開発部CLAUDE.md）] chore_request_done_notices は
--   default-deny（ポリシー0本）。決まり文句の4権限ではなく、設計部82.5章の
--   とおり authenticated には SELECT のみ（S5を満たすため。RLSが常に空集合に
--   する）、書き込みは service_role のみ。anon には何も付けない。ポリシーが
--   将来うっかり足されても書き込み権限が付いていない、という二重の守り。
-- ============================================================

-- ------------------------------------------------------------
-- 82.3 列と形のCHECK制約
-- ------------------------------------------------------------
ALTER TABLE chores
  ADD COLUMN IF NOT EXISTS is_request BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN chores.is_request IS
  '要件定義書07-43章決定10。保護者が専用の入口「おねがいする」から作った依頼ならtrue。通常のクエスト（1回だけ・0ptを含む）は常にfalse。作成時にchores_request_guard()とchk_chores_request_shapeが形（ポイント0・1回だけ・担当は在籍中の子ども・家族共有・絵文字は💌固定）を強制し、作成後はこの列を変更できない（題名とis_active以外も変更不可。担当がON DELETE SET NULLでNULLになる変化だけは許す）。担当がNULLのis_request行（担当だった子どもがいなくなった行）は、一覧に出さず通知も送らない。';

ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_request_shape;
ALTER TABLE chores
  ADD CONSTRAINT chk_chores_request_shape
  CHECK (
    NOT is_request
    OR (
      points = 0
      AND is_repeatable = false
      AND daily_limit IS NULL
      AND scope = 'family'
      AND emoji IS NOT DISTINCT FROM '💌'
      AND category_id IS NULL
      AND nfc_tag_id IS NULL
    )
  );

-- ------------------------------------------------------------
-- 82.3 上限の単一定義（統括の追加決定1）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.max_open_requests_per_child()
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 3; $$;

COMMENT ON FUNCTION public.max_open_requests_per_child() IS
  '2026-09-30統括決定。子ども1人あたりの「未完了のおねがい」（is_request=true・is_active・完了報告が1件も無い）の上限件数の単一の定義箇所。chores_request_guard()が、おねがいの作成時（と取り下げ済みの有効化時）に、この件数に達していればSQLSTATE RQ001で断る。数を増やす変更は既存データに影響しない。減らす変更は既存の行を消さない（超過している子どもは、やってくれた・取り下げたあとに、新しく作れる）。アプリの表示上の上限と必ず同じ値にすること。';

-- ------------------------------------------------------------
-- 82.4 検証トリガー（chores_request_guard。INSERT・UPDATE・DELETE）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chores_request_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_assignee_ok BOOLEAN;
  v_open_count INT;
  v_is_client BOOLEAN := (current_user IN ('authenticated', 'anon'));
BEGIN
  -- ---- DELETE（おねがいの取り下げ）----
  IF TG_OP = 'DELETE' THEN
    -- やってくれたあと（完了報告が1件でもある）のおねがいは、クライアントからは取り下げられない。
    -- 家族の削除（テーブル所有者としてのCASCADE）・運営作業（service_role）は止めない。
    IF OLD.is_request AND v_is_client THEN
      IF EXISTS (SELECT 1 FROM chore_completions cc WHERE cc.chore_id = OLD.id) THEN
        RAISE EXCEPTION 'やってくれたあとのおねがいは、取り下げられません'
          USING ERRCODE = 'insufficient_privilege', HINT = 'chore_request_completed';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- 通常のクエスト（is_request=false）は何も検査しない（決定19。既存の作成経路に影響しない）。
    IF NOT NEW.is_request THEN
      RETURN NEW;
    END IF;

    IF NEW.scope IS DISTINCT FROM 'family' THEN
      RAISE EXCEPTION 'おねがいは家族共有のクエストとしてだけ作れます' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.points IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'おねがいにはポイントを付けられません（0のまま作ってください）' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.is_repeatable IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'おねがいは1回だけのものとして作ってください' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.daily_limit IS NOT NULL THEN
      RAISE EXCEPTION 'おねがいには1日の回数の上限を付けられません' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.category_id IS NOT NULL OR NEW.nfc_tag_id IS NOT NULL THEN
      RAISE EXCEPTION 'おねがいにはカテゴリー・NFCタグを付けられません' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'おねがいは有効な状態で作ってください' USING ERRCODE = 'check_violation';
    END IF;

    -- 担当: 同じ家族の在籍中の子ども（role='child'）1人。他表を見るのでCHECKでは書けない。
    -- （NULL＝誰でも実行可は、おねがいでは作れない。早い者勝ちになり比較を生むため。決定16）
    SELECT EXISTS (
      SELECT 1
      FROM family_members fm
      WHERE fm.id = NEW.assigned_to
        AND fm.family_id = NEW.family_id
        AND fm.role = 'child'
        AND fm.is_active
    ) INTO v_assignee_ok;

    IF NEW.assigned_to IS NULL OR NOT v_assignee_ok THEN
      RAISE EXCEPTION 'おねがいの相手は、この家族の在籍中の子どもを指定してください' USING ERRCODE = 'check_violation';
    END IF;

    -- 【統括の追加決定1】未完了のおねがいは子ども1人につき3つまで（82.4a章）。
    -- 同じ子どもへの同時の作成でも上限を超えないよう、その子どもを単位にした
    -- トランザクション単位のアドバイザリロックを先に取ってから数える。
    PERFORM pg_advisory_xact_lock(hashtextextended('chore_request_limit:' || NEW.assigned_to::text, 0));

    SELECT count(*) INTO v_open_count
    FROM chores c
    WHERE c.family_id = NEW.family_id
      AND c.assigned_to = NEW.assigned_to
      AND c.is_request
      AND c.is_active
      AND NOT EXISTS (SELECT 1 FROM chore_completions cc WHERE cc.chore_id = c.id);

    IF v_open_count >= public.max_open_requests_per_child() THEN
      RAISE EXCEPTION 'この子への、まだ終わっていないおねがいがいっぱいです（%件まで）。やってくれたあと、または取り下げたあとで作れます',
        public.max_open_requests_per_child()
        USING ERRCODE = 'RQ001', HINT = 'chore_request_limit_reached';
    END IF;

    -- 絵文字はサーバーが💌に固定する（クライアントが入れ忘れても、別の絵文字を送っても、
    -- ここで上書きする。CHECK制約chk_chores_request_shapeがこの後で最終確認する）。
    NEW.emoji := '💌';
    RETURN NEW;
  END IF;

  -- ---- UPDATE ----
  -- おねがいかどうかは、どちらの向きにも変えられない。
  IF NEW.is_request IS DISTINCT FROM OLD.is_request THEN
    RAISE EXCEPTION 'おねがいかどうかは作成後に変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 通常のクエストの更新は何も検査しない（既存の編集経路に影響しない）。
  IF NOT OLD.is_request THEN
    RETURN NEW;
  END IF;

  -- おねがいの行で変えてよいのは、題名（title）・有効フラグ（is_active）・
  -- 担当が「値あり→NULL」になる変化（ON DELETE SET NULLの自動UPDATE）だけ。
  IF NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.emoji IS DISTINCT FROM OLD.emoji
     OR NEW.points IS DISTINCT FROM OLD.points
     OR NEW.is_repeatable IS DISTINCT FROM OLD.is_repeatable
     OR NEW.daily_limit IS DISTINCT FROM OLD.daily_limit
     OR NEW.nfc_tag_id IS DISTINCT FROM OLD.nfc_tag_id
     OR (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL)
  THEN
    RAISE EXCEPTION 'おねがいは、題名のほかは作成後に変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 【統括の追加決定4】やってくれたあと（完了報告が1件でもある）のおねがいは、題名の変更・
  -- 取り下げ（is_activeをfalseにする）ができない。クライアントのロールのときだけ働かせる
  -- （家族削除・運営作業・ON DELETE SET NULLの自動UPDATEを止めない）。
  IF v_is_client
     AND (NEW.title IS DISTINCT FROM OLD.title
          OR (OLD.is_active AND NOT NEW.is_active))
     AND EXISTS (SELECT 1 FROM chore_completions cc WHERE cc.chore_id = OLD.id) THEN
    RAISE EXCEPTION 'やってくれたあとのおねがいは、題名を変えたり取り下げたりできません'
      USING ERRCODE = 'insufficient_privilege', HINT = 'chore_request_completed';
  END IF;

  -- 【統括の追加決定1】取り下げ済み（is_active=false）を有効に戻すことで、未完了のおねがいが
  -- 上限を超えてしまう抜け道を塞ぐ。未完了に戻る場合だけ、INSERTと同じ検査をする。
  -- （自分自身はis_active=falseの間は数えられていないので、count >= 上限 でよい）
  IF NEW.is_active AND NOT OLD.is_active
     AND NEW.assigned_to IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM chore_completions cc WHERE cc.chore_id = OLD.id) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('chore_request_limit:' || NEW.assigned_to::text, 0));

    SELECT count(*) INTO v_open_count
    FROM chores c
    WHERE c.family_id = NEW.family_id
      AND c.assigned_to = NEW.assigned_to
      AND c.is_request
      AND c.is_active
      AND c.id <> NEW.id
      AND NOT EXISTS (SELECT 1 FROM chore_completions cc WHERE cc.chore_id = c.id);

    IF v_open_count >= public.max_open_requests_per_child() THEN
      RAISE EXCEPTION 'この子への、まだ終わっていないおねがいがいっぱいです（%件まで）。やってくれたあと、または取り下げたあとで作れます',
        public.max_open_requests_per_child()
        USING ERRCODE = 'RQ001', HINT = 'chore_request_limit_reached';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chores_request_guard ON chores;
CREATE TRIGGER trg_chores_request_guard
  BEFORE INSERT OR UPDATE OR DELETE ON chores
  FOR EACH ROW EXECUTE FUNCTION public.chores_request_guard();

COMMENT ON FUNCTION public.chores_request_guard() IS
  '要件定義書07-43章決定10・統括の追加決定（2026-09-30）。is_request=trueのchoresの作成時（ポイント0・1回だけ・家族共有・担当は同じ家族の在籍中の子ども・絵文字は💌に上書き・未完了のおねがいは子ども1人につきmax_open_requests_per_child()件まで＝超えたらSQLSTATE RQ001）と、更新時（is_request不変・題名とis_active以外不変。担当は値あり→NULLだけ許す＝ON DELETE SET NULL。やってくれたあとの題名変更・取り下げはクライアントのロールに限り拒否）と、削除時（やってくれたあとのおねがいはクライアントのロールに限り拒否）を検証する。通常のクエストは素通し。chores_before_write()には足さない（55章→57章で全面書き換えされて足した検証が消えた前例のため）。担当が必須のCHECK制約は作らない（assigned_toのON DELETE SET NULLと衝突し、子どもの削除が失敗するため）。未完了＝完了報告（chore_completions）が1件も無い有効なおねがい。';

-- ------------------------------------------------------------
-- 82.5 重複防止の記録表（default-deny）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chore_request_done_notices (
  chore_id UUID PRIMARY KEY REFERENCES chores(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chore_request_done_notices_family_id
  ON chore_request_done_notices(family_id);

ALTER TABLE chore_request_done_notices ENABLE ROW LEVEL SECURITY;
-- ポリシーは作らない（誰も読めない・書けない。触れるのはSECURITY DEFINERの関数とservice_roleのみ）。

-- [開発部の追記・2026-09-30] Supabaseは新しい表に anon・authenticated・service_role
-- の全権限を自動で付ける（ローカルは auto_expose_new_tables=true、本番の既存表も同様）。
-- 設計部82.5章の「authenticatedはSELECTのみ」を実際に成り立たせるには、自動付与された
-- 権限を先に剥がす必要がある（設計部のDDLはanonからだけREVOKEしており、実測でauthenticated
-- にINSERT/UPDATE/DELETEが残っていた）。REVOKE→GRANTの順で、必要な権限だけにする。
REVOKE ALL ON public.chore_request_done_notices FROM anon, authenticated;
GRANT SELECT ON public.chore_request_done_notices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chore_request_done_notices TO service_role;

COMMENT ON TABLE chore_request_done_notices IS
  '要件定義書07-43章決定12「完了の通知は1つの依頼につき1通だけ」を、1分以内の取消→押し直しがあっても守るための記録。おねがい（chores.is_request=true）について、完了のプッシュ通知を送る準備ができた時点で1行を作る（ON CONFLICT DO NOTHINGで最初の1回だけが成功する）。誰が・いつ完了したか・題名は持たない。default-deny（ポリシー無し）。書き込みはchore_completions_after_insert_notify_request_done()（SECURITY DEFINER）だけ。おねがいを取り下げる（choresを削除する）と一緒に消える。';

-- ------------------------------------------------------------
-- 82.6 おねがいの通知2本（宛先の組み立て・トリガー）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chore_request_notification_payload(
  p_kind TEXT,
  p_ref_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_chore_id UUID;
  v_completion_id UUID;
  v_recipient_id UUID;
  v_actor_id UUID;
  v_recipient_role TEXT;
  v_actor_name TEXT;
  v_tokens jsonb;
BEGIN
  CASE p_kind
    WHEN 'chore_request' THEN
      SELECT c.family_id, c.id, c.assigned_to, c.created_by
        INTO v_family_id, v_chore_id, v_recipient_id, v_actor_id
      FROM chores c
      WHERE c.id = p_ref_id AND c.is_request AND c.is_active;
      v_recipient_role := 'child';
    WHEN 'chore_request_done' THEN
      SELECT cc.family_id, c.id, cc.id, c.created_by, cc.reported_by
        INTO v_family_id, v_chore_id, v_completion_id, v_recipient_id, v_actor_id
      FROM chore_completions cc
      JOIN chores c ON c.id = cc.chore_id
      WHERE cc.id = p_ref_id AND c.is_request;
      v_recipient_role := 'parent';
    ELSE
      RETURN NULL;
  END CASE;

  -- 対象が見つからない・宛先（担当／作成者）が空・送り手が空・自分自身宛て、は送らない。
  IF v_family_id IS NULL
     OR v_recipient_id IS NULL
     OR v_actor_id IS NULL
     OR v_recipient_id = v_actor_id THEN
    RETURN NULL;
  END IF;

  SELECT fm.display_name INTO v_actor_name
  FROM family_members fm
  WHERE fm.id = v_actor_id AND fm.family_id = v_family_id;

  IF v_actor_name IS NULL THEN
    RETURN NULL;
  END IF;

  -- 宛先の本人のトークンだけ。送り手のmember_idに紐づくトークン値と一致するものは除く
  -- （端末単位の除外。保護者が自分のスマホで作り、そのスマホを子どもが借りている場合は、
  -- 目の前の端末で鳴らさない。子どもが完了した端末が依頼者と同じ場合も同様）。
  SELECT COALESCE(jsonb_agg(DISTINCT pt.expo_push_token), '[]'::jsonb)
    INTO v_tokens
  FROM push_tokens pt
  JOIN family_members fm ON fm.id = pt.member_id
  WHERE fm.family_id = v_family_id
    AND fm.is_active
    AND fm.role = v_recipient_role
    AND pt.member_id = v_recipient_id
    AND pt.expo_push_token NOT IN (
      SELECT pt2.expo_push_token FROM push_tokens pt2 WHERE pt2.member_id = v_actor_id
    );

  RETURN jsonb_build_object(
    'kind', p_kind,
    'chore_id', v_chore_id,
    'completion_id', v_completion_id,
    'actor_display_name', v_actor_name,
    'recipient_tokens', v_tokens
  );
END;
$$;

COMMENT ON FUNCTION public.chore_request_notification_payload(TEXT, UUID) IS
  '要件定義書07-43章決定12。おねがいの通知1件について、通知に必要な最小限の情報（種別・chore_id・completion_id・きっかけを作った人の表示名・宛先Expoトークンの配列）だけをjsonbで組み立てる。題名・ポイント・ひとことは含めない（統括回答U5）。chore_request＝依頼が作られた→担当の子どもへ（送り手＝依頼者）。chore_request_done＝子どもが完了した→依頼者1人へ（送り手＝完了した子ども）。宛先は本人のトークンだけで、送り手のmember_idに紐づくトークン値と一致するものは除外する。宛先が在籍していない・空のときはNULL。EXECUTEはクライアントに渡さない。';

REVOKE ALL ON FUNCTION public.chore_request_notification_payload(TEXT, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chores_after_insert_notify_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_notify_enabled BOOLEAN;
  v_payload jsonb;
  v_url TEXT;
  v_bearer TEXT;
BEGIN
  BEGIN
    -- (1) 家族トグル。判定できないときは「送らない」側に倒す（74.3章と同じ）。
    SELECT f.push_notifications_enabled INTO v_family_notify_enabled
    FROM families f WHERE f.id = NEW.family_id;

    IF NOT COALESCE(v_family_notify_enabled, false) THEN
      RETURN NEW;
    END IF;

    -- (2) 宛先の組み立て。宛先が0件なら何もしない。
    v_payload := public.chore_request_notification_payload('chore_request', NEW.id);

    IF v_payload IS NULL
       OR jsonb_array_length(COALESCE(v_payload->'recipient_tokens', '[]'::jsonb)) = 0 THEN
      RETURN NEW;
    END IF;

    -- (3) Vaultから呼び出し先を読み、net.http_postで非同期に呼ぶ。
    SELECT vs.decrypted_secret INTO v_url
    FROM vault.decrypted_secrets vs WHERE vs.name = 'chore_request_notify_url';
    SELECT vs.decrypted_secret INTO v_bearer
    FROM vault.decrypted_secrets vs WHERE vs.name = 'chore_request_notify_bearer';

    IF v_url IS NULL OR v_bearer IS NULL THEN
      RAISE WARNING 'chores request notify skipped for % (vault secrets not configured)', NEW.id;
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_bearer),
      body    := v_payload
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chores request notify failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chores_after_insert_notify_request ON chores;
CREATE TRIGGER trg_chores_after_insert_notify_request
  AFTER INSERT ON chores
  FOR EACH ROW
  WHEN (NEW.is_request)
  EXECUTE FUNCTION public.chores_after_insert_notify_request();

COMMENT ON FUNCTION public.chores_after_insert_notify_request() IS
  '要件定義書07-43章決定12。おねがい（is_request=true）が作られた直後に、担当の子どもへ1通だけプッシュ通知を送る。families.push_notifications_enabledがfalseなら送らない（印とベルは出る）。Edge Function notify-chore-requestをnet.http_postで非同期に呼ぶ。失敗はRAISE WARNINGに留め、クエストの登録を巻き戻さない。題名の変更（UPDATE）では再通知しない。';

CREATE OR REPLACE FUNCTION public.chore_completions_after_insert_notify_request_done()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_request BOOLEAN;
  v_family_notify_enabled BOOLEAN;
  v_payload jsonb;
  v_url TEXT;
  v_bearer TEXT;
  v_claimed INT;
BEGIN
  SELECT c.is_request INTO v_is_request
  FROM chores c
  WHERE c.id = NEW.chore_id;

  IF NOT COALESCE(v_is_request, false) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT f.push_notifications_enabled INTO v_family_notify_enabled
    FROM families f WHERE f.id = NEW.family_id;

    IF NOT COALESCE(v_family_notify_enabled, false) THEN
      RETURN NEW;
    END IF;

    v_payload := public.chore_request_notification_payload('chore_request_done', NEW.id);

    IF v_payload IS NULL
       OR jsonb_array_length(COALESCE(v_payload->'recipient_tokens', '[]'::jsonb)) = 0 THEN
      RETURN NEW;
    END IF;

    SELECT vs.decrypted_secret INTO v_url
    FROM vault.decrypted_secrets vs WHERE vs.name = 'chore_request_notify_url';
    SELECT vs.decrypted_secret INTO v_bearer
    FROM vault.decrypted_secrets vs WHERE vs.name = 'chore_request_notify_bearer';

    IF v_url IS NULL OR v_bearer IS NULL THEN
      RAISE WARNING 'chore_completions request-done notify skipped for % (vault secrets not configured)', NEW.id;
      RETURN NEW;
    END IF;

    -- 送る権利を取る（1つの依頼につき最初の1回だけ成功する）。
    INSERT INTO chore_request_done_notices (chore_id, family_id)
    VALUES (NEW.chore_id, NEW.family_id)
    ON CONFLICT (chore_id) DO NOTHING;
    GET DIAGNOSTICS v_claimed = ROW_COUNT;

    IF v_claimed = 0 THEN
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_bearer),
      body    := v_payload
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'chore_completions request-done notify failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chore_completions_after_insert_notify_request_done ON chore_completions;
CREATE TRIGGER trg_chore_completions_after_insert_notify_request_done
  AFTER INSERT ON chore_completions
  FOR EACH ROW EXECUTE FUNCTION public.chore_completions_after_insert_notify_request_done();

COMMENT ON FUNCTION public.chore_completions_after_insert_notify_request_done() IS
  '要件定義書07-43章決定12。おねがい（is_request=true）の完了報告が記録された直後に、依頼者（chores.created_by）1人へ1通だけプッシュ通知を送る。families.push_notifications_enabledがfalseなら送らない（ベルは出る）。1つの依頼につき1通（chore_request_done_noticesで、1分以内の取消→押し直しでも2通目を送らない）。完了報告の記録は通知の失敗で巻き戻さない。07章フロー3「完了報告→保護者」の通知（未実装）を将来実装するときは、is_request=trueの完了を除外して二重に鳴らさないこと。すでに送った通知は取消で取り消せない（既知の限界）。';

-- ------------------------------------------------------------
-- 82.7 感謝ポイントの通知（宛先の組み立て・トリガー）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gratitude_notification_payload(
  p_gratitude_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_sender_id UUID;
  v_recipient_id UUID;
  v_sender_name TEXT;
  v_tokens jsonb;
BEGIN
  SELECT g.family_id, g.sender_id, g.recipient_id
    INTO v_family_id, v_sender_id, v_recipient_id
  FROM gratitude_points g
  WHERE g.id = p_gratitude_id AND g.revoked_at IS NULL;

  IF v_family_id IS NULL OR v_sender_id = v_recipient_id THEN
    RETURN NULL;
  END IF;

  SELECT fm.display_name INTO v_sender_name
  FROM family_members fm
  WHERE fm.id = v_sender_id AND fm.family_id = v_family_id;

  IF v_sender_name IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(DISTINCT pt.expo_push_token), '[]'::jsonb)
    INTO v_tokens
  FROM push_tokens pt
  JOIN family_members fm ON fm.id = pt.member_id
  WHERE fm.family_id = v_family_id
    AND fm.is_active
    AND pt.member_id = v_recipient_id
    AND pt.expo_push_token NOT IN (
      SELECT pt2.expo_push_token FROM push_tokens pt2 WHERE pt2.member_id = v_sender_id
    );

  RETURN jsonb_build_object(
    'gratitude_id', p_gratitude_id,
    'sender_display_name', v_sender_name,
    'recipient_tokens', v_tokens
  );
END;
$$;

COMMENT ON FUNCTION public.gratitude_notification_payload(UUID) IS
  '要件定義書07-5章・07-43章統括回答U7。感謝ポイント1件について、通知に必要な最小限の情報（贈った人の表示名・受け取った人の在籍中のExpoトークンの配列）だけをjsonbで組み立てる。額（points）・ひとこと（note）は含めない。宛先は受け取った本人だけで、贈った人のmember_idに紐づくトークン値と一致するものは除外する。取消済み・宛先が空のときはNULL。EXECUTEはクライアントに渡さない。';

REVOKE ALL ON FUNCTION public.gratitude_notification_payload(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.gratitude_points_after_insert_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_notify_enabled BOOLEAN;
  v_payload jsonb;
  v_url TEXT;
  v_bearer TEXT;
BEGIN
  BEGIN
    SELECT f.push_notifications_enabled INTO v_family_notify_enabled
    FROM families f WHERE f.id = NEW.family_id;

    IF NOT COALESCE(v_family_notify_enabled, false) THEN
      RETURN NEW;
    END IF;

    v_payload := public.gratitude_notification_payload(NEW.id);

    IF v_payload IS NULL
       OR jsonb_array_length(COALESCE(v_payload->'recipient_tokens', '[]'::jsonb)) = 0 THEN
      RETURN NEW;
    END IF;

    SELECT vs.decrypted_secret INTO v_url
    FROM vault.decrypted_secrets vs WHERE vs.name = 'gratitude_notify_url';
    SELECT vs.decrypted_secret INTO v_bearer
    FROM vault.decrypted_secrets vs WHERE vs.name = 'gratitude_notify_bearer';

    IF v_url IS NULL OR v_bearer IS NULL THEN
      RAISE WARNING 'gratitude_points notify skipped for % (vault secrets not configured)', NEW.id;
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_bearer),
      body    := v_payload
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'gratitude_points notify failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gratitude_points_after_insert_notify ON gratitude_points;
CREATE TRIGGER trg_gratitude_points_after_insert_notify
  AFTER INSERT ON gratitude_points
  FOR EACH ROW EXECUTE FUNCTION public.gratitude_points_after_insert_notify();

COMMENT ON FUNCTION public.gratitude_points_after_insert_notify() IS
  '要件定義書07-5章・07-43章統括回答U7。感謝ポイントが贈られた直後に、受け取った人へ「◯◯から ありがとうが とどいたよ」のプッシュ通知を送る（対象は感謝ポイント全般。額・ひとことは出さない）。families.push_notifications_enabledがfalseなら送らない。Edge Function notify-gratitudeをnet.http_postで非同期に呼ぶ。失敗はRAISE WARNINGに留め、贈る操作（INSERT）を巻き戻さない。取消（UPDATE）では何も送らず、すでに送った通知は取り消せない。感謝ポイントの表・上限・RLS・取消のルールは変更していない。';

-- ------------------------------------------------------------
-- 82.8 実行権限（宛先関数2本のREVOKEは各定義の直後に記述済み）
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.chores_request_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chores_after_insert_notify_request() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chore_completions_after_insert_notify_request_done() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gratitude_points_after_insert_notify() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 82.9a 列COMMENTの更新（メタデータのみ。データ・制約・権限に影響しない）
-- ------------------------------------------------------------
COMMENT ON COLUMN families.push_notifications_enabled IS
  '要件定義書07-37章3章・07-43章・統括Q2(A)（2026-09-30）。「お知らせの通知（家族みんな共通）」のスイッチ（保護者・副管理者のみ変更可）。既定はfalse——OSの許可ダイアログという利用者への要求を発生させる設定であり、既定でオフにするのが筋。**家族のやりとり（social_interactions_enabled）とは別の列・別のRPCで、互いに連動しない**（やりとりを止めても、このスイッチは有効のまま残る）。falseのとき、次のプッシュを1通も送らない: (1)掲示板の投稿通知、(2)コメント通知3種（掲示板・完了報告・お絵かき）、(3)おねがいが届いた通知（子どもへ）、(4)おねがいをやってくれた通知（依頼者へ）、(5)感謝ポイントが届いた通知（受け取った人へ）。対象外（スイッチを見ない）: お絵かきの公開通知（常時ON）・定時のメッセージ・運営宛てのお問い合わせ。スタンプは通知しない。この列がtrueでも、実際に配信されるかは受け手ごとのOSの通知許可に依存する（この列は唯一のゲートではない）。';
