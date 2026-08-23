-- ============================================================
-- 家族の木（07-9章）・色分けによる個人の可視化（07-10章）・
-- 今週のまとめメッセージ（07-8章）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-8〜07-10章（2026-08-23追加、本部長採点100点）
--   設計部/成果物/スキーマ設計.sql 29章（family_tree_seasons本体・加算専用トリガー・
--     閾値関数・月次ロールオーバー関数）・29b章（family_tree_current_season /
--     family_tree_member_breakdown の2View）・29c章（月次バッチ）・
--     30章（色分け表示に新規テーブルが不要であることの確認メモ）・
--     31章（weekly_family_digests本体・生成関数2種）
--   設計部/成果物/API仕様.md 9章・10章
-- 本ファイルは上記スキーマ設計.sql 29〜31章の内容をほぼそのままマイグレーションと
-- して適用したものである（実装メモ.md 66章参照）。
--
-- 破壊性: 非破壊的な変更のみ（開発部/成果物/実装メモ.md 66章に事前記録済み）。
--   - 新規テーブル2件（family_tree_seasons, weekly_family_digests）の追加。
--     既存テーブルへの列追加・変更は一切無い。
--   - 新規View2件（family_tree_current_season, family_tree_member_breakdown）の追加。
--   - 新規トリガー1件（chore_completionsへのAFTER INSERT）の追加。既存の
--     chore_completions_before_insert等の既存トリガーには一切手を加えない。
--     追加されるのは「別テーブルの集計行を+1する」という副作用のみで、
--     chore_completions自体のINSERT可否・返り値には影響しない。
--   - 新規関数5件（family_tree_stage_for_count, family_tree_seasons_bump,
--     rollover_family_tree_seasons, generate_weekly_family_digest,
--     generate_weekly_family_digests_for_all_families）の追加。既存関数の
--     置き換え（CREATE OR REPLACE）は一切無い。
--   - pg_cron拡張の有効化（既存プロジェクトで未使用だった拡張機能。事前に
--     `select * from pg_available_extensions where name='pg_cron'` で導入可能
--     であることを確認済み。実装メモ.md 66章参照）と、2件のcronジョブ登録
--     （月次ロールオーバー・週次ダイジェスト生成）。既存のジョブ・スケジュールは無い
--     （新規プロジェクトのため、cron.schedule実行前に `select * from cron.job` で
--     既存ジョブが0件であることを確認済み）。
--   - [開発部の追加判断] スキーマ設計.sql 31a/31b章・API仕様.md 10.2節は
--     「generate_weekly_family_digest / generate_weekly_family_digests_for_all_families
--     のEXECUTE権限はservice_roleにのみ付与し、authenticated/anonには付与しない
--     こと」を要求している。本番DBの実際の権限設定を`pg_proc.proacl`で確認した
--     ところ、本プロジェクトでは新規作成した関数に対してauthenticated/anonへの
--     EXECUTE権限が自動的に付与される設定になっていることを確認した（既存の
--     create_family_with_owner等、他のSECURITY DEFINER関数も同様の自動付与を
--     受けており、それらは明示的にauthenticatedへのGRANTが必要な関数だったため
--     問題が表面化していなかった）。そのため本ファイルでは、クライアントから
--     直接呼び出されるべきではない3関数（rollover_family_tree_seasons /
--     generate_weekly_family_digest / generate_weekly_family_digests_for_all_families）
--     について、REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated を明示的に
--     追加した（スキーマ設計.sql本文には無い、開発部側での安全確認に基づく追加。
--     実装メモ.md 66章参照）。
-- ============================================================


