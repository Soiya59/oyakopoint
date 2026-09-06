-- ============================================================
-- 07-13-2章拡張「お絵かきの上限拡張（線数・点数・バイト数）とパレット10色化」
-- （2026-09-07・統括の実体験〔塗り絵で上限到達・白が欲しい〕への対応）
-- ============================================================
-- 参照:
--   設計部/成果物/スキーマ設計.sql 46章（46.1〜46.11、決定46-1〜46-8）
--   設計部/成果物/API仕様.md 12.2c節（および12.2・12.2b・11章の改訂）
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 21.5d節（決定32〜39）
--   UIUXデザイン部/成果物/デザイントークン.md 1.9節
--   開発部/成果物/実装メモ.md 136章（本マイグレーション対応章）
--
-- [背景] 統括が実際に塗り絵をして手が止まった絵は86本・21,463byte
-- （旧上限21,504byteの99.8%）で、線数・点数の上限（150本・3000点）には
-- 届いていなかった。バイト数だけが先に効いていたため、線数300本・合計点数
-- 6000点・バイト数65,536byteへ引き上げる（スキーマ設計.sql 46.2章）。
-- あわせてパレットに「しろ」「ちゃいろ」を追加し10色化、「きいろ」を改訂する
-- （主要画面ワイヤーフレーム.md 21.5d節）。
--
-- [色の最終値について] スキーマ設計.sql 46.3章はUIUXデザイン部の選定を
-- 待つプレースホルダ`'#UIUX_TBD'`を置いていたが、UIUX側の当初案
-- （ちゃいろ`#C66339`・きいろ`#D5C40B`）はいずれも統括の目視により却下され、
-- 本部長の裁定で下記に置き換わっている（主要画面ワイヤーフレーム.md 21.5d節
-- 決定35'・決定39それぞれの直前にある「【統括決定・2026-09-07・本部長注記】」）。
--   - ちゃいろ: `#C66339`（案） → `#8B4513`（確定、CSS名 saddlebrown）
--   - きいろ : `#D5C40B`（案） → `#FFD400`（確定、明るい純粋な黄）
-- 本マイグレーションは`'#UIUX_TBD'`をこの2色（＋しろ`#FFFFFF`）に置き換えて
-- 適用する。プレースホルダをそのまま含めていない。
--
-- 破壊性: 非破壊的。`family_drawings`テーブルへのALTER TABLEは無い
-- （line_data列は元からJSONB型）。46.5章の数学的な保証（検証条件を緩める
-- 方向にしか変更していない）により、既存の絵はすべて改訂後も無条件で有効。
--
-- 適用順序: 本マイグレーションは、対応するクライアント改修（theme.tsの
-- 上限値・パレット更新、DrawingPalette.tsxの5列化）より先に、または
-- 同一デプロイで適用すること（46.9章）。旧クライアントは常に旧上限・旧8色
-- 以内でしか送らないため、DB先行は安全（46.9章の表のとおり）。
--
-- 権限影響: なし。EXECUTE権限は変更しない（46.6章）。CREATE OR REPLACE
-- FUNCTIONは既存のACL（PUBLICへのEXECUTE維持）を保持したまま関数本体のみを
-- 差し替える。
--
-- RLS照査スイート（oyakopoint-app/supabase/tests/rls_checks.sql）への影響:
-- S1・S3・S4のいずれも±0の見込み（46.7章）。新規テーブル・新規ポリシー・
-- 新規GRANT/REVOKEを一切行わないため。適用後、開発部/成果物/実装メモ.md
-- 136章の手順に従いS1/S3/S4を実測し、見込みどおり±0であることを確認する。
--
-- [重要] 本マイグレーションはまだ本番に適用していない（作成のみ）。
-- 適用は本部長の操作を待つ（開発部/成果物/実装メモ.md 136章参照）。
-- ============================================================

-- ------------------------------------------------------------
-- is_valid_drawing_line_data() 改訂DDL本体（スキーマ設計.sql 46.4章）
-- ------------------------------------------------------------
-- シグネチャは不変（p_line_data JSONB）。DROP FUNCTIONは不要。
-- CREATE OR REPLACEのみで既存の呼び出し元（chk_family_drawings_line_data制約・
-- family_drawings_before_insertトリガー・edit_unpublished_drawing()）はすべて
-- 変更不要のまま新しい検証ロジックを使うようになる。
--
-- [20260905010000のDDLとの差分は以下の4点のみ]
--   (1) v_line_count上限を150→300に変更。
--   (2) v_total_points上限を3000→6000に変更。
--   (3) octet_lengthの比較値を21504→65536に変更。
--   (4) v_allowed_colorsに'#FFFFFF'・'#8B4513'・'#FFD400'の3色を追加
--       （10色→13色）。
-- それ以外（v/lines/1本あたり座標点数の範囲2〜600・座標値0〜1000の検証・
-- wの3値検証・total_pointsの集計ロジック）は完全に同一。

