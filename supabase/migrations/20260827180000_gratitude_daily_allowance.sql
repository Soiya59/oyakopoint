-- 感謝ポイントの原資を「週50pt」から「1日3pt」へ変更する。
--
-- [2026-08-27・本部長／軽微変更ルート] ユーザー判断「感謝ポイントは1日3ポイントでよいと思う」。
--
-- 背景:
--   本番の感謝ポイントは累計5件・最終送信2026-08-22で止まっていた（同期間の完了報告70件・
--   リアクション28件と比べて明らかに使われていない）。週次原資は「今週まだあるから後で」が
--   効いてしまい、使い忘れがそのまま週末に消える。日次にすると毎日リセットされるため
--   貯め込めず、贈る習慣が日課になる。
--   ユーザーは兄の家族の参加（子ども3人）も見込んでおり、1日3ptなら複数人へ1ptずつ
--   贈り分けられる。人数がさらに増えた場合の増額はその時点で判断する。
--
-- 総量は週50pt → 週21pt相当と半分以下になるが、狙いは総量ではなくリズムである。
--
-- 既存の送信済みgratitude_points行には一切影響しない（このマイグレーションは関数のみを
-- 差し替える）。過去の送信が新しい日次上限に照らして超過扱いになることもない
-- （上限判定はINSERT時にしか行われないため）。

-- 1) 配布額。週50 → 日3。
CREATE OR REPLACE FUNCTION public.gratitude_daily_allowance()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 3;
$$;

-- 2) 使用済み集計。JSTの「その日」で数える。
--    集計の境界をJSTに揃える考え方は gratitude_points_weekly_used から引き継いでいる
--    （created_at は timestamptz なので、AT TIME ZONE 'Asia/Tokyo' でJSTの壁時計に直してから
--    日付を取る）。取消済み（revoked_at IS NOT NULL）は原資を消費しない。
CREATE OR REPLACE FUNCTION public.gratitude_points_daily_used(
  p_sender_id UUID,
  p_at TIMESTAMPTZ DEFAULT now()
)
RETURNS INTEGER
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(points), 0)::INT
  FROM gratitude_points
  WHERE sender_id = p_sender_id
    AND revoked_at IS NULL
    AND (created_at AT TIME ZONE 'Asia/Tokyo')::date
        = (p_at AT TIME ZONE 'Asia/Tokyo')::date;
$$;

-- 3) 呼び出し本人の残存原資（API仕様.md 7a.1章）。関数名は変えない
--    （クライアントが .rpc("my_gratitude_giveable_balance") で参照しているため）。
CREATE OR REPLACE FUNCTION public.my_gratitude_giveable_balance()
RETURNS INTEGER
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT GREATEST(
    public.gratitude_daily_allowance() - public.gratitude_points_daily_used(current_family_member_id()),
    0
  );
$$;

-- 4) INSERTトリガー。上限判定と、ユーザーに見えるエラー文言を日次に合わせる。
--    （この関数の他の部分＝家族一致チェック・family_id改ざん防止は変更していない）
CREATE OR REPLACE FUNCTION public.gratitude_points_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_sender_family_id UUID;
  v_recipient_family_id UUID;
  v_used INT;
  v_allowance INT;
BEGIN
  SELECT family_id INTO v_sender_family_id
  FROM family_members WHERE id = NEW.sender_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '送信者が見つからないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT family_id INTO v_recipient_family_id
  FROM family_members WHERE id = NEW.recipient_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '受取人が見つからないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_sender_family_id IS DISTINCT FROM v_recipient_family_id THEN
    RAISE EXCEPTION '送信者と受取人は同じ家族のメンバーである必要があります' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- クライアントが送ってきたfamily_idは信用せず、常にDB側の最新値で上書きする
  -- （chore_completions_before_insert等と同じ「改ざん防止」パターン、5a章参照）。
  NEW.family_id := v_sender_family_id;

  v_allowance := public.gratitude_daily_allowance();
  v_used := public.gratitude_points_daily_used(NEW.sender_id, NEW.created_at);

  IF v_used + NEW.points > v_allowance THEN
    RAISE EXCEPTION '今日贈れる感謝ポイントの残り原資（%pt）を超えています（残り%pt）',
      v_allowance, GREATEST(v_allowance - v_used, 0)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- 5) CHECK制約 chk_gratitude_points_within_allowance を日次版に貼り替える。
--
--    この制約は gratitude_weekly_allowance() を直接参照しており（CHECK (points <= gratitude_weekly_allowance())）、
--    関数を先にDROPできない。トリガー側の「累計 + 今回 > 上限」判定のほうが厳しいため制約は
--    実質的に冗長だが、多層防御として残っている設計を勝手に外さず、日次版へ貼り替える。
--
--    **NOT VALID にする理由**: 既存の gratitude_points には points = 5 の行が2件あり
--    （週50pt時代に送られたもの）、新しい上限3ptでは検証に通らない。NOT VALID にすると
--    既存行の検証をスキップし、以後のINSERT/UPDATEにのみ適用される。
--    この2行がUPDATEされる可能性は無い（gratitude_points_before_update() が「送信から5分を
--    超えていたら取消不可」で先に弾くため、そもそもUPDATEが成立しない）。
ALTER TABLE public.gratitude_points DROP CONSTRAINT chk_gratitude_points_within_allowance;
ALTER TABLE public.gratitude_points
  ADD CONSTRAINT chk_gratitude_points_within_allowance
  CHECK (points <= public.gratitude_daily_allowance()) NOT VALID;

-- 6) 週次版はどこからも参照されなくなったので削除する
--    （参照元は gratitude_points_before_insert・my_gratitude_giveable_balance・上のCHECK制約の
--    3つだけで、いずれも日次版へ差し替え済み。pg_proc.prosrc と pg_constraint を検索して確認）。
DROP FUNCTION IF EXISTS public.gratitude_points_weekly_used(UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.gratitude_weekly_allowance();

-- 7) 実行権限。既存の週次版と同じ方針に揃える。
--    Supabaseでは EXECUTE が PUBLIC 経由ではなく anon/authenticated へ直接付与されるため、
--    REVOKE ... FROM PUBLIC だけでは不十分（実装メモ.md参照）。ここでは明示的に付け直す。
REVOKE ALL ON FUNCTION public.gratitude_points_daily_used(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gratitude_daily_allowance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.my_gratitude_giveable_balance() TO authenticated;
