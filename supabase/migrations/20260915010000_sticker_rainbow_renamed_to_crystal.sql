-- ============================================================
-- メダルの最上位レアリティ「虹（rainbow）」を「クリスタル（crystal）」に改称
-- （本部長からの業務指示、統括判断・2026-09-08）
-- ============================================================
-- 参照:
--   本部長からの業務指示（統括判断・実装メモ173章、2026-09-08「やること.md
--   5-10」着手）。統括の原文「新しい絵に差し替えました。crystalに差し替えて
--   ください。rainbowと記載されたやつは削除してください。あと、クリスタル感が
--   出たと思うので、虹からクリスタルにメダルの名前を変えて欲しい」。
--   開発部/成果物/実装メモ.md 173章
--
-- [経緯・前提が変わったことの記録] 同じ2026-09-08のうちに、いったんは
-- 「虹でいこう」と決めた経緯がある（旧・統括提供の絵がホログラム調で虹の名に
-- 忠実、銅・銀・金と並んだときの座りも良い、という開発部の具申による）。
-- その後、統括が絵を作り直したことで前提が変わった（「クリスタル感が出た」）。
-- 4段階の構成（銅・銀・金・クリスタル）自体は変わらない。最上位の呼び名のみを
-- 置き換える。
--
-- [本部長が確認した事実] 2026-09-08時点、`rarity='rainbow'`の3行
-- （beetle_rainbow／butterfly_rainbow／flower_rainbow）はいずれも購入実績
-- 0件（`ornament_sticker_purchases`全体でも1件のみで、それは別レアリティ）。
-- 移行対象のデータが無いため、本マイグレーションはガード（下記0.）で0件を
-- 確認したうえで、単純な値の置き換えとして実装する。
--
-- 破壊性:
--   (1) `sticker_catalog`の既存3行を書き換える（`rarity`・`sticker_key`・
--       `display_name`）。0.のガードにより、この3行を参照する
--       `ornament_sticker_purchases`行が存在しないことを適用前に確認する
--       （存在した場合はガードがRAISE EXCEPTIONで処理を止める。外部キー
--       `ornament_sticker_purchases.sticker_catalog_id`は`id`を参照しており
--       `rarity`列そのものは参照しないため、仮にガードを通っても外部キー
--       違反は起きないが、購入記録が突然「クリスタル」を指すことになるのは
--       意図しない履歴の書き換えのため、事前ガードで止める設計にした）。
--   (2) `sticker_catalog_rarity_check`（CHECK制約）を張り替える。
--       `ARRAY['bronze','silver','gold','rainbow']`→
--       `ARRAY['bronze','silver','gold','crystal']`。実行順序は
--       「DROP CONSTRAINT→UPDATE（(1)）→ADD CONSTRAINT」。
--       [ローカル検証で判明・修正した点] 当初は「UPDATE→DROP→ADD」の順で
--       書いていたが、PostgreSQLは同一トランザクション内でも各DML文の実行時点で
--       有効な制約定義を見るため、制約をまだ外していない状態でUPDATEを実行すると
--       旧制約（`rainbow`のみ許容）に新しい値`crystal`が弾かれてマイグレーション
--       自体が失敗した（`npx supabase db push --local`で実測）。DROPを先頭に
--       移動して解決した。
--   (3) `purchase_sticker(UUID)`をCREATE OR REPLACEする。引数・戻り値の
--       列名は一切変更していない（シグネチャ無変更）ため、83.2章の
--       「旧シグネチャの明示DROPが必要」という教訓は本変更には当てはまらない。
--       CREATE OR REPLACEは同一シグネチャなら既存のGRANT/REVOKE設定をそのまま
--       保持するため、権限の再設定も不要（20260909010000・20260910010000・
--       20260911010000の申し送りと同じ）。変更点は段階解放ロジックの
--       `WHEN 'rainbow' THEN 'gold'`を`WHEN 'crystal' THEN 'gold'`に
--       書き換えるのみ（判定ロジック自体は無変更）。あわせてCOMMENT ON
--       FUNCTIONの説明文中の「虹」も「クリスタル」に更新する（DBの
--       メタデータが実装と食い違ったまま残らないようにするため）。
--
--   影響を受けないことを確認した「rainbow」の別件: 過去のマイグレーション
--   `20260825120000_gacha_drawing_tree_decoration_foundation.sql`の
--   `gacha_preset_ornaments`初期データに`('rainbow', 'にじ', '🌈')`という
--   行があるが、これはガチャの既製の飾り（ornament_key）であり、本改称の
--   対象であるメダルのレアリティ（sticker_catalog.rarity）とは無関係の
--   別機能・別テーブルのため、変更しない。
--
--   既存の適用済みマイグレーションファイル（20260907020000・20260911010000等）
--   は書き換えない（経緯が読めなくなるため。20260910010000の同じ方針を踏襲）。
--   本ファイルが最新仕様の記録になる。
--
-- [RLS照査への影響] GRANT/REVOKE・RLSポリシー・トリガーは一切変更しない。
--   `purchase_sticker(UUID)`はシグネチャ無変更のCREATE OR REPLACEのため
--   `supabase/tests/rls_checks.sql`のS4（authenticated実行可能な関数の
--   一覧）はproname単位の差分検査であり、本変更後もproname
--   `purchase_sticker`は変わらず存在し続けるため差分は出ない見込み。
--   S1/S3についても本変更はポリシー・トリガーを追加/削除しないため差分なしの
--   見込み。本部長の業務指示どおり、適用後に実測して確認する（実測値が
--   想定と異なった場合は期待値を書き換えず報告する＝96.5章の教訓）。
-- ============================================================


