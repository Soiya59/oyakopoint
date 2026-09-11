-- ============================================================
-- メンバーのアバターを自分で描いた絵にできるようにする（本部長からの実装依頼・
-- やること.md 2-41、2026-09-11）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-27章（決定1〜22、本部長採点100点、2026-09-11受理）
--   設計部/成果物/スキーマ設計.sql 54章（決定54-1〜54-13、本部長採点100点）。
--     本ファイルは54.2章・54.3章・54.5章のDDL・RLSをそのまま適用したものであり、
--     独自の変更は加えていない。**ただしDDLの記述順のみ入れ替えた**（下記注記）。
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 43章（決定1〜28、本部長採点100点）
--
-- [開発部での訂正・記述順について] スキーマ設計.sql 54章は54.2（テーブル）→
-- 54.3（検証関数）の順で説明しているが、これは「決定を説明する順序」であり
-- 実行可能なSQLの順序ではない。CREATE TABLEのCHECK制約が
-- `is_valid_avatar_line_data()`を参照するため、**関数を先に作ってからテーブルを
-- 作らないと「function does not exist」で失敗する**。実際に本番へ適用された
-- family_drawings（20260825120000_...sql）も
-- is_valid_drawing_line_data()（154行目）→CREATE TABLE family_drawings
-- （224行目、233行目のCHECKで参照）の順であることをファイルで確認済み。
-- 本ファイルはこの前例と同じ順（関数→テーブル）にする。DDLの中身・値は
-- スキーマ設計.sql 54章から一切変更していない。
--
-- [破壊性] 新規テーブル1つ（member_avatars）・新規関数2つ（is_valid_avatar_line_data・
-- member_avatars_before_write）・新規トリガー2本・新規RLSポリシー2本を追加するのみ。
-- 既存のテーブル（family_members・family_drawings・gacha_draws等）・既存の関数・
-- 既存のポリシーは1つも変更しない（決定54-1・54-11）。
--
-- [RLS照査スイートへの影響（見込み、実測は本部長が適用直前に行う。スキーマ設計.sql
-- 54.11章・54.14章(1)、開発部への業務指示より）]
--   S1（RLSが有効なテーブル数）: +1（member_avatarsを新規にENABLE ROW LEVEL SECURITY）
--   S3（ポリシーの一覧と中身の照合）: +2（member_avatars_select_same_family・
--     member_avatars_write_self_or_parentの2本を新設）
--   S4（authenticatedが実行できる関数の一覧）: +2（is_valid_avatar_line_data・
--     member_avatars_before_writeはいずれもSECURITY DEFINERではなく明示的なREVOKEも
--     行わないため、既存のis_valid_drawing_line_data・chores_before_writeと同じ理由で
--     自動的にauthenticatedへEXECUTE権限が付与される）
--   起点は2026-09-11時点の本部長実測値（2-34適用後 S1=29・S3=57・S4=62）だが、
--   2-35（メダルの値段編集、20260923010000_family_sticker_prices.sql）も同じ起点で
--   未適用のため、実際の最終値は適用順序に依存する。本ファイルはrls_checks.sqlの
--   期待値を変更しない（本部長が適用直前に実測してから追加する、業務指示のとおり）。
-- ============================================================