-- ============================================================
-- 29. family_tree_seasons（新規：07-9章「家族の木」のシーズン管理）
-- ============================================================
-- [設計判断: 加算専用カウンタ＋月次バッチのロールオーバーのハイブリッド方式]
-- 詳細な設計判断の理由は 設計部/成果物/スキーマ設計.sql 29章のコメントを参照
-- （本ファイルでは重複コメントを省略し、DDL本体のみをそのまま適用する）。
-- ============================================================
CREATE TABLE IF NOT EXISTS family_tree_seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  season_start DATE NOT NULL,
  season_end DATE NULL,
  completion_count INT NOT NULL DEFAULT 0 CHECK (completion_count >= 0),
  current_stage SMALLINT NOT NULL DEFAULT 0 CHECK (current_stage BETWEEN 0 AND 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_family_tree_seasons_start_is_month_start
    CHECK (season_start = date_trunc('month', season_start::timestamp)::date),
  CONSTRAINT chk_family_tree_seasons_end_after_start
    CHECK (season_end IS NULL OR season_end > season_start),

  UNIQUE (family_id, season_start)
);

COMMENT ON TABLE family_tree_seasons IS
  '要件定義書07-9章「家族の木」。家族全体のシーズン(暦月)内累計完了報告数と到達段階を保持する。書き込みはトリガー/バッチ関数(SECURITY DEFINER)のみが行い、クライアントからの直接書き込みは一切許可しない。';

CREATE UNIQUE INDEX IF NOT EXISTS uq_family_tree_seasons_open
  ON family_tree_seasons(family_id) WHERE season_end IS NULL;

DROP TRIGGER IF EXISTS trg_family_tree_seasons_updated_at ON family_tree_seasons;
CREATE TRIGGER trg_family_tree_seasons_updated_at
  BEFORE UPDATE ON family_tree_seasons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE family_tree_seasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_tree_seasons_select_same_family" ON family_tree_seasons;
CREATE POLICY "family_tree_seasons_select_same_family" ON family_tree_seasons
  FOR SELECT
  USING (family_id = current_family_id());

-- [重要] INSERT/UPDATE/DELETEポリシーは意図的に一切定義しない（RLS有効時、
-- 対応するポリシーが1つも無いコマンドは常に拒否されるデフォルト拒否の挙動を利用する）。


-- ------------------------------------------------------------
-- 29a. トリガー: chore_completions INSERT時にシーズンカウンタを加算
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.family_tree_stage_for_count(p_count INT)
RETURNS SMALLINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_count >= 100 THEN 4::SMALLINT
    WHEN p_count >= 60  THEN 3::SMALLINT
    WHEN p_count >= 30  THEN 2::SMALLINT
    WHEN p_count >= 10  THEN 1::SMALLINT
    ELSE 0::SMALLINT
  END;
$$;

COMMENT ON FUNCTION public.family_tree_stage_for_count(INT) IS
  '07-9章の成長段階閾値の単一の定義箇所。将来閾値を調整する場合はこの関数のみをCREATE OR REPLACEすればよい。';

CREATE OR REPLACE FUNCTION public.family_tree_seasons_bump()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start DATE;
BEGIN
  v_month_start := date_trunc('month', (NEW.reported_at AT TIME ZONE 'Asia/Tokyo'))::date;

  UPDATE family_tree_seasons
  SET season_end = (season_start + INTERVAL '1 month')::date,
      updated_at = now()
  WHERE family_id = NEW.family_id
    AND season_end IS NULL
    AND season_start <> v_month_start;

  INSERT INTO family_tree_seasons (family_id, season_start, season_end, completion_count, current_stage)
  VALUES (NEW.family_id, v_month_start, NULL, 0, 0)
  ON CONFLICT (family_id, season_start) DO NOTHING;

  UPDATE family_tree_seasons
  SET completion_count = completion_count + 1,
      current_stage = public.family_tree_stage_for_count(completion_count + 1),
      updated_at = now()
  WHERE family_id = NEW.family_id
    AND season_start = v_month_start
    AND season_end IS NULL;

  RETURN NULL; -- AFTER ROWトリガーのため戻り値は無視される
END;
$$;

DROP TRIGGER IF EXISTS trg_family_tree_seasons_bump ON chore_completions;
CREATE TRIGGER trg_family_tree_seasons_bump
  AFTER INSERT ON chore_completions
  FOR EACH ROW EXECUTE FUNCTION public.family_tree_seasons_bump();

COMMENT ON TRIGGER trg_family_tree_seasons_bump ON chore_completions IS
  '07-9章「家族の木」。chore_completionsへのINSERTのたびに、対象家族の進行中シーズンのcompletion_countを+1する。chore_completions自体にUPDATE/DELETE経路が無いため、対応する減算トリガーは存在せず、存在させる必要も無い。';