-- ------------------------------------------------------------
-- 0. ガード: 移行対象の3行（rarity='rainbow'）に購入履歴が無いことを確認する
-- ------------------------------------------------------------
-- 本部長が2026-09-08時点で確認した「購入実績0件」という前提が崩れていないかを
-- 適用直前に再確認する。崩れていた場合は黙って書き換えず処理を止める。
DO $$
DECLARE
  v_purchase_count INT;
BEGIN
  SELECT count(*) INTO v_purchase_count
  FROM ornament_sticker_purchases osp
  JOIN sticker_catalog sc ON sc.id = osp.sticker_catalog_id
  WHERE sc.rarity = 'rainbow';

  IF v_purchase_count > 0 THEN
    RAISE EXCEPTION 'rarity=rainbowのメダルに購入履歴が%件あります。本部長が確認した「購入実績0件」という前提が崩れているため、実装メモ173章の単純な値置き換えでは移行できません。処理を中断しました。手動での移行方針の検討が必要です', v_purchase_count;
  END IF;
END;
$$;


-- ------------------------------------------------------------
-- 1. CHECK制約を先に外す（PostgreSQLは同一トランザクション内でも各DML文の
--    実行時点で有効な制約定義を見るため、UPDATEより先に外す必要がある。
--    ローカル検証で「DROPを2.に後回しにする」順序のまま流したところ、
--    2026-09-15の適用時点で旧制約に弾かれてUPDATEが失敗することを実測で確認した。
--    実装メモ173章「動作確認」参照）
-- ------------------------------------------------------------
ALTER TABLE sticker_catalog DROP CONSTRAINT IF EXISTS sticker_catalog_rarity_check;


-- ------------------------------------------------------------
-- 2. sticker_catalog の既存3行を書き換える
-- ------------------------------------------------------------
UPDATE sticker_catalog
SET
  rarity = 'crystal',
  sticker_key = replace(sticker_key, '_rainbow', '_crystal'),
  display_name = CASE shape
    WHEN 'beetle'    THEN 'クリスタルのカブトムシ'
    WHEN 'butterfly' THEN 'クリスタルのちょうちょ'
    WHEN 'flower'    THEN 'クリスタルのちいさなはな'
  END
WHERE rarity = 'rainbow';


-- ------------------------------------------------------------
-- 3. CHECK制約を新しい許容値で張り直す（2.で全行が新しい許容値に収まった後に行う）
-- ------------------------------------------------------------
ALTER TABLE sticker_catalog ADD CONSTRAINT sticker_catalog_rarity_check
  CHECK (rarity IN ('bronze', 'silver', 'gold', 'crystal'));


