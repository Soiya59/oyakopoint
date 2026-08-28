-- ============================================================
-- 家族の書き込みボード（要件定義書.md 07-14章、2026-08-28追加）第1段階：DB基盤
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-14章
--   設計部/成果物/スキーマ設計.sql 35章（family_board_posts本体・RLS）・
--     35a章（日次投稿数上限ヘルパー関数）・35b章（BEFORE INSERTトリガー）・
--     35c章（BEFORE UPDATEトリガー＝論理削除の強制）・35d章（family_home_card View）・
--     35e章（プッシュ通知は開発部への申し送りのみ、本ファイルの対象外＝実装しない）
--   設計部/成果物/API仕様.md 13章
--
-- 本ファイルはスキーマ設計.sql 35〜35d章の内容をほぼそのまま適用したものである
-- （開発部/成果物/実装メモ.md 79章参照）。
--
-- [今回のスコープ] 本部長指示により「見る側」のみの第1段階。DB層（本ファイル）は
-- 35〜35d章の全体（テーブル・RLS・トリガー・View・関数）を一度に適用する
-- （投稿INSERTのRLS・トリガー自体は今回作るが、投稿画面〈P33/C28/S21〉と
-- その呼び出しコードは第2段階まで実装しない。削除UIの導線も同様に作らない。
-- プッシュ通知〈35e章〉はそもそも実装しない＝本ファイルにSQLを含めない）。
--
-- 破壊性: 非破壊的な変更のみ（開発部/成果物/実装メモ.md 79章に事前記録済み）。
--   - 新規テーブル1件（family_board_posts）の追加。既存テーブルへの列追加・変更は
--     一切無い。
--   - 新規View1件（family_home_card）の追加。既存View（weekly_family_digests等）
--     には一切手を加えない。
--   - 新規トリガー2件（family_board_postsへのBEFORE INSERT・BEFORE UPDATE）の追加。
--     いずれも新規テーブル自身に対するものであり、既存テーブルのトリガーには
--     一切手を加えない。
--   - 新規関数4件（family_board_posts_daily_limit, family_board_posts_daily_used,
--     my_family_board_posts_remaining_today, family_board_posts_before_insert,
--     family_board_posts_before_update）の追加。既存関数の置き換え
--     （CREATE OR REPLACE）は一切無い。
--
-- [権限に関する注意（開発部CLAUDE.md・実装メモ34.3章・77章/78章の教訓）]
-- family_board_posts_before_insert()・family_board_posts_before_update()は
-- SECURITY DEFINERではないため、呼び出し元ロール（authenticated）として実行される。
-- その内部から呼ぶfamily_board_posts_daily_limit()・family_board_posts_daily_used()には
-- authenticatedのEXECUTEが必須（20260827183000_restore_gratitude_helper_grants.sqlで
-- 実際に本番障害として発生した問題と同種）。スキーマ設計.sql 35a章が明記している
-- 3件のGRANT EXECUTE ... TO authenticatedはそのまま適用し、削除・追加のREVOKEは
-- 一切行わない（本プロジェクトは新規関数作成時にanon/authenticatedへEXECUTE権限が
-- 自動付与される既知の挙動があるため、明示GRANTは「付け直し」ではなく「明示化」の
-- 意味を持つ。34.5章参照）。