-- ------------------------------------------------------------
-- 29b. 参照用View（現在シーズン・メンバー別内訳＝色分け表示の集計）
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.family_tree_current_season
WITH (security_invoker = true) AS
SELECT *
FROM family_tree_seasons
WHERE season_end IS NULL;

COMMENT ON VIEW public.family_tree_current_season IS
  '進行中（season_end IS NULL）のシーズンのみを返す絞り込みView。1家族につき常に0件または1件。security_invoker=trueのためfamily_tree_seasons_select_same_familyがそのまま適用される。';

CREATE OR REPLACE VIEW public.family_tree_member_breakdown
WITH (security_invoker = true) AS
SELECT
  fm.family_id,
  fts.id AS season_id,
  fts.season_start,
  fm.id AS member_id,
  fm.display_name,
  fm.avatar_color,
  fm.created_at AS member_created_at,
  COUNT(cc.id)::INT AS completion_count
FROM family_members fm
JOIN family_tree_seasons fts
  ON fts.family_id = fm.family_id AND fts.season_end IS NULL
LEFT JOIN chore_completions cc
  ON cc.family_id = fm.family_id
 AND cc.reported_by = fm.id
 AND cc.reported_at >= (fts.season_start::timestamp AT TIME ZONE 'Asia/Tokyo')
WHERE fm.is_active
GROUP BY fm.family_id, fts.id, fts.season_start, fm.id, fm.display_name, fm.avatar_color, fm.created_at;

COMMENT ON VIEW public.family_tree_member_breakdown IS
  '07-10章「詳細内訳（タップ表示）」用。進行中シーズンにおけるメンバー別完了報告件数。ORDER BYを意図的に持たせていない（07-10章必須要件1「ソート・並び替え機能を持たせない」対応。クライアントはmember_created_at昇順で並べること）。';


-- ------------------------------------------------------------
-- 29c. バッチ関数: 毎月1日0:00（Asia/Tokyo）のシーズン切り替え
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rollover_family_tree_seasons()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_this_month DATE := date_trunc('month', (now() AT TIME ZONE 'Asia/Tokyo'))::date;
BEGIN
  UPDATE family_tree_seasons
  SET season_end = (season_start + INTERVAL '1 month')::date,
      updated_at = now()
  WHERE season_end IS NULL
    AND season_start <> v_this_month;

  INSERT INTO family_tree_seasons (family_id, season_start, season_end, completion_count, current_stage)
  SELECT f.id, v_this_month, NULL, 0, 0
  FROM families f
  WHERE NOT EXISTS (
    SELECT 1 FROM family_tree_seasons fts
    WHERE fts.family_id = f.id AND fts.season_start = v_this_month
  );
END;
$$;

COMMENT ON FUNCTION public.rollover_family_tree_seasons() IS
  '07-9章「1ヶ月（暦月）を1シーズンとし、毎月1日0:00に新しい種から育て直す」に対応する月次バッチ。冪等（何度実行しても安全）。pg_cronから定期実行する（本ファイル末尾のcron.schedule参照）。';

-- [開発部の追加判断] クライアント（authenticated/anon）から直接RPC呼び出しできる
-- 必要は無い関数のため、本プロジェクトのデフォルト権限設定（新規関数は
-- authenticated/anonにもEXECUTEが自動付与される）を明示的に打ち消す。
REVOKE EXECUTE ON FUNCTION public.rollover_family_tree_seasons() FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 30. 07-10. 色分けによる個人の可視化 — 新規テーブル不要の確認メモ
-- ============================================================
-- スキーマ設計.sql 30章のとおり、色分け表示・詳細内訳はいずれもchore_completions
-- （誰が＝reported_by）とfamily_members.avatar_colorの結合で表現でき、新規テーブルは
-- 追加しない。木の描画そのもの（完了報告1件ずつへの着色）は、クライアントが
-- `chore_completions.select('*, family_members!reported_by(avatar_color)')` を
-- 直接使う（API仕様.md 9.2章）。29b章のfamily_tree_member_breakdownは詳細内訳
-- （タップ表示）専用の集計View。
-- ============================================================


