-- ============================================================
-- content_reports（アプリ内の報告／お問い合わせ）— 新設・2026-09-20
-- 参照: 設計部/成果物/スキーマ設計.sql 65章
-- 要件定義書 07-32章（決定4・6・8・9・10・30・31・32／未決12番の(A)確定）
-- ============================================================
-- [この章がいちばん気をつけるところ]
--   報告・お問い合わせの内容を読めるのは運営（統括ひとり）だけである。
--   同じ家族の保護者にも見せない（07-32-0c。本部長の決定・2026-09-20）。
--   したがって SELECT の RLS は「送信した本人の行だけ」であり、
--   family_id で絞るだけのポリシーを足してはならない（スキーマ設計.sql
--   65.3章）。is_current_user_parent() も足さない。運営向けのポリシーも
--   足さない（運営は service_role で RLS を迂回して読む）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. content_reports テーブル（スキーマ設計.sql 65.1章）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,

  -- 送信した人。保護者またはみまもりメンバー（子どもは入らない。下記関数参照）。
  reporter_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,

  -- 「だれについてですか」。自由記述・上限50字程度。空欄でもよい（任意）。
  about_text TEXT NULL CHECK (about_text IS NULL OR char_length(trim(about_text)) BETWEEN 1 AND 50),

  -- 「どこで見ましたか」。自由記述・上限50字程度。空欄でもよい（任意）。
  seen_where_text TEXT NULL CHECK (seen_where_text IS NULL OR char_length(trim(seen_where_text)) BETWEEN 1 AND 50),

  -- 「お問い合わせ内容（気になったことがあれば書いてください）」。上限200字。
  -- 一般的な問い合わせの本文も兼ねる（決定31）。空でもよい（任意）。
  note TEXT NULL CHECK (note IS NULL OR char_length(trim(note)) BETWEEN 1 AND 200),

  -- 対応状況。運営が service_role で更新する3値。
  --   'open'      = 未対応
  --   'hidden'    = 対応した（非表示にした場合を含む）
  --   'no_action' = 対応不要
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'hidden', 'no_action')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_reports_family_id ON content_reports(family_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_reporter ON content_reports(reporter_member_id);
-- 運営が「未対応の送信」を1本のSQLで拾うための部分インデックス（65.7章）。
CREATE INDEX IF NOT EXISTS idx_content_reports_open
  ON content_reports(created_at DESC) WHERE status = 'open';

ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE content_reports IS
  '要件定義書07-32章「アプリ内の報告」。決定31により、既存の「お問い合わせ」
   に統合され、一般的な問い合わせも同じ経路で受け付ける。Google Play UGC
   ポリシー（閉じたコミュニティ型）の "must provide in-app functionality to
   report content and users" に対応する。内容を読めるのは運営
   （service_role）だけで、同じ家族の保護者にも見せない（07-32-0c・
   本部長の決定2026-09-20）。SELECTポリシーは「送信した本人の行だけ」で
   あり、family_idだけで絞るポリシーを足してはならない。書き込みは
   submit_content_report()の内部からのみ行われる。対象のID列・理由の
   ラベル列・本文のスナップショット列・種別を区別するenum列は意図的に
   持たない（決定8・決定25・決定31・決定32）。';

COMMENT ON COLUMN content_reports.about_text IS
  '「だれについてですか」（自由記述）。NULLは「書かなかった」。
   メンバーIDのFKは持たない——同じ家族のメンバーかどうかを機械的に検証する
   処理は無い。';
COMMENT ON COLUMN content_reports.seen_where_text IS
  '「どこで見ましたか」（自由記述）。NULLは「書かなかった」。
   6択のCHECKは持たない（画面のプレースホルダに例示語を出す運用は
   スキーマ設計.sql 65.2章）。';
COMMENT ON COLUMN content_reports.note IS
  '「お問い合わせ内容（気になったことがあれば書いてください）」。決定31に
   より、一般的な問い合わせの本文も兼ねる。上限200字。NULLは「書かなかった」。';
COMMENT ON COLUMN content_reports.status IS
  '運営がSupabaseのTable Editor／SQLで更新する対応状況。open=未対応／
   hidden=対応した（非表示にした場合を含む。決定31で意味を広げた）／
   no_action=対応不要。アプリからは更新できない。';

-- ------------------------------------------------------------
-- 2. RLS（スキーマ設計.sql 65.3章。この章の核心）
-- ------------------------------------------------------------
-- 【最重要】SELECTは「送信した本人の行だけ」の1本のみ。family_id で絞る
-- 条件は書かない。is_current_user_parent() も足さない。運営向けの
-- ポリシーも足さない（運営はservice_roleでRLSを迂回して読む）。
DROP POLICY IF EXISTS "content_reports_select_own" ON content_reports;
CREATE POLICY "content_reports_select_own" ON content_reports
  FOR SELECT
  USING (reporter_member_id = current_family_member_id());

-- [重要] INSERT / UPDATE / DELETE のポリシーは意図的に1本も定義しない。
-- RLS有効時、対応するポリシーが1本も無いコマンドは常に拒否される
-- （デフォルト拒否）。
--   - INSERT の経路は下の submit_content_report()（SECURITY DEFINER）だけ。
--   - UPDATE（status の更新）は運営が service_role で行う。
--   - DELETE はアプリからは一切できない。家族ごと削除のCASCADEでのみ消える。

-- ------------------------------------------------------------
-- 3. submit_content_report()（書き込みはここだけ。スキーマ設計.sql 65.4章）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_content_report(
  p_about_text TEXT DEFAULT NULL,
  p_seen_where_text TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
  v_member_id UUID;
  v_role TEXT;
  v_about_text TEXT;
  v_seen_where_text TEXT;
  v_note TEXT;
  v_recent INT;
BEGIN
  v_family_id := public.current_family_id();
  v_member_id := public.current_family_member_id();
  v_role := public.current_family_role();

  IF v_family_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 送れるのは保護者とみまもりメンバーだけ（子どもの導線は作らない）。
  IF v_role IS DISTINCT FROM 'parent' AND v_role IS DISTINCT FROM 'supporter' THEN
    RAISE EXCEPTION 'この操作は保護者とみまもりメンバーのみ利用できます'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 3つとも自由記述。空文字・空白だけは NULL に寄せる（「何も書かずに
  -- 送れる」ため。空文字のまま入れるとCHECK制約に当たってしまう）。
  v_about_text := NULLIF(btrim(COALESCE(p_about_text, '')), '');
  IF v_about_text IS NOT NULL AND char_length(v_about_text) > 50 THEN
    RAISE EXCEPTION '50文字以内で入力してください' USING ERRCODE = 'check_violation';
  END IF;

  v_seen_where_text := NULLIF(btrim(COALESCE(p_seen_where_text, '')), '');
  IF v_seen_where_text IS NOT NULL AND char_length(v_seen_where_text) > 50 THEN
    RAISE EXCEPTION '50文字以内で入力してください' USING ERRCODE = 'check_violation';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
    RAISE EXCEPTION '200文字以内で入力してください' USING ERRCODE = 'check_violation';
  END IF;

  -- 多重送信のガード（企画部の要件には無い設計部の追加。運営へのメール
  -- 通知が1件につき1通飛ぶ設計のため、素通しだと受信箱を溢れさせる経路に
  -- なる。同じ人が直近60秒に5件以上のときだけ止める）。
  SELECT count(*) INTO v_recent
  FROM content_reports cr
  WHERE cr.reporter_member_id = v_member_id
    AND cr.created_at > now() - INTERVAL '60 seconds';
  IF v_recent >= 5 THEN
    RAISE EXCEPTION '短い時間に何度も送信されています。しばらく時間をおいてからお試しください'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO content_reports (
    family_id, reporter_member_id, about_text, seen_where_text, note
  )
  VALUES (
    v_family_id, v_member_id, v_about_text, v_seen_where_text, v_note
  );
END;
$$;

COMMENT ON FUNCTION public.submit_content_report(TEXT, TEXT, TEXT) IS
  'アプリ内の報告・お問い合わせを1件記録する（要件定義書07-32章）。3つの
   引数はいずれも自由記述・いずれも任意（1つも渡さずに呼べる）。保護者と
   みまもりメンバーのみ呼べる（子どものセッションからは
   insufficient_privilege）。返り値を持たないのは履歴画面を作らないため。';

-- ------------------------------------------------------------
-- 4. EXECUTE権限（スキーマ設計.sql 65.6章）
-- ------------------------------------------------------------
-- 子ども用JWTも authenticated ロールで発行されるため、ロールでは子どもを
-- 止められない。止めているのは上の関数内チェックである。
REVOKE ALL ON FUNCTION public.submit_content_report(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_content_report(TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 5. 運営の読み方（スキーマ設計.sql 65.7章。管理画面を作らない代わりの1行SQL）
-- ------------------------------------------------------------
-- 運営はSupabaseのSQL Editorで次を実行する（service_role相当で動くため
-- RLSは迂回される）。マイグレーションとしては何も作らない（参考として
-- コメントに残す）。
--
--   -- 未対応の送信を新しい順に見る
--   SELECT cr.id, cr.created_at, cr.about_text, cr.seen_where_text, cr.note,
--          f.name  AS family_name,
--          rep.display_name AS sender_name
--   FROM content_reports cr
--   JOIN families f ON f.id = cr.family_id
--   JOIN family_members rep ON rep.id = cr.reporter_member_id
--   WHERE cr.status = 'open'
--   ORDER BY cr.created_at DESC;
--
--   -- 対応が済んだら
--   UPDATE content_reports SET status = 'no_action' WHERE id = '<ID>';
--   UPDATE content_reports SET status = 'hidden'    WHERE id = '<ID>';
