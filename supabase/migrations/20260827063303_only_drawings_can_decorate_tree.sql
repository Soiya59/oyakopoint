-- 開発部/成果物/実装メモ.md 74章、設計部/成果物/スキーマ設計.sql 33e章の改訂。
--
-- [経緯] 第5段階まで完成し実利用が始まった段階で、ユーザーより
-- 「はーととか、おえかき以外は かざらなくてもいいかも」との要望があった。
--
-- 理由（ユーザー談）: 7人程度が参加する家族では、既製の飾りまで全部飾っていると
-- 「木も棚もパンパンになりそう」。完了報告5回ごとに1回引けるため、7人が
-- お手伝いをすれば月に数十回引かれる。既製の飾りが半分出るとして半年で百個以上に
-- なり、木だけでなく棚も埋まる。そうなると**せっかくの家族の絵が埋もれる**。
--
-- [決定] 木に飾れるのは**家族の絵（prize_kind = 'family_drawing'）のみ**とする。
-- 既製の飾りはコレクター棚に永久保管されるが、木には乗せない。
-- 木の上に大きく（36pt）表示される意味があるのは「誰かが描いたもの」だけであり、
-- 汎用の❤️や🎈が並ぶと、木が「みんなの作品が咲く場所」から
-- 「もらったものを並べる場所」に変わってしまうため。
--
-- [「外れ枠を作らない」原則との関係] 07-13-1章で「外れ枠を作らない」と定めており、
-- 既製の飾りが木に飾れなくなることで引いたときの体験に差がつく。ただし
--   - 既製の飾りもコレクター棚に永久保管される（何も得られないわけではない）
--   - 絵と飾りでは元々できることが違うと自然に受け取れる
-- ため、「外れ」と表示したり、がっかりさせる演出を入れない限り問題にならないと
-- 本部長・ユーザー協議で判断した。**UI側に「はずれ」表現を入れないこと。**
--
-- [なぜUIだけでなくDB側で制限するか] クライアントはPostgREST/RPCを直接呼べるため、
-- UI側の出し分けだけでは既製の飾りを木に乗せられてしまう。本アプリでは
-- 「秘匿性はUIではなくRLS・関数で担保する」方針を一貫して採っており（33b章・33d章）、
-- ここでも同じ考え方で関数側に制限を置く。
--
-- [既存データへの影響] 本マイグレーション適用時点で family_tree_decorations は
-- 2件あり、いずれも prize_kind = 'family_drawing'（本部長が本番で確認済み）。
-- 既製の飾りが飾られている行は存在しないため、データの手直しは不要。
-- 既存行を削除・変更する処理は含まない（非破壊）。

CREATE OR REPLACE FUNCTION public.decorate_tree_with_gacha_prize(p_draw_id UUID, p_completion_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_draw RECORD;
  v_completion RECORD;
  v_season_id UUID;
  v_season_start DATE;
  v_decoration_id UUID;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_draw FROM gacha_draws
  WHERE id = p_draw_id AND family_id = v_family_id AND member_id = v_member_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象のガチャ結果が見つかりません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- [2026-08-27追加] 木に飾れるのは家族の絵のみ。既製の飾りは棚に保管するだけで
  -- 木には乗せない（本ファイル冒頭の経緯参照）。
  IF v_draw.prize_kind <> 'family_drawing' THEN
    RAISE EXCEPTION '木に飾れるのは家族の絵だけです' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM family_tree_decorations WHERE draw_id = p_draw_id) THEN
    RAISE EXCEPTION 'この景品はすでに木に飾られています' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_completion FROM chore_completions
  WHERE id = p_completion_id AND family_id = v_family_id AND reported_by = v_member_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の色丸が見つからないか、自分の完了報告ではありません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM family_tree_decorations WHERE completion_id = p_completion_id) THEN
    RAISE EXCEPTION 'この色丸はすでに景品と交換済みです' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, season_start INTO v_season_id, v_season_start
  FROM family_tree_seasons
  WHERE family_id = v_family_id AND season_end IS NULL;

  IF v_season_id IS NULL
     OR date_trunc('month', (v_completion.reported_at AT TIME ZONE 'Asia/Tokyo'))::date <> v_season_start THEN
    RAISE EXCEPTION '今シーズンの色丸のみ交換できます（過去シーズンの木は保存された状態のまま変更できません）'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO family_tree_decorations (family_id, season_id, completion_id, draw_id)
  VALUES (v_family_id, v_season_id, p_completion_id, p_draw_id)
  RETURNING id INTO v_decoration_id;

  RETURN v_decoration_id;
END;
$$;

COMMENT ON FUNCTION public.decorate_tree_with_gacha_prize(UUID, UUID) IS
  '07-13-4章「木への飾り付け」。自分のガチャ結果を自分の今シーズンの色丸と交換する。木に飾れるのは家族の絵のみで、既製の飾りは棚に保管するだけ（2026-08-27決定）。';