-- ============================================================
-- 31. weekly_family_digests（新規：07-8章「今週のまとめメッセージ」）
-- ============================================================
CREATE TABLE IF NOT EXISTS weekly_family_digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  message TEXT NOT NULL CHECK (char_length(trim(message)) > 0),
  detected_pattern TEXT NOT NULL CHECK (detected_pattern IN (
    'tree_growth',
    'weekday_highlight',
    'streak_highlight',
    'week_comparison',
    'default'
  )),
  detail JSONB NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (family_id, week_start)
);

COMMENT ON TABLE weekly_family_digests IS
  '要件定義書07-8章「今週のまとめメッセージ」。週次バッチ(generate_weekly_family_digests_for_all_families)が生成する。書き込みはSECURITY DEFINER関数のみが行い、クライアントからの直接書き込みは一切許可しない。';

CREATE INDEX IF NOT EXISTS idx_weekly_family_digests_family_week
  ON weekly_family_digests(family_id, week_start DESC);

ALTER TABLE weekly_family_digests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weekly_family_digests_select_same_family" ON weekly_family_digests;
CREATE POLICY "weekly_family_digests_select_same_family" ON weekly_family_digests
  FOR SELECT
  USING (family_id = current_family_id());

-- [重要] INSERT/UPDATE/DELETEポリシーは一切定義しない（29章と同じ方針）。


-- ------------------------------------------------------------
-- 31a. 生成関数: 1家族・1週分のメッセージを検出・生成してUPSERTする
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_weekly_family_digest(p_family_id UUID, p_week_start DATE)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_end DATE := p_week_start + 7;
  v_prev_week_start DATE := p_week_start - 7;
  v_total_this_week INT;
  v_total_prev_week INT;
  v_weekday_counts INT[] := ARRAY[0,0,0,0,0,0,0];
  v_weekday_names TEXT[] := ARRAY['月','火','水','木','金','土','日'];
  v_stage_names TEXT[] := ARRAY['種','芽','若木','花','実'];
  rec RECORD;
  v_top_weekday INT;
  v_top_weekday_count INT := 0;
  v_tie_count INT;
  v_season RECORD;
  v_count_before INT;
  v_count_after INT;
  v_stage_before SMALLINT;
  v_stage_after SMALLINT;
  v_streak RECORD;
  v_message TEXT;
  v_pattern TEXT;
  v_detail JSONB;
  v_digest_id UUID;
