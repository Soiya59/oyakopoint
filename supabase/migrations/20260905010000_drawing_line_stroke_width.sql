-- ============================================================
-- 07-13-2章拡張「お絵かきの線の太さの保存対応（線データへの`w`追加）」
-- （2026-09-05・統括がB案〔線の太さの選択＋上限到達の通知〕を承認）
-- ============================================================
-- 参照:
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 21.5b節（決定20〜25）・
--     21.5c節（決定26〜31）、デザイントークン.md「線の太さ（3段階）」
--   設計部/成果物/スキーマ設計.sql 44章（44.1〜44.11。is_valid_drawing_line_data()の
--     DDL本体〔44.5章〕は下記へそのまま写している。33b章の色ホワイトリストが本番と
--     乖離していた〔44.5章「重要な発見」〕ため、33b章の記述ではなくAPI仕様.md
--     記載の実際の本番ホワイトリスト〔10色〕を採用している）
--   設計部/成果物/API仕様.md 12.2節・12.2b節・11章（エラー一覧）
--   開発部/成果物/実装メモ.md 131章（本マイグレーション対応章）
--
-- [背景] 統括経由の利用者の声（みまもりの方より）「もっと詳細な絵を描きたい、
-- クオリティーが低い絵しか描けない」を受け、直径280ptの円形キャンバスに対し
-- 線の太さが4pt固定だった問題を解消する。線データの各線オブジェクトへ`w`
-- （太さ、2/4/7のいずれか）を追加できるようにし、`is_valid_drawing_line_data()`を
-- 改訂する。
--
-- 破壊性: 非破壊的。`family_drawings`テーブルへのALTER TABLEは無い（line_data列は
-- 元からJSONB型で、`w`キーの追加はJSONBオブジェクトの中身の変更にとどまる、
-- 44.2章）。既存14枚（公開9・未公開5、本部長確認済み・2026-09-05時点）はいずれも
-- `w`キーを持たないが、`w`キーが無い線は無条件で有効とする設計（44.3章）のため、
-- 本マイグレーション適用後もそのまま読み書き（読み取りのみ、公開済み9枚は編集・
-- 削除不可）できる。CHECK制約はINSERT/UPDATE時にのみ評価され、関数本体の変更で
-- 既存行が遡って再検証されることは無い。
--
-- 適用順序: 本マイグレーションは、対応するクライアント改修（太さ選択UI・
-- `line.w`の描画反映・上限通知・`theme.ts`の`maxBytes`定数更新）より先に、または
-- 同一デプロイで適用すること（44.9章）。旧クライアントは`w`キーを一切送らないため、
-- DB先行（本マイグレーションを先に適用し、旧クライアントがまだ稼働中）の状態でも
-- 新しいCHECK制約は`w`キー無しの線を無条件で許可するので後方互換のとおり動作する
-- （安全）。クライアントを先にデプロイする順序は避ける（44.9章の表のとおり
-- 「非推奨」であり、旧DBのバイト数上限〈20,480〉が新クライアントの想定〈21,504〉
-- より小さいままの基準ズレが起こりうる）。
--
-- 権限影響: なし。EXECUTE権限は変更しない（44.6章）。CREATE OR REPLACE FUNCTIONは
-- 既存のACL（PUBLICへのEXECUTE維持）を保持したまま関数本体のみを差し替える。
--
-- RLS照査スイート（oyakopoint-app/supabase/tests/rls_checks.sql）への影響:
-- S1（RLS有効テーブル数）・S3（ポリシー本数の定義照合）・S4（authenticatedが
-- 実行できる関数の件数照合）のいずれも±0の見込み（44.7章）。新規テーブル・
-- 新規ポリシー・新規GRANT/REVOKEを一切行わないため。適用後、開発部/成果物/
-- 実装メモ.md 131章の手順に従いS1/S3/S4を実測し、見込みどおり±0であることを
-- 確認すること（96章の運用手順）。
--
-- [重要] 本マイグレーションはまだ本番に適用していない（作成のみ）。
-- 適用は本部長の操作を待つ（開発部/成果物/実装メモ.md 131章参照）。
-- ============================================================

