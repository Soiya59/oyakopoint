-- ============================================================
-- (1) 完了報告の取得が1,000件で頭打ちになる問題のDB側
--     参照: 設計部/成果物/スキーマ設計.sql 58章（決定58-1〜58-3）
--     やること.md 4-58・4-47原因②
-- (2) エラー文言の呼称の取りこぼし（やること.md 4-70）
-- ============================================================
-- [1本にまとめた理由] (1)(2)はいずれも chore_completions_before_insert()
-- を CREATE OR REPLACE する。2本に分けると、後から適用する側が先の修正を
-- 踏まえて全文を書き直す必要があり、順序を誤ると文言の修正が巻き戻る
-- 事故につながる。同じ関数を触る変更は1本にまとめた（開発部の判断）。
--
-- 【破壊的操作の記録・実行前】
--   - chore_completions に列 activity_date を追加し、既存行を1回きりの
--     UPDATEでbackfillしたのち NOT NULL 化する。backfillは行数に比例した
--     時間・ロックを要する可能性がある（設計部58.9章の注記）。本番の
--     完了報告は2026-09-20時点で268件（やること.md 4-58に記録済み）と
--     少数であり、ローカルでの実測（後述）でも同規模なら瞬時に終わる
--     ことを確認した。
--   - chore_completion_daily_summary を CREATE OR REPLACE VIEW で
--     作り直す（列名・型は変えないため、これに依存する既存の問い合わせは
--     壊れない）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. chore_completions に activity_date 列を追加（スキーマ設計.sql 58.4章）
-- ------------------------------------------------------------
ALTER TABLE chore_completions
  ADD COLUMN IF NOT EXISTS activity_date DATE NULL;

-- ------------------------------------------------------------
-- 2. chore_completions_before_insert() の改訂
--    (a) activity_date の設定を1行追加（58.4章）
--    (b) 担当者チェックのエラー文言を「クエスト」に統一（4-70）
--        20260912010000マイグレーション268行「このお手伝いは担当者のみ
--        完了報告できます」は、2026-08-29の呼称変更より後に追加された
--        文言で、同じ関数の他の2文（自分専用のクエスト／みまもり共通の
--        クエスト）と異なり旧称のままだった。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chore_completions_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_family_id UUID;
  v_title TEXT;
  v_emoji TEXT;
  v_points INT;
  v_is_repeatable BOOLEAN;
  v_daily_limit INT;
  v_scope TEXT;
  v_created_by UUID;
  v_assigned_to UUID;
  v_count INT;
  v_today DATE;
BEGIN
  SELECT family_id, title, emoji, points, is_repeatable, daily_limit, scope, created_by, assigned_to
    INTO v_family_id, v_title, v_emoji, v_points, v_is_repeatable, v_daily_limit, v_scope, v_created_by, v_assigned_to
  FROM chores
  WHERE id = NEW.chore_id AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION '指定されたchoreが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_scope = 'personal' AND NEW.reported_by <> v_created_by THEN
    RAISE EXCEPTION '自分専用のクエストは作成者本人のみ完了報告できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [2026-09-20修正・やること.md 4-70] 「このお手伝いは」→「このクエストは」。
  IF v_scope = 'family' AND v_assigned_to IS NOT NULL AND NEW.reported_by <> v_assigned_to THEN
    RAISE EXCEPTION 'このクエストは担当者のみ完了報告できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_scope = 'supporter_shared' THEN
    IF NOT EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = NEW.reported_by AND fm.family_id = v_family_id AND fm.role = 'supporter'
    ) THEN
      RAISE EXCEPTION 'みまもり共通のクエストは、みまもりメンバーのみ完了報告できます' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  NEW.family_id := v_family_id;
  NEW.chore_title := v_title;
  NEW.chore_emoji := v_emoji;
  NEW.points := v_points;

  -- [2026-09-20追加・スキーマ設計.sql 58.4章決定58-2] 生成列は
  -- AT TIME ZONE 'Asia/Tokyo' がSTABLEでありIMMUTABLE必須の生成列には
  -- 使えないため、BEFORE INSERTトリガーでJST基準の日付を都度計算して
  -- 書き込む。chore_completionsはINSERT専用のログでUPDATE経路が無いため、
  -- INSERT時に1回設定すればそれ以降ズレる余地が無い。
  NEW.activity_date := (NEW.reported_at AT TIME ZONE 'Asia/Tokyo')::date;

  v_today := (now() AT TIME ZONE 'Asia/Tokyo')::date;

  IF NOT v_is_repeatable THEN
    IF EXISTS (
      SELECT 1 FROM chore_completions
      WHERE chore_id = NEW.chore_id
    ) THEN
      RAISE EXCEPTION 'このクエストはすでに完了報告済みです' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_daily_limit IS NOT NULL THEN
    SELECT count(*) INTO v_count
    FROM chore_completions
    WHERE chore_id = NEW.chore_id
      AND reported_by = NEW.reported_by
      AND (reported_at AT TIME ZONE 'Asia/Tokyo')::date = v_today;

    IF v_count >= v_daily_limit THEN
      RAISE EXCEPTION '本日の実行回数上限（%回）に達しています', v_daily_limit
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
-- トリガー本体（trg_chore_completions_before_insert）は既存のものをそのまま
-- 再利用する（再作成不要。シグネチャ不変）。