BEGIN
  SELECT count(*) INTO v_total_this_week
  FROM chore_completions
  WHERE family_id = p_family_id
    AND reported_at >= (p_week_start::timestamp AT TIME ZONE 'Asia/Tokyo')
    AND reported_at <  (v_week_end::timestamp AT TIME ZONE 'Asia/Tokyo');

  SELECT count(*) INTO v_total_prev_week
  FROM chore_completions
  WHERE family_id = p_family_id
    AND reported_at >= (v_prev_week_start::timestamp AT TIME ZONE 'Asia/Tokyo')
    AND reported_at <  (p_week_start::timestamp AT TIME ZONE 'Asia/Tokyo');

  FOR rec IN
    SELECT extract(dow FROM (reported_at AT TIME ZONE 'Asia/Tokyo'))::INT AS dow, count(*)::INT AS c
    FROM chore_completions
    WHERE family_id = p_family_id
      AND reported_at >= (p_week_start::timestamp AT TIME ZONE 'Asia/Tokyo')
      AND reported_at <  (v_week_end::timestamp AT TIME ZONE 'Asia/Tokyo')
    GROUP BY 1
  LOOP
    v_weekday_counts[((rec.dow + 6) % 7) + 1] := rec.c;
  END LOOP;

  -- 1. 木の成長ハイライト（最優先）
  SELECT * INTO v_season
  FROM family_tree_seasons
  WHERE family_id = p_family_id
    AND season_start <= (v_week_end - 1)
    AND (season_end IS NULL OR season_end > (v_week_end - 1))
  ORDER BY season_start DESC
  LIMIT 1;

  IF FOUND THEN
    SELECT count(*) INTO v_count_before
    FROM chore_completions
    WHERE family_id = p_family_id
      AND reported_at >= (v_season.season_start::timestamp AT TIME ZONE 'Asia/Tokyo')
      AND reported_at <  (p_week_start::timestamp AT TIME ZONE 'Asia/Tokyo');

    v_count_after := v_count_before + v_total_this_week;

    v_stage_before := public.family_tree_stage_for_count(v_count_before);
    v_stage_after := public.family_tree_stage_for_count(v_count_after);

    IF v_stage_after > v_stage_before THEN
      v_pattern := 'tree_growth';
      v_message := format('今週、家族の木が「%s」になりました', v_stage_names[v_stage_after + 1]);
      v_detail := jsonb_build_object(
        'season_id', v_season.id,
        'season_start', v_season.season_start,
        'stage_before', v_stage_before,
        'stage_after', v_stage_after,
        'count_after', v_count_after
      );
    END IF;
  END IF;

  -- 2. 曜日ハイライト
  IF v_pattern IS NULL THEN
    FOR i IN 1..7 LOOP
      IF v_weekday_counts[i] > v_top_weekday_count THEN
        v_top_weekday_count := v_weekday_counts[i];
        v_top_weekday := i;
      END IF;
    END LOOP;

    IF v_top_weekday_count > 0 THEN
      SELECT count(*) INTO v_tie_count
      FROM unnest(v_weekday_counts) AS c
      WHERE c = v_top_weekday_count;

      IF v_tie_count = 1 THEN
        v_pattern := 'weekday_highlight';
        v_message := format('%s曜日は家族みんなのお手伝いがいちばん多い日でした', v_weekday_names[v_top_weekday]);
        v_detail := jsonb_build_object('weekday', v_top_weekday, 'count', v_top_weekday_count);
      END IF;
    END IF;
  END IF;

  -- 3. お手伝い継続ハイライト
  IF v_pattern IS NULL THEN
    SELECT chore_id, chore_title, streak_len INTO v_streak
    FROM (
      SELECT
        chore_id,
        chore_title,
        count(*) AS streak_len,
        max(week_start) AS last_week
      FROM (
        SELECT
          chore_id,
          chore_title,
          week_start,
          row_number() OVER (PARTITION BY chore_id ORDER BY week_start) AS rn
        FROM (
          SELECT DISTINCT
            cc.chore_id,
            cc.chore_title,
            date_trunc('week', (cc.reported_at AT TIME ZONE 'Asia/Tokyo'))::date AS week_start
          FROM chore_completions cc
          WHERE cc.family_id = p_family_id
            AND cc.chore_id IS NOT NULL
            AND cc.reported_at >= ((p_week_start - 364)::timestamp AT TIME ZONE 'Asia/Tokyo')
            AND cc.reported_at <  (v_week_end::timestamp AT TIME ZONE 'Asia/Tokyo')
        ) weeks
      ) ranked
      GROUP BY chore_id, chore_title, (week_start - (rn * 7 || ' days')::interval)
      HAVING max(week_start) = p_week_start AND count(*) >= 3
    ) streaks
    ORDER BY streak_len DESC, chore_id
    LIMIT 1;

    IF FOUND THEN
      v_pattern := 'streak_highlight';
      v_message := format('%sは%s週連続で続いています', v_streak.chore_title, v_streak.streak_len);
      v_detail := jsonb_build_object('chore_id', v_streak.chore_id, 'chore_title', v_streak.chore_title, 'streak_weeks', v_streak.streak_len);
    END IF;
  END IF;

  -- 4. 先週比較ハイライト
  IF v_pattern IS NULL AND v_total_prev_week > 0 THEN
    IF v_total_this_week > v_total_prev_week THEN
      v_pattern := 'week_comparison';
      v_message := '先週より家族みんなで頑張った1週間でした';
      v_detail := jsonb_build_object('this_week', v_total_this_week, 'prev_week', v_total_prev_week, 'direction', 'up');
    ELSIF v_total_this_week < v_total_prev_week THEN
      v_pattern := 'week_comparison';
      v_message := '今週は少しゆっくりめの1週間でした。来週もまた気軽に';
      v_detail := jsonb_build_object('this_week', v_total_this_week, 'prev_week', v_total_prev_week, 'direction', 'down');
    END IF;
  END IF;

  -- 5. デフォルト（フォールバック）
  IF v_pattern IS NULL THEN
    v_pattern := 'default';
    v_message := '今週も家族みんなお疲れさまでした';
    v_detail := jsonb_build_object('this_week', v_total_this_week, 'prev_week', v_total_prev_week);
  END IF;

  INSERT INTO weekly_family_digests (family_id, week_start, message, detected_pattern, detail)
  VALUES (p_family_id, p_week_start, v_message, v_pattern, v_detail)
  ON CONFLICT (family_id, week_start)
  DO UPDATE SET
    message = EXCLUDED.message,
    detected_pattern = EXCLUDED.detected_pattern,
    detail = EXCLUDED.detail,
    generated_at = now()
  RETURNING id INTO v_digest_id;

  RETURN v_digest_id;