-- ------------------------------------------------------------
-- is_valid_drawing_line_data() 改訂DDL本体（スキーマ設計.sql 44.5章）
-- ------------------------------------------------------------
-- シグネチャは不変（p_line_data JSONB）。40.7章・83.2章の教訓（引数リストが
-- 変わる場合は別オーバーロードとして扱われ旧シグネチャの明示DROPが必要）は
-- ここでは該当しない。DROP FUNCTIONは不要。CREATE OR REPLACEのみで既存の
-- 呼び出し元（chk_family_drawings_line_data制約・family_drawings_before_insert
-- トリガー・edit_unpublished_drawing()）はすべて変更不要のまま新しい検証ロジックを
-- 使うようになる。

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
    '#E4572E', '#E5449B'  -- 旧パレット（あか・ピンク）。20260829150000で
                           -- 変更された旧色。既存データ保護のため残置
                           -- （削除しない。API仕様.md 12.2節参照）
  ]; -- 07-13-2章決定済みの8色パレット＋旧2色（本番の実際のホワイトリスト。
     -- スキーマ設計.sql 44.5章コメント参照。33b章の記述〈8色のみ〉は乖離しており
     -- 本マイグレーションでは使わない）
  v_allowed_widths NUMERIC[] := ARRAY[2, 4, 7]; -- 44.1章・決定20の3値
  v_val JSONB;
  v_num NUMERIC;
  v_width JSONB;
BEGIN
  IF p_line_data IS NULL OR jsonb_typeof(p_line_data) <> 'object' THEN RETURN false; END IF;
  IF p_line_data ->> 'v' IS DISTINCT FROM '1' THEN RETURN false; END IF;

  v_lines := p_line_data -> 'lines';
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' THEN RETURN false; END IF;

  v_line_count := jsonb_array_length(v_lines);
  IF v_line_count < 1 OR v_line_count > 150 THEN RETURN false; END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    IF jsonb_typeof(v_line) <> 'object' THEN RETURN false; END IF;
    IF NOT ((v_line ->> 'c') = ANY (v_allowed_colors)) THEN RETURN false; END IF;

    -- [44.3章・後方互換] "w"キーが無い線は、旧データ（太さ保存前に描かれた
    -- 線）または将来のクライアント実装として許可し、拒否しない。
    -- キーが存在する場合のみ、決定20の3値（2/4/7）のいずれかであることを
    -- 検証する（cの8色〈+旧2色〉ホワイトリスト判定と同じ考え方）。
    IF v_line ? 'w' THEN
      v_width := v_line -> 'w';
      IF jsonb_typeof(v_width) <> 'number' THEN RETURN false; END IF;
      IF NOT ((v_width::text::numeric) = ANY (v_allowed_widths)) THEN RETURN false; END IF;
    END IF;

    v_points := v_line -> 'p';
    IF v_points IS NULL OR jsonb_typeof(v_points) <> 'array' THEN RETURN false; END IF;

    v_point_count := jsonb_array_length(v_points);
    IF v_point_count < 2 OR v_point_count > 600 OR v_point_count % 2 <> 0 THEN RETURN false; END IF;

    FOR v_val IN SELECT * FROM jsonb_array_elements(v_points) LOOP
      IF jsonb_typeof(v_val) <> 'number' THEN RETURN false; END IF;
      v_num := v_val::text::numeric;
      IF v_num < 0 OR v_num > 1000 OR v_num <> trunc(v_num) THEN RETURN false; END IF;
    END LOOP;

    v_total_points := v_total_points + (v_point_count / 2);
  END LOOP;

  IF v_total_points > 3000 THEN RETURN false; END IF;
  -- [44.4章] 20,480byte（20KB）→ 21,504byte（21KB）。`w`追加による決定論的な
  -- 最大増分（150本×6byte＝900byte）を安全に吸収するための引き上げであり、
  -- 線数・点数の上限（＝描ける複雑さ）自体は変更していない。
  IF octet_length(p_line_data::text) > 21504 THEN RETURN false; END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.is_valid_drawing_line_data(JSONB) IS
  '07-13-2章「線データ」のスキーマ検証・悪意ある巨大データ対策。線数(1-150)・1本あたり座標点数(1-300)・合計座標点数(3000以下)・座標値(0-1000の整数)・色(8色固定パレット+旧2色)・太さ(存在する場合のみ2/4/7を検証、44章)・シリアライズ後バイト数(21504byte=21KB以下、44.4章)を検証する。数値の根拠は33b章・44章コメント参照。';