-- ------------------------------------------------------------
-- [2026-08-28 本部長修正] 適用順序の訂正
-- ------------------------------------------------------------
-- 当初このファイルは設計書（スキーマ設計.sql）の章立て順（35a関数 → 35テーブル）を
-- そのまま写していたため、**テーブルより先に、そのテーブルを参照する関数を作ろうとして
-- 失敗した**。
--     ERROR: relation "family_board_posts" does not exist (SQLSTATE 42P01)
--     At statement: 2  CREATE OR REPLACE FUNCTION public.family_board_posts_daily_used(...)
-- `LANGUAGE sql`の関数は作成時に本文が解析・検証されるため（`LANGUAGE plpgsql`と違い
-- 実行時まで遅延されない）、参照先のテーブルが存在していなければならない。
-- 設計書は「読み物としての章立て」であって「適用順序」ではない、という取り違えである。
-- ここではテーブル → 関数 → トリガー → View の順に並べ替えた。設計書側の章番号
-- （35 / 35a / 35b / 35c / 35d）は読みやすさのため変更していない。
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 35. CREATE TABLE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_board_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  author_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  deleted_at TIMESTAMPTZ NULL,
  deleted_by_member_id UUID NULL REFERENCES family_members(id) ON DELETE SET NULL,

  CONSTRAINT chk_family_board_posts_deleted_by_requires_deleted_at
    CHECK (deleted_by_member_id IS NULL OR deleted_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_family_board_posts_family_id ON family_board_posts(family_id);

CREATE INDEX IF NOT EXISTS idx_family_board_posts_family_created_active
  ON family_board_posts(family_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_family_board_posts_author_created
  ON family_board_posts(author_member_id, created_at);

ALTER TABLE family_board_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_board_posts_select_same_family" ON family_board_posts;
CREATE POLICY "family_board_posts_select_same_family" ON family_board_posts
  FOR SELECT
  USING (family_id = current_family_id() AND deleted_at IS NULL);

DROP POLICY IF EXISTS "family_board_posts_insert_self" ON family_board_posts;
CREATE POLICY "family_board_posts_insert_self" ON family_board_posts
  FOR INSERT
  WITH CHECK (family_id = current_family_id() AND author_member_id = current_family_member_id());

DROP POLICY IF EXISTS "family_board_posts_update_soft_delete" ON family_board_posts;
CREATE POLICY "family_board_posts_update_soft_delete" ON family_board_posts
  FOR UPDATE
  USING (
    family_id = current_family_id()
    AND (author_member_id = current_family_member_id() OR is_current_user_parent())
  )
  WITH CHECK (
    family_id = current_family_id()
    AND (author_member_id = current_family_member_id() OR is_current_user_parent())
  );

-- DELETEポリシーは作らない（論理削除のみ）。

COMMENT ON TABLE family_board_posts IS
  '要件定義書07-14章「家族の書き込みボード」。保護者・子ども・みまもりメンバー全員が書き込める家族全体への自由記述掲示板。編集不可（削除して再投稿のみ）。論理削除（deleted_at/deleted_by_member_id）。SELECT RLSは削除済みを除外するため、削除された投稿はservice_role以外からは本文ごと見えなくなる。';


-- ------------------------------------------------------------
-- 35a. 日次投稿数上限のヘルパー関数
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.family_board_posts_daily_limit()
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 5;
$$;

COMMENT ON FUNCTION public.family_board_posts_daily_limit() IS
  '要件定義書07-14章「1日あたりの投稿数上限」。1人1日あたりの投稿数上限（企画部初期案）。将来見直す場合は本関数のみ書き換えれば良い（13章gratitude_weekly_allowance()と同じパターン）。';

CREATE OR REPLACE FUNCTION public.family_board_posts_daily_used(p_author_member_id UUID, p_at TIMESTAMPTZ DEFAULT now())
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
  FROM family_board_posts
  WHERE author_member_id = p_author_member_id
    AND (created_at AT TIME ZONE 'Asia/Tokyo')::date = (p_at AT TIME ZONE 'Asia/Tokyo')::date;
$$;

COMMENT ON FUNCTION public.family_board_posts_daily_used(UUID, TIMESTAMPTZ) IS
  '指定メンバーが、指定時刻を含むJST暦日に投稿した件数（論理削除済みも含む）。35b章の日次上限チェック・35a章の残数参照RPCの両方で使用。';

CREATE OR REPLACE FUNCTION public.my_family_board_posts_remaining_today()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    public.family_board_posts_daily_limit() - public.family_board_posts_daily_used(current_family_member_id()),
    0
  );
$$;

COMMENT ON FUNCTION public.my_family_board_posts_remaining_today() IS
  '呼び出し本人（current_family_member_id()）が今日まだ投稿できる残り件数。他メンバー分は取得できない（13e章と同じランキング防止の設計判断）。投稿フォームで「あと◯件」の表示・事前バリデーションに使う想定（API仕様.md参照。第2段階で使用）。';

GRANT EXECUTE ON FUNCTION public.family_board_posts_daily_limit() TO authenticated;
GRANT EXECUTE ON FUNCTION public.family_board_posts_daily_used(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_family_board_posts_remaining_today() TO authenticated;


-- ------------------------------------------------------------
-- 35b. BEFORE INSERTトリガー: family_id自動補完・created_at改ざん防止・
--      日次投稿数上限チェック
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.family_board_posts_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_author_family_id UUID;
  v_used INT;
  v_limit INT;
BEGIN
  SELECT family_id INTO v_author_family_id
  FROM family_members WHERE id = NEW.author_member_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '投稿者が見つからないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.family_id := v_author_family_id;
  NEW.created_at := now();
  NEW.deleted_at := NULL;
  NEW.deleted_by_member_id := NULL;

  v_limit := public.family_board_posts_daily_limit();
  v_used := public.family_board_posts_daily_used(NEW.author_member_id, NEW.created_at);

  IF v_used >= v_limit THEN
    RAISE EXCEPTION '今日書き込める上限（%件）に達しています（本日はあと0件）', v_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_board_posts_before_insert ON family_board_posts;
CREATE TRIGGER trg_family_board_posts_before_insert
  BEFORE INSERT ON family_board_posts
  FOR EACH ROW EXECUTE FUNCTION public.family_board_posts_before_insert();


-- ------------------------------------------------------------
-- 35c. BEFORE UPDATEトリガー: 論理削除の強制
--      （本人は5分以内のみ／保護者は時間制限なし／削除以外の変更は拒否）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.family_board_posts_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor_member_id UUID;
BEGIN
  IF NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.author_member_id IS DISTINCT FROM OLD.author_member_id
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION '削除（deleted_atの設定）以外の変更はできません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'この投稿はすでに削除されています' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'deleted_atを設定しないUPDATEは許可されていません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_actor_member_id := current_family_member_id();

  IF v_actor_member_id = OLD.author_member_id THEN
    IF now() > OLD.created_at + INTERVAL '5 minutes' THEN
      RAISE EXCEPTION '投稿から5分を過ぎているため削除できません' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF public.is_current_user_parent() THEN
    NULL;
  ELSE
    RAISE EXCEPTION '他のメンバーの投稿を削除する権限がありません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.deleted_at := now();
  NEW.deleted_by_member_id := v_actor_member_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_board_posts_before_update ON family_board_posts;
CREATE TRIGGER trg_family_board_posts_before_update
  BEFORE UPDATE ON family_board_posts
  FOR EACH ROW EXECUTE FUNCTION public.family_board_posts_before_update();


-- ------------------------------------------------------------
-- 35d. カード表示統合View（family_home_card）
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.family_home_card
WITH (security_invoker = true) AS
WITH latest_post AS (
  SELECT DISTINCT ON (family_id)
    id, family_id, author_member_id, body, created_at
  FROM family_board_posts
  WHERE deleted_at IS NULL
  ORDER BY family_id, created_at DESC
),
latest_digest AS (
  SELECT DISTINCT ON (family_id)
    id, family_id, message, week_start, generated_at
  FROM weekly_family_digests
  ORDER BY family_id, week_start DESC
)
SELECT
  f.id AS family_id,
  CASE WHEN lp.id IS NOT NULL THEN 'board_post' ELSE 'weekly_digest' END AS source,
  COALESCE(lp.body, ld.message) AS message,
  lp.id AS board_post_id,
  lp.author_member_id AS board_post_author_member_id,
  lp.created_at AS board_post_created_at,
  ld.id AS digest_id,
  ld.week_start AS digest_week_start,
  ld.generated_at AS digest_generated_at
FROM families f
LEFT JOIN latest_post lp ON lp.family_id = f.id
LEFT JOIN latest_digest ld ON ld.family_id = f.id
WHERE lp.id IS NOT NULL OR ld.id IS NOT NULL;

COMMENT ON VIEW public.family_home_card IS
  '07-14章「カード表示の優先順位ロジック」。familiesを起点に、family_board_postsの削除されていない最新1件があればそれ（source=board_post）、無ければweekly_family_digestsの最新1件（source=weekly_digest）を1行で返す。両方とも無い家族は行自体が存在しない（クライアント側はカード非表示または07-8章10.1節と同様の暫定表示にする）。security_invoker=trueのため呼び出しユーザー自身のfamilies/family_board_posts/weekly_family_digests RLSがそのまま適用される。投稿の新しさによる足切りは行わない（07-14章「書き込みが存在する限り、どれだけ古くても書き込みを優先」）。';

-- 35e. プッシュ通知は実装しない（本部長判断・要件定義書08章「実装状況の記録・
-- 2026-08-28追加」参照。expo-notificationsが依存関係に無く、配信がWeb書き出し
-- 〈GitHub Pages〉のみでネイティブビルドを行っていないため原理的に動作しないため）。
-- DB Webhook等の関連オブジェクトは本ファイルに一切含めない。