END;
$$;

COMMENT ON FUNCTION public.generate_weekly_family_digest(UUID, DATE) IS
  '07-8章「今週のまとめメッセージ」。1家族・1週(p_week_startはその週の月曜日)分の集計・検出・一文生成をまとめて行い、weekly_family_digestsへUPSERTする。';

-- [開発部の追加判断] API仕様.md 10.2節「GRANT EXECUTEはservice_roleにのみ付与し、
-- authenticated/anonには付与しないこと」への対応。本ファイル冒頭コメント参照。
REVOKE EXECUTE ON FUNCTION public.generate_weekly_family_digest(UUID, DATE) FROM PUBLIC, anon, authenticated;


-- ------------------------------------------------------------
-- 31b. バッチ関数: 全家族分をまとめて生成する（毎週月曜0:00起動想定）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_weekly_family_digests_for_all_families(p_week_start DATE DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_start DATE;
  v_family RECORD;
BEGIN
  v_week_start := COALESCE(
    p_week_start,
    date_trunc('week', (now() AT TIME ZONE 'Asia/Tokyo'))::date - 7
  );

  FOR v_family IN SELECT id FROM families LOOP
    PERFORM public.generate_weekly_family_digest(v_family.id, v_week_start);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.generate_weekly_family_digests_for_all_families(DATE) IS
  '07-8章「今週のまとめメッセージ」の週次バッチのエントリポイント。pg_cronから引数無しで呼び出す（本ファイル末尾のcron.schedule参照）。p_week_startは主に手動での過去分再生成・テスト用。';

REVOKE EXECUTE ON FUNCTION public.generate_weekly_family_digests_for_all_families(DATE) FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 32. pg_cronによる定期実行登録
-- ============================================================
-- [開発部の実装方式判断] スキーマ設計.sql 29c章・31b章コメント、API仕様.md 9.5節・
-- 10.2節のとおり、本番Supabaseプロジェクト(pnznewjkaiwlqmddszpl)でpg_cron拡張が
-- 利用可能であることを事前に確認した（実装メモ.md 66章参照。
-- `select * from pg_available_extensions where name = 'pg_cron'` で
-- default_version 1.6.4が確認でき、実際にCREATE EXTENSIONも成功した）。
-- そのため「pg_cron優先」の第一候補どおり、本ファイルでcron.scheduleを登録する。
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- 毎日 UTC 15:05（Asia/Tokyo 00:05）に実行。関数は冪等なため日次実行で問題ない。
-- cron.schedule(jobname, ...) は同名ジョブが既に存在する場合はスケジュール・
-- コマンドを更新する（pg_cron 1.4以降。マイグレーション再適用時も安全）。
SELECT cron.schedule(
  'family-tree-season-rollover',
  '5 15 * * *',
  $$SELECT public.rollover_family_tree_seasons();$$
);

-- 毎週月曜 0:00（Asia/Tokyo）＝毎週日曜 15:00（UTC）に実行。
SELECT cron.schedule(
  'weekly-family-digest-generation',
  '0 15 * * 0',
  $$SELECT public.generate_weekly_family_digests_for_all_families();$$
);
-- ============================================================
