-- ============================================================
-- 古いビルドの人に「アップデートしてください」を出す仕組みのDB
-- （表 app_update_policies ＋ 未ログインで呼べる読み取りRPC get_app_update_policy）
-- 2026-10-08・要件定義書07-47章、やること.md 4-97、設計部/成果物/スキーマ設計.sql 85章、
-- 設計部/成果物/API仕様.md 41章、開発部/成果物/実装メモ.md 362章
-- ============================================================
-- 変えるもの: 小さな表を1つ（OS別に最大2行）と、読み取り専用のRPCを1本。
-- 変えないもの: 既存の表・列・View・トリガー・RLSポリシー・既存のRPC・同意の版。
--
-- 設計部85.3・85.4のSQL案のとおり（表の権限・RPCの本文は変えていない）。
--  ・表はRLSを有効にしてポリシーを1本も作らない（default-deny）。アプリは表を直接読めない・書けない。
--  ・読み取りはRPC1本だけ。SECURITY DEFINER・search_path固定・STABLE。anon（未ログイン）にもEXECUTEを付ける。
--  ・行が無い・OSが不正・NULLでもエラーにせず (0, 0, '') を返す（閉じ込めない。要件定義書決定5）。
--  ・書き込みはアプリから一切できない。運用者（統括の確認のうえ）が本番DBで直接UPDATEする
--    （手順の雛形は設計部85.6章、開発部/成果物/実装メモ.md 362章）。
--  ・初期値は両OSとも0（何も出ない）。DBはアプリ（OTA）より先に本番へ入れる。
--  ・家族・メンバー・端末を指す列は1つも無い（個人情報なし）。
--
-- [GRANTの書き方について] 開発部/CLAUDE.mdの決まり文句は「authenticated, service_roleに
-- SELECT/INSERT/UPDATE/DELETE」だが、この表は設計部85.2判断Fのとおり、authenticatedには
-- SELECTだけを付ける（RLSのポリシーが0本なので実際は常に0行。S5の網を弱めないために
-- SELECTだけは付ける）。INSERT/UPDATE/DELETEをauthenticatedに付けないことはrls_checks.sqlの
-- C-U1が見張る。anonへ表のGRANTはしない（読ませ方はRPCのみ。判断B）。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_update_policies (
  platform              TEXT PRIMARY KEY
                          CONSTRAINT chk_app_update_policies_platform CHECK (platform IN ('ios', 'android')),
  required_min_build    INT  NOT NULL DEFAULT 0
                          CONSTRAINT chk_app_update_policies_required CHECK (required_min_build BETWEEN 0 AND 100000),
  recommended_min_build INT  NOT NULL DEFAULT 0
                          CONSTRAINT chk_app_update_policies_recommended CHECK (recommended_min_build BETWEEN 0 AND 100000),
  store_url             TEXT NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_app_update_policies_store_url CHECK (
    store_url IS NULL
    OR (
      char_length(store_url) <= 300
      AND (
        (platform = 'ios'     AND store_url ~ '^https://apps\.apple\.com/[^[:space:]]*$')
        OR
        (platform = 'android' AND store_url ~ '^https://play\.google\.com/[^[:space:]]*$')
      )
    )
  )
);

COMMENT ON TABLE public.app_update_policies IS
  '古いビルドへの「アップデートしてください」の最低ビルド番号（OS別に最大2行）。0は「使わない」。個人・家族・端末の情報は持たない。アプリは直接読まず get_app_update_policy() を使う。書き込みは運用者が本番DBで直接行う（要件定義書07-47章・スキーマ設計.sql 85章）';

-- updated_atは自動記録（運用者がSETに書き忘れても残る）。set_updated_at()は既存（S4に数え済み）
DROP TRIGGER IF EXISTS trg_app_update_policies_updated_at ON public.app_update_policies;
CREATE TRIGGER trg_app_update_policies_updated_at
  BEFORE UPDATE ON public.app_update_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: 有効にしてポリシーを1本も作らない（default-deny）。SECURITY DEFINERのRPC（オーナー=postgres）と
-- service_roleとダッシュボードのSQL Editor（postgres）だけが行に触れる。
-- FORCE ROW LEVEL SECURITYは付けない（RPCのオーナーが読めなくなる）。
ALTER TABLE public.app_update_policies ENABLE ROW LEVEL SECURITY;

-- 権限: 自動付与に頼らず、いったん全部外してから必要な分だけ付ける。
REVOKE ALL ON public.app_update_policies FROM PUBLIC, anon, authenticated;
-- [2026-10-30対策・rls_checks.sqlのS5] authenticatedにSELECTだけ。RLSのポリシーが0本なので実際は常に0行。
-- anonには付けない。authenticatedにINSERT/UPDATE/DELETEは付けない。
GRANT SELECT ON public.app_update_policies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_update_policies TO service_role;

-- 初期データ: 両OSとも0（何も出ない）。DO NOTHING＝再実行しても本番で変えた値を巻き戻さない。
-- AndroidのURLは要件定義書07-47章 決定7の値（パッケージ名はapp.jsonのandroid.package）。iOSは掲載後に運用で入れる。
INSERT INTO public.app_update_policies (platform, required_min_build, recommended_min_build, store_url)
VALUES ('ios',     0, 0, NULL),
       ('android', 0, 0, 'https://play.google.com/store/apps/details?id=jp.soiyalab.oyakopoint')
ON CONFLICT (platform) DO NOTHING;

-- ------------------------------------------------------------
-- RPC: get_app_update_policy（未ログインで呼べる読み取り専用）
-- ------------------------------------------------------------
-- 列名衝突の自己点検（設計部/CLAUDE.mdのルール）: 出力列名（required_min_build等）は表の列名と同じだが、
-- 本文中の表の列参照はすべて別名 p. 付き。変数は v_ 始まり・引数は p_platform で別名。
-- #variable_conflict use_column は保険。例外を投げる文は1つも無い。
CREATE OR REPLACE FUNCTION public.get_app_update_policy(p_platform TEXT)
RETURNS TABLE (required_min_build INT, recommended_min_build INT, store_url TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_required    INT;
  v_recommended INT;
  v_url         TEXT;
BEGIN
  -- 渡されたOSの1行だけを読む。NULL・不正な値・行なしは、どれもINTOの結果がNULLのままになる（STRICTにしない）
  SELECT p.required_min_build, p.recommended_min_build, p.store_url
    INTO v_required, v_recommended, v_url
  FROM public.app_update_policies p
  WHERE p.platform = lower(btrim(p_platform));

  -- 「閉じ込めない」: 何があっても(0, 0, '')＝使わない、に倒れる。エラーにしない
  RETURN QUERY
  SELECT COALESCE(v_required, 0), COALESCE(v_recommended, 0), COALESCE(v_url, '');
END;
$$;

COMMENT ON FUNCTION public.get_app_update_policy(TEXT) IS
  '起動時に呼ぶ読み取り専用RPC。未ログイン(anon)でも呼べる。渡したOS(ios/android)の必須最低・おすすめ最低・ストアURLだけを1行で返す。行なし・不正なOSでもエラーにせず(0,0,'''')を返す。要件定義書07-47章';

REVOKE ALL ON FUNCTION public.get_app_update_policy(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_app_update_policy(TEXT) TO anon, authenticated, service_role;
