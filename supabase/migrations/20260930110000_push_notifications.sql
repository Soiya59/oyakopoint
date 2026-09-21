-- ============================================================
-- プッシュ通知（掲示板の投稿通知）の土台 — 新設・2026-09-22
-- 参照: 企画部/成果物/要件定義書.md 07-37章
--       設計部/成果物/スキーマ設計.sql 74章（74.1〜74.13）
--       設計部/成果物/API仕様.md 31章
--       UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 63章
--       開発部/成果物/実装メモ.md 271章（同型の先行事例。骨格をそのまま踏襲）
-- ============================================================
-- [依頼された3つの失敗の反映]
--   (1) 新設する関数はすべて SET search_path = public を付ける。
--   (2) pg_net・supabase_vaultはCREATE EXTENSIONしない。271章の実績どおり
--       ローカル・本番いずれも既に導入済み（pg_netは2026-09-21に統括が
--       本番で有効化済み）であることを前提にする。相乗りするだけ。
--   (3) family_membersへの新しいON DELETE RESTRICTは追加しない
--       （family_membersには一切列を足さない。スキーマ設計.sql 74.6章の
--       訂正どおり）。
--
-- [family_membersには列を足さない・★重要]
-- スキーマ設計.sql 74.6章は当初 family_members.push_soft_ask_responded_at
-- を追加する案だったが、共有端末で二度と聞かれなくなる不具合を生むため
-- 撤回された。ソフトアスクの表示済み状態は端末ローカル（クライアント側の
-- AsyncStorage等）に持ち、DBには一切保存しない。本マイグレーションが
-- ALTERするのは families と push_tokens の2表のみ。
-- ============================================================

-- ------------------------------------------------------------
-- 1. push_tokens への小さな追加（インデックス1本、スキーマ設計.sql 74.2章）
-- ------------------------------------------------------------
-- 送信対象の絞り込み（下記4章）・無効トークンの掃除（Edge Function側の
-- DELETE ... WHERE expo_push_token = ...）のいずれもexpo_push_tokenの値で
-- 絞り込むため追加する。テーブル定義・既存のUNIQUE制約・RLS・トリガーは
-- いずれも変更しない。
CREATE INDEX IF NOT EXISTS idx_push_tokens_expo_push_token
  ON push_tokens(expo_push_token);

-- ------------------------------------------------------------
-- 2. families への列追加（家族単位の通知トグル、スキーマ設計.sql 74.3章）
-- ------------------------------------------------------------
-- [既定値はfalse・★重要] 要件定義書07-37章6章「掲示板の通知を使わない
-- 家庭であれば、トグルをONにしない限り許可要求自体が発生しない設計に
-- なる」を成立させるための既定値（既定trueだと家族全員に無条件でソフト
-- アスクが表示されてしまう。スキーマ設計.sql 74.3章に訂正の経緯あり）。
-- 67.1章 social_interactions_enabled（既定true）とは異なる——本列はONに
-- するとOSの許可ダイアログという「利用者への要求」を発生させる設定で
-- あり、既定でオフにするのが筋という判断（本部長確定・2026-09-21）。
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN NOT NULL DEFAULT false,
  -- 最後にこの設定を確認・変更した保護者。67.2章と同じ理由で外部キーは
  -- 張らない（循環参照回避）。変更履歴は持たない。
  ADD COLUMN IF NOT EXISTS push_notifications_updated_by UUID NULL,
  ADD COLUMN IF NOT EXISTS push_notifications_updated_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN families.push_notifications_enabled IS
  '要件定義書07-37章3章。家族の掲示板投稿の通知を送るかどうかの家族単位の
   トグル（保護者・副管理者のみ変更可）。既定はfalse——07-37章6章「トグルを
   ONにしない限り許可要求自体が発生しない」を成立させるための値
   （スキーマ設計.sql 74.3章）。この列がtrueでも、実際に配信されるかは
   受け手ごとのOSの通知許可に依存する——この列は唯一のゲートではない。';
COMMENT ON COLUMN families.push_notifications_updated_by IS
  '最後にプッシュ通知の設定を確認・変更した保護者のfamily_members.id。
   意図的に外部キーを張っていない（67.2章と同じ循環参照回避）。';

-- [家族削除への影響] families への列追加のみであり、family_members への
-- ON DELETE RESTRICTを新設していない。families行のDELETEに新しい制約は
-- 一切増えない。