-- ------------------------------------------------------------
-- 3. 既存行のbackfill（1回きり。スキーマ設計.sql 58.4章）
-- ------------------------------------------------------------
-- 生成列ではないため、過去に挿入済みの行には自動的に値が入らない。
-- 上記トリガーの改訂を適用したあとに実行する（適用前に発生した新規行も
-- 含めて対象漏れが無いようにするため）。
UPDATE chore_completions
SET activity_date = (reported_at AT TIME ZONE 'Asia/Tokyo')::date
WHERE activity_date IS NULL;

-- ------------------------------------------------------------
-- 4. NOT NULL化（backfillの完了を前提に、以後は常に埋まっていることを
--    DBで保証する。多層防御として明示）
-- ------------------------------------------------------------
ALTER TABLE chore_completions ALTER COLUMN activity_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chore_completions_family_activity_date
  ON chore_completions(family_id, activity_date);

-- ------------------------------------------------------------
-- 5. chore_completion_daily_summary の作り直し（スキーマ設計.sql 58.4章）
-- ------------------------------------------------------------
-- 旧定義（20260815093520_initial_schema.sql）は
-- `(cc.reported_at AT TIME ZONE 'Asia/Tokyo')::date` という計算式で
-- GROUP BYしており、この式に対応する索引が無いため日付範囲条件が索引を
-- 使えなかった（家族の生涯全行を評価してから絞る形になっていた）。加えて
-- 400日×メンバー数の組み合わせ次第でPostgRESTのmax_rows（1,000）を
-- 超えうる（設計部58.2章）。列名・型は変えていないため、このViewに依存
-- する既存の問い合わせ（dailySummary()等）は壊れない。
CREATE OR REPLACE VIEW chore_completion_daily_summary
WITH (security_invoker = true) AS
SELECT
  cc.family_id,
  cc.reported_by AS member_id,
  cc.activity_date,
  COUNT(*)::INT AS completion_count,
  SUM(cc.points)::INT AS total_points
FROM chore_completions cc
GROUP BY cc.family_id, cc.reported_by, cc.activity_date;

COMMENT ON VIEW public.chore_completion_daily_summary IS
  '要件定義書07-3章・07-8章。family_id×member_id×activity_date（通常列。
   BEFORE INSERTトリガーchore_completions_before_insert()がJST基準の日付を
   書き込む。生成列ではない）ごとの完了報告件数・獲得ポイント合計。
   2026-09-20改訂（やること.md 4-47原因②・4-58）: GROUP BY対象をすべて
   素の列にし、(family_id, activity_date)の複合索引で範囲条件を支える。
   旧定義は計算式でGROUP BYしていた。';

-- ------------------------------------------------------------
-- 6. 開発部への申し送り（次回の画面対応。DB変更は伴わない）
-- ------------------------------------------------------------
-- - 58.5章 isOneOffFinishedFor のDB側化（56章 chore_completion_totals への
--   置き換え）はクライアントのみの変更であり、DBオブジェクトの追加は
--   不要（56章は20260928010000で適用済み）。今回のDBマイグレーションの
--   対象外。
-- - 58.6章 load()の初回取得の内部ページングもクライアントのみの変更。
--   今回のDBマイグレーションの対象外。
-- - 58.2章の診断（family_id絞り込みが実際に効いているか）は、適用後に
--   EXPLAIN (ANALYZE) で実測して確認すること（本実装メモに記録）。
