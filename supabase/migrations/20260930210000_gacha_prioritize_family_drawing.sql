-- ============================================================
-- 07-13-1章「ガチャ」— 家族の絵を、当てられる絵が1枚でもあれば必ず出す
-- （本部長依頼2026-09-29、軽微変更ルート・統括承認済み）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-13-1章「決定の記録（2026-09-29・統括判断）」
--   設計部/成果物/スキーマ設計.sql 33d章（draw_gacha()）
--   開発部/成果物/実装メモ.md 323章
--
-- 決定（統括判断・2026-09-29）: 引いた人が当てられる家族の絵（自分の絵以外で、
-- 未公開のままストックにある絵）が1枚でもあれば、必ず家族の絵を出す。既製の
-- 飾り（gacha_preset_ornaments、8種）は、当てられる絵が1枚も無いときだけ出す。
-- 却下した案（B案）: 絵の重みを上げつつ、たまに絵文字も出るようにする案。
-- 採らなかった理由は3点（実装メモ323章に詳細）。
--   (1) ガチャの一番の価値は家族の絵が届くことにある
--   (2) 描いた絵がすぐ引かれると、スタンプやコメントが早く返ってくる
--   (3) ストックが空になると絵文字が続くので、それが「また描こう」の
--       きっかけになる
--
-- 破壊性: 既存関数のCREATE OR REPLACEのみで非破壊。テーブル・列・RLS
--   ポリシー・GRANT/REVOKEの追加/削除は無い（draw_gacha()のACLは
--   20260825120000・20260825130000で確立済みのものをそのまま維持し、
--   本ファイルでは一切変更しない）。動作確認は実装メモ.md 323章参照。
-- ============================================================