-- ------------------------------------------------------------
-- 4. purchase_sticker(UUID) — 20260911010000時点の内容を踏襲し、
--    段階解放ロジックの参照レアリティのみ書き換える
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purchase_sticker(p_catalog_id UUID)
RETURNS TABLE (
  purchase_id UUID,
  sticker_catalog_id UUID,
  points_spent INT,
  purchased_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_catalog RECORD;
  v_required_rarity TEXT;
  v_balance INT;
  v_new_id UUID;
  v_purchased_at TIMESTAMPTZ;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_catalog FROM sticker_catalog WHERE id = p_catalog_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '指定されたメダルが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- [重要・変更なし] 本関数のRETURNS TABLEはsticker_catalog_id・points_spent・
  -- purchased_atという列名を持ち、いずれもornament_sticker_purchasesの実列名と
  -- 一致する。plpgsqlの既定（variable_conflict=error）により、テーブル別名
  -- （osp）を必ず付けて列を修飾すること（20260907020000の既存コメントを踏襲）。

  -- [2026-09-11時点・変更なし] 月次購入上限のチェック（決定31）は決定39により撤廃済み。

  -- [2026-09-15改訂・本改称にあわせた書き換え] 段階購入制の参照レアリティを
  -- 'rainbow'から'crystal'に変更した。判定ロジック自体（CASE分岐の構造・
  -- EXISTS判定の条件）は20260911010000から一切変えていない。
  IF v_catalog.rarity <> 'bronze' THEN
    v_required_rarity := CASE v_catalog.rarity
      WHEN 'silver' THEN 'bronze'
      WHEN 'gold' THEN 'silver'
      WHEN 'crystal' THEN 'gold'
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM ornament_sticker_purchases osp
      JOIN sticker_catalog sc ON sc.id = osp.sticker_catalog_id
      WHERE osp.family_id = v_family_id
        AND sc.shape = v_catalog.shape
        AND sc.rarity = v_required_rarity
    ) THEN
      RAISE EXCEPTION 'このメダルはまだ買えません。家族の誰かがひとつ下のレアリティを買うと購入できるようになります'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- 残高チェック（無変更。決定22: ポイントは現金で発行・販売しない）。
  SELECT current_points INTO v_balance FROM member_points WHERE member_id = v_member_id;
  v_balance := COALESCE(v_balance, 0);

  IF v_balance < v_catalog.points_cost THEN
    RAISE EXCEPTION 'ポイントが不足しています。必要: %pt、保有: %pt', v_catalog.points_cost, v_balance
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO ornament_sticker_purchases AS osp (family_id, member_id, sticker_catalog_id, points_spent)
  VALUES (v_family_id, v_member_id, p_catalog_id, v_catalog.points_cost)
  RETURNING osp.id, osp.purchased_at INTO v_new_id, v_purchased_at;

  RETURN QUERY SELECT v_new_id, p_catalog_id, v_catalog.points_cost, v_purchased_at;
END;
$$;

COMMENT ON FUNCTION public.purchase_sticker(UUID) IS
  '要件定義書07-19-14章（決定32〜38、2026-09-11改訂）。段階購入制（銅は無条件、銀・金・クリスタルは同じ形のひとつ下のレアリティを家族の誰かが過去に購入したことがある場合のみ購入可。判定はornament_sticker_purchasesへのEXISTS、家族単位・購入者本人は問わない）・残高チェック（member_points）を満たした場合のみornament_sticker_purchasesへ記録する。月次購入上限は決定39により撤廃した（同じ種類を何枚でも購入できる）。取消経路は無い（決定24）。画面に出るメッセージの呼び名は「メダル」（152章）。最上位レアリティの呼び名は2026-09-08に「虹」から「クリスタル」へ改称した（実装メモ173章）。';

-- [権限について] REVOKE/GRANTの再実行は不要。CREATE OR REPLACE FUNCTIONは
-- 引数リスト（シグネチャ）が同一である限り同一のオブジェクト（同一OID）を
-- 更新するだけであり、20260907020000で設定済みのGRANT EXECUTE TO
-- authenticated・REVOKE ALL FROM PUBLIC, anon はそのまま維持される
-- （PostgreSQLの仕様。RLS照査スイートS4の実測でも変化が無いことを確認する。
-- 実装メモ143章・161章・173章参照）。