-- ------------------------------------------------------------
-- 54.3〜54.4 is_valid_avatar_line_data()（アバター専用の検証関数、新設）
-- ------------------------------------------------------------
-- is_valid_drawing_line_data()（family_drawings用、7回改訂の実績あり）とは
-- 意図的に共用しない専用関数（決定54-3）。JSONBスキーマ（{v:1, lines:[{c,p,w?}]}、
-- 座標0〜1000の整数、wは存在すれば2/4/7）はfamily_drawingsと構造的に同一。
-- 上限値のみ、family_drawings拡張前の水準（線数150・合計座標点数3000・
-- シリアライズ後20,480byte=20KB）に据え置く（決定54-2）。パレットは現行選択可能な
-- 10色のみを許可し、旧データ保護専用の色（#E4572E・#E5449B・#F5C518）は
-- 一切含めない（決定54-4。アバターには保護すべき既存データが存在しないため）。
CREATE OR REPLACE FUNCTION public.is_valid_avatar_line_data(p_line_data JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_lines JSONB;
  v_line JSONB;
  v_points JSONB;
  v_point_count INT;
  v_total_points INT := 0;
  v_line_count INT;
  -- oyakopoint-app/src/theme/theme.ts drawingPaletteの現行10色と完全一致
  -- （2026-09-11時点）。
  v_allowed_colors TEXT[] := ARRAY[
    '#2E2E2E', '#DC2626', '#F2913D', '#FFD400', '#FFFFFF',
    '#3FA34D', '#2F80ED', '#FF6FB5', '#8B5CD6', '#8B4513'
  ];
  v_allowed_widths NUMERIC[] := ARRAY[2, 4, 7];
  v_val JSONB;
  v_num NUMERIC;
  v_width JSONB;
BEGIN
  IF p_line_data IS NULL OR jsonb_typeof(p_line_data) <> 'object' THEN RETURN false; END IF;
  IF p_line_data ->> 'v' IS DISTINCT FROM '1' THEN RETURN false; END IF;

  v_lines := p_line_data -> 'lines';
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' THEN RETURN false; END IF;

  v_line_count := jsonb_array_length(v_lines);
  -- 線数上限: 150本（family_drawingsの2026-09-07拡張前の水準）。
  IF v_line_count < 1 OR v_line_count > 150 THEN RETURN false; END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    IF jsonb_typeof(v_line) <> 'object' THEN RETURN false; END IF;
    IF NOT ((v_line ->> 'c') = ANY (v_allowed_colors)) THEN RETURN false; END IF;

    IF v_line ? 'w' THEN
      v_width := v_line -> 'w';
      IF jsonb_typeof(v_width) <> 'number' THEN RETURN false; END IF;
      IF NOT ((v_width::text::numeric) = ANY (v_allowed_widths)) THEN RETURN false; END IF;
    END IF;

    v_points := v_line -> 'p';
    IF v_points IS NULL OR jsonb_typeof(v_points) <> 'array' THEN RETURN false; END IF;

    -- 1本あたりの座標点数上限（300点＝p配列600要素）はfamily_drawingsと同じ値の
    -- まま据え置く（変更なし）。
    v_point_count := jsonb_array_length(v_points);
    IF v_point_count < 2 OR v_point_count > 600 OR v_point_count % 2 <> 0 THEN RETURN false; END IF;

    FOR v_val IN SELECT * FROM jsonb_array_elements(v_points) LOOP
      IF jsonb_typeof(v_val) <> 'number' THEN RETURN false; END IF;
      v_num := v_val::text::numeric;
      IF v_num < 0 OR v_num > 1000 OR v_num <> trunc(v_num) THEN RETURN false; END IF;
    END LOOP;

    v_total_points := v_total_points + (v_point_count / 2);
  END LOOP;

  -- 合計座標点数上限3000・シリアライズ後20,480byte（20KB）上限。
  IF v_total_points > 3000 THEN RETURN false; END IF;
  IF octet_length(p_line_data::text) > 20480 THEN RETURN false; END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.is_valid_avatar_line_data(JSONB) IS
  '要件定義書07-27章。member_avatars.line_dataのスキーマ検証。JSONBの形式・座標範囲・太さ(w)の扱いはis_valid_drawing_line_data()と共通だが、上限値（線数150・合計座標点数3000・シリアライズ後20,480byte=20KB以下）とパレット（現行選択可能な10色のみ、旧データ保護用の色は含めない）を意図的に分離している（理由: スキーマ設計.sql 54.3章）。is_valid_drawing_line_data()とは無関係の別関数であり、どちらか一方を改訂しても他方は一切影響を受けない。';

-- [EXECUTE権限] is_valid_drawing_line_data()と同じ扱い（33g章の教訓）。CHECK制約からの
-- 呼び出しはロールに関わらず動作する必要があるため、PUBLICへのEXECUTEを維持する
-- （REVOKEしない）。member_avatars_before_write()も同様にトリガー関数でありSECURITY
-- DEFINERではないため、新規関数作成時にauthenticatedへEXECUTE権限が自動付与される
-- 既知の挙動（34.5章）をそのまま受け入れる（明示的なREVOKEは行わない）。

-- ------------------------------------------------------------
-- 54.2 member_avatars（新設テーブル）
-- ------------------------------------------------------------
-- [行の有無で「描いたかどうか」を表す] family_drawingsと同じく、「絵が無い」状態を
-- NULL列ではなく行の不在で表す。決定1「デフォルトは現状のまま」＝行が無ければ
-- family_members.avatar_color＋display_name先頭1文字（既存のMemberAvatar表示）が
-- そのまま使われる。決定5・決定20〜22「元に戻す」＝行のDELETE。
--
-- [avatar_colorを複製しない] 色は引き続きfamily_members.avatar_colorのみが単一の
-- 情報源（決定54-6）。
--
-- [family_id列を持たせる理由] family_drawings（33b章）・chore_nfc_tags（39.2章）と
-- 同じく、所属先を辿れる列（member_id）とは別にfamily_idを冗長に持つ。RLSの
-- USING句がfamily_membersへの結合無しにfamily_id = current_family_id()だけで
-- 完結できる。
CREATE TABLE IF NOT EXISTS member_avatars (
  member_id UUID PRIMARY KEY REFERENCES family_members(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  line_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_member_avatars_line_data CHECK (public.is_valid_avatar_line_data(line_data))
);

-- クライアントの主な読み出しパターンは「自分の家族のアバター一覧をまとめて1回取る」
-- （54.7章）であり、family_id単体の索引で足りる（PKはmember_id単体のため別途必要）。
CREATE INDEX IF NOT EXISTS idx_member_avatars_family_id ON member_avatars(family_id);

ALTER TABLE member_avatars ENABLE ROW LEVEL SECURITY;

-- [改ざん防止トリガー] 本テーブルは決定12により「保護者が他人のmember_idを指定して
-- INSERT/UPDATEする」正当な経路を持つ。「member_idは自分の家族のメンバーか」を
-- RLSのUSING/WITH CHECKのfamily_id一致だけに委ねると、クライアントが
-- 「member_idは他家族のメンバーだがfamily_idは自分の家族」という偽装行を送った場合に
-- 素通りしてしまう恐れがある。19章chores_before_write()のassigned_to検証と同じ考え方で、
-- 対象member_idの実際のfamily_idをサーバー側で引き直し、NEW.family_idを強制的に
-- 上書きする（改ざん防止パターン）。
--
-- [列名衝突の回避（設計部CLAUDE.mdの遵守事項）] 本関数はRETURNS TRIGGERであり、
-- RETURNS TABLEの出力列名との衝突は原理的に起こらない。NEW/OLD以外の裸の列参照は
-- 一切書いていない。
CREATE OR REPLACE FUNCTION public.member_avatars_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_member_family_id UUID;
BEGIN
  SELECT fm.family_id INTO v_member_family_id FROM family_members fm WHERE fm.id = NEW.member_id;
  IF v_member_family_id IS NULL THEN
    RAISE EXCEPTION '指定されたメンバーが存在しません' USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.family_id := v_member_family_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_member_avatars_before_write ON member_avatars;
CREATE TRIGGER trg_member_avatars_before_write
  BEFORE INSERT OR UPDATE ON member_avatars
  FOR EACH ROW EXECUTE FUNCTION public.member_avatars_before_write();

DROP TRIGGER IF EXISTS trg_member_avatars_updated_at ON member_avatars;
CREATE TRIGGER trg_member_avatars_updated_at
  BEFORE UPDATE ON member_avatars
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE member_avatars IS
  '要件定義書07-27章。メンバーが自分で描いた絵をアバターとして使う機能（決定1〜5）。行が存在しない＝未設定（既定の色丸＋頭文字のまま、決定1）。行のDELETE＝「元に戻す」（決定5・決定20〜22）。family_drawings（07-13-2章のガチャ用お絵かき）とは完全に独立（決定6〜8、is_publishedを持たない・ガチャの抽選対象外・未公開3枚上限のカウント対象外）。色（avatar_color）は複製せずfamily_membersのみを単一の情報源とする。';

-- ------------------------------------------------------------
-- 54.5 RLS（決定11〜14の実現）
-- ------------------------------------------------------------
-- family_members_update_scoped（初期スキーマ244〜248行目）と全く同じ条件式
-- （本人または保護者）を複製するだけであり、新しい判定ロジックは何も追加しない。
DROP POLICY IF EXISTS "member_avatars_select_same_family" ON member_avatars;
CREATE POLICY "member_avatars_select_same_family" ON member_avatars
  FOR SELECT
  USING (family_id = current_family_id());

-- [FOR ALLでINSERT/UPDATE/DELETEをまとめて1本にする理由] 決定11（本人の描く・
-- 描き直す・消す）と決定12（保護者代理の同じ3操作）はいずれもINSERT/UPDATE/DELETEの
-- 3操作すべてに同じ権限境界が適用されるべきであり、family_members_update_scopedの
-- ようにUPDATE専用にする必要が無い。
DROP POLICY IF EXISTS "member_avatars_write_self_or_parent" ON member_avatars;
CREATE POLICY "member_avatars_write_self_or_parent" ON member_avatars
  FOR ALL
  USING (
    family_id = current_family_id()
    AND (is_current_user_parent() OR member_id = current_family_member_id())
  )
  WITH CHECK (
    family_id = current_family_id()
    AND (is_current_user_parent() OR member_id = current_family_member_id())
  );

-- [決定11〜14が過不足なく成立することの確認]
--   決定11（本人）: member_id = current_family_member_id() が真になるため、
--     role（child/parent/supporter）を問わず自分の行はINSERT/UPDATE/DELETEできる。
--   決定12（保護者は家族全員分）: is_current_user_parent()が真であればmember_idの
--     一致を問わず全行がUSING/WITH CHECKを満たす。
--   決定13（みまもりは自分の分のみ）: role='supporter'はis_current_user_parent()が
--     常にfalse。したがってmember_id = current_family_member_id()（＝自分自身）で
--     なければ両条件とも成立せず、他人の行には一切触れない。
--   決定14（第三者不可）: 決定13と対称に自動的に閉じる。