CREATE OR REPLACE FUNCTION public.is_valid_drawing_line_data(p_line_data JSONB)
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
  v_allowed_colors TEXT[] := ARRAY[
    '#2E2E2E', '#F2913D', '#F5C518', '#3FA34D', '#2F80ED', '#8B5CD6',
    '#DC2626', '#FF6FB5', -- 現行パレット（あか・ピンク）
    '#E4572E', '#E5449B', -- 旧パレット（あか・ピンク）。20260829150000で
                           -- 変更された旧色。既存データ保護のため残置
                           -- （削除しない。API仕様.md 12.2節参照）
    '#FFFFFF',             -- 【2026-09-07追加】しろ（統括決定済みhex、
                           -- 主要画面ワイヤーフレーム.md 21.5d節 決定32〜34）
    '#8B4513',             -- 【2026-09-07追加】ちゃいろ（本部長裁定の確定色。
                           -- UIUXデザイン部の当初案`#C66339`は統括の目視で
                           -- 却下され、定番の茶`#8B4513`〈saddlebrown〉に
                           -- 置き換わった。21.5d節 決定35' 直前の
                           -- 「【統括決定・2026-09-07・本部長注記】」参照）
    '#FFD400'              -- 【2026-09-07追加】改訂後きいろ（本部長裁定の
                           -- 確定色。UIUXデザイン部の当初案`#D5C40B`は
                           -- 統括の目視で却下され、明るい純粋な黄`#FFD400`に
                           -- 置き換わった。旧`#F5C518`は既存データ保護のため
                           -- 上記のとおり引き続き残置する）
  ]; -- 07-13-2章決定済みの8色パレット＋旧2色＋しろ＋ちゃいろ＋改訂後きいろ
     -- ＝13色（実装メモ.md 136章参照）
  v_allowed_widths NUMERIC[] := ARRAY[2, 4, 7]; -- 44.1章・決定20の3値（変更なし）
  v_val JSONB;
  v_num NUMERIC;
  v_width JSONB;
BEGIN
  IF p_line_data IS NULL OR jsonb_typeof(p_line_data) <> 'object' THEN RETURN false; END IF;
  IF p_line_data ->> 'v' IS DISTINCT FROM '1' THEN RETURN false; END IF;

  v_lines := p_line_data -> 'lines';
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' THEN RETURN false; END IF;

  v_line_count := jsonb_array_length(v_lines);
  -- [46.4章(1)] 150→300（46.1章・46.2.1章）。
  IF v_line_count < 1 OR v_line_count > 300 THEN RETURN false; END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    IF jsonb_typeof(v_line) <> 'object' THEN RETURN false; END IF;
    IF NOT ((v_line ->> 'c') = ANY (v_allowed_colors)) THEN RETURN false; END IF;

    -- [44.3章・後方互換] "w"キーが無い線は、旧データ（太さ保存前に描かれた
    -- 線）または将来のクライアント実装として許可し、拒否しない。
    -- キーが存在する場合のみ、決定20の3値（2/4/7）のいずれかであることを
    -- 検証する（cの色ホワイトリスト判定と同じ考え方）。
    IF v_line ? 'w' THEN
      v_width := v_line -> 'w';
      IF jsonb_typeof(v_width) <> 'number' THEN RETURN false; END IF;
      IF NOT ((v_width::text::numeric) = ANY (v_allowed_widths)) THEN RETURN false; END IF;
    END IF;

    v_points := v_line -> 'p';
    IF v_points IS NULL OR jsonb_typeof(v_points) <> 'array' THEN RETURN false; END IF;

    -- [変更なし・46.1章] 1本あたりの座標点数上限（300点＝p配列600要素）は
    -- 統括指示により据え置く。
    v_point_count := jsonb_array_length(v_points);
    IF v_point_count < 2 OR v_point_count > 600 OR v_point_count % 2 <> 0 THEN RETURN false; END IF;

    FOR v_val IN SELECT * FROM jsonb_array_elements(v_points) LOOP
      IF jsonb_typeof(v_val) <> 'number' THEN RETURN false; END IF;
      v_num := v_val::text::numeric;
      IF v_num < 0 OR v_num > 1000 OR v_num <> trunc(v_num) THEN RETURN false; END IF;
    END LOOP;

    v_total_points := v_total_points + (v_point_count / 2);
  END LOOP;

  -- [46.4章(2)] 3000→6000（46.1章・46.2.1章）。
  IF v_total_points > 6000 THEN RETURN false; END IF;
  -- [46.4章(3)] 21504→65536（46.2.2章に見積もりの根拠を記載）。
  IF octet_length(p_line_data::text) > 65536 THEN RETURN false; END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.is_valid_drawing_line_data(JSONB) IS
  '07-13-2章「線データ」のスキーマ検証・悪意ある巨大データ対策。線数(1-300、46章)・1本あたり座標点数(1-300)・合計座標点数(6000以下、46章)・座標値(0-1000の整数)・色(13色、46章＋しろ/ちゃいろ/改訂後きいろ)・太さ(存在する場合のみ2/4/7を検証)・シリアライズ後バイト数(65536byte=64KB以下、46章)を検証する。数値の根拠は33b章・44章・46章コメント参照。';