-- [変更点] 抽選プールの構成方法を変更する。従来は「既製の飾り（重み1×8種=8）＋
-- 未公開の他人の絵（重み3×N枚）」を1つのプールとして加重抽選していたため、
-- 絵の枚数が少ないと絵が出ない確率が高かった（絵1枚で約27%、3枚でも約53%）。
-- 新方式: 当てられる絵（FOR UPDATE SKIP LOCKEDで行ロックを取得できたもの）が
-- 1件以上あれば、その中から等確率で1枚を選ぶ（既製の飾りは候補に入れない）。
-- 0件のときだけ、既製の飾りから従来どおり等確率で1つを選ぶ。
-- [同時実行対策] 家族の絵の候補にFOR UPDATE SKIP LOCKEDを使う点は従来と同じ
-- （「同じ絵が2人に同時に当たる」事故を構造的に防ぐ）。
-- [権利の検証・自分の絵の除外・公開状態への更新・gacha_drawsへの記録・
-- 戻り値の形・SECURITY DEFINER・search_path]はいずれも従来と同じ。
CREATE OR REPLACE FUNCTION public.draw_gacha()
RETURNS TABLE (
  draw_id UUID,
  prize_kind TEXT,
  preset_ornament_id UUID,
  prize_drawing_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_lifetime_count INT;
  v_draw_count INT;
  v_next_threshold INT;
  v_kind TEXT;
  v_ref_id UUID;
  v_new_draw_id UUID;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 行ロックしてから判定する（同一メンバーからの同時多重呼び出しでの二重
  -- 抽選・カウンタ不整合を防ぐ）。行が無ければ「0回」として扱う。
  SELECT lifetime_completion_count, draw_count
    INTO v_lifetime_count, v_draw_count
  FROM gacha_member_progress
  WHERE member_id = v_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_lifetime_count := 0;
    v_draw_count := 0;
  END IF;

  -- [権利の検証] 完了報告数と消費実績（draw_count*5）の差が5以上か。
  v_next_threshold := (v_draw_count + 1) * 5;
  IF v_lifetime_count < v_next_threshold THEN
    RAISE EXCEPTION 'まだガチャを引けません（あと%回の完了報告が必要です）',
      (v_next_threshold - v_lifetime_count)
      USING ERRCODE = 'check_violation';
  END IF;

  -- [抽選本体・2026-09-29改訂] 当てられる絵が1件でもあれば必ず絵から等確率で
  -- 選ぶ。無ければ既製の飾りから等確率で選ぶ（gacha_drawing_weight()は
  -- ここでは使わなくなった。CHECK制約等から呼ばれていないためCOMMENTのみ
  -- 更新し、関数自体は残す）。
  WITH locked_drawings AS (
    SELECT id
    FROM family_drawings
    WHERE family_id = v_family_id
      AND NOT is_published
      AND artist_member_id <> v_member_id -- 自分の絵は自分では引けない
    FOR UPDATE SKIP LOCKED
  ),
  picked_drawing AS (
    SELECT id FROM locked_drawings
    ORDER BY random()
    LIMIT 1
  ),
  picked_ornament AS (
    SELECT id FROM gacha_preset_ornaments
    WHERE is_active
      AND NOT EXISTS (SELECT 1 FROM picked_drawing)
    ORDER BY random()
    LIMIT 1
  )
  SELECT
    CASE WHEN (SELECT id FROM picked_drawing) IS NOT NULL THEN 'family_drawing' ELSE 'preset_ornament' END,
    COALESCE((SELECT id FROM picked_drawing), (SELECT id FROM picked_ornament))
  INTO v_kind, v_ref_id;

  IF v_ref_id IS NULL THEN
    -- 通常運用では到達しない（gacha_preset_ornaments_before_updateがis_active=true
    -- の行を0件にすることを防止しているため、既製の飾りのプールは常に非空）。
    RAISE EXCEPTION '抽選できる景品がありません（運用側の設定を確認してください）' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO gacha_draws (
    family_id, member_id, prize_kind, preset_ornament_id, prize_drawing_id,
    consumed_completion_from, consumed_completion_to
  ) VALUES (
    v_family_id, v_member_id, v_kind,
    CASE WHEN v_kind = 'preset_ornament' THEN v_ref_id END,
    CASE WHEN v_kind = 'family_drawing' THEN v_ref_id END,
    v_draw_count * 5 + 1,
    v_next_threshold
  )
  RETURNING id INTO v_new_draw_id;

  -- 抽選回数を確定させる（上記FOR UPDATEで行ロック済みのため安全に+1できる）。
  UPDATE gacha_member_progress
  SET draw_count = draw_count + 1, updated_at = now()
  WHERE member_id = v_member_id;

  IF v_kind = 'family_drawing' THEN
    -- [方針1と方針2の接続点] ここで初めてis_published=trueになる。
    -- 「引かれた瞬間に家族へ初公開される」をサーバー側の1トランザクションとして実装している。
    UPDATE family_drawings
    SET is_published = true, published_at = now(), revealed_by_draw_id = v_new_draw_id
    WHERE id = v_ref_id;
  END IF;

  RETURN QUERY SELECT
    v_new_draw_id,
    v_kind,
    CASE WHEN v_kind = 'preset_ornament' THEN v_ref_id END,
    CASE WHEN v_kind = 'family_drawing' THEN v_ref_id END;
END;
$$;

COMMENT ON FUNCTION public.draw_gacha() IS
  '要件定義書07-13-1章「ガチャ」。引数を一切取らない（景品をクライアントが指定できないようにするための構造的な設計）。権利検証・プール構成（自分の絵を除外）・抽選・公開状態への更新・gacha_drawsへの記録を1トランザクションで行う。【2026-09-29改訂・統括判断】当てられる家族の絵が1枚でもあれば必ずそれを等確率で選ぶ。絵が0枚のときだけ既製の飾りから等確率で選ぶ（加重抽選ではなくなった）。EXECUTE権限は20260825120000・20260825130000で確立済みのものを維持し、本ファイルでは変更しない。';

-- gacha_drawing_weight()自体は削除しない（GRANT/REVOKE・CHECK制約からの
-- 呼び出しは無く、削除しても実害は無いが、07-13-1章の企画部初期案の値を
-- 参照したい場合に備えて関数定義は残す。draw_gacha()からは呼ばなくなった
-- ことをCOMMENTに明記する）。
COMMENT ON FUNCTION public.gacha_drawing_weight() IS
  '07-13-1章「家族の絵1枚あたりの当選確率を、既製の飾り3個分程度の重みとする」の初出定義（企画部初期案）。【2026-09-29改訂・統括判断】draw_gacha()では使わなくなった。当てられる絵が1枚でもあれば必ず絵を出す方式に変更したため、この関数が返す重み3という値はもはや抽選に反映されない。関数自体はCHECK制約・他関数から呼ばれておらず（開発部が2026-09-29に全マイグレーションを検索して確認済み）、削除しても実害は無いが、経緯を残すため残置する。';
-- ============================================================