-- ------------------------------------------------------------
-- 3. set_family_push_notifications_enabled()（スキーマ設計.sql 74.5章）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_family_push_notifications_enabled(
  p_enabled BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_member_id UUID;
BEGIN
  v_family_id := public.current_family_id();
  v_member_id := public.current_family_member_id();

  IF v_family_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 保護者のみ（要件定義書07-37章3章。みまもりメンバー・子どもは変更できない）。
  IF NOT COALESCE(public.is_current_user_parent(), false) THEN
    RAISE EXCEPTION 'この設定は保護者のみ変更できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_enabled IS NULL THEN
    RAISE EXCEPTION '設定を指定してください' USING ERRCODE = 'check_violation';
  END IF;

  -- やりとりトグル（social_interactions_enabled）との連動チェックは意図的に
  -- 行わない。理由: 通知は掲示板への投稿をきっかけにしか発生せず、その投稿
  -- 自体はfamily_board_posts_social_toggle_guard()トリガーで止まるため、
  -- 通知トグル単体が不整合値を持っても実害が無い（スキーマ設計.sql 74.4章）。

  UPDATE families f
     SET push_notifications_enabled  = p_enabled,
         push_notifications_updated_by = v_member_id,
         push_notifications_updated_at = now()
   WHERE f.id = v_family_id;
END;
$$;

COMMENT ON FUNCTION public.set_family_push_notifications_enabled(BOOLEAN) IS
  '要件定義書07-37章3章。保護者が家族の掲示板投稿の通知トグルを設定する。
   やりとりトグル（set_family_social_settings）との連動チェックは意図的に
   行わない（スキーマ設計.sql 74.4章）。家族全体に即時反映し、変更履歴は
   持たない。トグルをONにした直後にOSの許可を求める（6-1節）流れは
   クライアント側の責務であり、本関数はDBの値を1回のUPDATEで確定させる
   だけである。';

REVOKE ALL ON FUNCTION public.set_family_push_notifications_enabled(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_family_push_notifications_enabled(BOOLEAN) TO authenticated;

-- ------------------------------------------------------------
-- 4. family_board_post_notification_payload()（スキーマ設計.sql 74.8章）
-- ------------------------------------------------------------
-- RETURNS jsonbにする理由: 68.7章 account_deletion_preview() と同じ回避策。
-- 返す値（投稿者の表示名・送信先トークンの配列）をRETURNS TABLEにすると
-- 出力列名と実在列名（expo_push_token等）が衝突しうるため、構造的に衝突を
-- 無くす。本文中の表の列参照にはすべてテーブル別名を付けている。
CREATE OR REPLACE FUNCTION public.family_board_post_notification_payload(
  p_post_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_author_id UUID;
  v_author_name TEXT;
  v_tokens jsonb;
BEGIN
  SELECT p.family_id, p.author_member_id
    INTO v_family_id, v_author_id
  FROM family_board_posts p
  WHERE p.id = p_post_id;

  IF v_family_id IS NULL THEN
    -- 対象の投稿が見つからない（呼び出し側の取り違え等）。空を返す。
    RETURN NULL;
  END IF;

  SELECT fm.display_name INTO v_author_name
  FROM family_members fm
  WHERE fm.id = v_author_id;

  -- 要件定義書07-37章2-1節「端末単位の除外」（スキーマ設計.sql 74.1章）。
  -- push_tokensは1つのExpoトークンが複数member_idに紐づくことを許容する
  -- 設計（家族共有タブレット）のため、投稿者自身のmember_idに紐づく
  -- トークン値と一致するものを、送信対象（家族内・自分以外・在籍中）から
  -- 取り除く。これにより「投稿者本人が現在（または過去に一度でも）
  -- ログインした端末」が新しい列を持たずに除外できる。
  SELECT COALESCE(jsonb_agg(DISTINCT pt.expo_push_token), '[]'::jsonb)
    INTO v_tokens
  FROM push_tokens pt
  JOIN family_members fm ON fm.id = pt.member_id
  WHERE fm.family_id = v_family_id
    AND fm.is_active
    AND pt.member_id <> v_author_id
    AND pt.expo_push_token NOT IN (
      SELECT pt2.expo_push_token
      FROM push_tokens pt2
      WHERE pt2.member_id = v_author_id
    );

  RETURN jsonb_build_object(
    'post_id', p_post_id,
    -- 要件定義書07-37章2-1節「投稿者の表示名＋定型文のみ。本文のプレビューは
    -- 行わない」。投稿本文は一切含めない。
    'author_display_name', v_author_name,
    'recipient_tokens', v_tokens
  );
END;
$$;

COMMENT ON FUNCTION public.family_board_post_notification_payload(UUID) IS
  '要件定義書07-37章2-1節。掲示板の投稿1件について、通知に必要な最小限の
   情報（投稿者の表示名・送信先Expoトークンの配列）だけをjsonbで組み立てる。
   投稿本文は含めない。送信先は同じ家族の在籍中(is_active)メンバーのうち、
   投稿者自身と、投稿者のmember_idに紐づくトークン値を除いたもの
   （スキーマ設計.sql 74.1章）。';

-- [EXECUTE権限] クライアントから直接呼ばれることを想定しない（下記5章の
-- SECURITY DEFINERトリガー関数の内部からのみ呼ぶ）。他人のpush_tokensを
-- 間接的に読み出せる関数のため、authenticated/anonには一切渡さない。
REVOKE ALL ON FUNCTION public.family_board_post_notification_payload(UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. family_board_posts_after_insert_notify()（スキーマ設計.sql 74.9章）
-- ------------------------------------------------------------
-- [271章と同型にする] content_reports_after_insert_notify（実装メモ271章、
-- マイグレーション20260930060000）と同じ骨格。差分は次の3点だけ。
--   1. トリガーがfamily_board_postsへのINSERT。
--   2. 家族単位のON/OFFトグル・連投の据え置き判定（下記(1)(2)）を、送信
--      するかどうかの分岐として先頭に追加している。
--   3. Vaultシークレット名・Edge Function名が異なる
--      （family_board_post_notify_url/_bearer、notify-family-board-post）。
-- 非同期のnet.http_post・EXCEPTION WHEN OTHERSで握りつぶす設計は271章の
-- 実績をそのまま踏襲する（通知の失敗が投稿の記録を巻き戻さない）。
CREATE OR REPLACE FUNCTION public.family_board_posts_after_insert_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_notify_enabled BOOLEAN;
  v_recent_exists BOOLEAN;
  v_payload jsonb;
  v_url TEXT;
  v_bearer TEXT;
BEGIN
  -- (1) 家族単位トグル（2章）。falseなら以降を一切行わない。判定できない
  -- ときは「送らない」側に倒す（74.3章の既定falseと対にした安全側の選択）。
  SELECT f.push_notifications_enabled INTO v_family_notify_enabled
  FROM families f WHERE f.id = NEW.family_id;

  IF NOT COALESCE(v_family_notify_enabled, false) THEN
    RETURN NEW;
  END IF;

  -- (2) 連投の据え置き判定（要件定義書07-37章2-2節、スキーマ設計.sql
  -- 74.7章）。同一投稿者による直近15分以内の別の投稿（未削除）が存在すれば
  -- 今回の通知は送らない（1件目の通知だけが届いた状態のまま据え置く）。
  SELECT EXISTS (
    SELECT 1 FROM family_board_posts p
    WHERE p.family_id = NEW.family_id
      AND p.author_member_id = NEW.author_member_id
      AND p.id <> NEW.id
      AND p.deleted_at IS NULL
      AND p.created_at >  NEW.created_at - INTERVAL '15 minutes'
      AND p.created_at <= NEW.created_at
  ) INTO v_recent_exists;

  IF v_recent_exists THEN
    RETURN NEW;
  END IF;

  -- (3) 送信内容の組み立て（4章）。送り先が0件なら何もしない。
  v_payload := public.family_board_post_notification_payload(NEW.id);

  IF v_payload IS NULL
     OR jsonb_array_length(COALESCE(v_payload->'recipient_tokens', '[]'::jsonb)) = 0 THEN
    RETURN NEW;
  END IF;

  -- (4) Vaultから呼び出し先を読み、net.http_postで非同期に呼ぶ。
  BEGIN
    SELECT vs.decrypted_secret INTO v_url
    FROM vault.decrypted_secrets vs WHERE vs.name = 'family_board_post_notify_url';

    SELECT vs.decrypted_secret INTO v_bearer
    FROM vault.decrypted_secrets vs WHERE vs.name = 'family_board_post_notify_bearer';

    IF v_url IS NULL OR v_bearer IS NULL THEN
      RAISE WARNING 'family_board_posts notify skipped for % (vault secrets not configured)', NEW.id;
    ELSE
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || v_bearer),
        body    := v_payload
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'family_board_posts notify failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_board_posts_after_insert_notify ON family_board_posts;
CREATE TRIGGER trg_family_board_posts_after_insert_notify
  AFTER INSERT ON family_board_posts
  FOR EACH ROW EXECUTE FUNCTION public.family_board_posts_after_insert_notify();

COMMENT ON FUNCTION public.family_board_posts_after_insert_notify() IS
  '要件定義書07-37章2章。掲示板への新規投稿を受けて、家族単位トグル・
   連投の据え置き判定を経たうえで、Edge Function notify-family-board-post
   （API仕様.md 31章）をnet.http_postで非同期に呼ぶ。失敗はRAISE WARNINGに
   留め、投稿の記録（INSERT）を巻き戻さない（271章と同型）。';

-- [S4（rls_checks.sql）への申し送り] 本関数はSECURITY DEFINERだが
-- RETURNS TRIGGERであり、明示的なREVOKEを行っていない。新規関数作成時の
-- 既定動作（34.5章の既知の挙動）により、PUBLIC/authenticatedへのEXECUTE
-- 権限が自動付与される（content_reports_after_insert_notify等の既存
-- トリガー関数と同じ扱い）。トリガー文脈の外で直接呼び出すとNEW参照で
-- エラーになるだけで実害は無い。
-- ※設計部/成果物/スキーマ設計.sql 74.11章は「トリガー関数のため対象外」
-- としていたが、271章の前例（content_reports_after_insert_notifyは同じ
-- 条件でS4に含まれている）と食い違う。ローカルDockerで実測し、実測結果を
-- 正としてrls_checks.sqlを更新した（実装メモに記載）。
